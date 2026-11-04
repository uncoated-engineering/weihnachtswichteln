# 🎁 Weihnachtswichteln

Wichtel-Seite für unsere Familie, Weihnachten 2026.

- **Ein Link für alle.** Wer ihn öffnet, tippt auf seinen Namen (oder „Ich bin neu hier") und gibt eine 4-stellige PIN ein. Kein Link muss aufgehoben werden.
- **Wunschzettel** schreiben, den der eigene Wichtel lesen kann.
- **Auslosung** über die geheime Organisator-Seite (`#/admin/<token>`): Leute eintragen, PINs zurücksetzen, Ausschlüsse (z.B. Paare), auslosen. Niemand sieht die ganze Zuordnung.
- Nach der Auslosung packt jeder sein Geschenk aus und sieht, für wen er etwas besorgt.

## Technik

- Statische Seite (`index.html`, `app.js`, `style.css`) ohne Build-Schritt.
- Backend: Supabase (Postgres). Alle Tabellen sind per RLS gesperrt; der Browser ruft nur
  `SECURITY DEFINER`-Funktionen auf, die PIN bzw. geheime Tokens prüfen (`supabase/migrations/`).
- `config.js` enthält Supabase-URL, Publishable Key und den Familien-Code (öffentlich, für den Browser gedacht).
- Hosting: Hostinger, statisch aus diesem Repo.
