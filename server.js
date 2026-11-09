import express from "express";
import cors from "cors";
import OpenAI from "openai";
import crypto from "node:crypto";
import { once } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createSpeechService, SpeechError } from "./speech.js";

export function createApp({ env = process.env, fetch: providerFetch, speechFetch } = {}) {
  const provider = env.AI_PROVIDER?.trim().toLowerCase() ||
    (env.GROQ_API_KEY?.trim() ? "groq" : env.OPENAI_API_KEY?.trim() ? "openai" :
      env.GEMINI_API_KEY?.trim() ? "gemini" : "groq");
  const providers = {
    groq: {
      keyName: "GROQ_API_KEY",
      baseURL: "https://api.groq.com/openai/v1",
      model: env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile"
    },
    openai: {
      keyName: "OPENAI_API_KEY",
      baseURL: "https://api.openai.com/v1",
      model: env.OPENAI_MODEL?.trim() || "gpt-4o-mini"
    },
    gemini: {
      keyName: "GEMINI_API_KEY",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      model: env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite"
    }
  };
  if (!Object.hasOwn(providers, provider)) {
    throw new Error("AI_PROVIDER muss groq, openai oder gemini sein.");
  }

  const { keyName, baseURL, model } = providers[provider];
  const apiKey = env[keyName]?.trim();
  if (!apiKey) throw new Error(`${keyName} fehlt.`);

  const password = env.JARVIS_PASSWORD;
  if (!password || password.length < 16 || password.length > 256) {
    throw new Error("JARVIS_PASSWORD muss zwischen 16 und 256 Zeichen lang sein.");
  }

  const trustProxy = Number(env.TRUST_PROXY || 0);
  if (!Number.isInteger(trustProxy) || trustProxy < 0) {
    throw new Error("TRUST_PROXY muss eine nichtnegative Anzahl vertrauenswürdiger Proxy-Hops sein.");
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
    timeout: 30000,
    maxRetries: 0,
    ...(providerFetch ? { fetch: providerFetch } : {})
  });
  const speechModel = env.GEMINI_TTS_MODEL?.trim() || "gemini-3.8-flash-lite-tts";
  const speech = createSpeechService({
    apiKey: env.GEMINI_API_KEY?.trim(),
    model: speechModel,
    voice: env.GEMINI_VOICE?.trim() || "Sulafat",
    fetch: speechFetch || globalThis.fetch,
    timeoutMs: 30000
  });
  const allowedOrigins = (env.ALLOWED_ORIGINS || "https://manuellaski-gif.github.io")
    .split(",").map(origin => origin.trim()).filter(Boolean);

  const app = express();
  const sessions = new Map();
  const attempts = new Map();
  const passwordHash = crypto.createHash("sha256").update(password).digest();
  const loginWindow = 15 * 60 * 1000;
  app.disable("x-powered-by");
  app.set("trust proxy", trustProxy);
  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json({ limit: "20kb" }));

  // Remove stale records when requests arrive, without a background timer.
  function prune(now) {
    for (const [token, session] of sessions) {
      if (session.expires <= now) sessions.delete(token);
    }
    for (const [ip, history] of attempts) {
      const recent = history.filter(time => now - time < loginWindow);
      if (recent.length) attempts.set(ip, recent);
      else attempts.delete(ip);
    }
  }

  function getSession(req) {
    const token = req.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
    return token && sessions.get(token);
  }

  function wantsEvents(req) {
    return (req.get("Accept") || "").split(",")
      .some(type => type.split(";")[0].trim().toLowerCase() === "text/event-stream");
  }

  function startEvents(res) {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.flushHeaders();
  }

  async function sendEvent(res, event, data, signal) {
    if (signal.aborted || res.destroyed) return;
    if (!res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) {
      await once(res, "drain", { signal });
    }
  }

  function requestLifetime(res) {
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", onClose);
    return {
      controller,
      dispose() {
        res.off("close", onClose);
        controller.abort();
      }
    };
  }

  async function sendFailure(res, failure, signal) {
    if (signal.aborted || res.destroyed) return;
    if (res.headersSent) {
      await sendEvent(res, "error", { error: failure.message, status: failure.status }, signal);
      res.end();
    } else {
      if (failure.status === 429) res.set("Retry-After", "60");
      res.status(failure.status).json({ error: failure.message });
    }
  }

  function logTiming(started, firstTokenMs, providerName, modelName) {
    console.info("JARVIS timing:", {
      provider: providerName,
      model: modelName,
      firstTokenMs,
      totalMs: Math.round(performance.now() - started)
    });
  }

  app.get("/", (req, res) => {
    res.json({ status: "JARVIS Server online" });
  });

  // Explicitly serve only the public HTML, never the project directory or .env.
  app.get("/app", (req, res) => {
    res.sendFile(fileURLToPath(new URL("./index.html", import.meta.url)));
  });

  app.post("/api/login", (req, res) => {
    res.set("Cache-Control", "no-store");
    const now = Date.now();
    prune(now);
    const ip = req.ip;
    const history = attempts.get(ip) || [];

    if (history.length >= 5) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((history[0] + loginWindow - now) / 1000))));
      return res.status(429).json({ error: "Zu viele Versuche. Bitte später erneut versuchen." });
    }

    const supplied = req.body?.password;
    const valid = typeof supplied === "string" && supplied.length <= 256 &&
      crypto.timingSafeEqual(crypto.createHash("sha256").update(supplied).digest(), passwordHash);
    if (!valid) {
      history.push(now);
      attempts.set(ip, history);
      return res.status(401).json({ error: "Falsches Passwort." });
    }

    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { expires: now + 60 * 60 * 1000, requests: [], speechRequests: [] });
    res.json({ token });
  });

  app.post("/api/chat", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const now = Date.now();
    prune(now);
    const session = getSession(req);
    if (!session) {
      return res.status(401).json({ error: "Bitte erneut anmelden." });
    }

    const message = req.body?.message;
    if (typeof message !== "string" || !message.trim() || message.length > 2000) {
      return res.status(400).json({ error: "Ungültige Nachricht." });
    }

    session.requests = session.requests.filter(time => now - time < 60000);
    if (session.requests.length >= 5) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((session.requests[0] + 60000 - now) / 1000))));
      return res.status(429).json({ error: "Bitte eine Minute warten." });
    }
    session.requests.push(now);

    const started = performance.now();
    let firstTokenMs = null;
    const { controller, dispose } = requestLifetime(res);
    const streaming = wantsEvents(req);
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content: "Du bist JARVIS, ein persönlicher Assistent. Antworte auf Deutsch in natürlicher, direkter Alltagssprache. Antworte normalerweise in zwei bis drei kurzen Sätzen; werde ausführlicher, wenn der Nutzer darum bittet. Beginne direkt mit der hilfreichen Antwort, ohne Begrüßungsfloskeln oder ständige Anreden. Behaupte niemals, Aktionen ausgeführt zu haben, wenn du sie nicht wirklich ausgeführt hast."
          },
          { role: "user", content: message.trim() }
        ],
        ...(streaming ? { stream: true } : {}),
        // Keep room for thinking; the fast Flash-Lite model supports minimal effort.
        ...(provider === "gemini"
          ? { max_tokens: 2048, reasoning_effort: model === "gemini-3.5-flash-lite" ? "minimal" : "low" }
          : { max_tokens: 400 })
      }, { signal: controller.signal });

      if (streaming) {
        let reply = "";
        for await (const chunk of response) {
          if (controller.signal.aborted || res.destroyed) return;
          const text = chunk.choices?.[0]?.delta?.content;
          if (typeof text !== "string" || !text) continue;
          if (firstTokenMs === null) {
            firstTokenMs = Math.round(performance.now() - started);
            startEvents(res);
          }
          reply += text;
          await sendEvent(res, "delta", { text }, controller.signal);
        }
        if (controller.signal.aborted || res.destroyed) return;
        if (!reply.trim()) {
          return await sendFailure(res, {
            status: 502, message: "Keine KI-Antwort erhalten. Bitte erneut versuchen."
          }, controller.signal);
        }
        await sendEvent(res, "done", { reply }, controller.signal);
        res.end();
        return;
      }

      const reply = response.choices?.[0]?.message?.content;
      if (typeof reply !== "string" || !reply.trim()) {
        return res.status(502).json({ error: "Keine KI-Antwort erhalten. Bitte erneut versuchen." });
      }
      firstTokenMs = Math.round(performance.now() - started);
      res.json({ reply });
    } catch (error) {
      const failure = error.status === 429
        ? { status: 429, message: "Das KI-Limit ist erreicht. Bitte später erneut versuchen." }
        : error instanceof OpenAI.APIConnectionTimeoutError
          ? { status: 504, message: "Die KI antwortet zu langsam. Bitte erneut versuchen." }
          : { status: 503, message: "Der KI-Dienst ist vorübergehend nicht verfügbar. Bitte später erneut versuchen." };
      await sendFailure(res, failure, controller.signal);
    } finally {
      dispose();
      logTiming(started, firstTokenMs, provider, model);
    }
  });

  app.post("/api/speech", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const now = Date.now();
    prune(now);
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: "Bitte erneut anmelden." });

    const text = req.body?.text;
    if (typeof text !== "string" || !text.trim() || text.trim().length > 1200) {
      return res.status(400).json({ error: "Ungültiger Sprachtext. Bitte 1 bis 1200 Zeichen senden." });
    }
    if (!speech.available) {
      return res.status(503).json({ error: "Die natürliche Sprachausgabe ist noch nicht verfügbar." });
    }
    session.speechRequests = session.speechRequests.filter(time => now - time < 60000);
    if (session.speechRequests.length >= 5) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((session.speechRequests[0] + 60000 - now) / 1000))));
      return res.status(429).json({ error: "Bitte eine Minute mit der Sprachausgabe warten." });
    }
    session.speechRequests.push(now);

    const started = performance.now();
    let firstTokenMs = null;
    let iterator;
    const { controller, dispose } = requestLifetime(res);
    try {
      if (wantsEvents(req)) {
        iterator = speech.stream(text.trim(), { signal: controller.signal })[Symbol.asyncIterator]();
        let chunk = await iterator.next();
        if (controller.signal.aborted || res.destroyed) return;
        if (chunk.done) {
          return await sendFailure(res, { status: 502, message: "Keine Sprachausgabe erhalten." }, controller.signal);
        }
        firstTokenMs = Math.round(performance.now() - started);
        startEvents(res);
        while (!chunk.done) {
          if (controller.signal.aborted || res.destroyed) return;
          await sendEvent(res, "audio", {
            data: chunk.value.toString("base64"), sampleRate: 24000, format: "pcm_s16le"
          }, controller.signal);
          chunk = await iterator.next();
        }
        await sendEvent(res, "done", {}, controller.signal);
        res.end();
      } else {
        const wav = await speech.synthesize(text.trim(), { signal: controller.signal });
        if (controller.signal.aborted || res.destroyed) return;
        firstTokenMs = Math.round(performance.now() - started);
        res.type("audio/wav").send(wav);
      }
    } catch (error) {
      await sendFailure(res, error instanceof SpeechError
        ? { status: error.status, message: error.message }
        : { status: 503, message: "Die Sprachausgabe ist vorübergehend nicht verfügbar." }, controller.signal);
    } finally {
      dispose();
      if (iterator?.return) await iterator.return();
      logTiming(started, firstTokenMs, "gemini-tts", speechModel);
    }
  });

  app.use((req, res) => res.status(404).json({ error: "Nicht gefunden." }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === "entity.too.large") {
      return res.status(413).json({ error: "Die Anfrage ist zu groß." });
    }
    if (error.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Ungültige JSON-Anfrage." });
    }
    res.status(500).json({ error: "Interner Serverfehler." });
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createApp();
  const port = process.env.PORT || 3000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`JARVIS läuft auf Port ${port}`);
  });
}
