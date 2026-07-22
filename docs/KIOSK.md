# Autostart & Kiosk-Modus

Diese Anleitung beschreibt, wie DeskOS beim Booten **automatisch startet** und das
Dashboard im **Vollbild-Kiosk-Modus** anzeigt – ideal für ein fest montiertes
Display (Raspberry Pi, Mini-PC) auf dem Schreibtisch.

Es gibt zwei Bausteine:

1. **Autostart der Dienste** – Backend (Port `4001`) und Frontend (Port `4000`)
   starten automatisch und werden bei einem Absturz neu gestartet.
2. **Kiosk-Browser** – ein Chromium/Chrome/Edge öffnet `http://localhost:4000`
   im Vollbild ohne Adressleiste, Tabs oder Bedienelemente.

> Auf einem Einzelgerät ist keine zusätzliche Konfiguration nötig: Das Frontend
> verbindet sich standardmäßig mit dem Backend unter `http://<hostname>:4001`.
> Liegt das Backend auf einem anderen Rechner, setze vor dem Build
> `NEXT_PUBLIC_API_URL=http://<backend-ip>:4001` in `apps/frontend/.env.local`.

Alle Dateien liegen unter [`deploy/`](../deploy).

> **Fernzugriff:** Soll das Dashboard zusätzlich von anderen Geräten über eine
> Tailscale-Domain (`https://<gerät>.<tailnet>.ts.net`) erreichbar sein, ohne dass
> sich am lokalen `http://localhost:4000` etwas ändert, siehe
> [TAILSCALE.md](./TAILSCALE.md).

---

## 7-Zoll / kleine Touch-Displays

DeskOS lässt sich problemlos auf einem kleinen, fest montierten Touch-Panel betreiben
(z. B. offizielles Raspberry-Pi-7"-Display oder ein günstiges HDMI-TFT). Das Dashboard
ist responsiv: Die Kacheln stapeln sich auf schmalen Screens automatisch untereinander,
und die gesamte Oberfläche wird auf kleinen/kurzen Panels **automatisch dichter skaliert**,
damit sie ohne Scroll-Marathon auf typische 7-Zoll-Auflösungen passt:

- **800 × 480** (verbreitete günstige TFTs) und **1024 × 600** (offizielles Pi-7") –
  beide werden per CSS-Media-Query erkannt und kompakter gerendert.
- Für **Hochformat** (z. B. 600 × 1024) greift dieselbe Verdichtung.

Zusätzlich gibt es in **Labs** (🧪) den Schalter **„Kompaktmodus (7-Zoll)"**, der den
kompakten Maßstab **auf jedem Display erzwingt** – nützlich, falls dein Panel eine große
logische Auflösung meldet oder du das Dashboard generell dichter möchtest. Der Schalter ist
opt-in und wird pro Gerät/Browser gespeichert (siehe [LABS.md](./LABS.md)).

**Empfohlene Einrichtung für ein 7-Zoll-Panel:**

1. Kiosk wie unten für Linux bzw. Windows einrichten (Vollbild-Browser auf `:4000`).
2. Einmalig **Strg + K** (bzw. das Kern-Symbol unten rechts) öffnen → **Labs** → bei Bedarf
   **„Kompaktmodus (7-Zoll)"** aktivieren.
3. Optional das Display im Betriebssystem auf **Querformat** stellen und die
   Touch-Kalibrierung prüfen.

> **Tipp:** Reicht die Verdichtung nicht, lässt sich der Chromium-Kiosk zusätzlich mit
> `--force-device-scale-factor=0.9` (oder kleiner) starten – das skaliert die ganze Seite
> nochmals herunter. Die Option kann in `deploy/linux/start-kiosk.sh` bzw.
> `deploy/windows/start-kiosk.bat` ergänzt werden.

---

## Linux / Raspberry Pi

Getestet für Raspberry Pi OS / Debian / Ubuntu mit Desktop-Umgebung.

### Installation (ein Befehl)

```bash
cd DeskOS
sudo ./deploy/linux/install.sh
```

Das Script erledigt automatisch:

- Node/npm erkennen (auch nvm), fehlende `.env`-Dateien anlegen
- bei Bedarf `npm install && npm run build` ausführen
- zwei **systemd-Services** installieren und aktivieren:
  - `descos-backend.service`
  - `descos-frontend.service`
- einen **Kiosk-Autostart** für den Desktop einrichten
  (`~/.config/autostart/descos-kiosk.desktop`)

### Display dauerhaft anzeigen (Autologin)

Damit der Kiosk-Browser ohne Anmeldung erscheint, den automatischen
Desktop-Login aktivieren:

```bash
sudo raspi-config
# -> System Options -> Boot / Auto Login -> "Desktop Autologin"
```

### Kiosk sofort testen (ohne Reboot)

```bash
./deploy/linux/start-kiosk.sh
```

Das Script wartet, bis das Dashboard erreichbar ist, schaltet den
Bildschirmschoner ab und startet den Browser im Kiosk-Modus.
Beenden: `Alt`+`F4` bzw. `Ctrl`+`W`.

### Nützliche Befehle

```bash
# Status & Logs
systemctl status descos-backend descos-frontend
journalctl -u descos-backend -u descos-frontend -f

# Neustart nach Code-Änderungen
npm run build
sudo systemctl restart descos-backend descos-frontend
```

### Voraussetzungen

- Ein Chromium/Chrome ist installiert
  (`sudo apt install chromium-browser`).
- Optional gegen einen wandernden Mauszeiger: `sudo apt install unclutter`.

### Hinweis zu Wayland

Manche neueren Raspberry-Pi-Images nutzen Wayland (labwc/wayfire). Wird der
XDG-Autostart-Eintrag dort nicht ausgeführt, trage den Start alternativ direkt
ein, z. B. in `~/.config/labwc/autostart`:

```sh
/Pfad/zu/DeskOS/deploy/linux/start-kiosk.sh &
```

### Deinstallation

```bash
sudo systemctl disable --now descos-backend descos-frontend
sudo rm /etc/systemd/system/descos-backend.service \
        /etc/systemd/system/descos-frontend.service
rm ~/.config/autostart/descos-kiosk.desktop
sudo systemctl daemon-reload
```

---

## Windows

### Installation

1. Autostart einrichten (PowerShell im Projektordner):

   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\windows\install-autostart.ps1
   ```

   Das legt eine Verknüpfung `DeskOS Kiosk.lnk` im **Autostart-Ordner** des
   aktuellen Benutzers an. Beim nächsten Login starten Backend, Frontend und der
   Kiosk-Browser automatisch.

2. Sofort starten (ohne Abmelden):

   ```bat
   deploy\windows\start-all.bat
   ```

Beim ersten Start wird bei Bedarf automatisch `npm install` + `npm run build`
ausgeführt.

### Was passiert

- `start-descos.bat` startet Backend (`:4001`) und Frontend (`:4000`) in
  minimierten Fenstern.
- `start-kiosk.bat` wartet, bis das Dashboard antwortet, und öffnet dann
  **Chrome** mit `--kiosk` (oder ersatzweise **Edge** mit `--kiosk`).
- Kiosk beenden: `Alt`+`F4`. Edge zusätzlich: `Ctrl`+`Shift`+`W`.

### Deinstallation

Verknüpfung aus dem Autostart-Ordner löschen:

```
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DeskOS Kiosk.lnk
```

(oder `shell:startup` im Ausführen-Dialog öffnen und die Datei entfernen).

---

## Alternative: Docker

Backend und Frontend lassen sich auch per Docker starten – die
`docker-compose.yml` setzt bereits `restart: unless-stopped`:

```bash
docker compose up -d
sudo systemctl enable docker   # Docker beim Booten starten
```

Den Kiosk-Browser anschließend wie oben beschrieben einrichten
(`deploy/linux/start-kiosk.sh` bzw. `deploy/windows/start-kiosk.bat`).

---

## Troubleshooting

| Problem | Lösung |
| --- | --- |
| Kiosk öffnet, zeigt aber Verbindungsfehler | Backend prüfen: `systemctl status descos-backend` / Port `4001` frei? |
| Schwarzer Bildschirm / kein Browser | `chromium-browser` installiert? `./deploy/linux/start-kiosk.sh` manuell ausführen und Fehler lesen |
| `npm: command not found` im Service | Node via nvm? `install.sh` erneut ausführen – es trägt den korrekten Pfad ein |
| Display schaltet sich ab | Autologin aktiv? Unter Wayland Bildschirm-Timeout im Desktop deaktivieren |
| Frontend findet Backend nicht (anderer Host) | `NEXT_PUBLIC_API_URL` setzen und neu bauen (`npm run build`) |
