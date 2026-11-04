# 🎁 Weihnachtswichteln

Kleine Wichtel-App für Familie & Freunde.

1. **Gruppe erstellen** – Name, Budget, Datum, Nachricht. Du bekommst einen Verwaltungslink.
2. **Einladen** – Einladungslink (z.B. per Signal über das Teilen-Menü) verschicken. Jeder trägt sich mit Namen ein und bekommt einen persönlichen Link. Leute ohne Handy kann der Organisator selbst eintragen.
3. **Ausschlüsse** (optional) – z.B. Paare ziehen sich nicht gegenseitig.
4. **Auslosen** – die Zuordnung wird in der Datenbank erstellt; niemand (auch nicht der Organisator) sieht die ganze Liste.
5. **Nachschauen** – jeder öffnet seinen persönlichen Link, packt das Geschenk aus und sieht den Wunschzettel seines Wichtels.

## Technik

- Statische Seite (`index.html`, `app.js`, `style.css`) ohne Build-Schritt.
- Backend: Supabase (Postgres). Alle Tabellen sind per RLS gesperrt; der Browser ruft nur
  `SECURITY DEFINER`-Funktionen auf, die geheime Tokens prüfen (`supabase/migrations/001_init.sql`).
- `config.js` enthält Supabase-URL und Publishable Key (öffentlich, für den Browser gedacht).
- Hosting: Hostinger, statisch aus diesem Repo.
