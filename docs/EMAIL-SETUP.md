# Automatische Kontomails

BREVO_API_KEY aktiviert den Brevo-API-Adapter. BREVO_SENDER_EMAIL und BREVO_SENDER_NAME sind optional; Standard ist info@matthiaswendlandfotografie.com. Schlüssel nur im Hosting hinterlegen, nie im Repository.

Registrierung verschickt eine kombinierte Willkommens- und Bestätigungsmail. Bestehende Konten können die Bestätigung im Dashboard anfordern. Passwort vergessen verschickt einen Rücksetzlink. Keine Newsletter oder Kontaktimporte.

Bestätigungstoken: gehasht, 24 Stunden, einmalig. Rücksetztoken: gehasht, eine Stunde, einmalig; Änderung invalidiert alle Sitzungen. Tokens stehen im Linkfragment, nicht in URL-Zugriffslogs. Bestätigung und Passwortänderung benötigen eine ausdrückliche POST-Anfrage. Origin, CSRF bei bestehender Sitzung und Rate Limits bleiben aktiv. Mailadapter hat 15 Sekunden Timeout; keine vertraulichen Inhalte in Fehlerlogs.

Versand muss mit echtem Postfach auf Zustellung und Spam geprüft werden. Absenderdomain in Brevo authentifizieren. Bestätigung ist in der Testphase noch keine Voraussetzung für Event-Erstellung.
