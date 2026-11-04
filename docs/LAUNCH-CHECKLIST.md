# FinalSnap – Aufgaben bis zum öffentlichen Start

Stand: 4. November 2026. Der deutsche Dienst ist live; Stripe bleibt im Testmodus. Dieser Plan ist keine rechtliche Freigabe.

## Erledigt, mit Grenzen
- [x] Registrierung, Anmeldung und Veranstalterkonto.
- [x] Brevo für Bestätigungsmails und Passwort-Zurücksetzen angebunden; vom Betreiber im echten Postfach getestet.
- [x] Brevo-Absender `info@finalsnap.de` ist aktiv; Brevo meldet die Domain `finalsnap.de` als authentifiziert.
- [x] QR-Gästezugang ohne Konto, Upload, Kamera-Auswahl, Galerie und Diashow.
- [x] In der aktuellen Testphase: je Veranstaltung bis zu 25 kostenlose Testfotos; vor dem Veranstaltungsdatum vorbereiten.
- [x] Fotoverwaltung, Mehrfachauswahl, Moderation und Löschung.
- [x] Bilder auf maximal 2.560 Pixel, JPEG-Qualität 82; keine unveränderten Originale.
- [x] Stripe-Testcheckout, Webhook-Prüfung und Übergang vom Testalbum zur Zahlung.
- [x] Grundlegende Zugriffskontrollen, Origin/CSRF-Schutz, Rate Limits und Upload-Prüfung; noch keine vollständige Sicherheitsprüfung.
- [x] Speicheranzeige, Uploadzähler und Warnung bei wenig freiem Disk-Speicher.
- [x] Aktiver Dienst `finalsnap-deutschland` in Frankfurt; `/health` und `/ready` geprüft.
- [x] Fotospeicher über Hetzner Object Storage in Nürnberg konfiguriert; Render-Disk enthält SQLite und temporäre Uploads.
- [x] Checkout-Wiederholungen, dokumentierte manuelle Erstattungen sowie Refund-/Streitfall-Protokollierung und Meldungen implementiert.
- [x] Öffentliche Preisangabe: 49,90 € Endpreis inkl. 19 % USt.; Pakettext nennt 25 GB und 90 Tage ab Veranstaltungsdatum.
- [x] Gästefotos sind pro Browser getrennt: Gäste sehen nur eigene Uploads; Veranstalter sehen alle. Gleicher Browser bedeutet dieselbe anonyme Gästesitzung.
- [x] 90 Tage Upload, Ansicht und Download ab Veranstaltungsdatum; danach automatische Löschung ohne zusätzliche Downloadphase.
- [x] FinalSnap als Arbeitsmarke, Paketkarten und Übernahme der Auswahl von der Landingpage.
- [x] 27 automatisierte Tests bestanden beim letzten Code-Deploy. Mobile End-to-End- und Lasttests bleiben offen.

## Als Nächstes: Praxistests und Infrastruktur
- [ ] Deutsche Steuerregistrierung in Stripe Tax im Testmodus einrichten. Betreiber hat bestätigt, dass sie derzeit fehlt; Live-Modus bleibt gesperrt.
- [ ] `STRIPE_TAX_ENABLED=1` erst nach bestätigter Testmodus-Registrierung einschalten und automatische Steuerberechnung prüfen.
- [ ] Ein bis zwei geschlossene Testveranstaltungen durchführen; mehrere Mobilgeräte, getrennte Gästegalerien und Löschtermine prüfen.
- [ ] Im Stripe-Testmodus Privat- und Geschäftskauf aus FinalSnap durchführen; Rechnungs-PDF, ausgewiesene 19 % USt., Endpreis 49,90 € und Kundenbestätigung prüfen.
- [ ] Stripe-Testerstattung und Teststreitfall auslösen; Status, Albumzugang, Protokoll und Alarmmail prüfen.
- [ ] Anzahl, Durchschnittsgröße und Gesamtvolumen der Fotos, Uploadfehler und Supportbedarf auswerten.
- [ ] Android/iPhone, HEIF-Unterstützung, Kamera, mehrere Uploads, langsames Netz, Verbindungsabbrüche und ZIP-Downloads testen.
- [ ] Gleichzeitige Uploads prüfen; derzeit wird pro Event nur ein Uploadauftrag gleichzeitig verarbeitet.
- [ ] 10-GB-Render-Disk und Hetzner-Speicherverbrauch in den Anbieter-Dashboards beobachten.
- [ ] Anbieter- und Datenflüsse für Render, Hetzner, Brevo, Stripe und GitHub vollständig prüfen und dokumentieren.
- [ ] Separaten Hetzner-Sicherungs-Bucket in Falkenstein anlegen, Zugang/Schlüssel setzen, Versioning und Lifecycle-Regel prüfen; dann `BACKUP_ENABLED=1` aktivieren.
- [ ] Täglichen Backup-Lauf und dokumentierten Wiederherstellungstest prüfen. Bestätigte Fristen: Datenbank 30 Tage, Fotos maximal 7 Tage nach aktiver Löschung.
- [ ] Vor größeren Datenbankänderungen einen konsistenten Sicherungs- und Rückweg nachweisen.

## Angebot – Arbeitsmodell, vor Verkauf noch bestätigen
- [x] Ein Kernpaket je Veranstaltung: 49,90 € Endpreis inkl. 19 % USt.
- [x] Keine feste Fotoanzahl; Zielgrenze bis zu 25 GB verarbeitete Fotos je Event.
- [x] Start am Veranstaltungsdatum; 90 Tage Upload, Ansicht und Download, danach automatische Löschung.
- [x] Bis zu 25 Testfotos für die Vorbereitung; bei Buchung bleiben sie erhalten und zählen zum Event-Speicher.
- [ ] Kosten für Render, Hetzner, Zahlungsverkehr und Support anhand tatsächlicher Pilotnutzung prüfen.
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
- [ ] Checkout-Vorvertragstexte, Widerrufsablauf und Leistungsbeginn passend zur konkreten Produktklassifikation festlegen.
- [ ] `docs/LEGAL-CHECKOUT-REVIEW.md` fachkundig prüfen lassen, bevor Checkout-Texte oder Widerrufs-Checkboxen veröffentlicht werden.
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
- [x] Aktiven Live-Dienst, Region, Datenträger und Datenpfade mit Render-Dienst und Startprotokoll abgeglichen.
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
- [x] FinalSnap-Absenderdomain bei Brevo authentifiziert und Absender aktiv.
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
- [ ] `STRIPE_TAX_ENABLED=1` erst im Testmodus nach bestätigter Stripe-Steuerkonfiguration einschalten und die beiden Testkäufe abnehmen.
- [ ] Stripe-Livemodus separat implementieren; Live-Schlüssel sind aktuell absichtlich im Code gesperrt.
- [ ] Rechte/Datenschutz/Verkaufsunterlagen fertig prüfen lassen.
- [ ] Öffentlichen Start und echte Zahlungen ausdrücklich durch Matthias freigeben lassen.
