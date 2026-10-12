# FinalSnap – Aufgaben bis zum öffentlichen Start

Stand: 12. Oktober 2026. Die Anwendung bleibt im Stripe-Testmodus. Dieser Plan ist keine rechtliche Freigabe.

## Erledigt, mit Grenzen
- [x] Registrierung, Anmeldung und Veranstalterkonto.
- [x] Brevo für Bestätigungsmails und Passwort-Zurücksetzen angebunden; vom Betreiber im echten Postfach getestet.
- [x] QR-Gästezugang ohne Konto, Upload, Kamera-Auswahl, Galerie und Diashow.
- [x] Kostenloser Einstieg: einmal pro Konto, 25 Fotos, 14 Tage; Praxisprüfung erfolgreich.
- [x] Fotoverwaltung, Mehrfachauswahl, Moderation und Löschung.
- [x] Bilder auf maximal 2.560 Pixel, JPEG-Qualität 82; keine unveränderten Originale.
- [x] Stripe-Testcheckout, Webhook-Prüfung und Übergang vom Testalbum zur Zahlung.
- [x] Grundlegende Zugriffskontrollen, Origin/CSRF-Schutz, Rate Limits und Upload-Prüfung; noch keine vollständige Sicherheitsprüfung.
- [x] Speicheranzeige, Uploadzähler und Warnung bei wenig freiem Disk-Speicher.
- [x] FinalSnap als Arbeitsmarke, Paketkarten und Übernahme der Auswahl von der Landingpage.
- [x] 15 automatisierte Tests bestehen. Mobile End-to-End- und Lasttests bleiben offen.

## Als Nächstes: Praxistests und Infrastruktur
- [ ] Ein bis zwei geschlossene Testveranstaltungen durchführen; zulässige Testbilder und Löschtermin abstimmen.
- [ ] Anzahl, Durchschnittsgröße und Gesamtvolumen der Fotos, Uploadfehler und Supportbedarf auswerten.
- [ ] Android/iPhone, HEIF-Unterstützung, Kamera, mehrere Uploads, langsames Netz, Verbindungsabbrüche und ZIP-Downloads testen.
- [ ] Gleichzeitige Uploads prüfen; derzeit wird pro Event nur ein Uploadauftrag gleichzeitig verarbeitet.
- [ ] Aktuelle 1-GB-Disk vor jeder Testveranstaltung auf freien Platz prüfen.
- [ ] Hosting-Region prüfen: aktueller Render-Service steht in Ohio; gewünschter Zielstandort und Datentransfers vor Marktstart klären.
- [ ] App, PostgreSQL und privaten Fotospeicher planen; Anbieter, Standort, Zugriffe, Kosten und Migration bewerten.
- [ ] Daten sichern und Wiederherstellung testen, bevor produktive Daten umgezogen werden.
- [ ] Vollständigen Umzug mit Rückweg und Datenabgleich vorbereiten; alte Disk erst nach Prüfung abbauen.

## Angebot – verbindlich offen halten
- [ ] Fotoanzahl ist Hauptunterschied der Pakete; Laufzeit ist Zusatzinformation.
- [ ] Klein / Mittel / Groß; mittleres Paket als Empfehlung. Keine unbelegte Behauptung „am beliebtesten“.
- [ ] Vorgeschlagene 300 / 1.000 / 3.000 Fotos und 19,90 / 34,90 / 54,90 Euro sind NICHT festgelegt oder umgesetzt.
- [ ] Aktuelle 1-/3-/6-Monatsangebote sind vorläufige technische Testangebote und müssen vor Verkauf ersetzt werden.
- [ ] Fotoanzahl und Speicherlimit müssen zusammenpassen; keine irreführenden Mengenzusagen.
- [ ] Speicher- und Uploadzeit getrennt definieren; Laufzeitstart an Veranstaltung statt Zahlung prüfen.
- [ ] Paket-Upgrade gegen Preisdifferenz auch für bereits bezahlte Alben implementieren.
- [ ] Foto-Nachschläge ohne Laufzeitverlängerung kalkulieren und implementieren.
- [ ] Hinweis bei 80 % des Kontingents, Uploadpause am Limit und Fortsetzung nach bestätigter Buchung prüfen.
- [ ] Gäste zahlen nichts; Kaufaktionen gehören ins Veranstalterkonto.
- [ ] Videos erst nach eigener Speicher-, Verarbeitungskosten- und Rechteprüfung anbieten.

## Datenschutz, Rechte und Cookies – vor öffentlichem Verkauf prüfen lassen
- [ ] Verarbeitungsvorgänge und Datenflüsse dokumentieren: Konto, Bilder, Metadaten, Zahlungen, E-Mails, Logs, Backups.
- [ ] Rollen und Rechtsgrundlagen für Betreiber, Veranstalter, Gäste und Dienstleister klären; private und geschäftliche Events berücksichtigen.
- [ ] Bildrechte, abgebildete Dritte, Minderjährige und Meldung unzulässiger Inhalte berücksichtigen.
- [ ] Auftragsverarbeitungsverträge, Unterauftragnehmer und mögliche Drittlandtransfers prüfen.
- [ ] Datenschutzerklärung, Nutzungsbedingungen/AGB, Impressum und Verbraucher-Checkout rechtlich prüfen lassen.
- [ ] Speicherfristen begründen; keine vermeintlich gesetzliche 3-/6-Monatsfrist behaupten.
- [ ] Löschkonzept für Originale, Vorschaubilder, Tokens, Konten, Logs und Backups erstellen und technisch testen.
- [ ] Auskunft, Berichtigung, Löschung, Widerruf/Widerspruch und zuständige Kontaktstelle organisatorisch ermöglichen.
- [ ] Cookies, Browser-Speicher, Tracking und externe Ressourcen inventarisieren; erforderliche Einwilligung und Hinweise konkret prüfen.
- [ ] Brevo-Tracking und E-Mail-Protokollierung prüfen; Konto-Verifizierung nicht mit Newsletter-Anmeldung vermischen.
- [ ] Werbung nur mit passend geprüftem separatem Verfahren; gegebenenfalls Double-Opt-in und Abmeldung.
- [ ] Datenschutzvorfälle, Meldewege und Fristen in einem Betriebsablauf festhalten.
- [ ] Fachkundige rechtliche Prüfung des tatsächlichen Produkts und der Unterlagen abschließen.

## Sicherheit und Betrieb
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
