# Fernzugriff über Tailscale

Diese Anleitung beschreibt, wie das DeskOS-Dashboard **zusätzlich** über eine
Tailscale-Domain (z. B. `https://homepi.tail5ba945.ts.net`) erreichbar wird –
**ohne** dass sich am lokalen Betrieb über `http://localhost:3000` etwas ändert.

> **Wie das funktioniert:** Das Frontend (Port `3000`) ermittelt die Backend-Adresse
> automatisch aus der aufgerufenen URL (`https://<host>:3001`). Wir veröffentlichen
> daher mit **Tailscale Serve** zwei HTTPS-Endpunkte auf demselben Gerät: das
> Dashboard auf Port `443` und das Backend (inkl. WebSocket) auf Port `3001`.
> Beides läuft über HTTPS – kein Mixed-Content, **keine Code-Änderung nötig**.

Die Seite ist **nicht** öffentlich: Sie ist nur innerhalb deines Tailnets
erreichbar (Tailscale *Serve*, nicht *Funnel*).

---

## Voraussetzungen

- Tailscale ist auf dem DeskOS-Gerät installiert und angemeldet (`sudo tailscale up`).
  Der Gerätename ergibt die Domain, z. B. `homepi` → `homepi.tail5ba945.ts.net`.
- **MagicDNS + HTTPS-Zertifikate** sind für dein Tailnet aktiviert:
  Admin-Konsole → **DNS** → **HTTPS Certificates** einschalten.
  Ohne diese Einstellung schlägt `tailscale serve --https` fehl.
- Backend (`:3001`) und Frontend (`:3000`) laufen (siehe [KIOSK.md](./KIOSK.md)).

---

## Einrichtung

### Variante A: Helfer-Skript (empfohlen)

```bash
sudo ./deploy/linux/tailscale-serve.sh
```

Das Skript prüft Tailscale, veröffentlicht beide Endpunkte und zeigt am Ende die
erreichbare URL an.

### Variante B: Manuell

```bash
sudo tailscale serve --bg --https=443  http://127.0.0.1:3000   # Dashboard
sudo tailscale serve --bg --https=3001 http://127.0.0.1:3001   # Backend / WebSocket
```

> `--bg` legt die Konfiguration dauerhaft ab – sie übersteht Reboots, ein eigener
> systemd-Dienst ist nicht nötig.

---

## Prüfen

```bash
tailscale serve status
```

Zeigt beide Zuordnungen, z. B.:

```
https://homepi.tail5ba945.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:3000

https://homepi.tail5ba945.ts.net:3001 (tailnet only)
|-- / proxy http://127.0.0.1:3001
```

Danach von einem **anderen** Gerät im Tailnet `https://homepi.tail5ba945.ts.net`
im Browser öffnen. Der erste Aufruf kann ein paar Sekunden dauern, während das
TLS-Zertifikat ausgestellt wird.

`http://localhost:3000` funktioniert auf dem Gerät selbst unverändert weiter.

---

## Wieder entfernen

```bash
sudo ./deploy/linux/tailscale-serve.sh off
# oder manuell:
sudo tailscale serve --https=443 off
sudo tailscale serve --https=3001 off
# bzw. alles zurücksetzen:
sudo tailscale serve reset
```

---

## Hinweise

- **Live-Daten:** Die Echtzeit-Updates laufen über WebSocket (Socket.IO). Kommt der
  WebSocket-Upgrade über den Proxy einmal nicht zustande, wechselt Socket.IO
  automatisch auf HTTPS-Long-Polling – die Daten kommen also in jedem Fall an.
- **Öffentlicher Zugriff (Funnel):** `tailscale funnel` würde DeskOS ins **öffentliche
  Internet** stellen. Davon wird abgeraten, da DeskOS aktuell **keine Authentifizierung**
  besitzt. Funnel ist zudem auf die Ports `443`/`8443`/`10000` beschränkt.
- **Anderer Gerätename / abweichende Ports:** Die Domain richtet sich nach dem
  Tailscale-Gerätenamen; `homepi.tail5ba945.ts.net` ist nur ein Beispiel – nutze die
  in `tailscale serve status` angezeigte URL. Laufen Frontend/Backend auf anderen Ports,
  lässt sich das Skript anpassen: `sudo FRONTEND_PORT=3000 BACKEND_PORT=3001 ./deploy/linux/tailscale-serve.sh`.

---

## Troubleshooting

| Problem | Lösung |
| --- | --- |
| `tailscale serve --https` schlägt fehl / kein Zertifikat | MagicDNS + HTTPS Certificates in der Admin-Konsole aktivieren (DNS-Tab). |
| Seite lädt, aber keine Live-Daten / „disconnected" | `tailscale serve status` muss auch `:3001` zeigen; läuft das Backend? (`systemctl status descos-backend`). |
| `permission denied` bei `tailscale serve` | Mit `sudo` ausführen. |
| Von außen nicht erreichbar | Das andere Gerät muss im selben Tailnet sein; die URL aus `tailscale serve status` verwenden (korrekter Gerätename). |
| Erster Aufruf hängt kurz | Normal – das TLS-Zertifikat wird einmalig ausgestellt. |
