# Node-RED · BME280 in DeskOS

Diese Anleitung verbindet einen **BME280**-Umgebungssensor (Temperatur,
Luftfeuchte, Luftdruck) über **Node-RED** mit dem in DeskOS eingebauten
**MQTT-Broker**. Die Werte erscheinen danach automatisch im **Sensor Hub** und
in der neuen Dashboard-Kachel **„Umgebungssensor (BME280)“**.

Quellen:
- Broker/Bridge: [`apps/backend/src/services/MqttService.ts`](../apps/backend/src/services/MqttService.ts)
- Kachel: [`apps/frontend/src/components/SensorWidget.tsx`](../apps/frontend/src/components/SensorWidget.tsx)
- Sensor Hub: [`apps/frontend/src/components/SensorView.tsx`](../apps/frontend/src/components/SensorView.tsx)
- Fertiger Flow zum Import: [`docs/node-red/deskos-bme280-flow.json`](./node-red/deskos-bme280-flow.json)

---

## Wie es funktioniert

DeskOS startet im Backend einen eingebetteten MQTT-Broker (aedes) auf Port
**1883**. Jeder Node, der auf `deskos/nodes/<id>/telemetry` publiziert, wird
**automatisch** als Gerät registriert – das Backend braucht dafür **keine
Änderung**. Node-RED liest den BME280 am Raspberry Pi (I2C) und übernimmt genau
diese Rolle:

```
BME280 --(I2C)--> Node-RED --(MQTT)--> DeskOS-Broker :1883 --> Sensor Hub / Kachel
```

Topic-Schema (`<id>` = `bme280`):

| Topic                              | Zweck                                             | Retain |
| ---------------------------------- | ------------------------------------------------- | ------ |
| `deskos/nodes/bme280/announce`     | Meldet den Node an (Name, Typ, Module)            | ja     |
| `deskos/nodes/bme280/telemetry`    | Messwerte: `{ temperature, humidity, pressure }`  | nein   |
| `deskos/nodes/bme280/status`       | `online` / `offline` (Last-Will)                  | ja     |

Der Telemetrie-Payload ist ein JSON-Objekt; DeskOS speichert alle Keys 1:1, also
tauchen `temperature`, `humidity` und `pressure` direkt in der UI auf.

---

## Voraussetzungen am Raspberry Pi

1. **I2C aktivieren**: `sudo raspi-config` → *Interface Options* → *I2C* → *Yes*,
   danach neu starten. Verkabelung BME280 ↔ Pi: `VCC→3V3`, `GND→GND`,
   `SDA→GPIO2 (Pin 3)`, `SCL→GPIO3 (Pin 5)`.
2. **Sensor prüfen** (optional): `sudo apt install -y i2c-tools && i2cdetect -y 1`
   – der BME280 zeigt sich als `76` oder `77`.
3. **BME280-Node installieren**: In Node-RED über *Menü → Palette verwalten →
   Installation* das Paket **`node-red-contrib-bme280`** installieren.

## Voraussetzungen in DeskOS

- Das **Backend läuft** (`npm run dev` im Repo-Root, oder Docker).
- In `apps/backend/.env` darf **kein `MQTT_BROKER`** gesetzt sein – nur dann
  startet der eingebettete Broker auf `:1883`
  (siehe [`MqttService.ts:39`](../apps/backend/src/services/MqttService.ts)).
- **Netzwerk**: Der Broker bindet an alle Interfaces, ist also im LAN unter der
  IP des DeskOS-Hosts auf Port 1883 erreichbar. Läuft Node-RED auf einem anderen
  Gerät (z. B. dem Pi), trage im Broker-Node diese **LAN-IP** ein.
- **Auth** (optional): Sind im Backend `MQTT_USERNAME` / `MQTT_PASSWORD` gesetzt,
  im Broker-Node unter *Sicherheit* dieselben Zugangsdaten hinterlegen. Ohne
  gesetzten `MQTT_USERNAME` ist der Broker offen (keine Anmeldung nötig).

---

## Flow importieren und konfigurieren

1. In Node-RED: *Menü → Import → Zwischenablage*, den Inhalt von
   [`docs/node-red/deskos-bme280-flow.json`](./node-red/deskos-bme280-flow.json)
   einfügen und importieren. Es entsteht ein Tab **„DeskOS BME280“**.
2. Einen der MQTT-Nodes doppelklicken → beim Server auf den **Stift** →
   **IP/Host des DeskOS-Backends** und Port **1883** eintragen → *Update*.
   (Auf demselben Rechner reicht `127.0.0.1`.)
3. Den Node **„BME280 lesen (I2C)“** öffnen und die **I2C-Adresse** (`0x76`
   oder `0x77`) setzen.
4. **Deploy** klicken.

Der Flow macht dann:

- **Beim Start** einmal `announce` (retained) → der Node wird in DeskOS
  registriert.
- **Alle 5 s** BME280 lesen → auf `{ temperature, humidity, pressure }`
  normalisieren (Luftdruck in **hPa**) → an `.../telemetry` senden.
- **Verbindung online/offline** über Birth-/Last-Will-Message auf `.../status`.

> Der `-> telemetry`-Function-Node fängt verschiedene Feldnamen/Einheiten ab
> (z. B. Luftdruck in Pa) und rechnet auf hPa um – falls dein Read-Node andere
> Keys liefert, siehst du hier, wo du sie anpasst.

---

## Prüfen

1. In DeskOS oben rechts **Sensor Hub** öffnen → der Node **„BME280 (Node-RED)“**
   erscheint mit Temperatur, Luftfeuchte und **Luftdruck (hPa)**.
2. Auf dem **Dashboard** die Kachel **„Umgebungssensor (BME280)“** über die
   **Anzeige**-Ansicht einblenden – sie zeigt dieselben Live-Werte kompakt.

## Test ohne Hardware

Zum Ausprobieren ohne BME280 gibt es zwei Wege:

- **Simulator** (sendet u. a. `pressure`):
  `npm run dev --workspace=apps/simulator`
- **Manuell per mosquitto_pub**:
  ```bash
  mosquitto_pub -h <deskos-host> -t deskos/nodes/bme280/telemetry \
    -m '{"temperature":21.3,"humidity":48,"pressure":1012.5}'
  ```

---

## Troubleshooting

- **Node-RED verbindet nicht** → Läuft das DeskOS-Backend? Ist `MQTT_BROKER` in
  `apps/backend/.env` leer? Ist die IP/Port im Broker-Node korrekt und der Host
  im LAN erreichbar (Firewall Port 1883)?
- **Node erscheint, aber „Noch keine Messwerte…“** → Der `announce` kam an, aber
  keine Telemetrie. Im Node-RED-Debug prüfen, ob der BME280-Read-Node Werte
  liefert (I2C-Adresse korrekt?).
- **Luftdruck sieht falsch aus (z. B. 101250)** → Dein Read-Node liefert Pa. Der
  Function-Node rechnet Werte > 2000 automatisch auf hPa um; sonst dort anpassen.
- **„unknown node: bme280“ beim Import** → `node-red-contrib-bme280` ist noch
  nicht installiert. Erst installieren, dann den Node öffnen und konfigurieren.
