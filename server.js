import express from "express";
import cors from "cors";
import OpenAI from "openai";
import crypto from "node:crypto";

const app = express();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const password = process.env.JARVIS_PASSWORD;
const sessions = new Map();
const attempts = new Map();

if (!password || password.length < 16) {
  throw new Error("JARVIS_PASSWORD fehlt oder ist zu kurz.");
}

app.use(cors({
  origin: "https://manuellaski-gif.github.io"
}));
app.use(express.json({ limit: "20kb" }));

app.get("/", (req, res) => {
  res.json({ status: "JARVIS Server online" });
});

app.post("/api/login", (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const history = (attempts.get(ip) || [])
    .filter(t => now - t < 15 * 60 * 1000);

  if (history.length >= 5) {
    return res.status(429).json({
      error: "Zu viele Versuche. Bitte später erneut versuchen."
    });
  }

  history.push(now);
  attempts.set(ip, history);

  const supplied = req.body?.password;

  if (typeof supplied !== "string" ||
      supplied.length > 256) {
    return res.status(401).json({
      error: "Falsches Passwort."
    });
  }

  const a = crypto.createHash("sha256")
    .update(supplied).digest();
  const b = crypto.createHash("sha256")
    .update(password).digest();

  if (!crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({
      error: "Falsches Passwort."
    });
  }

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    expires: now + 60 * 60 * 1000,
    requests: []
  });

  res.json({ token });
});

app.post("/api/chat", async (req, res) => {
  const token = req.get("Authorization")?.replace(
    /^Bearer /, ""
  );
  const session = token && sessions.get(token);

  if (!session || session.expires < Date.now()) {
    return res.status(401).json({
      error: "Bitte erneut anmelden."
    });
  }

  const now = Date.now();
  session.requests = session.requests.filter(
    t => now - t < 60000
  );

  if (session.requests.length >= 5) {
    return res.status(429).json({
      error: "Bitte eine Minute warten."
    });
  }

  session.requests.push(now);

  const message = req.body?.message;
  if (typeof message !== "string" ||
      !message.trim() ||
      message.length > 2000) {
    return res.status(400).json({
      error: "Ungültige Nachricht."
    });
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Du bist JARVIS, ein intelligenter persönlicher Assistent. Antworte auf Deutsch, ruhig, elegant und präzise. Sprich den Nutzer gelegentlich mit Boss an. Behaupte niemals, Aktionen ausgeführt zu haben, wenn du sie nicht wirklich ausgeführt hast."
        },
        { role: "user", content: message }
      ],
      max_tokens: 400
    });

    res.json({
      reply: response.choices[0]?.message?.content ||
        "Keine Antwort erhalten."
    });
  } catch (error) {
    console.error("JARVIS API error:", error.message);
    res.status(500).json({
      error: "KI-Anfrage fehlgeschlagen."
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`JARVIS läuft auf Port ${port}`);
});
