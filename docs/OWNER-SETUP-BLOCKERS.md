# FinalSnap – nächste Einrichtungsschritte

Diese Liste trennt Einrichtungsarbeiten in den Anbieter-Konten von den Änderungen im App-Code. Echte Zahlungen bleiben ausgeschaltet; alle Zahlungsprüfungen erfolgen im Stripe-Testmodus.

## 1. Stripe Tax im Testmodus vorbereiten

Das Stripe-Testkonto ist unter dem bestätigten Arbeitskonto eingerichtet; echte Zahlungen bleiben gesperrt.

1. Geschäftsadresse und deutsche Regelbesteuerungsregistrierung sind in Stripe **Testmodus** hinterlegt. Der Eintrag ersetzt keine Registrierung beim Finanzamt und hat `livemode=false`.
2. Die Steuerberechnung wurde für 49,90 € brutto in Gütersloh geprüft: Stripe berechnet 7,97 € enthaltene USt. und lässt den Gesamtpreis bei 49,90 €.
3. Für den Test ist `txcd_10103000` (SaaS, persönliche Nutzung) als vorläufige Produktkategorie vorgesehen. Vor Verkäufen außerhalb Deutschlands muss die steuerliche Einordnung bestätigt und gegebenenfalls angepasst werden.
4. Nach dem Code-Deploy `STRIPE_TAX_ENABLED=1` und `STRIPE_PRODUCT_TAX_CODE=txcd_10103000` ausschließlich im FinalSnap-Testbetrieb setzen. Vorher die endgültige USt-IdNr.-Anzeige auf der Stripe-Rechnung sicherstellen.

Stripe berechnet nur für Orte mit hinterlegter Registrierung Steuern. Die [Stripe-Einrichtungsanleitung](https://docs.stripe.com/tax/set-up) erklärt Geschäftsadresse, Produktsteuer-Code, Registrierungen und Aktivierung. Stripe erläutert auch, dass ein Tax-Registrierungseintrag Stripe über eine bestehende Registrierung informiert, sie aber nicht selbst bei der Behörde vornimmt ([API-Dokumentation](https://docs.stripe.com/api/tax/registrations)).

Wenn diese Kontoeinrichtung erledigt ist, kann im Render-Dienst der Tax-Schalter für Testzahlungen aktiviert werden. Danach sind zwei erfolgreiche Testkäufe nötig: Privatkunde und Geschäftskunde. Beide müssen insgesamt 49,90 € zahlen; bei 19 % inklusiver USt. sollte die Rechnung die Steuer innerhalb dieses Bruttopreises ausweisen. Firmenname, Rechnungsanschrift, angegebene USt-IdNr., Rechnungs-PDF und Link im FinalSnap-Konto mitprüfen.

## 2. Separaten Foto- und Datenbank-Backup-Speicher anlegen

1. In Hetzner Object Storage einen **neuen privaten Bucket in Falkenstein (`fsn1`)** erstellen. Nicht den bestehenden Nürnberg-Fotobucket wiederverwenden.
2. Bucket-Versionierung aktivieren.
3. Für den Prefix `photos/` eine Lifecycle-Regel für nicht aktuelle Versionen mit `NoncurrentDays: 7` einrichten. Keine automatische Ablaufregel für aktive Versionen setzen.
4. Einen eigenen, möglichst eingeschränkten Zugang für den Backup-Bucket erstellen.
5. Einen neuen zufälligen 32-Byte-SSE-C-Schlüssel für das Backup erzeugen und getrennt von den Zugangsdaten im Passwortmanager sichern. Den bestehenden Fotoschlüssel nicht wiederverwenden.
6. Die Backup-Umgebungsvariablen aus `docs/SETUP.md` als Render-Secrets setzen. Geheimnisse nicht in Chat oder GitHub einfügen.
7. Erst nach erfolgreicher Prüfung `BACKUP_ENABLED=1` setzen. Die App prüft Region, getrennten Bucket, Versionierung und Lebenszyklusregel vor dem Lauf.
8. Nach dem ersten erfolgreichen Lauf einen vollständigen Wiederherstellungstest in einer isolierten Umgebung dokumentieren: Datenbankintegrität, Albumzuordnung und Fotozugriff prüfen.

Die Fristen sind festgelegt: tägliche Datenbankkopien 30 Tage, Fotokopien höchstens 7 Tage nach normaler Albumlöschung. Hetzner beschreibt [Versionierung](https://docs.hetzner.com/storage/object-storage/howto-protect-objects/protect-versioning/) und [Lifecycle-Regeln](https://docs.hetzner.com/storage/object-storage/howto-protect-objects/manage-lifecycle/). Änderungen an Bucket-Einstellungen können laut Hetzner einige Minuten benötigen, bevor sie greifen.

## 3. Kontrollierte Testbestellung durchführen

Nach Stripe-Tax-Einrichtung:

1. Im FinalSnap-Veranstalterkonto eine Veranstaltung anlegen und als Privatkunde testbestellen.
2. Bei einem Veranstaltungsdatum innerhalb der Widerrufsfrist die beiden getrennten Erklärungen zum vorzeitigen Leistungsbeginn prüfen.
3. Stripe-Testzahlung abschließen. Es darf keine Livezahlung entstehen.
4. Prüfen: Album freigeschaltet, Vertragsbestätigung samt Bedingungen und Widerrufsinformation per E-Mail zugestellt, Rechnung mit Steuerbetrag verfügbar.
5. Den Ablauf anschließend als Geschäftskunde wiederholen und Firmen-/Steuerangaben auf dem Beleg prüfen.
6. Eine Testerstattung und einen Stripe-Teststreitfall durchführen; Status, Alarm und Albumzugang kontrollieren.

Bis diese Prüfungen und der Backup-Wiederherstellungstest bestanden sind, bleibt der öffentliche Verkauf gesperrt. Die Rechtstexte benötigen zusätzlich eine fachkundige Prüfung.

## 4. Alarmierung praktisch abnehmen

1. Im [GitHub-Workflow „FinalSnap availability“](https://github.com/MWFOTO/Hochzeit-fotos/actions/workflows/finalsnap-availability.yml) einmal **Run workflow** starten. In den Actions-Läufen ist derzeit noch kein Lauf aufgezeichnet.
2. Prüfen, dass `/health` und `/ready` beide erfolgreich geprüft werden.
3. Im GitHub-Konto E-Mail-Benachrichtigungen für fehlgeschlagene Workflow-Läufe aktivieren und den Empfang eines Fehlalarms kontrolliert bestätigen.
4. `PAYMENT_ALERT_EMAIL` in Render auf ein überwachtes Postfach setzen und Zustellung für Speicherwarnung, Refund/Streitfall und fehlgeschlagene Sicherung praktisch bestätigen.
5. Zusätzlich Hetzner-Verbrauchs- und Kostenwarnungen im Hetzner-Konto konfigurieren. Die FinalSnap-App kennt nur die von ihr erfassten Fotodaten, nicht Hetzners Abrechnung.
