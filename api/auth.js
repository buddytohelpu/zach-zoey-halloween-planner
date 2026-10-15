const { isAuthenticated, json, passwordMatches, readBody, sessionCookie } = require("./_shared");

module.exports = async function auth(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "GET") {
    return json(response, 200, { authenticated: isAuthenticated(request) });
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return json(response, 405, { error: "Method not allowed" });
  }
  const body = readBody(request);
  if (typeof body.password !== "string" || !passwordMatches(body.password)) {
    return json(response, 401, { error: "Incorrect password" });
  }
  response.setHeader("Set-Cookie", sessionCookie());
  return json(response, 200, { authenticated: true });
};
