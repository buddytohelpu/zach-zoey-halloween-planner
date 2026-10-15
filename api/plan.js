const { isAuthenticated, json, readBody } = require("./_shared");

const PLAN_KEY = process.env.PLAN_KV_KEY || "zach-zoey:halloween-yard-plan";
const FRONTAGE_FT = 95;
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

function number(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function cleanItem(raw, index) {
  const widthFt = number(raw.widthFt, 1, FRONTAGE_FT, 10);
  const depthFt = number(raw.depthFt, 1, FRONTAGE_FT, 10);
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

async function readPlan() {
  const raw = await redis(["GET", PLAN_KEY]);
  if (!raw) return { revision: 0, items: null, updatedAt: null };
  try {
    const parsed = JSON.parse(raw);
    return {
      revision: number(parsed.revision, 0, Number.MAX_SAFE_INTEGER, 0),
      items: Array.isArray(parsed.items) ? parsed.items.map(cleanItem) : null,
      updatedAt: parsed.updatedAt || null
    };
  } catch (error) {
    return { revision: 0, items: null, updatedAt: null };
  }
}

module.exports = async function plan(request, response) {
  if (!isAuthenticated(request)) return json(response, 401, { error: "Authentication required" });
  if (request.method !== "GET" && request.method !== "PUT") {
    response.setHeader("Allow", "GET, PUT");
    return json(response, 405, { error: "Method not allowed" });
  }
  try {
    const current = await readPlan();
    if (request.method === "GET") return json(response, 200, current);

    const body = readBody(request);
    if (!Array.isArray(body.items) || body.items.length > 300) {
      return json(response, 400, { error: "The plan must contain 300 items or fewer" });
    }
    const expectedRevision = number(body.revision, 0, Number.MAX_SAFE_INTEGER, 0);
    if (expectedRevision !== current.revision) {
      return json(response, 409, { error: "The plan changed in another browser", ...current });
    }
    const next = {
      revision: current.revision + 1,
      items: body.items.map(cleanItem),
      updatedAt: new Date().toISOString()
    };
    await redis(["SET", PLAN_KEY, JSON.stringify(next)]);
    return json(response, 200, next);
  } catch (error) {
    console.error("Plan storage error", error.message);
    return json(response, 503, { error: "Shared storage is not configured" });
  }
};
