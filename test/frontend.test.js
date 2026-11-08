import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function response(status, body, nonJson = false) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      if (nonJson) throw new SyntaxError("Unexpected token <");
      return body;
    }
  };
}

function browser({ token = "", hostname = "manuellaski-gif.github.io", fetchImpl,
  storageFailures = [], speechFails = false } = {}) {
  const elements = new Map();
  const requests = [];
  const opened = [];
  const timers = new Map();
  const saved = new Map(token ? [["jarvis_session", token]] : []);
  let timerId = 0;
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: "", textContent: "", hidden: false, disabled: false,
      dataset: {}, listeners: new Map(),
      addEventListener(name, callback) { this.listeners.set(name, callback); },
      focus() { this.focused = true; }
    });
    return elements.get(id);
  }
  const actions = ["Wie spät ist es?", "Öffne Kalender", "Öffne Google", "Gib mir eine Geschäftsidee"]
    .map((command, index) => {
      const button = element(`action${index}`);
      button.dataset.cmd = command;
      return button;
    });
  const controls = [element("submit"), element("mic"), ...actions];
  const context = vm.createContext({
    window: {
      location: { hostname },
      open(...args) { opened.push(args); },
      speechSynthesis: {
        cancel() { if (speechFails) throw new Error("Speech unavailable"); },
        speak() {}
      }
    },
    document: {
      querySelector(selector) { return element(selector.replace(/^#/, "")); },
      querySelectorAll(selector) {
        if (selector === "[data-cmd]") return actions;
        if (selector === "#form button, [data-cmd]") return controls;
        throw new Error(`Unexpected selector ${selector}`);
      }
    },
    sessionStorage: {
      getItem(key) {
        if (storageFailures.includes("get")) throw new Error("Storage blocked");
        return saved.get(key) ?? null;
      },
      setItem(key, value) {
        if (storageFailures.includes("set")) throw new Error("Storage blocked");
        saved.set(key, value);
      },
      removeItem(key) {
        if (storageFailures.includes("remove")) throw new Error("Storage blocked");
        saved.delete(key);
      }
    },
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      return fetchImpl ? fetchImpl(url, options) : response(200, { reply: "Hallo Boss." });
    },
    AbortController,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    console
  });
  vm.runInContext(script, context);
  return {
    element, requests, opened, saved, timers, controls,
    answer(command) { return vm.runInContext(`answer(${JSON.stringify(command)})`, context); },
    login() { return vm.runInContext("login()", context); }
  };
}

test("restores a saved session without another login request", () => {
  const page = browser({ token: "saved-session" });
  assert.equal(page.element("loginPanel").hidden, true);
  assert.equal(page.element("status").textContent, "● VERBUNDEN");
  assert.equal(page.requests.length, 0);
});

test("only explicit clock requests bypass the AI", async () => {
  const page = browser({ token: "session" });
  await page.answer("Wie spät ist es?");
  assert.match(page.element("reply").textContent, /Uhr\.$/);
  assert.equal(page.requests.length, 0);
  for (const command of ["Erkläre Zeitmanagement", "Wie funktioniert eine Uhr?", "Was ist die Ruhr?"]) {
    await page.answer(command);
    assert.equal(JSON.parse(page.requests.at(-1).body).message, command);
  }
  assert.equal(page.requests.length, 3);
});

test("typed calendar and Google commands use the same local actions as buttons", async () => {
  const page = browser();
  await page.answer("Öffne Kalender");
  await page.answer("Google öffnen!");
  assert.equal(page.opened[0][0], "https://calendar.google.com/");
  assert.equal(page.opened[1][0], "https://www.google.com/");
  assert.equal(page.requests.length, 0);
});

test("prompts mentioning calendar or Google are still sent to the AI", async () => {
  const page = browser({ token: "session" });
  await page.answer("Erkläre den Google Kalender");
  assert.equal(page.requests.length, 1);
  assert.equal(page.opened.length, 0);
});

test("requires login before sending an AI message", async () => {
  const page = browser();
  await page.answer("Hallo");
  assert.equal(page.requests.length, 0);
  assert.equal(page.element("password").focused, true);
  assert.match(page.element("loginNote").textContent, /zuerst an/);
});

test("uses same-origin API locally and preserves the existing production endpoint", async () => {
  for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
    const page = browser({ token: "session", hostname });
    await page.answer("Hallo");
    assert.equal(page.requests[0].url, "/api/chat");
  }
  const production = browser({ token: "session" });
  await production.answer("Hallo");
  assert.equal(production.requests[0].url, "https://jarvis-iphone-qxi0.onrender.com/api/chat");
  assert.equal(production.requests[0].headers.Authorization, "Bearer session");
});

test("blocks duplicate chat requests and restores controls after the reply", async () => {
  let finish;
  const page = browser({ token: "session", fetchImpl: () => new Promise(resolve => { finish = resolve; }) });
  const first = page.answer("Erste Frage");
  assert.ok(page.controls.every(button => button.disabled));
  assert.equal(page.element("command").disabled, true);
  await page.answer("Zweite Frage");
  assert.equal(page.requests.length, 1);
  finish(response(200, { reply: "Erste Antwort" }));
  await first;
  assert.equal(page.element("reply").textContent, "Erste Antwort");
  assert.ok(page.controls.every(button => !button.disabled));
  assert.equal(page.timers.size, 0);
});

test("blocks duplicate login including Enter and restores controls", async () => {
  let finish;
  const page = browser({ fetchImpl: () => new Promise(resolve => { finish = resolve; }) });
  page.element("password").value = "test-password-only";
  const first = page.login();
  assert.equal(page.element("loginButton").disabled, true);
  await page.login();
  page.element("password").listeners.get("keydown")({ key: "Enter", preventDefault() {} });
  assert.equal(page.requests.length, 1);
  finish(response(200, { token: "new-session" }));
  await first;
  assert.equal(page.saved.get("jarvis_session"), "new-session");
  assert.equal(page.element("loginPanel").hidden, true);
  assert.equal(page.element("password").value, "");
  assert.equal(page.element("loginButton").disabled, false);
});

test("clears an expired session even when a 401 body is not JSON", async () => {
  const page = browser({ token: "expired", fetchImpl: () => response(401, null, true) });
  await page.answer("Hallo");
  assert.equal(page.saved.has("jarvis_session"), false);
  assert.equal(page.element("loginPanel").hidden, false);
  assert.match(page.element("reply").textContent, /Sitzung ist abgelaufen/);
  assert.ok(page.controls.every(button => !button.disabled));
  await page.answer("Hallo nochmal");
  assert.equal(page.requests.length, 1);
});

test("shows useful errors for HTML hosting failures and invalid successful responses", async () => {
  const failed = browser({ token: "session", fetchImpl: () => response(502, null, true) });
  await failed.answer("Hallo");
  assert.match(failed.element("reply").textContent, /KI-Anfrage fehlgeschlagen/);
  assert.doesNotMatch(failed.element("reply").textContent, /Unexpected token/);
  const invalid = browser({ token: "session", fetchImpl: () => response(200, null, true) });
  await invalid.answer("Hallo");
  assert.match(invalid.element("reply").textContent, /keine gültige Antwort/);
});

test("preserves the server's safe rate-limit error message", async () => {
  const page = browser({ token: "session", fetchImpl: () => response(429, { error: "Bitte eine Minute warten." }) });
  await page.answer("Hallo");
  assert.equal(page.element("reply").textContent, "Bitte eine Minute warten.");
});

test("aborts requests after 45 seconds and allows retry", async () => {
  const page = browser({ token: "session", fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }) });
  const pending = page.answer("Hallo");
  const timer = [...page.timers.values()][0];
  assert.equal(timer.delay, 45000);
  timer.callback();
  await pending;
  assert.equal(page.requests[0].signal.aborted, true);
  assert.match(page.element("reply").textContent, /nicht rechtzeitig/);
  assert.ok(page.controls.every(button => !button.disabled));
  assert.equal(page.timers.size, 0);
});

test("browser storage and speech failures do not break a successful login or chat", async () => {
  const page = browser({
    storageFailures: ["get", "set", "remove"], speechFails: true,
    fetchImpl: url => url.endsWith("/api/login")
      ? response(200, { token: "memory-session" }) : response(200, { reply: "Text remains available" })
  });
  page.element("password").value = "test-password-only";
  await page.login();
  assert.equal(page.element("loginPanel").hidden, true);
  await page.answer("Hallo");
  assert.equal(page.requests[1].headers.Authorization, "Bearer memory-session");
  assert.equal(page.element("reply").textContent, "Text remains available");
  assert.equal(page.element("headline").textContent, "Antwort bereit");
});

test("login hosting failures restore controls and show a readable message", async () => {
  const page = browser({ fetchImpl: () => response(503, null, true) });
  page.element("password").value = "test-password-only";
  await page.login();
  assert.match(page.element("loginNote").textContent, /Anmeldung fehlgeschlagen/);
  assert.equal(page.element("loginButton").disabled, false);
  assert.equal(page.element("loginPanel").hidden, false);
});
