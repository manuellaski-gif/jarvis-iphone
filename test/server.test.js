import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../server.js";

const testPassword = "synthetic-test-password-only";
const baseEnv = {
  GROQ_API_KEY: "synthetic-groq-test-key",
  JARVIS_PASSWORD: testPassword
};
const completion = { choices: [{ message: { content: "Hallo, Boss." } }] };

function providerResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function start(t, env = {}, upstream = () => providerResponse(completion)) {
  const upstreamRequests = [];
  const app = createApp({
    env: { ...baseEnv, ...env },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      upstreamRequests.push({
        url: request.url,
        authorization: request.headers.get("Authorization"),
        body: JSON.parse(await request.text())
      });
      return upstream();
    }
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { body, rawBody, token, headers, method, ...options } = {}) {
    const hasBody = body !== undefined || rawBody !== undefined;
    return fetch(origin + path, {
      ...options,
      method: method || (hasBody ? "POST" : "GET"),
      headers: {
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      ...(hasBody ? { body: rawBody ?? JSON.stringify(body) } : {})
    });
  }
  async function login(headers) {
    const response = await request("/api/login", {
      body: { password: testPassword }, headers
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const { token } = await response.json();
    assert.match(token, /^[a-f0-9]{64}$/);
    return token;
  }
  return { request, login, upstreamRequests };
}

test("startup validates provider, credentials, password bounds and proxy configuration", () => {
  assert.throws(() => createApp({ env: {} }), /GROQ_API_KEY fehlt/);
  assert.throws(() => createApp({ env: { ...baseEnv, AI_PROVIDER: "other" } }), /AI_PROVIDER/);
  assert.throws(() => createApp({ env: { ...baseEnv, AI_PROVIDER: "openai" } }), /OPENAI_API_KEY fehlt/);
  for (const password of [undefined, "", "x".repeat(15), "x".repeat(257)]) {
    assert.throws(() => createApp({ env: { ...baseEnv, JARVIS_PASSWORD: password } }), /JARVIS_PASSWORD/);
  }
  for (const password of ["x".repeat(16), "x".repeat(256)]) {
    assert.doesNotThrow(() => createApp({ env: { ...baseEnv, JARVIS_PASSWORD: password } }));
  }
  for (const trustProxy of ["-1", "1.5", "true", "invalid"]) {
    assert.throws(() => createApp({ env: { ...baseEnv, TRUST_PROXY: trustProxy } }), /TRUST_PROXY/);
  }
});

test("health and public app work without serving project or credential files", async t => {
  const { request } = await start(t);
  const health = await request("/");
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("X-Powered-By"), null);
  assert.deepEqual(await health.json(), { status: "JARVIS Server online" });
  const page = await request("/app");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("Content-Type"), /text\/html/);
  assert.match(await page.text(), /<title>J\.A\.R\.V\.I\.S\./);
  for (const path of ["/.env", "/.env.example", "/server.js", "/package.json", "/.git/config"]) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
    assert.deepEqual(await response.json(), { error: "Nicht gefunden." });
  }
});

test("real SDK serializes Groq endpoint, key, model and chat message", async t => {
  const { request, login, upstreamRequests } = await start(t, {
    OPENAI_API_KEY: "synthetic-unused-openai-key",
    GROQ_MODEL: "test-groq-model"
  });
  const token = await login();
  const response = await request("/api/chat", { token, body: { message: "  Hallo  " } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { reply: "Hallo, Boss." });
  assert.equal(upstreamRequests.length, 1);
  assert.equal(upstreamRequests[0].url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(upstreamRequests[0].authorization, "Bearer synthetic-groq-test-key");
  assert.equal(upstreamRequests[0].body.model, "test-groq-model");
  assert.equal(upstreamRequests[0].body.max_tokens, 400);
  assert.equal(upstreamRequests[0].body.messages[0].role, "system");
  assert.deepEqual(upstreamRequests[0].body.messages[1], { role: "user", content: "Hallo" });
});

test("Groq uses its default model when no override is configured", async t => {
  const { request, login, upstreamRequests } = await start(t);
  const response = await request("/api/chat", { token: await login(), body: { message: "Hallo" } });
  assert.equal(response.status, 200);
  await response.json();
  assert.equal(upstreamRequests[0].body.model, "llama-3.3-70b-versatile");
});

test("existing OpenAI configuration remains usable without a Groq key", async t => {
  const { request, login, upstreamRequests } = await start(t, {
    GROQ_API_KEY: undefined,
    OPENAI_API_KEY: "synthetic-openai-test-key"
  });
  const response = await request("/api/chat", { token: await login(), body: { message: "Hallo" } });
  assert.equal(response.status, 200);
  await response.json();
  assert.equal(upstreamRequests[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(upstreamRequests[0].authorization, "Bearer synthetic-openai-test-key");
  assert.equal(upstreamRequests[0].body.model, "gpt-4o-mini");
});

test("explicit provider selection and OpenAI model override take precedence", async t => {
  const { request, login, upstreamRequests } = await start(t, {
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "synthetic-selected-openai-key",
    OPENAI_MODEL: "test-openai-model"
  });
  const response = await request("/api/chat", { token: await login(), body: { message: "Hallo" } });
  assert.equal(response.status, 200);
  await response.json();
  assert.equal(upstreamRequests[0].authorization, "Bearer synthetic-selected-openai-key");
  assert.equal(upstreamRequests[0].body.model, "test-openai-model");
});

test("successful logins do not exhaust failed-login allowance and reset failures", async t => {
  const { request, login } = await start(t);
  for (let i = 0; i < 7; i++) await login();
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 4; i++) {
      const failed = await request("/api/login", { body: { password: "wrong" } });
      assert.equal(failed.status, 401);
      await failed.json();
    }
    await login();
  }
});

test("failed logins are throttled and untrusted forwarded IPs cannot bypass this", async t => {
  const { request } = await start(t);
  for (let i = 0; i < 5; i++) {
    const failed = await request("/api/login", {
      body: { password: "wrong" }, headers: { "X-Forwarded-For": `192.0.2.${i + 1}` }
    });
    assert.equal(failed.status, 401);
    await failed.json();
  }
  const blocked = await request("/api/login", {
    body: { password: testPassword }, headers: { "X-Forwarded-For": "192.0.2.99" }
  });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
  assert.match((await blocked.json()).error, /Zu viele Versuche/);
});

test("configured reverse proxy isolates failed-login limits by client IP", async t => {
  const { request, login } = await start(t, { TRUST_PROXY: "1" });
  for (let i = 0; i < 5; i++) {
    const response = await request("/api/login", {
      body: { password: "wrong" }, headers: { "X-Forwarded-For": "192.0.2.1" }
    });
    assert.equal(response.status, 401);
    await response.json();
  }
  const blocked = await request("/api/login", {
    body: { password: testPassword }, headers: { "X-Forwarded-For": "192.0.2.1" }
  });
  assert.equal(blocked.status, 429);
  await blocked.json();
  await login({ "X-Forwarded-For": "192.0.2.2" });
});

test("chat authenticates Bearer tokens, validates before quota and limits actual requests", async t => {
  const { request, login, upstreamRequests } = await start(t);
  const token = await login();
  for (const authorization of [undefined, token, "Bearer invalid", `Basic ${token}`]) {
    const response = await request("/api/chat", {
      body: { message: "Hallo" },
      headers: authorization ? { Authorization: authorization } : {}
    });
    assert.equal(response.status, 401);
    await response.json();
  }
  for (const message of [undefined, "", "  ", 42, {}, [], "x".repeat(2001)]) {
    const response = await request("/api/chat", { token, body: { message } });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Ungültige Nachricht/);
  }
  for (let i = 0; i < 5; i++) {
    const response = await request("/api/chat", { token, body: { message: "Hallo" } });
    assert.equal(response.status, 200);
    await response.json();
  }
  const limited = await request("/api/chat", { token, body: { message: "Hallo" } });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("Retry-After")) > 0);
  await limited.json();
  assert.equal(upstreamRequests.length, 5);
});

test("malformed and oversized JSON return JSON errors", async t => {
  const { request } = await start(t);
  const malformed = await request("/api/login", {
    rawBody: '{"password":'
  });
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /Ungültige JSON-Anfrage/);
  const oversized = await request("/api/login", { body: { password: "x".repeat(21000) } });
  assert.equal(oversized.status, 413);
  assert.match((await oversized.json()).error, /zu groß/);
});

test("configured CORS origins receive permission and other origins do not", async t => {
  const { request } = await start(t, { ALLOWED_ORIGINS: "https://example.test, http://localhost:3000" });
  const allowed = await request("/", { headers: { Origin: "https://example.test" } });
  assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), "https://example.test");
  await allowed.json();
  const denied = await request("/", { headers: { Origin: "https://other.test" } });
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
  await denied.json();
});

for (const { name, upstream, status, message } of [
  {
    name: "upstream rate limit", status: 429, message: /KI-Limit/,
    upstream: () => providerResponse({ error: { message: "private upstream detail" } }, 429)
  },
  {
    name: "upstream authentication failure", status: 503, message: /vorübergehend/,
    upstream: () => providerResponse({ error: { message: "private upstream detail" } }, 401)
  },
  {
    name: "upstream outage", status: 503, message: /vorübergehend/,
    upstream: () => providerResponse({ error: { message: "private upstream detail" } }, 500)
  },
  {
    name: "upstream timeout", status: 504, message: /zu langsam/,
    upstream: () => { throw Object.assign(new Error("private upstream detail"), { name: "AbortError" }); }
  },
  {
    name: "empty completion", status: 502, message: /Keine KI-Antwort/,
    upstream: () => providerResponse({ choices: [] })
  }
]) {
  test(`${name} returns a safe error without leaking upstream detail`, async t => {
    const { request, login, upstreamRequests } = await start(t, {}, upstream);
    const response = await request("/api/chat", { token: await login(), body: { message: "Hallo" } });
    assert.equal(response.status, status);
    const body = await response.json();
    assert.match(body.error, message);
    assert.doesNotMatch(JSON.stringify(body), /private upstream detail|synthetic-groq-test-key/);
    assert.equal(upstreamRequests.length, 1, "Do not retry limited upstream requests");
    if (status === 429) assert.equal(response.headers.get("Retry-After"), "60");
  });
}
