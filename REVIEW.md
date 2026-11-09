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

## Projektstruktur

`index.html` ist die aktive Oberfläche. `server.js` bleibt der bestehende
Express-Server mit denselben Anmelde- und Chat-Endpunkten. `index 2.html` ist ein
älterer Offline-Prototyp und wurde unverändert beibehalten. Es wurde kein neues
Anwendungsprojekt angelegt.

Die vorhandene Produktionsadresse im Frontend bleibt erhalten. Lokal wird die
API desselben Ursprungs verwendet. Der Server liefert nur die öffentliche
HTML-Datei unter `/app` aus, nicht das Projektverzeichnis.

## Verifikation

- `npm test -- --test-reporter=tap`: **33 Tests bestanden**, davon 19 Server-HTTP-
  und 14 Frontend-Regressionstests. Der tatsächliche SDK-Client verwendet einen
  simulierten ausgehenden Transport; keine echten KI-Anfragen.
- Gemini wird mit dem dokumentierten OpenAI-kompatiblen Endpunkt und dem
  Standardmodell `gemini-3.8-flash` getestet. Explizite Anbieterwahl und ein
  anderes konfiguriertes Modell sind abgedeckt; bestehende Groq-/OpenAI-Auswahl
  bleibt bei zusätzlich vorhandenem Gemini-Schlüssel erhalten.
- Chromium mit mobiler Fenstergröße 390 × 844: Anmeldung, Chat über lokalen
  Express-Server mit simuliertem Groq-Transport, Zeitmanagement-Frage,
  Wiederherstellung nach Neuladen, Uhrzeit, HTML/502-Fehler, HTML/401-Abmeldung,
  wieder nutzbare Bedienelemente, keine horizontale Überbreite und keine
  JavaScript-Laufzeitfehler bestanden.
- `node --check server.js` und `git diff --check`: bestanden.
- `npm audit --omit=dev`: keine bekannten Sicherheitslücken gemeldet
  (Momentaufnahme der neu installierten, im Lockfile festgehaltenen Versionen).

## Offene Punkte und Grenzen

- Echte Groq- und Gemini-Aufrufe wurden ohne passende Zugangsdaten nicht
  ausgeführt. Kostenloses Kontingent, Modellfreigabe und Limits müssen im
  jeweiligen Konto verfügbar sein. Die Konfiguration steht in `README.md`.
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
- Die Gemini-Erweiterung benötigt ein eigenes Deployment und einen privat
  hinterlegten `GEMINI_API_KEY`. `AI_PROVIDER=gemini` wählt Gemini ausdrücklich;
  die bestehende OpenAI-Konfiguration wird durch den Code nicht überschrieben.
- Die letzte beobachtete produktive KI-Anfrage nutzte OpenAI und erhielt HTTP
  429. Ob ein kurzfristiges Anfragelimit oder ein Kontingentproblem vorliegt,
  lässt sich aus dem bewusst reduzierten Fehlerlog nicht unterscheiden.
