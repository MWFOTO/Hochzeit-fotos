# FinalSnap – Last- und Großalbumtest

Stand: 26. November 2026

Branch: `codex/lasttest` auf Basis von `codex/germany-storage` (`924ff92ea92cfd179ac5d5b3ca0cbcf935f503a1`)
Ausführung: macOS 27.2.1, Apple M5 Pro, 24 GB RAM; ausschließlich lokaler Node-Server, eigene temporäre SQLite-Datenbank und lokaler Fotospeicher.

## Methode und Grenzen

`scripts/load-test.js` erstellt pro Szenario ein Pilot-Testalbum und für jeden Gast einen eigenen Gästelink-Cookie. Das Skript erzeugt mit Sharp zufällige JPGs zwischen 3 und 8 MB, verteilt die Uploadstarts gleichmäßig über die Testdauer und sendet höchstens zehn Dateien pro Anfrage. Die Upload-Anfragen tragen den korrekten Origin-Header und das Veranstaltungs-Token. Anschließend lädt es als Veranstalter das ZIP des vollständigen Albums streamend in eine temporäre Datei.

Die Standarddauer ist proportional zur Zielvorgabe von 2.000 Fotos in 30 Minuten: drei Minuten für 200 Fotos, zwölf Minuten für 800 Fotos und 30 Minuten für 2.000 Fotos. Die Upload-Latenz ist die Zeit einer HTTP-Anfrage mit bis zu zehn Fotos. „Fotos/Minute“ zählt nur erfolgreich gespeicherte Fotos. RSS ist der Spitzenwert des gesamten lokalen Testprozesses. Die ZIP-Spalte nennt den separat gemessenen ZIP-Spitzenwert.

Das sind keine Render- oder Hetzner-Ergebnisse: lokale Dateispeicherung und Loopback-Netzwerk sind schneller und anders als der Produktivpfad mit Hetzner Object Storage. Der Test belegt deshalb die Anwendungspipeline und das ZIP-Verhalten auf dieser Entwicklungsmaschine, nicht die Kapazität des Live-Dienstes oder des S3-Netzwerks. Der ZIP-Download lief als einzelner vollständiger Veranstalterdownload.

## Klein – 20 Gäste, 200 Fotos

| Messwert | Ergebnis |
| --- | ---: |
| Uploaddauer (Soll / gemessen) | 3,00 / 2,99 min |
| Erfolgreiche Fotos | 200 / 200 |
| Fotos pro Minute | 66,80 |
| Upload-Anfragen | 20; 6,68 Anfragen/min |
| Fehlerquote / Statuscodes | 0 %; HTTP 200: 20, HTTP 429: 0, HTTP 503: 0 |
| Anfragezeit p50 / p95 | 6.312 / 7.315 ms |
| Maximaler RSS | 358,04 MB |
| ZIP: Status, Dauer, Größe, RSS-Spitze | 200; 1.952 ms; 1.070,26 MB; 202,48 MB |
| Upload-Ordner: Spitzenbelegung | 1.439,18 MB |
| Temporärer Ordner `.tmp`: Spitzenbelegung | 64,65 MB |
| Serverfehler / auffällige Logs | keine |

## Mittel – 80 Gäste, 800 Fotos

| Messwert | Ergebnis |
| --- | ---: |
| Uploaddauer (Soll / gemessen) | 12,00 / 12,11 min |
| Erfolgreiche Fotos | 800 / 800 |
| Fotos pro Minute | 66,08 |
| Upload-Anfragen | 80; 6,61 Anfragen/min |
| Fehlerquote / Statuscodes | 0 %; HTTP 200: 80, HTTP 429: 0, HTTP 503: 0 |
| Anfragezeit p50 / p95 | 6.859 / 7.557 ms |
| Maximaler RSS | 291,53 MB |
| ZIP: Status, Dauer, Größe, RSS-Spitze | 200; 8.026 ms; 4.428,11 MB; 224,97 MB |
| Upload-Ordner: Spitzenbelegung | 5.819,49 MB |
| Temporärer Ordner `.tmp`: Spitzenbelegung | 65,87 MB |
| Serverfehler / auffällige Logs | keine |

## Groß – 150 Gäste, 2.000 Fotos

| Messwert | Ergebnis |
| --- | ---: |
| Uploaddauer (Soll / gemessen) | 30,00 / 30,23 min |
| Erfolgreiche Fotos | 2.000 / 2.000 |
| Fotos pro Minute | 66,15 |
| Upload-Anfragen | 300; 9,92 Anfragen/min |
| Fehlerquote / Statuscodes | 0 %; HTTP 200: 300, HTTP 429: 0, HTTP 503: 0 |
| Anfragezeit p50 / p95 | 3.371 / 7.440 ms |
| Maximaler RSS | 360,76 MB |
| ZIP: Status, Dauer, Größe, RSS-Spitze | 200; 17.230 ms; 11.108,68 MB; 332,73 MB |
| Upload-Ordner: Spitzenbelegung | 14.536,98 MB |
| Temporärer Ordner `.tmp`: Spitzenbelegung | 64,36 MB |
| Serverfehler / auffällige Logs | keine |

## Einordnung von Rate-Limit und Warteschlange

- **Rate-Limit:** Der Test sendete pro Gast nur ein bis zwei Upload-Anfragen. Das Limit von 120 Anfragen pro Minute je IP und Gast-Cookie wurde damit bei weitem nicht erreicht. Es zählt die Zahl der HTTP-Requests, nicht die Zahl der Fotos in einem Request. Für den normalen Ablauf dieser simulierten Hochzeit ist das Limit kein Engpass.
- **Upload-Warteschlange:** Im Großlauf kamen die Uploads über 30 Minuten verteilt an; alle 300 Anfragen erhielten HTTP 200. Die gemessene Rate von 66,15 Fotos pro Minute lag knapp unter dem Zielwert von 66,67. Die p95-Anfragezeit für bis zu zehn Fotos betrug 7,44 Sekunden. Unter diesem gleichmäßig verteilten Muster reichen Warteschlange und Verarbeitung auf der lokalen Maschine aus.
- **Spitzenlast:** Der Test startet Gäste im Abstand von etwa zwölf Sekunden und bildet keinen gleichzeitigen Scan durch 150 Gäste ab. Die Ereigniswarteschlange serialisiert die Verarbeitung für ein Album und nimmt höchstens 30 wartende Anfragen auf; weitere Anfragen erhalten HTTP 429. Bei einem kurzen Uploadburst kann es deshalb weiterhin zu abgelehnten Anfragen kommen. Das Rate-Limit wäre dabei voraussichtlich nicht die Ursache.
- **ZIP:** Ein ZIP mit 2.000 Originaldateien und rund 11,1 GB wurde lokal mit HTTP 200 streamend erzeugt. Der dabei gemessene RSS-Spitzenwert lag bei rund 333 MB; der gesamte Prozess erreichte rund 361 MB. Das ist ein gutes Zeichen für den lokalen ZIP-STORE-Pfad. Es beweist nicht dieselbe Downloadzeit über den Hetzner-Object-Storage-Pfad.

## Vorschläge – nicht umgesetzt

1. Vor Verkaufsstart den identischen Ablauf in einer getrennten Staging-Umgebung mit Render- und Object-Storage-Konfiguration wiederholen; niemals gegen `finalsnap.de` testen.
2. Zusätzlich einen lokalen Burstlauf mit vielen gleichzeitig startenden Gästen durchführen und die maximale Warteschlangentiefe sowie 429-Anteile dokumentieren.
3. Im Browser sicherstellen, dass 429 und 503 automatisch mit wachsendem Warteabstand und derselben Upload-ID wiederholt werden. Die Oberfläche sollte den wartenden Upload sichtbar halten.
4. Für einen kontrollierten ZIP-Test mit großen Alben einen verfügbaren Speicherplatz für die heruntergeladene ZIP-Datei prüfen und den vollständigen Download zusätzlich mit einem großen, aber realistischen Nutzeranschluss messen.
5. Erst nach den Staging-Messungen entscheiden, ob die Warteschlangenobergrenze erhöht oder Uploads je Album parallel verarbeitet werden sollten. Eine Erhöhung ohne Speichertest könnte den temporären Speicher stärker belasten.

## Ausführung und Tests

- `node scripts/load-test.js --guests 20 --photos 200` – erfolgreich: 200/200 Fotos; vollständiges ZIP geladen.
- `node scripts/load-test.js --guests 80 --photos 800` – erfolgreich: 800/800 Fotos; vollständiges ZIP geladen.
- `node scripts/load-test.js --guests 150 --photos 2000` – erfolgreich: 2.000/2.000 Fotos; vollständiges ZIP geladen.
- `npm test` – 55/55 Tests bestanden.
- Keine Anfragen an Render oder `finalsnap.de`, keine echten Zugangsdaten, kein Deploy.
