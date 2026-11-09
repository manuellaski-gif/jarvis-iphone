import crypto from "node:crypto";

export class SpeechError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SpeechError";
    this.status = status;
  }
}

function aborted() {
  return new DOMException("Sprachausgabe abgebrochen.", "AbortError");
}

function upstreamError(status) {
  return new SpeechError(status === 429 ? 429 : 503, status === 429
    ? "Das Stimmen-Kontingent ist erreicht. Der Text bleibt verfügbar."
    : "Die natürliche Stimme ist gerade nicht verfügbar.");
}

async function* readEvents(response, maxBytes) {
  if (!response.body) throw new SpeechError(502, "Keine Sprachdaten erhalten.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", lines = [], received = 0;
  function parse() {
    const data = lines.join("\n");
    lines = [];
    if (!data || data === "[DONE]") return null;
    try { return JSON.parse(data); }
    catch { throw new SpeechError(502, "Ungültige Antwort des Sprachdienstes."); }
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) throw new SpeechError(502, "Die Sprachausgabe ist zu groß.");
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (!line) {
          const event = parse();
          if (event) yield event;
        } else if (line.startsWith("data:")) lines.push(line.slice(5).replace(/^ /, ""));
      }
    }
    buffer += decoder.decode();
    if (buffer.startsWith("data:")) lines.push(buffer.slice(5).trim());
    const event = parse();
    if (event) yield event;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function asWav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function createSpeechService({
  apiKey,
  model = "gemini-3.8-flash-lite-tts",
  voice = "Sulafat",
  fetch: providerFetch = globalThis.fetch,
  timeoutMs = 20000,
  maxAudioBytes = 6 * 1024 * 1024
} = {}) {
  const key = apiKey?.trim();
  model = model?.trim() || "gemini-3.8-flash-lite-tts";
  voice = voice?.trim() || "Sulafat";
  // Audio is private, bounded and short-lived in RAM; never persisted or logged.
  const cache = new Map();
  let cacheBytes = 0;
  function remember(id, pcm) {
    if (pcm.length > 12 * 1024 * 1024) return;
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (entry.expires <= now) { cacheBytes -= entry.pcm.length; cache.delete(key); }
    }
    while (cache.size >= 8 || cacheBytes + pcm.length > 12 * 1024 * 1024) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cacheBytes -= cache.get(oldest).pcm.length;
      cache.delete(oldest);
    }
    cache.set(id, { pcm, expires: now + 15 * 60 * 1000 });
    cacheBytes += pcm.length;
  }

  async function* stream(text, { signal } = {}) {
    if (!key) throw new SpeechError(503, "Die natürliche Stimme ist auf diesem Server nicht verfügbar.");
    if (typeof text !== "string" || !text.trim() || text.length > 1200) {
      throw new SpeechError(400, "Ungültiger Text für die Sprachausgabe.");
    }
    if (signal?.aborted) throw aborted();
    text = text.trim();
    const id = crypto.createHash("sha256").update(model + "\0" + voice + "\0" + text).digest("hex");
    const saved = cache.get(id);
    if (saved && saved.expires > Date.now()) {
      cache.delete(id); cache.set(id, saved);
      for (let offset = 0; offset < saved.pcm.length; offset += 48000) {
        if (signal?.aborted) throw aborted();
        yield saved.pcm.subarray(offset, offset + 48000);
      }
      return;
    }
    if (saved) { cacheBytes -= saved.pcm.length; cache.delete(id); }

    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await providerFetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{
              text,
              speech_metadata: {
                style: "Sprich natürlich auf Deutsch, warm, freundlich und entspannt, in zügigem Gesprächstempo. Verwende lebendige, dezente Betonung und fließende Übergänge, ohne theatralische Ansage."
              }
            }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { voice } }
            }
          })
        });
      if (!response.ok) throw upstreamError(response.status);
      const chunks = [];
      let audioBytes = 0;
      for await (const event of readEvents(response, maxAudioBytes * 2 + 65536)) {
        if (signal?.aborted) throw aborted();
        if (event.error) throw upstreamError(event.error.code);
        for (const candidate of event.candidates || []) {
          for (const part of candidate.content?.parts || []) {
            const audio = part.inlineData || part.inline_data;
            if (!audio?.data) continue;
            const mime = audio.mimeType || audio.mime_type || "";
            const rate = mime.match(/rate=(\d+)/i)?.[1];
            if (!/^audio\/(?:L16|pcm)(?:;|$)/i.test(mime) || (rate && rate !== "24000")) {
              throw new SpeechError(502, "Der Sprachdienst hat ein unerwartetes Audioformat gesendet.");
            }
            if (typeof audio.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(audio.data) || audio.data.length % 4 === 1) {
              throw new SpeechError(502, "Ungültige Sprachdaten erhalten.");
            }
            const pcm = Buffer.from(audio.data, "base64");
            if (!pcm.length) continue;
            audioBytes += pcm.length;
            if (audioBytes > maxAudioBytes) throw new SpeechError(502, "Die Sprachausgabe ist zu groß.");
            chunks.push(pcm);
            yield pcm;
          }
        }
      }
      if (!audioBytes || audioBytes % 2) throw new SpeechError(502, "Keine vollständige Sprachausgabe erhalten.");
      remember(id, Buffer.concat(chunks, audioBytes));
    } catch (error) {
      if (signal?.aborted) throw aborted();
      if (controller.signal.aborted) throw new SpeechError(504, "Die natürliche Stimme antwortet zu langsam. Der Text bleibt verfügbar.");
      if (error instanceof SpeechError) throw error;
      throw upstreamError(503);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      controller.abort();
    }
  }

  return {
    available: Boolean(key),
    stream,
    async synthesize(text, options) {
      const chunks = [];
      for await (const chunk of stream(text, options)) chunks.push(chunk);
      return asWav(Buffer.concat(chunks));
    }
  };
}
