import express from "express";
import cors from "cors";
import OpenAI from "openai";
import crypto from "node:crypto";

const app = express();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const accessToken = process.env.JARVIS_ACCESS_TOKEN;

if (!accessToken || accessToken.length < 32) {
  throw new Error("JARVIS_ACCESS_TOKEN fehlt oder ist zu kurz.");
}

app.use(cors({
  origin: "https://manuellaski-gif.github.io"
}));
app.use(express.json({ limit: "20kb" }));

const requests = new Map();

app.get("/", (req, res) => {
  res.json({ status: "JARVIS Server online" });
});

app.post("/api/chat", async (req, res) => {
  const supplied = req.get("X-Jarvis-Token") || "";
  const expected = Buffer.from(accessToken);
  const actual = Buffer.from(supplied);

  if (
    actual.length !== expected.length ||
    !crypto.timingSafeEqual(actual, expected)
  ) {
    return res.status(401).json({
      error: "Zugriff verweigert."
    });
  }

  const now = Date.now();
  const key = crypto.createHash("sha256")
    .update(supplied).digest("hex");
  const history = (requests.get(key) || [])
    .filter(time => now - time < 60000);

  if (history.length >= 5) {
    return res.status(429).json({
      error: "Bitte eine Minute warten."
    });
  }

  history.push(now);
  requests.set(key, history);

  try {
    const message = req.body?.message;

    if (
      typeof message !== "string" ||
      !message.trim() ||
      message.length > 2000
    ) {
      return res.status(400).json({
        error: "Ungültige Nachricht."
      });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Du bist JARVIS, ein intelligenter persönlicher Assistent. Antworte auf Deutsch, ruhig, elegant, präzise und hilfsbereit. Sprich den Nutzer gelegentlich mit Boss an. Behaupte niemals, Aktionen ausgeführt zu haben, wenn du sie nicht wirklich ausgeführt hast."
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
      error: "JARVIS konnte die Anfrage nicht verarbeiten."
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`JARVIS Server läuft auf Port ${port}`);
});
