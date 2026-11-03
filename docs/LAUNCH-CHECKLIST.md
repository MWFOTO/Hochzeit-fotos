# FinalSnap – Aufgaben bis zum öffentlichen Start

Stand: 12. Oktober 2026. Die Anwendung bleibt im Stripe-Testmodus. Dieser Plan ist keine rechtliche Freigabe.

## Erledigt, mit Grenzen
- [x] Registrierung, Anmeldung und Veranstalterkonto.
- [x] Brevo für Bestätigungsmails und Passwort-Zurücksetzen angebunden; vom Betreiber im echten Postfach getestet.
- [x] QR-Gästezugang ohne Konto, Upload, Kamera-Auswahl, Galerie und Diashow.
- [x] In der aktuellen Testphase: je Veranstaltung bis zu 25 kostenlose Testfotos; vor dem Veranstaltungsdatum vorbereiten.
- [x] Fotoverwaltung, Mehrfachauswahl, Moderation und Löschung.
- [x] Bilder auf maximal 2.560 Pixel, JPEG-Qualität 82; keine unveränderten Originale.
- [x] Stripe-Testcheckout, Webhook-Prüfung und Übergang vom Testalbum zur Zahlung.
- [x] Grundlegende Zugriffskontrollen, Origin/CSRF-Schutz, Rate Limits und Upload-Prüfung; noch keine vollständige Sicherheitsprüfung.
- [x] Speicheranzeige, Uploadzähler und Warnung bei wenig freiem Disk-Speicher.
- [x] Gästefotos sind pro Browser getrennt: Gäste sehen nur eigene Uploads; Veranstalter sehen alle. Gleicher Browser bedeutet dieselbe anonyme Gästesitzung.
- [x] 90-tägige Nur-Lese-Downloadphase nach dem Albumzeitraum; davor zwölf Monate ab Veranstaltungsdatum online.
- [x] FinalSnap als Arbeitsmarke, Paketkarten und Übernahme der Auswahl von der Landingpage.
- [x] 20 automatisierte Tests bestehen. Mobile End-to-End- und Lasttests bleiben offen.

## Als Nächstes: Praxistests und Infrastruktur
- [ ] Ein bis zwei geschlossene Testveranstaltungen durchführen; mehrere Mobilgeräte, getrennte Gästegalerien und Löschtermine prüfen.
- [ ] Anzahl, Durchschnittsgröße und Gesamtvolumen der Fotos, Uploadfehler und Supportbedarf auswerten.
- [ ] Android/iPhone, HEIF-Unterstützung, Kamera, mehrere Uploads, langsames Netz, Verbindungsabbrüche und ZIP-Downloads testen.
- [ ] Gleichzeitige Uploads prüfen; derzeit wird pro Event nur ein Uploadauftrag gleichzeitig verarbeitet.
- [ ] Aktuelle 1-GB-Disk vor jeder Testveranstaltung auf freien Platz prüfen.
- [ ] Hosting-Region prüfen: aktueller Render-Service steht in Ohio; gewünschter Zielstandort und Datentransfers vor Marktstart klären.
- [ ] App, PostgreSQL und privaten Fotospeicher planen; Anbieter, Standort, Zugriffe, Kosten und Migration bewerten.
- [ ] Daten sichern und Wiederherstellung testen, bevor produktive Daten umgezogen werden.
- [ ] Vollständigen Umzug mit Rückweg und Datenabgleich vorbereiten; alte Disk erst nach Prüfung abbauen.

## Angebot – Arbeitsmodell, vor Verkauf noch bestätigen
- [x] Ein Kernpaket je Veranstaltung: 34,90 € als vorläufiger Arbeitspreis.
- [x] Keine feste Fotoanzahl; Zielgrenze bis zu 25 GB verarbeitete Fotos je Event.
- [x] Start am Veranstaltungsdatum; zwölf Monate online und danach 90 Tage Nur-Lese-Download.
- [x] Bis zu 25 Testfotos für die Vorbereitung; bei Buchung bleiben sie erhalten und zählen zum Event-Speicher.
- [ ] Praxistest, Providerkapazität, aktuelle Hosting-Umgebungswerte und Kosten vor Verkauf prüfen.
- [ ] Arbeitspreis anhand Speicher, Downloadverkehr, Zahlungsgebühren, Steuern und Support bestätigen.
- [ ] 25-GB-Grenze, Speicherwarnung und Uploadverhalten bei vollem Speicher in Hosting und Nutzerhinweisen bestätigen.
- [ ] Videos bleiben zunächst außerhalb des Kernpakets; Grußbox als spätere Option kalkulieren und umsetzen.
- [ ] Fotospiegel und persönliche Begleitung separat kalkulieren; Landingpage-Anfragen sind kein bestätigtes Miet-/Serviceangebot.
- [ ] Gäste zahlen nichts; Kaufaktionen gehören ins Veranstalterkonto.

## Datenschutz, Rechte und Cookies – vor öffentlichem Verkauf prüfen lassen
- [ ] Verarbeitungsvorgänge und Datenflüsse dokumentieren: Konto, Bilder, Metadaten, Zahlungen, E-Mails, Logs, Backups.
- [ ] Rollen und Rechtsgrundlagen für Betreiber, Veranstalter, Gäste und Dienstleister klären; private und geschäftliche Events berücksichtigen.
- [ ] Bildrechte, abgebildete Dritte, Minderjährige und Meldung unzulässiger Inhalte berücksichtigen.
- [ ] Auftragsverarbeitungsverträge, Unterauftragnehmer und mögliche Drittlandtransfers prüfen.
- [ ] Datenschutzerklärung, Nutzungsbedingungen/AGB, Impressum und Verbraucher-Checkout rechtlich prüfen lassen.
- [ ] Speicherfristen begründen; keine vermeintlich gesetzliche 3-/6-Monatsfrist behaupten.
- [ ] Löschkonzept für Originale, Vorschaubilder, Tokens, Konten, Logs und Backups erstellen und technisch testen.
- [ ] Externe Wiederherstellung/Backup- und Provider-Log-Aufbewahrung passend zur 90-Tage-Frist prüfen; App-Löschung allein löscht keine außerhalb der App vorhandenen Kopien.
- [ ] Auskunft, Berichtigung, Löschung, Widerruf/Widerspruch und zuständige Kontaktstelle organisatorisch ermöglichen.
- [ ] Cookies, Browser-Speicher, Tracking und externe Ressourcen inventarisieren; erforderliche Einwilligung und Hinweise konkret prüfen.
- [ ] Brevo-Tracking und E-Mail-Protokollierung prüfen; Konto-Verifizierung nicht mit Newsletter-Anmeldung vermischen.
- [ ] Werbung nur mit passend geprüftem separatem Verfahren; gegebenenfalls Double-Opt-in und Abmeldung.
- [ ] Datenschutzvorfälle, Meldewege und Fristen in einem Betriebsablauf festhalten.
- [ ] Fachkundige rechtliche Prüfung des tatsächlichen Produkts und der Unterlagen abschließen.

## Sicherheit und Betrieb
- [x] Schneller Liveness-Endpunkt `/health` und Abhängigkeitsprüfung `/ready` ergänzt; Ready meldet Datenbank-, Uploadspeicher- und Object-Storage-Ausfälle mit HTTP 503.
- [x] Geordnetes Herunterfahren bei SIGTERM/SIGINT ergänzt, damit laufende Anfragen Zeit zum Beenden erhalten.
- [ ] Tatsächlichen Live-Dienst, Region, Tarif und Datenpfade im Anbieter-Konto verifizieren; die Projektdokumentation und Render-Kontoabfrage stimmen noch nicht überein.
- [ ] Externe Erreichbarkeitsüberwachung und Benachrichtigung für `/health` und `/ready` einrichten.
- [ ] Warnungen für niedrigen freien Speicher, Annäherung an das Object-Storage-Limit und ungewöhnliche Anbieter-Verbrauchskosten einrichten.
- [ ] Konsistente tägliche SQLite-Sicherung und Fotosicherung an einem unabhängigen Ort einrichten.
- [ ] Wiederherstellung von Datenbank und Fotos nachweisen; danach regelmäßige Wiederherstellungstests dokumentieren.
- [ ] Supportzeiten, Zuständigkeit und Störungsablauf festlegen; Runbook in `docs/OPERATIONS.md` beachten.
- [ ] Unabhängige Prüfung von Berechtigungen, Gäste-Tokens, Sessions, Passwort-Reset, E-Mail-Verifizierung und Checkout.
- [ ] E-Mail-Bestätigung vor sensiblen Aktionen und Missbrauchsschutz für kostenlose Konten festlegen.
- [ ] Verifizierungs-/Reset-Mails mit Zustellfehlern, Rate Limits und abgelaufenen Links testen.
- [ ] Upload-Limits und temporären Speicher bei parallelen Events absichern; Disk-Warnung darf nicht alleiniger Schutz sein.
- [ ] Schad-/Fremdformate, sehr große Bilder, beschädigte Dateien, EXIF/GPS und unerwartete Dateinamen prüfen.
- [ ] Abhängigkeiten, Node-Version, Sicherheitsupdates, Secrets, minimale Berechtigungen und Tokenrotation verwalten.
- [ ] Sicherheitsheader/CSP prüfen; inline Scripts soweit sinnvoll entfernen.
- [ ] HTTPS, Domain, sichere Cookies und DNS-/Mail-Authentifizierung prüfen.
- [ ] Brevo-IP-Freigaben für die künftige Hosting-Region aktualisieren; Schutz eingeschaltet lassen.
- [ ] Fehlerüberwachung, Erreichbarkeitsprüfung, Kosten-/Speicheralarme und Supportkontakt einrichten.
- [ ] Backups verschlüsseln, Zugriff begrenzen und Wiederherstellung einschließlich bereits gelöschter Daten testen.
- [ ] Deployment, Datenbankmigrationen und Rücknahme fehlerhafter Releases dokumentieren.
- [ ] Barrierearme Bedienung, mobile Darstellung und verständliche Fehlermeldungen prüfen.

## Marke und Vertrieb
- [ ] FinalSnap: Domain, Markenverfügbarkeit und mögliche Verwechslungen prüfen.
- [ ] Rechte am eigenständigen Maskottchen, an Grafiken und Schriften prüfen; keine rechtliche Freigabe bisher.
- [ ] QR-Karten/Flyer mit austauschbarem QR-Code abstimmen und Scannbarkeit nach Druck testen.
- [ ] Hilfe/FAQ, klare Qualitätsangabe für komprimierte Bilder, Leistungsumfang und Verlängerungs-/Löschhinweise fertigstellen.

## Letzte Freigabe
- [ ] Belastbare Kapazität, erfolgreiche Wiederherstellung, Zugriffsschutz und Löschung nachweisen.
- [ ] Pakete, Bruttopreise, Abrechnung, Steuer-/Rechnungsablauf, Rückerstattung und Support festlegen.
- [ ] Stripe-Livemodus separat implementieren; Live-Schlüssel sind aktuell absichtlich im Code gesperrt.
- [ ] Rechte/Datenschutz/Verkaufsunterlagen fertig prüfen lassen.
- [ ] Öffentlichen Start und echte Zahlungen ausdrücklich durch Matthias freigeben lassen.
