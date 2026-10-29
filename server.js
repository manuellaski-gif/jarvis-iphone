import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(cors({
  origin: "https://manuellaski-gif.github.io"
}));
app.use(express.json({ limit: "20kb" }));

app.get("/", (req, res) => {
  res.json({ status: "JARVIS Server online" });
});

app.post("/api/chat", async (req, res) => {
  try {
    const message = req.body?.message;

    if (typeof message !== "string" ||
        !message.trim() ||
        message.length > 2000) {
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
            "Du bist JARVIS, ein intelligenter persönlicher Assistent, inspiriert von Iron Man. Antworte auf Deutsch, ruhig, elegant, präzise und hilfsbereit. Sprich den Nutzer gelegentlich mit Boss an. Behaupte niemals, Aktionen ausgeführt zu haben, wenn du sie nicht wirklich ausgeführt hast."
        },
        {
          role: "user",
          content: message
        }
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
