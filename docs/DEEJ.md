# deej – Hardware-Lautstärkeregler in DeskOS

DeskOS kann deinen selbstgebauten **deej**-Lautstärkeregler direkt einbinden – du
brauchst die separate deej-Software dann nicht mehr. DeskOS liest die Reglerstände
über die serielle Schnittstelle, zeigt sie live im Dashboard (Ansicht **Audio**)
und setzt damit die Lautstärke deines PCs.

> [deej](https://github.com/omriharel/deej) ist ein Open-Source-Projekt: ein
> Arduino/ESP mit ein paar Potentiometern/Schiebereglern, der seine Stellungen
> zeilenweise über USB-Serial sendet, z. B. `512|1023|0|340` (jeder Wert 0–1023).

---

## Was DeskOS macht

1. **Liest** die serielle Zeile deines deej-Geräts.
2. **Normiert** jeden Regler auf 0–100 % (optional invertiert + rauschgeglättet).
3. **Wendet** den Wert auf das zugeordnete Ziel des Betriebssystems an:
   **Master**, **Mikrofon** oder eine **bestimmte App**.
4. **Sendet** die Reglerstände live ans Dashboard (WebSocket) – die Fader in der
   Audio-Ansicht bewegen sich mit.

Alles ist auf dem Backing-**Device** (Typ `Arduino`, Fähigkeit `audio`)
gespeichert, taucht also im **Device Center** auf und übersteht Neustarts.

---

## Voraussetzung: `serialport` installieren (für echte Hardware)

Der serielle Zugriff nutzt das npm-Paket **`serialport`**. Es ist eine
**optionale** Abhängigkeit, damit DeskOS auch auf Systemen ohne native
Build-Tools startet. Für echte Hardware einmalig installieren:

```bash
npm install serialport --workspace=apps/backend
```

Ohne `serialport` funktioniert trotzdem alles außer der echten Verbindung:
Regler lassen sich im Dashboard **ziehen** und per **Test**-Knopf **simulieren**
– beides steuert die tatsächliche Lautstärke.

> Nur **ein** Programm darf den seriellen Port gleichzeitig öffnen. Wenn DeskOS
> den deej-Regler übernimmt, beende die separate deej-App (bzw. deaktiviere ihren
> Autostart), sonst blockieren sich beide.

---

## Einrichten im Dashboard

1. Menü öffnen (**Strg + K**) → Seite **HARDWARE & CONTROL** → Kachel **Audio**.
2. **Ports scannen** und deinen deej-Port wählen (z. B. `/dev/ttyUSB0` oder
   `COM3`). Baudrate meist **9600** (deej-Standard).
3. **Verbinden**. Der Statuspunkt wird grün, die Fader bewegen sich live.
4. Jeden Regler über das **Zahnrad** zuordnen:
   - **Master** – System-Gesamtlautstärke
   - **Mikrofon** – Standard-Eingabegerät
   - **App** – eine Anwendung per Prozessname (z. B. `spotify.exe`, `firefox`)
   - **System** / **Frei** – nur Anzeige, wird nicht ans OS geschickt
5. **Invertieren**, **Rauschunterdrückung** (low/default/high) und die **Anzahl
   der Regler** stellst du oben in der Verbindungsleiste ein.

Ohne Hardware zum Ausprobieren: einfach einen Fader ziehen oder **Test** klicken.

---

## Plattform-Unterstützung für die Lautstärke

Das Setzen der Lautstärke ist „best effort" und nutzt das jeweilige Standard-Tool
des Betriebssystems. Fehlt es, wird der Reglerwert nur angezeigt (eine Warnung im
Log), der Rest funktioniert weiter.

| Plattform | Master | Mikrofon | Pro-App | Werkzeug |
|-----------|:------:|:--------:|:-------:|----------|
| **Linux** (PulseAudio/PipeWire) | ✅ | ✅ | ✅ | `pactl` |
| **macOS** | ✅ | ✅ | – | `osascript` |
| **Windows** | ✅* | – | – | `nircmd` (falls im PATH) |

\* Unter Windows wird `nircmd` verwendet, falls verfügbar. Für vollständige
Pro-App-Steuerung unter Windows ist die native deej-App weiterhin die
umfassendere Wahl.

---

## Umgebungsvariablen (optional, für Kiosk/headless)

Alles lässt sich auch im Dashboard einstellen. Für den automatischen Start ohne
Klicks (in der Root-`.env`):

| Variable | Standard | Bedeutung |
|----------|----------|-----------|
| `DEEJ_PORT` | – | serieller Port (z. B. `/dev/ttyUSB0`, `COM3`) |
| `DEEJ_BAUD` | `9600` | Baudrate |
| `DEEJ_SLIDERS` | `4` | Anzahl der Regler |
| `DEEJ_INVERT` | `false` | Regler invertieren |
| `DEEJ_NOISE` | `default` | Rauschunterdrückung: `low` \| `default` \| `high` |
| `DEEJ_AUTOCONNECT` | `false` | beim Start automatisch verbinden |

---

## Arduino-Firmware

Es genügt der **Standard-deej-Sketch** – DeskOS erwartet exakt dasselbe Format
wie die deej-App: eine Zeile pro Messung, Werte `0–1023`, mit `|` getrennt, mit
`\r\n` abgeschlossen. Beispiel für 4 Regler:

```cpp
const int NUM_SLIDERS = 4;
const int analogInputs[NUM_SLIDERS] = {A0, A1, A2, A3};

void setup() { Serial.begin(9600); }

void loop() {
  String out = "";
  for (int i = 0; i < NUM_SLIDERS; i++) {
    out += String(analogRead(analogInputs[i]));
    if (i < NUM_SLIDERS - 1) out += "|";
  }
  Serial.println(out);
  delay(10);
}
```

---

## REST-API

| Methode & Pfad | Zweck |
|----------------|-------|
| `GET /api/deej/status` | aktueller Status + Reglerzuordnung + Werte |
| `GET /api/deej/ports` | verfügbare serielle Ports |
| `POST /api/deej/connect` · `POST /api/deej/disconnect` | Verbindung öffnen/schließen |
| `PATCH /api/deej/config` | Port, Baud, Invertieren, Rauschunterdrückung, Reglerzahl |
| `PATCH /api/deej/sliders/:index` | Zuordnung eines Reglers (Ziel/App/Label/Mute) |
| `POST /api/deej/sliders/:index/volume` | Regler-Wert manuell setzen (0–100) |
| `POST /api/deej/simulate` | rohe serielle Zeile einspeisen (Test/Demo) |

**WebSocket:** `deej:update` liefert bei jeder Änderung den kompletten Status.

**Automationen:** über das Bus-Event `deej:command`
(`{ index?, target?, value, muted? }`) lässt sich die Lautstärke auch aus
Automationen/Szenen steuern.
