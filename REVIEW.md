# Prüfung und vorbereitete Groq-Integration

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
| Nur OpenAI ist fest integriert. | Groq ist über das vorhandene SDK nutzbar; die bestehende OpenAI-Konfiguration bleibt unterstützt. Kein zweites SDK. |
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

- `npm test -- --test-reporter=tap`: **31 Tests bestanden**, davon 17 Server-HTTP-
  und 14 Frontend-Regressionstests. Der tatsächliche SDK-Client verwendet einen
  simulierten ausgehenden Transport; keine echten KI-Anfragen.
- Chromium mit mobiler Fenstergröße 390 × 844: Anmeldung, Chat über lokalen
  Express-Server mit simuliertem Groq-Transport, Zeitmanagement-Frage,
  Wiederherstellung nach Neuladen, Uhrzeit, HTML/502-Fehler, HTML/401-Abmeldung,
  wieder nutzbare Bedienelemente, keine horizontale Überbreite und keine
  JavaScript-Laufzeitfehler bestanden.
- `node --check server.js` und `git diff --check`: bestanden.
- `npm audit --omit=dev`: keine bekannten Sicherheitslücken gemeldet
  (Momentaufnahme der neu installierten, im Lockfile festgehaltenen Versionen).

## Offene Punkte und Grenzen

- Ein echter Groq-Aufruf wurde ohne hinterlegten Groq-Schlüssel nicht ausgeführt.
  Kostenloses Kontingent, Modellfreigabe und Limits müssen im Groq-Konto geprüft
  werden. Die Konfigurationsanleitung steht in `README.md`.
- Vor einem späteren Deployment die Reverse-Proxy-Topologie prüfen und erst dann
  `TRUST_PROXY` setzen. Standardmäßig wird kein weitergeleiteter Client-IP-Header
  vertraut. Eine falsche Einstellung kann Anmeldelimits beeinträchtigen.
- Sitzungen und Limits liegen weiterhin im Prozessspeicher. Für mehrere Instanzen
  oder dauerhafte Sitzungen ist ein gemeinsamer Speicher nötig.
- Mikrofon und Sprachausgabe auf einem echten iPhone/Safari wurden nicht getestet.
- Zugangsdaten und bestehende Server-/Hosting-Einstellungen wurden nicht geändert.
  `main` bleibt unverändert. Kein Deployment wurde durchgeführt.
- Bei der ersten Vorbereitung fehlte die GitHub-App-Installation; Schreibzugriffe
  wurden mit `403 Resource not accessible by integration` abgewiesen. Die
  Installation für das bestehende Repository ist inzwischen bestätigt. Der Stand
  bleibt auf dem separaten Arbeitsbranch und als übertragbarer Patch gesichert.
