# JARVIS iPhone

Der Node-Server ruft Groq über die OpenAI-kompatible API auf. Der vorhandene
OpenAI-Client bleibt dafür als Abhängigkeit erhalten. Anmeldung und Browser-API
(`/api/login`, `/api/chat`) bleiben unverändert.

## Lokal starten

Voraussetzung: Node.js 20.6 oder neuer.

1. `npm install`
2. `cp .env.example .env`
3. In der lokalen `.env` einen Groq-Schlüssel unter `GROQ_API_KEY` und ein
   eigenes `JARVIS_PASSWORD` mit mindestens 16 Zeichen eintragen.
4. `node --env-file=.env server.js`

Optional legt `GROQ_MODEL` das Modell fest (Standard:
`llama-3.3-70b-versatile`). Das Modell muss für dein Groq-Konto verfügbar sein.
`PORT` ist optional und standardmäßig 3000.

Die Webseite verwendet weiterhin die in `index.html` konfigurierte Serveradresse.
Für lokale Browsertests diese Adresse im lokalen Checkout anpassen und die
CORS-Origin in `server.js` an die lokale Webseite anpassen.

## Server-Konfiguration für einen späteren Betrieb

Im Hosting-Dienst `GROQ_API_KEY` und `JARVIS_PASSWORD` als geheime
Umgebungsvariablen setzen, optional auch `GROQ_MODEL`. `npm start` verwendet
diese Variablen; eine `.env` wird dabei nicht automatisch eingelesen.
`OPENAI_API_KEY` wird nicht mehr benötigt.

API-Schlüssel ausschließlich auf dem Server speichern, niemals in HTML,
Browser-Speicher oder Git. Die lokale `.env` wird von Git ignoriert.
Diese Änderung führt kein Deployment durch.
