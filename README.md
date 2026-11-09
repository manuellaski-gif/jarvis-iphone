# JARVIS iPhone

Bestehendes Projekt: eine mobile HTML-Oberfläche und ein Express-Server für
Anmeldung und KI-Anfragen. API-Schlüssel bleiben ausschließlich auf dem Server.

## Projektstruktur

- `index.html`: aktive Oberfläche mit Texteingabe, Anmeldung und optionaler Sprache.
- `index 2.html`: älterer Offline-Prototyp ohne KI; bleibt als Bestand erhalten.
- `server.js`: Anmeldung, Chat, geschützte Sprachausgabe, Status unter `/` und Oberfläche unter `/app`.
- `speech.js`: natürliche Gemini-Stimme mit fortlaufender Audioausgabe und kurzem RAM-Cache.
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

## KI-Anbieter und bestehende Konfiguration

Der vorhandene `openai`-Client unterstützt auch die OpenAI-kompatiblen Endpunkte
von Groq und Google Gemini. Ein zusätzliches SDK ist nicht erforderlich.

| Variable | Bedeutung |
| --- | --- |
| `AI_PROVIDER` | Optional `groq`, `openai` oder `gemini`. Ohne Vorgabe: Groq, danach OpenAI, danach Gemini, jeweils nur mit vorhandenem Schlüssel. |
| `GROQ_API_KEY` | Groq-Schlüssel, nur serverseitig hinterlegen. |
| `GROQ_MODEL` | Optional, Standard `llama-3.3-70b-versatile`. |
| `OPENAI_API_KEY` | Bestehender OpenAI-Schlüssel bleibt weiterhin nutzbar. |
| `OPENAI_MODEL` | Optional, Standard `gpt-4o-mini`. |
| `GEMINI_API_KEY` | Gemini-Schlüssel, ausschließlich serverseitig hinterlegen. |
| `GEMINI_MODEL` | Optional, Standard `gemini-3.5-flash-lite` für kurze Antwortzeiten. |
| `GEMINI_TTS_MODEL` | Optional, Standard `gemini-3.8-flash-lite-tts`. |
| `GEMINI_VOICE` | Optional, Standard `Sulafat` (warme Stimme). |
| `JARVIS_PASSWORD` | Bestehendes Passwort, 16 bis 256 Zeichen. |
| `ALLOWED_ORIGINS` | Optional, erlaubte Browser-Ursprünge, durch Kommas getrennt. Standard: `https://manuellaski-gif.github.io`. |
| `TRUST_PROXY` | Zahl vertrauenswürdiger Proxy-Hops, Standard `0`. |

Eine bestehende Installation mit `OPENAI_API_KEY` und `JARVIS_PASSWORD` bleibt
funktionsfähig. Es werden keine Schlüssel erzeugt, gelöscht oder verändert.
Bei explizitem `AI_PROVIDER=groq` muss `GROQ_API_KEY` gesetzt sein. Es gibt keinen
automatischen Anbieterwechsel bei Fehlern während einer Anfrage.

### Google Gemini aktivieren

1. In [Google AI Studio](https://aistudio.google.com/apikey) einen persönlichen
   API-Schlüssel erstellen oder einen bereits vorhandenen passenden Schlüssel
   verwenden. Den Schlüssel niemals in Chat, Git oder HTML eintragen.
2. In der geschützten Umgebung des bestehenden Servers `GEMINI_API_KEY`
   hinterlegen und `AI_PROVIDER=gemini` setzen. Bestehende Passwörter und
   Schlüssel anderer Anbieter unverändert lassen.
3. Die Version mit Gemini-Unterstützung deployen. Das bloße Speichern einer
   Variable aktiviert sie noch nicht im laufenden Prozess. Ein älterer Build
   ohne Gemini-Unterstützung kann `AI_PROVIDER=gemini` nicht verarbeiten.

`gemini-3.5-flash-lite` wird in der zum Implementierungszeitpunkt geprüften
[Google-Preisliste](https://aistudio.google.com/docs/pricing) mit kostenlosem
Kontingent für Ein- und Ausgabetokens geführt. Modellzugang und Kontolimits
müssen im eigenen Google-Konto verfügbar sein. Eine bezahlte Abrechnung wird
durch diesen Code nicht eingerichtet. Der Server verwendet den dokumentierten
[OpenAI-kompatiblen Endpunkt](https://aistudio.google.com/docs/openai).

Wenn zusätzlich noch ein OpenAI-Schlüssel existiert, ist die explizite Vorgabe
`AI_PROVIDER=gemini` erforderlich, um Gemini zu wählen. So bleibt das Verhalten
bereits bestehender OpenAI-Installationen unverändert.

### Schnelle Antworten und natürliche Sprache

„Hilfe“, Datum und Uhrzeit werden direkt in der Oberfläche beantwortet. Diese
Befehle benötigen keine KI-Anfrage. Normale KI-Fragen erscheinen bereits während
der Generierung. Der Server verwendet für das schnelle Standardmodell minimale
Denkarbeit und bittet normalerweise um zwei bis drei natürliche, kurze Sätze.
Ein ausdrücklich gesetztes `GEMINI_MODEL` bleibt unterstützt.

Die Stimmeinstellung **Natürlich** verwendet Googles Flash-Lite-Sprachmodell und
den bereits serverseitig hinterlegten `GEMINI_API_KEY`. Die warme deutsche
Sprachausgabe wird fortlaufend abgespielt. **Gerätestimme** verwendet auf Wunsch
eine vorhandene hochwertige deutsche Systemstimme; **Aus** schaltet das Vorlesen
ab. **Vorlesen** und **Stopp** erlauben manuelle Steuerung. Bei fehlendem Kontingent
oder Audiofehlern bleibt die Textantwort erhalten. Es wird nicht unbemerkt auf
eine andere Stimme gewechselt.

Auch `gemini-3.8-flash-lite-tts` hat laut der geprüften
[Google-Preisliste](https://aistudio.google.com/docs/pricing#gemini-3.8-flash-lite-tts)
ein kostenloses Standardkontingent. Freigaben und Limits sind projektabhängig.
Es wird kein zusätzlicher Cloud-TTS-Dienst und keine bezahlte Abrechnung
eingerichtet. Sprachdaten werden kurz und begrenzt im Server-RAM gepuffert,
nicht in Dateien oder Logs gespeichert.

**Fünf Sekunden sind ein Ziel für einen bereits laufenden Dienst.** Eine feste
Obergrenze lässt sich mit dem kostenlosen Hosting nicht zusichern:
[Render Free](https://render.com/docs/free#spinning-down-on-idle) pausiert Dienste
nach Inaktivität, und das Aufwachen kann etwa eine Minute dauern. Lokale Befehle
funktionieren nach dem Laden der Seite weiterhin sofort. Es werden keine
Hintergrund-Pings eingerichtet und kein kostenpflichtiger Plan aktiviert.

### API-Kompatibilität

`POST /api/chat` liefert weiterhin `{reply}` als JSON. Mit
`Accept: text/event-stream` sendet der Server `delta`-Ereignisse mit `{text}` und
abschließend `done` mit `{reply}`. Fehler vor Beginn bleiben JSON-Antworten mit
HTTP-Status; spätere Fehler sind `error`-Ereignisse. Verbindungsabbrüche brechen
auch die ausgehende Anfrage ab.

`POST /api/speech` erwartet dieselbe Bearer-Sitzung und `{text}` mit höchstens
1200 Zeichen. Ohne Streaming erhält der Client WAV; mit SSE erhält er
`audio`-Ereignisse mit Base64-PCM16LE, 24 kHz, mono, anschließend `done`.
Die Sprachausgabe hat ein eigenes Limit von fünf Anfragen pro Minute und Sitzung.
Zeitmessungen in den Logs enthalten nur Anbieter, Modell und Laufzeiten.

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

- Deployments erfolgen im vom Nutzer freigegebenen Rahmen; bereits erteilte
  Zustimmungen im Gespräch gelten weiter.
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

Die Anwendung erzeugt oder verändert keine Zugangsdaten automatisch.
