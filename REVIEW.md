# Prüfung und vorbereitete KI-Integration

Geprüftes Repository: `manuellaski-gif/jarvis-iphone`.
Basis: `main` bei `019e9cc0884baabe40df1ed131cb1b2cb5191bec`.
Änderungen im bestehenden Checkout auf `codex/review-groq-integration`.

## Befunde und Korrekturen

| Befund im Ausgangsstand | Änderung |
| --- | --- |
| Die Uhrzeit-Regel erkennt jedes Vorkommen von „zeit“ oder „uhr“ und verhindert damit echte KI-Fragen wie „Erkläre Zeitmanagement“. | Nur ausdrückliche Uhrzeitbefehle werden lokal beantwortet. |
| Ein Token wird aus dem Sitzungsspeicher gelesen, die Oberfläche startet trotzdem gesperrt. | Gespeicherte Sitzungen werden dargestellt; bei HTTP 401 erfolgt die Abmeldung. |
| Doppelte Klicks, Enter oder Spracheingaben können parallele Anfragen und widersprüchliche Antworten auslösen. | Anfragen sind gegen Doppelstarts geschützt, Bedienelemente werden währenddessen deaktiviert. |
| Fehlende Browser-Speicher- oder Sprachunterstützung kann erfolgreichen Chat unterbrechen. | Speicherung und Sprachausgabe sind optional und separat abgesichert. |
| HTML-Fehlerseiten werden ungeprüft als JSON gelesen; Browser-Anfragen können unbegrenzt warten. | Verständliche Fehler bei nicht-JSON-Antworten, 45 Sekunden Browser-Timeout, 30 Sekunden SDK-Timeout. |
| Erfolgreiche Anmeldungen zählen gegen das Fehlversuchs-Limit. Abgelaufene Einträge verbleiben in Maps. | Nur fehlgeschlagene Anmeldungen zählen; erfolgreiche Anmeldung setzt deren Zähler zurück. Alte Einträge werden bei API-Anfragen entfernt. |
| Ungültige Nachrichten verbrauchen das Chat-Limit. | Validierung erfolgt vor dem Zählen einer KI-Anfrage. |
| Provider-Limits und Ausfälle erscheinen pauschal als HTTP 500; upstream Fehlermeldungen werden geloggt. | Sichere 429/502/503/504-Antworten, kein Loggen von Upstream-Inhalten oder Schlüsseln und keine automatischen Wiederholungen. |
| Fehlerhafte oder zu große JSON-Anfragen erzeugen HTML-Fehlerseiten. | Einheitliche JSON-Fehlerantworten mit HTTP 400/413. |
| Nur OpenAI ist fest integriert. | Groq und Gemini sind über das vorhandene SDK nutzbar; die bestehende OpenAI-Konfiguration bleibt unterstützt. Kein zweites SDK. |
| Lokales Zusammenspiel von Frontend und Server ist nicht vorbereitet; Lockfile und Testbefehl fehlen. | Lokale Oberfläche unter `/app`, Lockfile, Node-Anforderung und `npm test` ergänzt. |
| „Hilfe“ benötigt eine vollständige KI-Antwort; Antworten werden erst am Ende sichtbar. | Hilfe, Datum und Uhrzeit werden lokal beantwortet; normale Antworten erscheinen per SSE während der Generierung. |
| Die voreingestellte Gerätestimme klingt je nach iPhone-Stimmenpaket künstlich. | Natürliche deutsche Gemini-Sprachausgabe mit fortlaufendem Audio, separater Gerätestimmen-Option und Stopp/Vorlesen-Steuerung. |

## Projektstruktur

`index.html` ist die aktive Oberfläche. `server.js` bleibt der bestehende
Express-Server mit denselben Anmelde- und Chat-Endpunkten. `index 2.html` ist ein
älterer Offline-Prototyp und wurde unverändert beibehalten. Es wurde kein neues
Anwendungsprojekt angelegt.

Die vorhandene Produktionsadresse im Frontend bleibt erhalten. Lokal wird die
API desselben Ursprungs verwendet. Der Server liefert nur die öffentliche
HTML-Datei unter `/app` aus, nicht das Projektverzeichnis.

## Verifikation

- `npm test -- --test-reporter=tap`: **71 Tests bestanden**, davon 33 Server-HTTP-,
  30 Frontend- und 8 Sprachtransporttests. Der tatsächliche SDK-Client verwendet einen
  simulierten ausgehenden Transport; keine echten KI-Anfragen.
- Gemini wird mit dem dokumentierten OpenAI-kompatiblen Endpunkt und dem
  schnelleren Standardmodell `gemini-3.5-flash-lite` getestet. Explizite Anbieterwahl und ein
  anderes konfiguriertes Modell sind abgedeckt; bestehende Groq-/OpenAI-Auswahl
  bleibt bei zusätzlich vorhandenem Gemini-Schlüssel erhalten.
- Der echte lokale Express-Server, SDK und Sprachtransport wurden gemeinsam im
  mobilen Chromium getestet. Hilfe ohne API-Aufruf, Anmeldung, progressive
  Textausgabe vor Abschluss, fortlaufende PCM-Wiedergabe, Stopp und Aus-Modus
  sowie ein Stimmen-Limit bei weiterhin sichtbarer Antwort sind bestanden.
  Bei 320 und 390 Pixeln Breite keine horizontale Überbreite oder JS-Fehler.
- Die lokalen Zeitmessungen (Hilfe etwa 99 ms, erster Text etwa 252 ms) enthalten
  simulierte Anbieter und sind kein Benchmark der echten Gemini-Verbindung.
- Sprachtests prüfen den dokumentierten TTS-Modellnamen, Stimme und Stil,
  Audio vor Stream-Abschluss, korrektes WAV, Cache, Abbruch, Timeout und sichere
  Fehler. Google-Schlüssel wurden nicht ausgelesen oder für diese Tests genutzt.
- `node --check server.js` und `git diff --check`: bestanden.
- `npm audit --omit=dev`: keine bekannten Sicherheitslücken gemeldet
  (Momentaufnahme der neu installierten, im Lockfile festgehaltenen Versionen).

## Offene Punkte und Grenzen

- Echte Modell- und Stimmenanfragen sind in dieser Testsuite simuliert.
  Modellfreigaben und Kontingente müssen im eigenen Google-Konto verfügbar
  sein. Die natürliche Stimme muss nach Veröffentlichung auf dem persönlichen
  iPhone angehört werden; die Browserprüfung verwendet synthetisches Audio.
- Unter fünf Sekunden ist bei einem laufenden Dienst das Optimierungsziel,
  keine garantierte Obergrenze. Render Free pausiert nach Inaktivität und kann
  etwa eine Minute zum Aufwachen benötigen. Ein kostenpflichtiger Tarif wurde
  nicht aktiviert.
- Vor einem späteren Deployment die Reverse-Proxy-Topologie prüfen und erst dann
  `TRUST_PROXY` setzen. Standardmäßig wird kein weitergeleiteter Client-IP-Header
  vertraut. Eine falsche Einstellung kann Anmeldelimits beeinträchtigen.
- Sitzungen und Limits liegen weiterhin im Prozessspeicher. Für mehrere Instanzen
  oder dauerhafte Sitzungen ist ein gemeinsamer Speicher nötig.
- Mikrofon und Sprachausgabe auf einem echten iPhone/Safari wurden nicht getestet.
- Zugangsdaten wurden nicht geändert; `main` bleibt unverändert. Der Stand
  `8896b1a` wurde am 8. November 2026 auf dem bestehenden Render-Dienst
  veröffentlicht und anhand von HTTP-Antworten, ausgelieferter HTML-Datei,
  mobilen Browserprüfungen und Laufzeitlogs verifiziert. Der manuelle
  Commit-Deploy hat automatische Deployments deaktiviert.
- Gemini wurde mit einem privat vom Nutzer hinterlegten `GEMINI_API_KEY` und
  `AI_PROVIDER=gemini` aktiviert. Der Dienst verwendet den separaten Arbeitsbranch;
  bestehende Passwörter und andere API-Schlüssel wurden nicht verändert.
  Die neue Sprachausgabe verwendet denselben Schlüssel.
