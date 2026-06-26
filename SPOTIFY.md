# Spotify in DeskOS verbinden

Das Spotify-Plugin zeigt den **aktuell laufenden Titel** (Cover, Titel, Interpret,
Fortschritt) im Dashboard an und erlaubt die **Wiedergabesteuerung**
(Play / Pause / Vor / Zurück) – direkt aus DeskOS heraus.

Die Anbindung läuft über die offizielle **Spotify Web API** mit OAuth 2.0
(Authorization-Code-Flow). Du brauchst dafür ein kostenloses Konto im Spotify
Developer Dashboard. Spotify-Steuerung über die Web API setzt **Spotify Premium**
voraus; die Now-Playing-Anzeige funktioniert auch ohne Premium.

> Hinweis: Die Web API steuert ein **bereits aktives Wiedergabegerät** (Spotify
> muss also auf dem PC, Handy oder einem Speaker gerade laufen bzw. zuletzt aktiv
> gewesen sein). DeskOS ist die Fernbedienung, nicht der Player selbst.

---

## 1. Spotify-App anlegen (einmalig)

1. Öffne das [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   und melde dich mit deinem Spotify-Konto an.
2. **Create app** → Name und Beschreibung frei wählen (z. B. „DeskOS").
3. Trage als **Redirect URI** exakt Folgendes ein und klicke **Add**:

   ```
   http://127.0.0.1:4001/api/spotify/callback
   ```

   - Spotify verlangt für lokale Adressen ausdrücklich `127.0.0.1` (nicht
     `localhost`).
   - Läuft dein Backend auf einem anderen Port oder Host (LAN/Tailscale), passe
     die URI an und setze zusätzlich `SPOTIFY_REDIRECT_URI` (siehe unten).
4. Als **API/SDK** „Web API" auswählen, speichern.
5. In den App-Einstellungen findest du **Client ID** und **Client Secret**
   (Secret ggf. über „View client secret" einblenden). Beide gleich gebraucht.

---

## 2. Zugangsdaten in DeskOS hinterlegen

1. Dashboard öffnen (`http://localhost:4000`).
2. Overlay-Menü mit **Strg + K** (⌘ + K am Mac) → **Plugins**.
3. Bei der **Spotify**-Karte auf **Installieren**, danach **Aktivieren** klicken.
4. Auf das **Zahnrad** klicken → **Client ID** und **Client Secret** eintragen →
   **Speichern**.

Alternativ kannst du die Werte als Umgebungsvariablen setzen
(`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`) – siehe `apps/backend/.env.example`.

---

## 3. Verbinden (OAuth-Login)

Im Dashboard erscheint jetzt das **Spotify-Widget**:

1. Auf **Verbinden** klicken → es öffnet sich ein Spotify-Login-Popup.
2. Den Zugriff bestätigen. Das Popup meldet „Spotify verbunden" und schließt sich.
3. Das Widget zeigt nun den laufenden Titel inkl. Steuerung. Starte testweise die
   Wiedergabe in deiner Spotify-App – DeskOS übernimmt den Rest.

Der Login wird über einen **Refresh-Token** dauerhaft gespeichert (überlebt
Neustarts). Über **Trennen** im Widget kannst du die Verbindung jederzeit lösen.

---

## Konfiguration (optional)

| Variable | Standard | Beschreibung |
|----------|----------|--------------|
| `SPOTIFY_CLIENT_ID` | – | Client ID (Alternative zum Plugin-UI) |
| `SPOTIFY_CLIENT_SECRET` | – | Client Secret (Alternative zum Plugin-UI) |
| `SPOTIFY_REDIRECT_URI` | `http://127.0.0.1:4001/api/spotify/callback` | Muss exakt der in der Spotify-App eingetragenen URI entsprechen |

### API-Endpunkte

| Methode | Pfad | Zweck |
|---------|------|-------|
| `GET` | `/api/spotify/status` | Verbindungsstatus (keine Secrets) |
| `GET` | `/api/spotify/login` | liefert die Login-URL |
| `GET` | `/api/spotify/callback` | OAuth-Redirect-Ziel (vom Browser) |
| `GET` | `/api/spotify/now-playing` | aktueller Titel |
| `POST` | `/api/spotify/control/:action` | `play` · `pause` · `next` · `previous` |
| `POST` | `/api/spotify/disconnect` | Verbindung trennen |

---

## Troubleshooting

- **„INVALID_CLIENT: Invalid redirect URI"** → Die Redirect-URI in der Spotify-App
  stimmt nicht 1:1 mit der von DeskOS verwendeten überein. Auf exakte Schreibweise
  (Schema, Host `127.0.0.1`, Port, Pfad) achten und ggf. `SPOTIFY_REDIRECT_URI`
  setzen.
- **„Aktuell wird nichts abgespielt"** → In Spotify zuerst einen Song starten;
  die Web API braucht ein aktives Wiedergabegerät.
- **Steuerung reagiert nicht** → Wiedergabesteuerung erfordert Spotify Premium und
  ein aktives Gerät.
- **Popup wird blockiert** → Popups für das Dashboard erlauben und erneut auf
  „Verbinden" klicken.
- **Token läuft ab / 401** → Access-Tokens werden automatisch erneuert. Schlägt
  der Refresh fehl (z. B. App-Secret geändert), zeigt das Widget wieder
  „Verbinden" – einfach neu einloggen.
