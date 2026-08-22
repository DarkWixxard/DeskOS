# Pi-hole in DeskOS einbinden

Das Pi-hole-Plugin holt die Zahlen deines DNS-Blockers direkt ins DeskOS-Dashboard:
**Anfragen, Blockrate, Top-Domains, Top-Clients, 24-Stunden-Verlauf** – und du kannst
das **Blocking von DeskOS aus pausieren und wieder einschalten**.

Es gibt zwei Darstellungen:

- **Widget** auf dem Dashboard (bei den übrigen Plugin-Kacheln) mit den Kennzahlen und
  einer Schnellsteuerung „Aus für 30 s / 5 min / dauerhaft".
- **Vollansicht** über das Overlay-Menü (**Strg + K** → *Pi-hole*) mit Kennzahlen,
  Verlaufschart und den Top-Listen.

> **Warum kein iframe auf das Pi-hole-Panel?** Pi-hole verbietet die Einbettung per
> `X-Frame-Options`, und ein Direktzugriff aus dem Browser scheitert an CORS und würde
> dein Passwort ins Frontend-Bundle legen. DeskOS fragt den Pi-hole deshalb im Backend
> ab (`/api/pihole/*`); im Browser landen nur fertige Zahlen.

**Pi-hole v6 und v5 werden beide unterstützt** – DeskOS erkennt selbst, welche
Generation antwortet.

---

## 1. Zugangsdaten am Pi-hole holen

### Pi-hole v6 (aktuelle Versionen)

1. Pi-hole-Weboberfläche öffnen und anmelden.
2. **Settings → Web interface / API** aufrufen.
3. Auf **Configure app password** klicken und ein **App-Passwort** erzeugen.
4. Das angezeigte Passwort kopieren – es wird nur einmal im Klartext gezeigt.

> Das normale Web-Passwort funktioniert ebenfalls; ein eigenes App-Passwort ist
> aber sauberer, weil du es einzeln zurückziehen kannst.

### Pi-hole v5 (ältere Installationen)

Dort gibt es kein App-Passwort, sondern einen **API-Token** (der doppelte
SHA-256-Hash des Web-Passworts):

- In der Weboberfläche unter **Settings → API/Web interface → Show API token**, oder
- auf dem Pi-hole per Shell:

  ```bash
  sudo grep WEBPASSWORD /etc/pihole/setupVars.conf
  ```

---

## 2. In DeskOS hinterlegen

1. Dashboard öffnen (`http://localhost:4000`).
2. Overlay-Menü mit **Strg + K** (⌘ + K am Mac) → **Plugins**.
3. Bei der **Pi-hole**-Karte auf **Installieren**, danach **Aktivieren** klicken.
4. Auf das **Zahnrad** klicken und eintragen:
   - **Pi-hole URL** – die Adresse der Weboberfläche, z. B. `http://192.168.178.10`
     (ohne `/admin`). Fehlt `http://`, ergänzt DeskOS es.
   - **App-Passwort (v6) bzw. API-Token (v5)**
5. **Speichern** – das Widget geht innerhalb weniger Sekunden live, ein Neustart ist
   nicht nötig.

Das Passwort liegt in der DeskOS-Datenbank und wird **nie über die REST-API
zurückgegeben** – die API meldet nur, *ob* etwas hinterlegt ist.

### Alternativ per Umgebungsvariablen

Für den headless-/Kiosk-Betrieb lässt sich alles auch vorkonfigurieren
(siehe `.env.example` im Projekt-Root):

```bash
PIHOLE_URL=http://192.168.178.10
PIHOLE_PASSWORD=dein-app-passwort
PIHOLE_POLL_INTERVAL_MS=15000   # Abfrageintervall, Standard 15 s
PIHOLE_TIMEOUT_MS=4000          # Timeout je Anfrage, Standard 4 s
```

Werte aus den Plugin-Settings haben Vorrang vor den Umgebungsvariablen.

---

## 3. Blocking steuern

Im Widget und in der Vollansicht kannst du das DNS-Blocking pausieren:

| Aktion | Wirkung |
|---|---|
| **30 s / 5 min / 1 h** | Pi-hole schaltet nach Ablauf **selbst** wieder ein |
| **Dauerhaft** | bleibt aus, bis du **Blocking einschalten** drückst |

Die Restzeit einer befristeten Pause zeigt DeskOS an (nur v6 – die v5-API liefert
keine Restlaufzeit).

### In Automations und Szenen

Unter **Automations** gibt es die Aktion **Pi-hole-Blocking** mit Ein/Aus und Dauer.
Damit lässt sich z. B. eine Szene „Streaming-Abend" bauen, die das Blocking für eine
Stunde aussetzt. Szenen können dieselbe Aktion enthalten.

---

## 4. Was DeskOS abfragt

| Daten | Pi-hole v6 | Pi-hole v5 |
|---|---|---|
| Kennzahlen | `GET /api/stats/summary` | `?summaryRaw` |
| Blocking-Status | `GET /api/dns/blocking` | `status` aus `?summaryRaw` |
| Blocking schalten | `POST /api/dns/blocking` | `?enable` / `?disable=<sek>` |
| Top-Domains | `GET /api/stats/top_domains` | `?topItems` |
| Top-Clients | `GET /api/stats/top_clients` | `?getQuerySources` |
| Query-Typen | aus `/api/stats/summary` | `?getQueryTypes` |
| Upstreams | `GET /api/stats/upstreams` | `?getForwardDestinations` |
| 24-h-Verlauf | `GET /api/history` | `?overTimeData10mins` |

Die Anmeldung läuft bei v6 über `POST /api/auth`; die zurückgegebene Session-ID
schickt DeskOS als `X-FTL-SID`-Header mit und erneuert sie automatisch, wenn sie
abläuft. Beim Herunterfahren meldet sich DeskOS wieder ab, damit keine Sessions
belegt bleiben.

Query-Typen und Upstreams liefert **v5 als Prozentwerte**, **v6 als Absolutzahlen** –
die Ansicht kennzeichnet das entsprechend.

---

## 5. Fehlersuche

| Anzeige | Ursache / Abhilfe |
|---|---|
| „Nicht eingerichtet" | URL oder Passwort fehlt → Plugins → Pi-hole → Zahnrad |
| „Passwort wurde abgelehnt" | falsches App-Passwort (v6). Neues erzeugen und eintragen |
| „Kein Pi-hole erreichbar oder Token ungültig" | v5-Token falsch, oder unter der URL läuft kein Pi-hole |
| Timeout / „Nicht erreichbar" | Adresse oder Port prüfen; das Backend muss den Pi-hole im Netz erreichen (Docker: eigenes Netz / Host-IP statt `localhost`) |
| Zahlen bleiben auf 0 | Der Pi-hole ist erreichbar, hat aber heute noch keine Anfragen gesehen |

Ein schneller Test von der Maschine aus, auf der das **Backend** läuft:

```bash
# v6
curl -X POST http://192.168.178.10/api/auth -H 'Content-Type: application/json' \
  -d '{"password":"dein-app-passwort"}'

# v5
curl 'http://192.168.178.10/admin/api.php?summaryRaw&auth=dein-token'
```

Antwortet das nicht, liegt das Problem im Netz oder am Pi-hole, nicht an DeskOS.

---

## Verwandte Dokumente

- [`docs/DASHBOARD.md`](DASHBOARD.md) – Aufbau des Dashboards, Widgets ein-/ausblenden
- [`docs/API.md`](API.md) – REST-Endpunkte des Backends
- [`docs/SECURITY.md`](SECURITY.md) – Token-Auth, CORS, Umgang mit Zugangsdaten
