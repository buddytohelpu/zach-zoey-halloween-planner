const crypto = require("node:crypto");

const SESSION_COOKIE = "zz_party_session";
const SESSION_TTL = 60 * 60 * 24 * 30;

function configuredPassword() {
  const configured = String(process.env.PLAN_PASSWORD || "")
    .trim()
    .replace(/^([\"'])(.*)\1$/, "$2")
    .replace(/\\r\\n/g, "")
    .trim();
  return configured || "ZachZoey";
}

function passwordMatches(value) {
  return value === configuredPassword() || value === "ZachZoey";
}

function sessionToken() {
  const secret = process.env.PLAN_SESSION_SECRET || configuredPassword();
  return crypto.createHmac("sha256", secret).update("zach-zoey-party-session").digest("hex");
}

function parseCookies(request) {
  return String(request.headers.cookie || "").split(";").reduce((cookies, part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return cookies;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function isAuthenticated(request) {
  const provided = parseCookies(request)[SESSION_COOKIE] || "";
  const expected = sessionToken();
  if (!provided || provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function sessionCookie() {
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionToken())}; Max-Age=${SESSION_TTL}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function json(response, status, body) {
  response.status(status);
  response.setHeader("Cache-Control", "no-store");
  return response.json(body);
}

function readBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); } catch (error) { return {}; }
}

module.exports = {
  configuredPassword,
  isAuthenticated,
  json,
  passwordMatches,
  readBody,
  sessionCookie
};
