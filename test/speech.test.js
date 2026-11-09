import test from "node:test";
import assert from "node:assert/strict";
import { createSpeechService, SpeechError } from "../speech.js";

const pcm = Buffer.from([0, 0, 255, 127, 0, 128, 0, 0]);
const audioEvent = (bytes = pcm, mimeType = "audio/L16;codec=pcm;rate=24000") => ({
  candidates: [{ content: { parts: [
    { text: "Grüße" }, { inlineData: { data: bytes.toString("base64"), mimeType } }
  ] } }]
});
const encodeEvent = event => new TextEncoder().encode("data: " + JSON.stringify(event) + "\r\n\r\n");
function response(events, fragment = false) {
  const bytes = Buffer.concat(events.map(encodeEvent));
  return new Response(new ReadableStream({
    start(controller) {
      if (fragment) for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.subarray(i, i + 7));
      else controller.enqueue(bytes);
      controller.close();
    }
  }), { headers: { "Content-Type": "text/event-stream" } });
}
async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test("natural speech uses the documented free-tier streaming model, private key and warm German style", async () => {
  let request;
  const service = createSpeechService({
    apiKey: "synthetic-speech-key",
    fetch: async (url, init) => {
      request = { url, headers: init.headers, body: JSON.parse(init.body) };
      return response([audioEvent()], true);
    }
  });
  assert.equal(service.available, true);
  assert.deepEqual(await collect(service.stream("Hallo, wie geht es dir?")), pcm);
  assert.equal(request.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:streamGenerateContent?alt=sse");
  assert.equal(request.headers["x-goog-api-key"], "synthetic-speech-key");
  assert.equal(request.body.contents[0].parts[0].text, "Hallo, wie geht es dir?");
  assert.match(request.body.contents[0].parts[0].speech_metadata.style, /Deutsch/);
  assert.deepEqual(request.body.generationConfig, {
    responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { voice: "Sulafat" } }
  });
});

test("first audio is yielded before the provider finishes its response", async () => {
  let source;
  const service = createSpeechService({ apiKey: "synthetic-key", fetch: async () =>
    new Response(new ReadableStream({ start(controller) { source = controller; } }))
  });
  const iterator = service.stream("Eine laufende Antwort.");
  const first = iterator.next();
  await new Promise(resolve => setImmediate(resolve));
  source.enqueue(encodeEvent(audioEvent(pcm.subarray(0, 4))));
  assert.deepEqual((await first).value, pcm.subarray(0, 4));
  source.enqueue(encodeEvent(audioEvent(pcm.subarray(4))));
  source.close();
  assert.deepEqual(await collect({ [Symbol.asyncIterator]: () => iterator }), pcm.subarray(4));
});

test("WAV fallback contains one valid header and repeat text reuses bounded in-memory audio", async () => {
  let calls = 0;
  const service = createSpeechService({ apiKey: "synthetic-key", fetch: async () => {
    calls++; return response([audioEvent()]);
  } });
  const wav = await service.synthesize("Wiederverwendbare Hilfe.");
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(wav.subarray(44), pcm);
  assert.deepEqual(await service.synthesize("Wiederverwendbare Hilfe."), wav);
  assert.deepEqual(await collect(service.stream("Wiederverwendbare Hilfe.")), pcm);
  assert.equal(calls, 1);
});

test("missing configuration and invalid text do not call a provider", async () => {
  let calls = 0;
  const fetch = async () => { calls++; return response([audioEvent()]); };
  const absent = createSpeechService({ fetch });
  assert.equal(absent.available, false);
  await assert.rejects(absent.synthesize("Hallo"), error => error instanceof SpeechError && error.status === 503);
  const ready = createSpeechService({ apiKey: "synthetic-key", fetch });
  for (const text of [null, 42, "", "  ", "x".repeat(1201)]) {
    await assert.rejects(ready.synthesize(text), error => error.status === 400);
  }
  assert.equal(calls, 0);
});

test("provider limits return a safe error without exposing provider details or credentials", async () => {
  const service = createSpeechService({ apiKey: "synthetic-private-key", fetch: async () =>
    new Response("private provider body: synthetic-private-key", { status: 429 })
  });
  await assert.rejects(service.synthesize("Hallo"), error => {
    assert.equal(error.status, 429);
    assert.match(error.message, /Kontingent/);
    assert.doesNotMatch(error.message, /private|synthetic/);
    return true;
  });
});

test("malformed, missing, truncated and unexpected audio is rejected safely", async () => {
  const cases = [
    () => new Response("data: invalid JSON\n\n"),
    () => response([{ candidates: [] }]),
    () => response([audioEvent(Buffer.from([1, 2, 3]))]),
    () => response([audioEvent(pcm, "audio/wav")]),
    () => response([audioEvent(pcm, "audio/L16;rate=48000")])
  ];
  for (const fetch of cases) {
    const service = createSpeechService({ apiKey: "synthetic-key", fetch });
    await assert.rejects(service.synthesize("Hallo"), error => error.status === 502);
  }
  const limited = createSpeechService({ apiKey: "synthetic-key", maxAudioBytes: 4, fetch: async () => response([audioEvent()]) });
  await assert.rejects(limited.synthesize("Hallo"), error => error.status === 502 && /groß/.test(error.message));
});

test("cancellation aborts the provider and does not cache partial speech", async () => {
  let providerSignal;
  const service = createSpeechService({ apiKey: "synthetic-key", fetch: async (_url, { signal }) => {
    providerSignal = signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
  } });
  const controller = new AbortController();
  const result = service.synthesize("Hallo", { signal: controller.signal });
  controller.abort();
  await assert.rejects(result, error => error.name === "AbortError");
  assert.equal(providerSignal.aborted, true);
});

test("a stalled speech provider times out without blocking text replies", async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const service = createSpeechService({ apiKey: "synthetic-key", timeoutMs: 10, fetch: async (_url, { signal }) =>
      new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }))
    });
    await assert.rejects(service.synthesize("Hallo"), error => error.status === 504 && /Text bleibt/.test(error.message));
  } finally { clearTimeout(keepAlive); }
});
