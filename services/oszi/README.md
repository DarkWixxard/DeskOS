# Oszi-Service (Rigol-Oszilloskop)

Python/Flask-Backend für die **„Oszi“**-Ansicht in DeskOS. Ursprünglich aus dem
Repo *Oszilloskop* (`ultimate_rigol_lab.py`). Hier liegen zwei Varianten:

| Datei | Zweck |
|-------|-------|
| `oszi_server.py` | **Kopfloser Web-Dienst** (nur Flask, kein Tkinter). Wird von DeskOS genutzt. |
| `ultimate_rigol_lab.py` | Original mit Tkinter-Desktop-GUI (Referenz / Standalone am PC). |
| `templates/dashboard.html` | Original-Weboberfläche (Standalone). In DeskOS nativ als React nachgebaut. |

## Start (kopfloser Dienst)

```bash
pip install -r requirements-web.txt

# Mit echter Hardware:
RIGOL_IP=192.168.1.45 python oszi_server.py

# Ohne Hardware (Demo-Signal, zum Testen der Oberfläche):
OSZI_DEMO=1 python oszi_server.py
```

Der Dienst lauscht auf `http://0.0.0.0:4002`. Aus dem DeskOS-Repo-Root genügt:

```bash
npm run dev:oszi          # echtes Gerät
OSZI_DEMO=1 npm run dev:oszi   # Demo
```

## Konfiguration (Umgebungsvariablen)

| Variable | Default | Bedeutung |
|----------|---------|-----------|
| `RIGOL_IP` | `192.168.1.45` | IP des Rigol (LAN/VISA) |
| `OSZI_HOST` | `0.0.0.0` | Bind-Adresse |
| `OSZI_PORT` | `4002` | Port |
| `OSZI_DEMO` | – | `1`/`true` → synthetisches Demo-Signal statt Hardware |
| `OSZI_CONN` | `auto` | `usb` = nur USB (kein LAN-Timeout), `lan` = nur LAN, `auto` = LAN (falls `RIGOL_IP`) dann USB |

## Anbindung an DeskOS

Die React-Ansicht ruft **nicht** direkt Port 4002 auf, sondern geht über den
Node-Backend-Proxy: `GET/POST {Backend:4001}/api/oszi/*` → `{OSZI:4002}/*`.
Der Proxy wird über `OSZI_URL` (bzw. `OSZI_HOST`/`OSZI_PORT`) im Backend konfiguriert.

> **Hinweis Hardware:** Ohne erreichbares Rigol bleiben die Live-Werte leer. Zum
> Entwickeln/Testen `OSZI_DEMO=1` verwenden. USB-Zugriff funktioniert im Container
> nur mit Geräte-Passthrough; bevorzugt den Dienst direkt auf dem Host starten.

## RIGOL per USB steuern (Windows)

USB-TMC braucht auf Windows **eine** der beiden Voraussetzungen. Zur Diagnose zuerst:

```bash
npm run oszi:doctor
```

Der Doctor zeigt das aktive VISA-Backend, gefundene Ressourcen und den konkret
nächsten Schritt.

**Weg A – VISA-Laufzeit (empfohlen, ohne Zadig):**
Rigol **UltraSigma** oder **NI-VISA** installieren. Beide bringen den USB-TMC-Treiber
und eine VISA-Bibliothek mit; `pyvisa` nutzt sie automatisch – der Dienst läuft ohne
weitere Änderung. Wichtig: **Python- und VISA-Bitness müssen übereinstimmen** (64-bit).

**Weg B – rein Python (ohne NI-VISA):**
1. `npm run setup:oszi` (installiert `pyusb` + `libusb-package`).
2. Mit **Zadig** der USB-Schnittstelle des Oszilloskops den Treiber **WinUSB**
   (oder libusbK) zuweisen. Danach findet `pyvisa-py` das Gerät als
   `USB0::0x1AB1::…::INSTR`.
   > WinUSB ersetzt den TMC-Treiber – UltraSigma/NI-VISA sehen das Gerät erst nach
   > Zurücksetzen wieder.

Danach `python oszi_server.py` (ohne `OSZI_DEMO`) → Status „USB Verbunden: …“.
Kein LAN-Timeout gewünscht? `OSZI_CONN=usb` setzen (überspringt den LAN-Versuch).
