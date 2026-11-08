import express from "express";
import cors from "cors";
import OpenAI from "openai";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

export function createApp({ env = process.env, fetch: providerFetch } = {}) {
  const provider = env.AI_PROVIDER?.trim().toLowerCase() ||
    (env.GROQ_API_KEY?.trim() ? "groq" : env.OPENAI_API_KEY?.trim() ? "openai" : "groq");
  if (!["groq", "openai"].includes(provider)) {
    throw new Error("AI_PROVIDER muss groq oder openai sein.");
  }

  const keyName = provider === "groq" ? "GROQ_API_KEY" : "OPENAI_API_KEY";
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
    baseURL: provider === "groq" ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1",
    timeout: 30000,
    maxRetries: 0,
    ...(providerFetch ? { fetch: providerFetch } : {})
  });
  const model = provider === "groq"
    ? env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile"
    : env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
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
    sessions.set(token, { expires: now + 60 * 60 * 1000, requests: [] });
    res.json({ token });
  });

  app.post("/api/chat", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const now = Date.now();
    prune(now);
    const token = req.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
    const session = token && sessions.get(token);
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

    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content: "Du bist JARVIS, ein intelligenter persönlicher Assistent. Antworte auf Deutsch, ruhig, elegant und präzise. Sprich den Nutzer gelegentlich mit Boss an. Behaupte niemals, Aktionen ausgeführt zu haben, wenn du sie nicht wirklich ausgeführt hast."
          },
          { role: "user", content: message.trim() }
        ],
        max_tokens: 400
      });

      const reply = response.choices?.[0]?.message?.content;
      if (typeof reply !== "string" || !reply.trim()) {
        return res.status(502).json({ error: "Keine KI-Antwort erhalten. Bitte erneut versuchen." });
      }
      res.json({ reply });
    } catch (error) {
      // Never log upstream response bodies, headers, keys, or the user's message.
      console.error("JARVIS API error:", { provider, status: error.status, type: error.name });
      if (error.status === 429) {
        res.set("Retry-After", "60");
        return res.status(429).json({ error: "Das KI-Limit ist erreicht. Bitte später erneut versuchen." });
      }
      if (error instanceof OpenAI.APIConnectionTimeoutError) {
        return res.status(504).json({ error: "Die KI antwortet zu langsam. Bitte erneut versuchen." });
      }
      return res.status(503).json({ error: "Der KI-Dienst ist vorübergehend nicht verfügbar. Bitte später erneut versuchen." });
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
