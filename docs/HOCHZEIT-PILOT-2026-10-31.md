# Geschlossener Hochzeitstest am 31. Oktober 2026

Stand: 24. Oktober 2026. Arbeitsstand, keine rechtliche Freigabe und keine fertige Datenschutzerklärung.

## Abgestimmter Rahmen

Betreiber: Matthias Wendland, Kupferweg 10, 33334 Gütersloh, info@matthiaswendlandfotografie.de.
Album: Shirin & Frederik · 31.10.2026, technische ID shirin-frederik-31102026.
Brautpaar mit Test einverstanden. Kleine freiwillige Testgruppe unter Freunden; keine geplante Nutzung durch sämtliche ca. 120 Gäste. Matthias verwaltet die Technik im Hintergrund; das Paar entscheidet über das Album. Gäste können freigegebene Bilder herunterladen. Keine Werbenutzung, kein Video im Test. Für die technische Auswertung nur Fotoanzahl, Dateigrößen und Upload-Erfolgs-/Fehlerzähler verwenden.

## Technische Vorbereitung

- Betreiberkonfiguration PILOT_EVENT_ID / PILOT_ENDS_AT / optional PILOT_TITLE aktiviert genau ein bestehendes, nicht gelöschtes Album als pilot, ohne Zahlung oder fingierten Zahlungsdatensatz. Andere Veranstaltungen bleiben unverändert.
- Pilot verwendet reguläre MAX_EVENT_PHOTOS / MAX_EVENT_BYTES. Aktuell 1.000 Fotos und 600 MiB pro Album; nicht gleichzeitig garantiert erreichbar. Die gemeinsame Disk hat nur 1 GB.
- Ablauf: 30. November 2026, 00:00 Uhr Europe/Berlin (2026-11-29T23:00:00Z). Ab dann Zugriff gesperrt. Dateientfernung beim nächsten erfolgreichen stündlichen Löschlauf bzw. beim nächsten Serverstart. Kein extern garantierter minutengenauer Löschjob.
- Ablaufbereinigung entfernt Fotoverzeichnis, Fotozeilen und Gästetoken; Event-/Konto-/Zahlungsmetadaten werden damit nicht vollständig entfernt. SQLite-WAL/Backups und Provider-Logs haben eigene Fristen; deren Löschung ist nicht durch diesen Job bewiesen.
- Neustart darf ein gelöschtes Pilot-Album nicht reaktivieren. PILOT-Konfiguration nach Ende entfernen.
- Kalendergebundener Pilot ist kein gekauftes Paket. Stripe bleibt ausschließlich im Testmodus.
- Freier Gesamtspeicher im angemeldeten Konto numerisch sichtbar; 100 MiB Upload-Stoppreserve. Vor dem Test prüfen. Kein belastbarer Parallel-Lasttest für 120 Gäste.

## Codeprüfung

- Anwendung setzt event_session für angemeldete Nutzer: HttpOnly, SameSite=Lax, im HTTPS-Betrieb Secure, maximal sieben Tage. Gäste benötigen kein eigenes Konto.
- In den öffentlichen HTML-/JS-Dateien keine externen HTTP-Ressourcen oder lokalen Tracking-Speicher gefunden (Quellcodeprüfung, keine vollständige Netzwerkmessung).
- Keine Newsletter-Anmeldung. Brevo erhält Konto-E-Mail und transaktionalen Mailtext für Bestätigung/Passwort-Wiederherstellung; keine Albumfotos im Mailer.
- Gastlink ist ein weitergebbarer Zugangsschlüssel, kein personengebundener Zugang; Download-Kopien bleiben nach Albumlöschung bestehen.
- Sharp erzeugt JPEG, maximal 2.560 Pixel, Qualität 82; unveränderte Originale nicht dauerhaft gespeichert. Temporäre Eingangsdateien und fehlgeschlagene Uploads gesondert berücksichtigen.

## Vor echten Testbildern noch offen

1. Tatsächliche Rollen und Rechtsgrundlagen festlegen; Einverständnis des Paares deckt nicht automatisch alle abgebildeten Personen. Freiwillige Teilnehmer und abgebildete Dritte vorab informieren. Keine pauschale Einwilligung für Gäste unterstellen.
2. Render-Service live in Ohio, USA, bestätigt. DPA veröffentlicht unter https://render.com/dpa; Kontoeinbeziehung, zutreffende Transfergrundlage und Unterauftragnehmer anhand tatsächlicher Vertragslage nachweisen. EU-Umzug wäre gesondertes technisches/kostenpflichtiges Vorhaben und allein keine Datenschutzfreigabe.
3. Brevo verweist auf DPA in Terms of Service: https://help.brevo.com/hc/en-us/articles/15403782599570-Where-can-I-find-the-Data-Processing-Agreement-DPA und https://www.brevo.com/legal/termsofuse/ . Zutreffende Kontobedingungen, Versandprotokolle/Tracking, Aufbewahrung und Unterauftragnehmer noch prüfen. Keine Vertragsannahme im Namen des Betreibers vorgenommen.
4. Vollständige Art.-13-Information mit bestätigten Rechtsgrundlagen, Empfängern/Transfers, Fristen, Rechten und Beschwerdemöglichkeit erstellen. Gästeseite enthält bislang nur Kurzhinweis, keine vollständige Datenschutzerklärung.
5. Löschung und Umgang mit Sicherungen/Logs, Wiederherstellung und Datenschutzanfragen dokumentieren. Hinweis an Teilnehmer vor Ablauf organisieren; Erinnerungsmail ist noch nicht implementiert.
6. Mehrere Handys, Scan vom Druck, Upload, Download und Moderation im gewünschten Modus testen. QR-Karte erst nach finaler Prüfung verteilen.

## Kurzhinweis für die Karten – Entwurf

Freiwilliger FinalSnap-Test zur Hochzeit von Shirin & Frederik. Mit dem QR-Code öffnest du das gemeinsame Album. Teilnehmer mit Gästelink können freigegebene Fotos ansehen und herunterladen. Bitte lade nur Bilder hoch, die du teilen darfst, und gib den Link nicht weiter. Keine Werbenutzung der Testbilder. Albumzugriff endet am 30.11.2026 um 00:00 Uhr; Entfernung beim nächsten Löschlauf. Bereits heruntergeladene Kopien bleiben erhalten. Fragen und Löschwünsche: info@matthiaswendlandfotografie.de. Vollständige Datenschutzhinweise müssen vor Freigabe ergänzt und vor dem Upload erreichbar sein.
