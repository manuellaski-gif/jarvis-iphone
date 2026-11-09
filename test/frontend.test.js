import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function response(status, body, nonJson = false, contentType = "application/json") {
  return {
    status,
    headers: new Headers({ "Content-Type": contentType }),
    ok: status >= 200 && status < 300,
    async json() {
      if (nonJson) throw new SyntaxError("Unexpected token <");
      return body;
    }
  };
}

function browser({ token = "", hostname = "manuellaski-gif.github.io", fetchImpl,
  storageFailures = [], speechFails = false, voiceMode = "off", voices = [],
  audioState = "running", resumeFails = false, decodeAudio } = {}) {
  const elements = new Map();
  const requests = [];
  const opened = [];
  const utterances = [];
  const audioContexts = [];
  const preferences = new Map(voiceMode ? [["jarvis_voice_mode", voiceMode]] : []);
  class FakeAudioContext {
    constructor() {
      this.state = audioState;
      this.currentTime = 10;
      this.destination = {};
      this.sources = [];
      this.buffers = [];
      this.resumeCalls = 0;
      audioContexts.push(this);
    }
    resume() {
      this.resumeCalls += 1;
      if (resumeFails) return Promise.reject(new Error("Activation required"));
      this.state = "running";
      return Promise.resolve();
    }
    createBuffer(_channels, length, sampleRate) {
      const values = new Float32Array(length);
      const buffer = { duration: length / sampleRate, sampleRate, getChannelData() { return values; } };
      this.buffers.push(buffer);
      return buffer;
    }
    createBufferSource() {
      const source = {
        connect() {},
        start(time) { this.startTime = time; },
        stop() { this.stopped = true; }
      };
      this.sources.push(source);
      return source;
    }
    decodeAudioData(bytes) {
      if (decodeAudio) return decodeAudio(bytes);
      return Promise.resolve(this.createBuffer(1, 24000, 24000));
    }
  }
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
      AudioContext: FakeAudioContext,
      open(...args) { opened.push(args); },
      speechSynthesis: {
        cancel() { if (speechFails) throw new Error("Speech unavailable"); },
        speak(utterance) { utterances.push(utterance); },
        getVoices() { return voices; }
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
    localStorage: {
      getItem(key) {
        if (storageFailures.includes("get")) throw new Error("Storage blocked");
        return preferences.get(key) ?? null;
      },
      setItem(key, value) {
        if (storageFailures.includes("set")) throw new Error("Storage blocked");
        preferences.set(key, value);
      }
    },
    TextDecoder,
    atob,
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
    element, requests, opened, saved, timers, controls, utterances, audioContexts, preferences,
    answer(command) { return vm.runInContext(`answer(${JSON.stringify(command)})`, context); },
    login() { return vm.runInContext("login()", context); },
    speak(text) { return vm.runInContext(`speak(${JSON.stringify(text)})`, context); },
    stop() { return vm.runInContext("stopOutput()", context); },
    changeVoice(value) {
      element("voiceMode").value = value;
      element("voiceMode").listeners.get("change")();
    }
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

function sseStream() {
  let controller;
  const encoder = new TextEncoder();
  const body = new ReadableStream({ start(value) { controller = value; } });
  return {
    response: new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    send(event, data) { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); },
    bytes(bytes) { controller.enqueue(bytes); },
    close() { controller.close(); }
  };
}

const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const audioEvent = bytes => ({ data: Buffer.from(bytes).toString("base64"), sampleRate: 24000, format: "pcm_s16le" });

test("Hilfe, capability, date and clock commands render immediately without login or cloud calls", async () => {
  const page = browser({ voiceMode: null });
  for (const command of ["Hilfe", "Was kannst du?", "Datum", "Welcher Tag ist heute?", "Wie spät ist es?"]) {
    const pending = page.answer(command);
    assert.notEqual(page.element("reply").textContent, "");
    assert.equal(page.requests.length, 0);
    assert.equal(page.element("headline").textContent, "Antwort bereit");
    await pending;
  }
  assert.match(page.element("voiceStatus").textContent, /bitte anmelden/);
  assert.equal(page.requests.length, 0);
});

test("natural voice is the default and saved modes survive storage failures", () => {
  assert.equal(browser({ voiceMode: null }).element("voiceMode").value, "natural");
  const selected = browser({ voiceMode: "device" });
  assert.equal(selected.element("voiceMode").value, "device");
  selected.changeVoice("off");
  assert.equal(selected.preferences.get("jarvis_voice_mode"), "off");
  const blocked = browser({ voiceMode: null, storageFailures: ["get", "set"] });
  blocked.changeVoice("device");
  assert.match(blocked.element("voiceStatus").textContent, /Gerätestimme/);
});

test("SSE renders fragmented UTF-8 and CRLF deltas before completion then speaks exactly once", async () => {
  const stream = sseStream();
  const page = browser({ token: "session", voiceMode: "device", fetchImpl: () => stream.response });
  const pending = page.answer("Eine Begrüßung bitte");
  const bytes = new TextEncoder().encode(': heartbeat\r\n\r\nevent: delta\r\ndata: {"text":"Grüße 👋"}\r\n\r\n');
  for (const byte of bytes) stream.bytes(new Uint8Array([byte]));
  await nextTurn();
  assert.equal(page.element("reply").textContent, "Grüße 👋");
  assert.equal(page.element("headline").textContent, "JARVIS antwortet …");
  assert.equal(page.utterances.length, 0);
  assert.equal(page.element("command").disabled, true);
  assert.equal(JSON.parse(page.requests[0].body).stream, true);
  assert.equal(page.requests[0].headers.Accept, "text/event-stream");
  stream.send("delta", { text: " Boss." });
  stream.send("done", { reply: "Grüße 👋 Boss." });
  stream.close();
  await pending;
  assert.equal(page.element("reply").textContent, "Grüße 👋 Boss.");
  assert.equal(page.utterances.length, 1);
  assert.equal(page.utterances[0].text, "Grüße 👋 Boss.");
  assert.equal(page.element("command").disabled, false);
});

test("a failed or incomplete stream preserves partial text without speaking it", async () => {
  for (const sendError of [true, false]) {
    const stream = sseStream();
    const page = browser({ token: "session", voiceMode: "device", fetchImpl: () => stream.response });
    const pending = page.answer("Eine längere Frage");
    stream.send("delta", { text: "Bereits sichtbarer Text" });
    if (sendError) stream.send("error", { error: "Bitte später versuchen.", status: 503 });
    stream.close();
    await pending;
    assert.equal(page.element("reply").textContent, "Bereits sichtbarer Text");
    assert.equal(page.utterances.length, 0);
    assert.equal(page.element("command").disabled, false);
    assert.match(page.element("voiceStatus").textContent, sendError ? /Bitte später/ : /unterbrochen/);
  }
});

test("Stop aborts an unfinished chat stream and restores controls", async () => {
  const stream = sseStream();
  const page = browser({ token: "session", voiceMode: "device", fetchImpl: () => stream.response });
  const pending = page.answer("Eine längere Frage");
  stream.send("delta", { text: "Teilantwort" });
  await nextTurn();
  page.stop();
  await pending;
  assert.equal(page.requests[0].signal.aborted, true);
  assert.equal(page.element("reply").textContent, "Teilantwort");
  assert.equal(page.element("headline").textContent, "Anfrage gestoppt");
  assert.equal(page.element("command").disabled, false);
  assert.equal(page.utterances.length, 0);
});

test("device mode chooses a high-quality German voice with neutral prosody", async () => {
  const voices = [
    { name: "English Premium", lang: "en-US", localService: true },
    { name: "Deutsch", lang: "de-DE", localService: true },
    { name: "Anna Enhanced", lang: "de-DE", localService: true },
    { name: "Markus Premium", lang: "de-DE", localService: true }
  ];
  const page = browser({ voiceMode: "device", voices });
  await page.answer("Hilfe");
  const utterance = page.utterances[0];
  assert.equal(utterance.voice, voices[3]);
  assert.equal(utterance.lang, "de-DE");
  assert.equal(utterance.rate, 1);
  assert.equal(utterance.pitch, 1);
  page.changeVoice("off");
  await page.answer("Hilfe");
  assert.equal(page.utterances.length, 1);
});

test("natural streaming schedules PCM chunks consecutively and preserves odd-byte carry", async () => {
  const stream = sseStream();
  const page = browser({ token: "session", voiceMode: "natural", fetchImpl: () => stream.response });
  page.element("reply").textContent = "Die vollständige Textantwort bleibt hier.";
  const pending = page.speak("Hallo Boss.");
  stream.send("audio", audioEvent([0, 0, 0]));
  stream.send("audio", audioEvent([128, 255, 127]));
  stream.send("done", {});
  stream.close();
  await pending;
  assert.equal(page.requests[0].url, "https://jarvis-iphone-qxi0.onrender.com/api/speech");
  assert.equal(page.requests[0].headers.Authorization, "Bearer session");
  assert.equal(page.requests[0].headers.Accept, "text/event-stream");
  const context = page.audioContexts[0];
  assert.equal(context.buffers.length, 2);
  assert.deepEqual([...context.buffers[0].getChannelData(0)], [0]);
  assert.deepEqual([...context.buffers[1].getChannelData(0)], [-1, 32767 / 32768]);
  assert.equal(context.sources[0].startTime, 10.12);
  assert.equal(context.sources[1].startTime, context.sources[0].startTime + context.buffers[0].duration);
  assert.equal(page.utterances.length, 0);
  assert.equal(page.element("reply").textContent, "Die vollständige Textantwort bleibt hier.");
  assert.equal(page.element("stopButton").disabled, false);
  page.stop();
  assert.ok(context.sources.every(source => source.stopped));
});

test("new commands abort pending speech and prevent stale audio from playing", async () => {
  let finish;
  const stream = sseStream();
  const page = browser({ token: "session", voiceMode: "natural", fetchImpl: () => new Promise(resolve => { finish = resolve; }) });
  const pending = page.speak("Alte Antwort");
  await nextTurn();
  assert.equal(page.requests.length, 1);
  page.changeVoice("off");
  await page.answer("Hilfe");
  stream.send("audio", audioEvent([0, 0, 0, 0]));
  stream.send("done", {});
  stream.close();
  finish(stream.response);
  await pending;
  assert.equal(page.requests[0].signal.aborted, true);
  assert.equal(page.audioContexts[0].sources.length, 0);
  assert.match(page.element("reply").textContent, /Uhrzeit, Datum und Hilfe/);
});

test("natural quota failure retains text and never silently invokes device speech", async () => {
  const page = browser({ token: "session", voiceMode: "natural", fetchImpl: () => response(429, { error: "Sprachlimit erreicht. Bitte später erneut versuchen." }) });
  page.element("reply").textContent = "Antwort bleibt sichtbar";
  await page.speak("Antwort bleibt sichtbar");
  assert.equal(page.element("reply").textContent, "Antwort bleibt sichtbar");
  assert.match(page.element("voiceStatus").textContent, /Sprachlimit erreicht/);
  assert.equal(page.utterances.length, 0);
  assert.equal(page.element("stopButton").disabled, true);
});

test("natural audio supports WAV fallback without blocking the text response", async () => {
  const wav = new Response(new Uint8Array([82, 73, 70, 70]), { headers: { "Content-Type": "audio/wav" } });
  const page = browser({ token: "session", voiceMode: "natural", fetchImpl: () => wav });
  await page.speak("WAV-Antwort");
  assert.equal(page.audioContexts[0].sources.length, 1);
  assert.equal(page.utterances.length, 0);
});

test("blocked iOS audio requests a playback tap without consuming a speech request", async () => {
  const page = browser({ token: "session", voiceMode: "natural", audioState: "suspended", resumeFails: true });
  await page.speak("Hallo");
  assert.match(page.element("voiceStatus").textContent, /Tippe auf Vorlesen/);
  assert.equal(page.requests.length, 0);
  assert.equal(page.utterances.length, 0);
});

test("natural speech is sentence-capped at 1200 while visible text remains complete", async () => {
  const text = "Ein kurzer erster Satz. " + "Sehr ausführliche Ergänzung ".repeat(70);
  const page = browser({ token: "session", voiceMode: "natural", fetchImpl: () => response(503, { error: "Gerade nicht verfügbar." }) });
  page.element("reply").textContent = text;
  await page.speak(text);
  const spoken = JSON.parse(page.requests[0].body).text;
  assert.ok(spoken.length <= 1200);
  assert.equal(spoken, "Ein kurzer erster Satz.");
  assert.equal(page.element("reply").textContent, text);
});

test("a slow speech request does not keep a completed AI reply busy", async () => {
  const page = browser({ token: "session", voiceMode: "natural", fetchImpl: url => url.endsWith("/api/chat")
    ? response(200, { reply: "Sofort sichtbarer Text" }) : new Promise(() => {}) });
  await page.answer("Bitte eine Antwort");
  assert.equal(page.element("reply").textContent, "Sofort sichtbarer Text");
  assert.equal(page.element("command").disabled, false);
  assert.equal(page.element("stopButton").disabled, false);
  assert.equal(page.requests.length, 2);
  page.stop();
});

test("a send gesture resumes AudioContext synchronously before the chat fetch", async () => {
  let finish;
  let page;
  page = browser({ token: "session", voiceMode: "natural", audioState: "suspended", fetchImpl: () => {
    assert.equal(page.audioContexts[0].resumeCalls, 1);
    assert.equal(page.audioContexts[0].state, "running");
    return new Promise(resolve => { finish = resolve; });
  } });
  const pending = page.answer("Bitte eine Idee");
  assert.equal(page.audioContexts[0].resumeCalls, 1);
  assert.equal(page.requests.length, 1);
  page.changeVoice("off");
  finish(response(200, { reply: "Eine Idee" }));
  await pending;
});

test("a speech SSE error stops queued audio without changing the answer or using device voice", async () => {
  const stream = sseStream();
  const page = browser({ token: "session", voiceMode: "natural", fetchImpl: () => stream.response });
  page.element("reply").textContent = "Sichtbare Antwort";
  const pending = page.speak("Sichtbare Antwort");
  stream.send("audio", audioEvent([0, 0, 0, 0]));
  stream.send("error", { status: 429, error: "Das Stimmen-Kontingent ist erreicht." });
  stream.close();
  await pending;
  assert.equal(page.element("reply").textContent, "Sichtbare Antwort");
  assert.match(page.element("voiceStatus").textContent, /Stimmen-Kontingent/);
  assert.ok(page.audioContexts[0].sources.every(source => source.stopped));
  assert.equal(page.utterances.length, 0);
});

test("an expired speech session reopens login while preserving the text answer", async () => {
  const page = browser({ token: "expired", voiceMode: "natural", fetchImpl: () => response(401, { error: "Bitte erneut anmelden." }) });
  page.element("reply").textContent = "Sichtbare Antwort";
  await page.speak("Sichtbare Antwort");
  assert.equal(page.element("loginPanel").hidden, false);
  assert.equal(page.saved.has("jarvis_session"), false);
  assert.equal(page.element("reply").textContent, "Sichtbare Antwort");
  assert.match(page.element("voiceStatus").textContent, /erneut anmelden/);
  assert.equal(page.utterances.length, 0);
});
