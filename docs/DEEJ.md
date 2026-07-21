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

## Konfiguration per `config.yaml` (wie beim Original-deej)

Wer lieber eine Datei bearbeitet als das Dashboard, kann DeskOS **genau wie deej**
über eine `config.yaml` konfigurieren.

- **Ort:** `config.yaml` im **Projekt-Root** (neben der `README.md`). Alternativ
  einen beliebigen Pfad über die Umgebungsvariable `DEEJ_CONFIG` setzen.
- **Erststart:** Existiert noch keine Datei, legt DeskOS automatisch eine
  `config.yaml` mit der aktuellen Zuordnung an – als Startpunkt zum Bearbeiten.
  Eine kommentierte Vorlage liegt außerdem als
  [`config.example.yaml`](../config.example.yaml) bei.
- **Live-Reload:** DeskOS **überwacht** die Datei. Speicherst du Änderungen,
  werden sie **sofort übernommen** – kein Neustart nötig. Im Dashboard zeigt ein
  Banner den aktiven Pfad und bietet einen **„Neu laden"**-Knopf.
- **Maßgeblich:** Ist eine `config.yaml` vorhanden, ist **sie die Quelle der
  Wahrheit**. Ändert sich die Datei, überschreibt sie die Zuordnung im Dashboard.

Format (identisch zu deej):

```yaml
slider_mapping:
  0: master
  1: spotify.exe
  2: chrome.exe
  3:                      # eine Liste = Gruppe (ein Regler steuert mehrere Apps)
    - pathofexile_x64.exe
    - rocketleague.exe
  4: discord.exe

invert_sliders: false
com_port: COM3
baud_rate: 9600
noise_reduction: default   # low | default | high
```

Mögliche Ziele je Regler: `master`, `mic`, `system`, `deej.current` (aktive App,
nur Windows), `deej.unmapped`, ein **Prozessname** (z. B. `spotify.exe`) oder eine
**Liste** von Prozessnamen (Gruppe). Steht ein `com_port` in der Datei, verbindet
sich DeskOS beim Start automatisch damit – wie deej.

> **Reihenfolge der Apps ändern:** Der Index (`0`, `1`, `2` …) entspricht dem
> physischen Regler (Reihenfolge in der seriellen Zeile). Um „welcher Regler
> steuert welche App" zu ändern, tauschst du einfach die Zuordnung der jeweiligen
> Indizes in der `config.yaml`.

---

## Plattform-Unterstützung für die Lautstärke

Das Setzen der Lautstärke ist „best effort" und nutzt das jeweilige Standard-Tool
des Betriebssystems. Fehlt es, wird der Reglerwert nur angezeigt (eine Warnung im
Log), der Rest funktioniert weiter.

| Plattform | Master | Mikrofon | Pro-App | Werkzeug |
|-----------|:------:|:--------:|:-------:|----------|
| **Windows** | ✅ | ✅ | ✅ | Core Audio API über PowerShell (**ohne Installation**) |
| **Linux** (PulseAudio/PipeWire) | ✅ | ✅ | ✅ | `pactl` |
| **macOS** | ✅ | ✅ | – | `osascript` |

Unter **Windows** spricht DeskOS direkt die **Windows Core Audio API** an – über
einen einzigen, dauerhaft laufenden PowerShell-Prozess (kompiliert einmalig einen
kleinen C#-Helfer via `Add-Type`). Es ist **kein** `nircmd` oder sonstiges Tool
nötig; PowerShell + .NET Framework sind auf jedem Windows vorhanden. Für die
Pro-App-Zuordnung ist der **Prozessname** entscheidend (z. B. `chrome`,
`spotify` – mit oder ohne `.exe`), und die App muss gerade Ton ausgeben (eine
aktive Audio-Session haben), damit sie zugeordnet werden kann.

### Pro-App reagiert nicht (nur Master funktioniert)?

Die Audio-Ansicht zeigt in der Verbindungsleiste eine Zeile **„Audio-Backend: …"**
mit der Live-Diagnose des OS-Backends. Typische Fälle:

- **`AUDIO OK`** – der C#-Helfer ist bereit (Master **und** Pro-App).
- **`APP-MISS <name> | sessions: chrome, spotify, …`** – der eingetragene Name
  passt zu keinem laufenden Audio-Stream. Trage **exakt** einen der aufgelisteten
  Prozessnamen ein (das ist die Liste der Apps, die gerade Ton ausgeben). Häufig
  ist der Name kürzer als gedacht (z. B. `spotify`, nicht `Spotify Premium`).
- **`AUDIO FAIL: …`** – der C#-Helfer ließ sich nicht übersetzen; die Meldung
  steht dahinter (bitte melden).

Wichtig: Die App muss zum Zeitpunkt des Reglerns **gerade Ton ausgeben**, sonst
existiert keine Audio-Session, der man die Lautstärke zuweisen kann.

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
