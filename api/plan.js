const { isAuthenticated, json, readBody } = require("./_shared");

const PLAN_KEY = process.env.PLAN_KV_KEY || "zach-zoey:halloween-yard-plan";
const GITHUB_REPO = process.env.PLAN_GITHUB_REPO || "buddytohelpu/zach-zoey-halloween-planner";
const GITHUB_PATH = process.env.PLAN_GITHUB_PATH || ".data/plan.json";
const GITHUB_BRANCH = process.env.PLAN_GITHUB_BRANCH || "plan-data";
const MAX_DIMENSION_FT = 113;
const COLORS = new Set(["coral", "yellow", "teal", "plum", "blue"]);

function storageConfig() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  };
}

async function redis(command) {
  const { url, token } = storageConfig();
  if (!url || !token) throw new Error("Vercel KV is not configured");
  const result = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command)
  });
  const body = await result.json();
  if (!result.ok || body.error) throw new Error(body.error || "KV request failed");
  return body.result;
}

function cleanConfiguredValue(value) {
  return String(value || "")
    .trim()
    .replace(/^[\"'](.*)[\"']$/, "$1")
    .replace(/\\r\\n|\\n|\\r/g, "")
    .trim();
}

function githubConfig() {
  return {
    token: cleanConfiguredValue(process.env.PLAN_GITHUB_TOKEN),
    repo: cleanConfiguredValue(GITHUB_REPO),
    path: cleanConfiguredValue(GITHUB_PATH),
    branch: cleanConfiguredValue(GITHUB_BRANCH)
  };
}

function githubUrl(config) {
  const path = encodeURIComponent(config.path).replace(/%2F/g, "/");
  return `https://api.github.com/repos/${config.repo}/contents/${path}?ref=${encodeURIComponent(config.branch)}`;
}

async function githubRequest(method, body) {
  const config = githubConfig();
  if (!config.token) throw new Error("GitHub storage is not configured");
  const response = await fetch(githubUrl(config), {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "User-Agent": "zach-zoey-halloween-planner",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let payload = null;
  try { payload = await response.json(); } catch (error) { /* empty response */ }
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(payload?.message || "GitHub storage request failed");
    if (response.status === 409) error.code = "CONFLICT";
    throw error;
  }
  return payload;
}

function number(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function cleanItem(raw, index) {
  const widthFt = number(raw.widthFt, 1, MAX_DIMENSION_FT, 10);
  const depthFt = number(raw.depthFt, 1, MAX_DIMENSION_FT, 10);
  return {
    id: String(raw.id || `item-${index}`).slice(0, 100),
    name: String(raw.name || "New setup").slice(0, 40),
    type: String(raw.type || "Other").slice(0, 40),
    widthFt,
    depthFt,
    x: number(raw.x, 0, 100, 50),
    y: number(raw.y, 0, 100, 50),
    rotation: Math.round(number(raw.rotation, -180, 180, 0) / 5) * 5,
    color: COLORS.has(raw.color) ? raw.color : "blue",
    reference: String(raw.reference || "").slice(0, 50),
    notes: String(raw.notes || "").slice(0, 240)
  };
}

function parsePlan(raw, storageSha = null) {
  if (!raw) return { revision: 0, items: null, updatedAt: null, storageSha };
  try {
    const parsed = JSON.parse(raw);
    return {
      revision: number(parsed.revision, 0, Number.MAX_SAFE_INTEGER, 0),
      items: Array.isArray(parsed.items) ? parsed.items.map(cleanItem) : null,
      updatedAt: parsed.updatedAt || null,
      storageSha
    };
  } catch (error) {
    return { revision: 0, items: null, updatedAt: null, storageSha };
  }
}

async function readPlan() {
  const redisSettings = storageConfig();
  if (redisSettings.url && redisSettings.token) {
    return parsePlan(await redis(["GET", PLAN_KEY]));
  }
  const file = await githubRequest("GET");
  if (!file?.content) return parsePlan(null);
  const raw = Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
  return parsePlan(raw, file.sha);
}

async function writePlan(next, current) {
  const redisSettings = storageConfig();
  if (redisSettings.url && redisSettings.token) {
    await redis(["SET", PLAN_KEY, JSON.stringify(next)]);
    return;
  }
  const content = Buffer.from(`${JSON.stringify(next, null, 2)}\n`, "utf8").toString("base64");
  await githubRequest("PUT", {
    message: "Update shared Halloween yard plan",
    content,
    branch: githubConfig().branch,
    ...(current.storageSha ? { sha: current.storageSha } : {})
  });
}

function publicPlan(plan) {
  const { storageSha, ...result } = plan;
  return result;
}

module.exports = async function plan(request, response) {
  if (!isAuthenticated(request)) return json(response, 401, { error: "Authentication required" });
  if (request.method !== "GET" && request.method !== "PUT") {
    response.setHeader("Allow", "GET, PUT");
    return json(response, 405, { error: "Method not allowed" });
  }
  try {
    const current = await readPlan();
    if (request.method === "GET") return json(response, 200, publicPlan(current));

    const body = readBody(request);
    if (!Array.isArray(body.items) || body.items.length > 300) {
      return json(response, 400, { error: "The plan must contain 300 items or fewer" });
    }
    const expectedRevision = number(body.revision, 0, Number.MAX_SAFE_INTEGER, 0);
    if (expectedRevision !== current.revision) {
      return json(response, 409, { error: "The plan changed in another browser", ...publicPlan(current) });
    }
    const next = {
      revision: current.revision + 1,
      items: body.items.map(cleanItem),
      updatedAt: new Date().toISOString()
    };
    try {
      await writePlan(next, current);
    } catch (error) {
      if (error.code === "CONFLICT") {
        const latest = await readPlan();
        return json(response, 409, { error: "The plan changed in another browser", ...publicPlan(latest) });
      }
      throw error;
    }
    return json(response, 200, next);
  } catch (error) {
    console.error("Plan storage error", error.message);
    return json(response, 503, { error: "Shared storage is not configured" });
  }
};
