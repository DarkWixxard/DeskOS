# DeskOS Remote-Agent

Der Agent läuft auf einem **zweiten Rechner** (Windows-PC, Laptop, Raspberry Pi),
sammelt dort Systemmetriken (CPU, RAM, Temperatur, Disks, GPU, Netzwerk,
Prozesse) und schickt sie per WebSocket an das DeskOS-Backend. Im Dashboard
taucht der Rechner danach als eigenes Gerät auf.

---

## Schnellstart auf dem Remote-PC

Es gibt zwei Wege — beide funktionieren, der erste ist der empfohlene.

### Weg A: ganzes Repository klonen (empfohlen)

```bash
git clone https://github.com/DarkWixxard/DeskOS.git
cd DeskOS
npm install
npm run dev --workspace=apps/agent
```

Windows-Alternative zum letzten Befehl: Doppelklick auf
`deploy\windows\start-agent.bat`.
Linux/Raspberry Pi: `./deploy/linux/start-agent.sh`.

### Weg B: nur den Ordner `apps/agent` kopieren

Der Agent ist bewusst eigenständig lauffähig — er braucht das restliche Repo
zur **Laufzeit** nicht:

```bash
cd agent            # der kopierte Ordner
npm install         # WICHTIG: einmal pro Rechner, installiert u. a. tsx
npm run dev
```

`npm run dev` prüft vor dem Start selbst, ob die Abhängigkeiten vollständig
sind, und installiert sie bei Bedarf nach. Ein vergessenes `npm install` ist
damit kein Fehlstart mehr.

### Danach: Backend-URL eintragen

Beim ersten Start legt der Agent `apps/agent/.env` aus `.env.example` an.
Dort gehört die Adresse des Rechners hinein, auf dem das **Backend** läuft:

```env
BACKEND_URL=http://192.168.178.156:4001   # IP des DeskOS-Backends, nicht localhost!
AGENT_NAME=Wohnzimmer-PC                   # frei wählbar, erscheint im Dashboard
POLL_INTERVAL=1000                         # Messintervall in ms
AGENT_TYPE=remote                          # optional: remote | RaspberryPi | Arduino
```

`localhost` funktioniert nur, wenn Backend und Agent auf demselben Rechner
laufen. Nach dem Ändern der `.env` den Agent neu starten.

---

## Dauerbetrieb / Autostart

**Windows:** Verknüpfung auf `deploy\windows\start-agent.bat` in den
Autostart-Ordner legen (`Win+R` → `shell:startup`).

**Linux / Raspberry Pi:** systemd-Unit aus dem Repo installieren
(Platzhalter durch die eigenen Werte ersetzen):

```bash
sudo sed -e "s|__DESCOS_USER__|$USER|g" \
         -e "s|__DESCOS_DIR__|$HOME/DeskOS|g" \
         -e "s|__NPM_BIN__|$(command -v npm)|g" \
         -e "s|__NODE_DIR__|$(dirname "$(command -v node)")|g" \
         deploy/linux/systemd/descos-agent.service \
         > /etc/systemd/system/descos-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now descos-agent.service
journalctl -u descos-agent -f      # Logs mitlesen
```

**Produktivvariante ohne tsx:** auf dem Hauptrechner `npm run build --workspace=apps/agent`
ausführen, `dist/`, `package.json` und `.env` auf den Remote-PC kopieren, dort
`npm install --omit=dev` und `node dist/index.js` starten.

---

## Fehlerbehebung

### `Der Befehl "tsx" ist entweder falsch geschrieben oder konnte nicht gefunden werden`

Auf diesem Rechner fehlen die Abhängigkeiten des Agents (`node_modules`) — meist
weil der Ordner ohne Installation kopiert oder mit `--omit=dev` / `--production`
installiert wurde. `tsx` ist eine devDependency und fällt dabei weg.

```bash
cd <agent-ordner>
npm install --include=dev
npm run dev
```

Seit dem Agent-Launcher (`scripts/dev.mjs`) erledigt `npm run dev` das selbst;
die Meldung kann nur noch bei sehr alten Kopien des Ordners auftreten.

### `npm run build` schlägt im kopierten Ordner fehl

Erwartet: Der Build (`tsc`) benötigt die Typen aus `packages/shared` und damit
das vollständige Repository. Zum **Ausführen** ist das egal — die Typimporte
werden wegkompiliert. Also entweder Weg A nutzen oder auf dem Hauptrechner
bauen und `dist/` kopieren.

(Die `tsconfig.json` des Agents ist deshalb eigenständig und erbt bewusst nicht
mehr vom Repo-Root — sonst scheiterte `tsc` im kopierten Ordner schon an
`TS5083: Cannot read file '.../tsconfig.json'`.)

### Agent startet, taucht aber nicht im Dashboard auf

1. `BACKEND_URL` prüfen — echte LAN-IP des Backends, Port `4001`, kein `localhost`.
2. Erreichbarkeit testen: `curl http://<backend-ip>:4001/health`
   (Windows: `curl.exe` oder im Browser öffnen).
3. Firewall auf dem **Backend**-Rechner: eingehend Port 4001 erlauben
   (Windows Defender Firewall → Eingehende Regel für Node.js/Port 4001).
4. Läuft das Backend mit `DESKOS_TOKEN`, müssen Agent und Backend dasselbe
   Netz/Token-Setup verwenden — siehe `docs/SECURITY.md`.

### Agent meldet `Optionales Modul "systeminformation" nicht installiert`

Nur ein Hinweis: Der Agent läuft weiter und liefert CPU, RAM, Uptime sowie
(unter Linux) Temperatur, Disks, Prozesse und Netzwerk über native Fallbacks.
Für GPU-Werte und den vollen Metriksatz `npm install` im Agent-Ordner ausführen.

### Zu alte Node-Version

Der Agent benötigt **Node 18+**. Der Launcher bricht mit einer klaren Meldung
ab, wenn die installierte Version älter ist.

---

## Wie der Agent gestartet wird

| Befehl | Zweck |
|--------|-------|
| `npm run dev` | Entwicklung/Normalbetrieb: Preflight (Node-Version, `.env`, Abhängigkeiten) + `tsx watch src/index.ts` |
| `npm run build` | TypeScript nach `dist/` kompilieren (benötigt das ganze Repo) |
| `npm start` | Vorher gebautes `dist/index.js` starten (kein tsx nötig) |

Preflight überspringen (z. B. in eigenen Deploy-Skripten): `DESKOS_SKIP_INSTALL=1 npm run dev`.
