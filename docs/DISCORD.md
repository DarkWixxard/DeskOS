# Discord in DeskOS verbinden

Das Discord-Plugin verbindet dein **persönliches Discord-Konto** mit DeskOS und
zeigt dein Profil (Avatar, Anzeigename) im Dashboard-Widget an.

> **Wichtig:** Das ist **kein Bot**. Du brauchst keinen Bot-Account, musst
> keinen Bot auf einen Server einladen und niemand sieht, dass DeskOS
> verbunden ist. Es handelt sich um einen normalen **"Login with
> Discord"-OAuth-Flow** – wie er auch von vielen Webseiten ("Mit Discord
> anmelden") verwendet wird. DeskOS erhält dabei nur Lesezugriff auf dein
> öffentliches Profil (Scope `identify`) – keinen Zugriff auf Server,
> Nachrichten, Freundesliste o. Ä.

---

## 1. Discord-Anwendung anlegen (einmalig)

1. Öffne das [Discord Developer Portal](https://discord.com/developers/applications)
   und melde dich mit deinem Discord-Konto an.
2. **New Application** → einen beliebigen Namen vergeben (z. B. „DeskOS") →
   **Create**.
3. Im linken Menü auf **OAuth2** klicken.
4. Unter **Redirects** auf **Add Redirect** und exakt Folgendes eintragen:

   ```
   http://localhost:4001/api/discord/callback
   ```

   - Läuft dein Backend auf einem anderen Port oder Host (LAN/Tailscale), passe
     die URI an und setze zusätzlich `DISCORD_REDIRECT_URI` (siehe unten).
5. **Save Changes** klicken.
6. Auf derselben Seite (**OAuth2 → General**) findest du **Client ID** und
   **Client Secret** (Secret ggf. über „Reset Secret" neu erzeugen). Beide
   gleich gebraucht.

Du musst dafür **nicht** zum Reiter „Bot" wechseln oder einen Bot erstellen –
das ist für dieses Plugin nicht nötig.

---

## 2. Zugangsdaten in DeskOS hinterlegen

1. Dashboard öffnen (`http://localhost:4000`).
2. Overlay-Menü mit **Strg + K** (⌘ + K am Mac) → **Plugins**.
3. Bei der **Discord**-Karte auf **Installieren**, danach **Aktivieren** klicken.
4. Auf das **Zahnrad** klicken → **Client ID** und **Client Secret** eintragen →
   **Speichern**.

Alternativ kannst du die Werte als Umgebungsvariablen setzen
(`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`) – siehe `apps/backend/.env.example`.

---

## 3. Verbinden (OAuth-Login)

Im Dashboard erscheint jetzt das **Discord-Widget**:

1. Auf **Verbinden** klicken → es öffnet sich ein Discord-Login-Popup.
2. Mit deinem Discord-Konto anmelden und den Zugriff (nur Profil lesen)
   bestätigen. Das Popup meldet „Discord-Konto verbunden" und schließt sich.
3. Das Widget zeigt nun deinen Avatar und Anzeigenamen.

Der Login wird über einen **Refresh-Token** dauerhaft gespeichert (überlebt
Neustarts). Über **Trennen** im Widget kannst du die Verbindung jederzeit lösen.

---

## Konfiguration (optional)

| Variable | Standard | Beschreibung |
|----------|----------|--------------|
| `DISCORD_CLIENT_ID` | – | Client ID (Alternative zum Plugin-UI) |
| `DISCORD_CLIENT_SECRET` | – | Client Secret (Alternative zum Plugin-UI) |
| `DISCORD_REDIRECT_URI` | `http://localhost:4001/api/discord/callback` | Muss exakt der in der Discord-App eingetragenen Redirect-URI entsprechen |

### API-Endpunkte

| Methode | Pfad | Zweck |
|---------|------|-------|
| `GET` | `/api/discord/status` | Verbindungsstatus (keine Secrets) |
| `GET` | `/api/discord/login` | liefert die Login-URL |
| `GET` | `/api/discord/callback` | OAuth-Redirect-Ziel (vom Browser) |
| `GET` | `/api/discord/profile` | verbundenes Profil (Avatar, Name) |
| `POST` | `/api/discord/disconnect` | Verbindung trennen |

---

## Troubleshooting

- **„Invalid OAuth2 redirect_uri"** → Die Redirect-URI in der Discord-App
  stimmt nicht 1:1 mit der von DeskOS verwendeten überein. Auf exakte
  Schreibweise (Schema, Host, Port, Pfad) achten und ggf.
  `DISCORD_REDIRECT_URI` setzen.
- **Popup wird blockiert** → Popups für das Dashboard erlauben und erneut auf
  „Verbinden" klicken.
- **Token läuft ab / 401** → Access-Tokens werden automatisch erneuert. Schlägt
  der Refresh fehl (z. B. App-Secret zurückgesetzt), zeigt das Widget wieder
  „Verbinden" – einfach neu einloggen.

## Was dieses Plugin (bewusst) nicht macht

Discords öffentliche OAuth2-API erlaubt keinen Zugriff auf Live-Status
(online/idle/DND) oder Mikrofon-Steuerung eines Accounts – das würde entweder
einen Bot mit Presence-Intent auf einem gemeinsamen Server **oder** die
lokale Discord-Desktop-RPC-Schnittstelle (nur auf dem Rechner nutzbar, auf dem
der Discord-Client selbst läuft) erfordern. Beides ist ein grundlegend anderer
Integrationsweg als der hier umgesetzte Konto-Login und daher nicht Teil
dieses Plugins.
