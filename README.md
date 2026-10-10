# Event-Foto-Plattform – Phase 1 / Stripe-Testmodus

Weiterentwicklung des bestehenden Express-/SQLite-Projekts. Gäste brauchen
kein Konto; Veranstalter verwalten mehrere bezahlte Veranstaltungen.
Das vorhandene Design bleibt die Grundlage.

## Lokal starten

Node.js 22.13 oder neuer (getestet: 24.19).

```bash
npm ci
cp .env.example .env
node --env-file=.env server.js
```

http://localhost:3000 → Konto erstellen → Event erstellen → Testzahlung.
Ohne Stripe-Schlüssel funktionieren Konten und Event-Erstellung; Checkout ist gesperrt.
`npm start` nutzt bereits gesetzte Umgebungsvariablen, lädt `.env` nicht automatisch.

```bash
npm test
npm audit --omit=dev
```

- [Bestandsaufnahme und Plan](docs/PHASE-1.md)
- [Render-/Stripe-Testeinrichtung und Migration](docs/SETUP.md)
- [Testumfang und offene Abnahme](docs/TESTS.md)

Kein Live-Zahlungsbetrieb: Testschlüssel werden erzwungen. Kein automatisches
Deployment oder Anlegen kostenpflichtiger Ressourcen durch dieses Repository.
