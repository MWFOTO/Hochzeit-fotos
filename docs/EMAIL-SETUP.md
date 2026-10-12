# E-Mail-Bestätigung: vorbereitet, Versand noch ausstehend

Der Server unterstützt einen injizierbaren mailer über createApp({mailer}). Ein Versanddienst, Absenderdomain und Zugangsdaten sind noch nicht angeschlossen. Im produktiven Stand werden keine E-Mails verschickt; die Registrierung bleibt nutzbar.

POST /api/auth/request-verification verlangt Anmeldung, CSRF und Rate Limit. Der Adapter erhält Empfänger, Betreff und Text. Token werden nur gehasht gespeichert, gelten 24 Stunden und sind einmalig. Der Link enthält das Token im Fragment, damit es nicht in URL-Zugriffslogs auftaucht. Bestätigung erfolgt explizit per POST, nicht beim Aufruf durch einen Mail-Linkscanner. POST /api/auth/verify-email bestätigt die Adresse und entwertet sämtliche Links dieses Kontos. Abgelaufene Token werden beim regelmäßigen Löschlauf entfernt.

Vor Aktivierung: Versanddienst auswählen, Absender verifizieren, Produktionsadapter anschließen, Registrierung um Versand und Wiederholungsbutton ergänzen, Zustellung und Fehlerfälle testen. Willkommensmail und Passwort-zurücksetzen sind noch nicht umgesetzt. Zugang wird bisher nicht an Bestätigung gebunden.
