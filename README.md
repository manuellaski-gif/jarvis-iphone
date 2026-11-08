# JARVIS iPhone

Bestehendes Projekt: eine mobile HTML-Oberfläche und ein Express-Server für
Anmeldung und KI-Anfragen. API-Schlüssel bleiben ausschließlich auf dem Server.

## Projektstruktur

- `index.html`: aktive Oberfläche mit Texteingabe, Anmeldung und optionaler Sprache.
- `index 2.html`: älterer Offline-Prototyp ohne KI; bleibt als Bestand erhalten.
- `server.js`: `/api/login`, `/api/chat`, Status unter `/` und Oberfläche unter `/app`.
- `.env.example`: leere Vorlagen und optionale Konfiguration, keine Zugangsdaten.
- `test/`: automatisierte Server- und Frontend-Regressionstests ohne echte KI-Aufrufe.

## Lokal starten

Voraussetzung: Node.js ab 20.6.

1. `npm ci`
2. Falls noch keine lokale `.env` existiert: `cp .env.example .env`.
   Eine vorhandene `.env` nicht überschreiben.
3. Nur in der lokalen `.env` oder in der geschützten Serverkonfiguration die
   gewünschten Variablen hinterlegen.
4. `npm run dev`
5. `http://localhost:3000/app` öffnen. Die Oberfläche nutzt auf localhost den
   lokalen Server. Auf GitHub Pages bleibt die bestehende Render-API-Adresse erhalten.

`npm start` verwendet bereits gesetzte Umgebungsvariablen und liest keine `.env`
automatisch ein. Der Port ist über `PORT` einstellbar (Standard: `3000`).

## Groq vorbereiten und bestehende Konfiguration erhalten

Der vorhandene `openai`-Client unterstützt auch Groqs OpenAI-kompatiblen Endpunkt;
ein zweites SDK ist nicht erforderlich.

| Variable | Bedeutung |
| --- | --- |
| `AI_PROVIDER` | Optional `groq` oder `openai`. Ohne Vorgabe: Groq bei vorhandenem `GROQ_API_KEY`, sonst OpenAI bei vorhandenem `OPENAI_API_KEY`. |
| `GROQ_API_KEY` | Groq-Schlüssel, nur serverseitig hinterlegen. |
| `GROQ_MODEL` | Optional, Standard `llama-3.3-70b-versatile`. |
| `OPENAI_API_KEY` | Bestehender OpenAI-Schlüssel bleibt weiterhin nutzbar. |
| `OPENAI_MODEL` | Optional, Standard `gpt-4o-mini`. |
| `JARVIS_PASSWORD` | Bestehendes Passwort, 16 bis 256 Zeichen. |
| `ALLOWED_ORIGINS` | Optional, erlaubte Browser-Ursprünge, durch Kommas getrennt. Standard: `https://manuellaski-gif.github.io`. |
| `TRUST_PROXY` | Zahl vertrauenswürdiger Proxy-Hops, Standard `0`. |

Eine bestehende Installation mit `OPENAI_API_KEY` und `JARVIS_PASSWORD` bleibt
funktionsfähig. Es werden keine Schlüssel erzeugt, gelöscht oder verändert.
Bei explizitem `AI_PROVIDER=groq` muss `GROQ_API_KEY` gesetzt sein. Es gibt keinen
automatischen Anbieterwechsel bei Fehlern während einer Anfrage.

Groq bietet je nach Konto ein kostenloses Kontingent mit Anfrage- und Tokenlimits.
Das ist keine Zusage unbegrenzter kostenloser Nutzung. Vor einer späteren
Aktivierung Modellverfügbarkeit und Kontolimits in der Groq-Konsole prüfen.
Eine 429-Antwort wird verständlich angezeigt; der Server wiederholt Anfragen
nicht automatisch.

## Tests

```sh
npm test
```

Die Servertests verwenden den echten Express-Server und SDK-Client, ersetzen aber
den ausgehenden KI-Transport. Die Frontendtests prüfen die Browserlogik mit
simulierten DOM-, Speicher- und Netzwerkfunktionen. Echte Zugangsdaten sind dafür
nicht erforderlich und der produktive Render-Server wird nicht angesprochen.

## Hinweise für ein späteres Deployment

Dieses Projekt wird weiterhin getrennt betrieben: GitHub Pages liefert
`index.html`, Render oder ein anderer Node-Host liefert die API. Das Veröffentlichen
der HTML-Dateien allein startet keinen Node-Server.

- Vor jedem Deployment ist die Zustimmung des Nutzers erforderlich.
- Geheimnisse nur in der geschützten Umgebung des Server-Hosts verwalten.
  `.env` ist lokal und wird von Git ignoriert. Nie Schlüssel ins HTML eintragen.
- Bei geändertem Frontend-Host `ALLOWED_ORIGINS` entsprechend setzen; CORS ersetzt
  keine Anmeldung. Bei geändertem API-Host die Produktionsadresse in `index.html`
  anpassen.
- Hinter einem Reverse Proxy muss dessen Topologie geprüft werden. Nur bei
  genau einem vertrauenswürdigen Hop `TRUST_PROXY=1` setzen. Ein falscher Wert
  kann die Begrenzung fehlgeschlagener Anmeldungen unwirksam machen oder mehrere
  Nutzer unter derselben Proxy-IP zusammenfassen.
- Sitzungen und Rate-Limits werden im RAM gehalten: ein Neustart meldet Nutzer
  ab; mehrere Serverinstanzen teilen diese Daten nicht. Für größeren Betrieb
  wäre ein gemeinsamer Sitzungsspeicher nötig.
- Sprachfunktionen hängen vom Browser und dessen Berechtigungen ab. Die Webseite
  kann den nativen iPhone-Kalender nicht direkt steuern; sie öffnet Google Calendar.

Es wurde kein Deployment ausgelöst und keine Zugangsdatenkonfiguration verändert.
