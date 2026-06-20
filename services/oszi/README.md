# Oszi-Service (Rigol-Oszilloskop)

Python/Flask-Backend für die **„Oszi"**-Ansicht in DeskOS. Ursprünglich aus dem
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

## Anbindung an DeskOS

Die React-Ansicht ruft **nicht** direkt Port 4002 auf, sondern geht über den
Node-Backend-Proxy: `GET/POST {Backend:4001}/api/oszi/*` → `{OSZI:4002}/*`.
Der Proxy wird über `OSZI_URL` (bzw. `OSZI_HOST`/`OSZI_PORT`) im Backend konfiguriert.

> **Hinweis Hardware:** Es gibt keinen eingebauten Simulationsmodus im Original –
> ohne erreichbares Rigol bleiben die Live-Werte leer. Zum Entwickeln/Testen
> `OSZI_DEMO=1` verwenden. USB-Zugriff funktioniert im Container nur mit
> Geräte-Passthrough; bevorzugt LAN (`RIGOL_IP`) nutzen oder den Dienst direkt
> auf dem Host starten.
