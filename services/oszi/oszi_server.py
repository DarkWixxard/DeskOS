"""
Oszi-Service fuer DeskOS -- kopfloser (headless) Web-Einstiegspunkt.

Dies ist eine schlanke, GUI-freie Variante von ``ultimate_rigol_lab.py``:
es laeuft NUR der Flask-Webserver (kein Tkinter, kein matplotlib), damit der
Dienst headless / im Container / neben DeskOS laufen kann.

Die REST-Endpunkte sind dieselben wie im Original, sodass das DeskOS-Frontend
(die native React-"Oszi"-Ansicht) sie ueber den Node-Proxy /api/oszi/* nutzen
kann.

Konfiguration ueber Umgebungsvariablen:
  RIGOL_IP   IP-Adresse des Rigol-Oszilloskops (Default 192.168.1.45)
  OSZI_HOST  Bind-Adresse des Webservers       (Default 0.0.0.0)
  OSZI_PORT  Port des Webservers               (Default 5000)
  OSZI_DEMO  Wenn gesetzt (1/true): Demo-Modus mit synthetischem Signal,
             damit die Oberflaeche auch OHNE echte Hardware getestet werden kann.

Start:  python oszi_server.py
"""

import os
import io
import csv
import math
import time
import socket
import threading

# ---------------------------------------------------------------------------
# Optionale Abhaengigkeiten (genau wie im Original mit Feature-Flags)
# ---------------------------------------------------------------------------
try:
    import pyvisa
    HAS_PYVISA = True
except ImportError:
    pyvisa = None
    HAS_PYVISA = False

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    np = None
    HAS_NUMPY = False

try:
    from reportlab.pdfgen import canvas as pdf_canvas
    HAS_REPORTLAB = True
except ImportError:
    pdf_canvas = None
    HAS_REPORTLAB = False

from flask import Flask, jsonify, request, Response, render_template

# ---------------------------------------------------------------------------
# Konfiguration
# ---------------------------------------------------------------------------
RIGOL_IP = os.environ.get("RIGOL_IP", "192.168.1.45")
OSZI_HOST = os.environ.get("OSZI_HOST", "0.0.0.0")
OSZI_PORT = int(os.environ.get("OSZI_PORT", "5000"))
DEMO = os.environ.get("OSZI_DEMO", "").lower() in ("1", "true", "yes", "on")

# ---------------------------------------------------------------------------
# Globaler Zustand
# ---------------------------------------------------------------------------
scope = None
status_text = "Demo-Modus verbunden" if DEMO else "Nicht verbunden"
trigger_source = "CHAN1"
waveform_data = np.array([]) if HAS_NUMPY else []
last_frequency = None
last_vpp = None
last_voltage = None
_state_lock = threading.Lock()

if HAS_PYVISA and not DEMO:
    try:
        rm = pyvisa.ResourceManager()
    except Exception as exc:  # pragma: no cover - haengt von der Umgebung ab
        rm = None
        print("PyVISA ResourceManager konnte nicht erstellt werden:", exc)
else:
    rm = None
    if not DEMO:
        print("pyvisa nicht verfuegbar -- Scope-Verbindung deaktiviert.")

# ---------------------------------------------------------------------------
# Hilfsfunktionen (aus dem Original uebernommen)
# ---------------------------------------------------------------------------
def nice_number(value):
    try:
        val = float(value)
    except (TypeError, ValueError):
        return None
    if abs(val) >= 1000:
        return f"{val:,.0f}"
    if abs(val) >= 1:
        return f"{val:,.2f}".rstrip("0").rstrip(".")
    if val == 0:
        return "0"
    return f"{val:,.3f}".rstrip("0").rstrip(".")


def format_readout(value, unit):
    nice_val = nice_number(value)
    return f"{nice_val} {unit}" if nice_val is not None else "N/A"


def _waveform_list():
    """waveform_data als reine Python-Liste."""
    with _state_lock:
        data = waveform_data
    if data is None:
        return []
    if HAS_NUMPY and hasattr(data, "tolist"):
        return data.tolist()
    return list(data)


# ---------------------------------------------------------------------------
# Verbindung / Steuerung (nur realer Modus)
# ---------------------------------------------------------------------------
def connect_scope():
    """Versucht LAN- und danach USB-Verbindung zum Rigol."""
    global scope, status_text

    if DEMO:
        status_text = "Demo-Modus verbunden"
        return True

    if not HAS_PYVISA or rm is None:
        status_text = "pyvisa nicht verfuegbar"
        return False

    # 1) LAN
    try:
        status_text = "Versuche LAN Verbindung..."
        test_scope = rm.open_resource(f"TCPIP::{RIGOL_IP}::INSTR")
        test_scope.timeout = 10000
        idn = test_scope.query("*IDN?")
        if "RIGOL" in idn.upper():
            scope = test_scope
            scope.write(":WAV:MODE NORM")
            scope.write(":WAV:FORM ASC")
            status_text = f"LAN Verbunden: {idn.strip()}"
            return True
    except Exception as lan_error:
        print("LAN Fehler:", lan_error)

    # 2) USB
    try:
        status_text = "Versuche USB Verbindung..."
        for resource in rm.list_resources():
            if "USB" not in resource.upper():
                continue
            try:
                test_scope = rm.open_resource(resource)
                test_scope.timeout = 10000
                idn = test_scope.query("*IDN?")
                if "RIGOL" in idn.upper():
                    scope = test_scope
                    scope.write(":WAV:MODE NORM")
                    scope.write(":WAV:FORM ASC")
                    status_text = f"USB Verbunden: {idn.strip()}"
                    return True
            except Exception as usb_error:
                print(f"USB Fehler bei {resource}:", usb_error)
    except Exception as usb_main_error:
        print("USB Hauptfehler:", usb_main_error)

    status_text = "Kein Rigol gefunden"
    return False


def get_waveform(channel="CHAN1"):
    global waveform_data
    try:
        scope.write(f":WAV:SOUR {channel}")
        scope.write(":WAV:DATA?")
        raw = scope.read_raw()
        text = raw[11:].decode(errors="ignore")
        waveform = []
        for value in text.split(","):
            try:
                waveform.append(float(value))
            except ValueError:
                pass
        with _state_lock:
            waveform_data = np.array(waveform) if HAS_NUMPY else waveform
        return waveform
    except Exception as exc:
        print("Waveform-Fehler:", exc)
        return []


def _safe_write(command):
    if scope is None:
        return False
    try:
        scope.write(command)
        return True
    except Exception as exc:
        print("SCPI-write Fehler:", exc)
        return False


# ---------------------------------------------------------------------------
# Hintergrund-Schleifen
# ---------------------------------------------------------------------------
def measurement_loop():
    """Liest live Messwerte + Wellenform vom echten Geraet."""
    global last_frequency, last_vpp, last_voltage
    while True:
        try:
            if scope is None:
                time.sleep(1)
                continue
            get_waveform(trigger_source)
            freq = scope.query(":MEASure:FREQuency? CHAN1").strip()
            vpp = scope.query(":MEASure:VPP? CHAN1").strip()
            try:
                vrms = scope.query(":MEASure:VRMS? CHAN1").strip()
            except Exception:
                vrms = None
            with _state_lock:
                last_frequency, last_vpp, last_voltage = freq, vpp, vrms
        except Exception as exc:
            print("Messschleifen-Fehler:", exc)
        time.sleep(1)


def auto_reconnect():
    while True:
        try:
            if scope is not None:
                scope.query("*IDN?")
        except Exception:
            print("Reconnect...")
            try:
                connect_scope()
            except Exception:
                pass
        time.sleep(5)


def demo_loop():
    """Erzeugt ein synthetisches Sinus-Signal, damit die UI ohne Hardware lebt."""
    global waveform_data, last_frequency, last_vpp, last_voltage
    n = 1200
    freq_hz = 1000.0
    vpp = 3.3
    phase = 0.0
    while True:
        phase += 0.35
        if HAS_NUMPY:
            t = np.linspace(0, 4 * math.pi, n)
            wave = (vpp / 2.0) * np.sin(t + phase) + 0.04 * np.random.randn(n)
            samples = wave
        else:
            samples = [
                (vpp / 2.0) * math.sin((4 * math.pi * i / n) + phase)
                for i in range(n)
            ]
        with _state_lock:
            waveform_data = samples
            last_frequency = freq_hz
            last_vpp = vpp
            last_voltage = vpp / (2 ** 0.5) / 2.0
        time.sleep(0.2)


# ---------------------------------------------------------------------------
# Flask-App + Endpunkte (gleiche Pfade wie im Original)
# ---------------------------------------------------------------------------
app = Flask(__name__)


@app.after_request
def add_cors(resp):
    # Erlaubt sowohl den Node-Proxy als auch direkten Dev-Zugriff.
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp


@app.route("/")
def index():
    # Standalone weiterhin nutzbar: liefert die Original-HTML-Oberflaeche,
    # falls templates/dashboard.html vorhanden ist; sonst kurze Info.
    try:
        return render_template("dashboard.html")
    except Exception:
        return jsonify({
            "service": "DeskOS Oszi-Service",
            "demo": DEMO,
            "endpoints": [
                "/api/status", "/api/waveform", "/run", "/stop", "/connect",
                "/autoscale", "/network_scan", "/export_csv", "/screenshot",
                "/report_pdf", "/scpi (POST)", "/target (POST)",
            ],
        })


@app.route("/api/status")
def api_status():
    with _state_lock:
        freq, vpp, voltage, status = last_frequency, last_vpp, last_voltage, status_text
    return jsonify({
        "status": status,
        "demo": DEMO,
        "trigger": trigger_source,
        "frequency": nice_number(freq),
        "vpp": nice_number(vpp),
        "voltage": nice_number(voltage),
        "frequency_readable": format_readout(freq, "Hz"),
        "vpp_readable": format_readout(vpp, "V"),
        "voltage_readable": format_readout(voltage, "V RMS"),
    })


@app.route("/api/waveform")
def api_waveform():
    try:
        data = _waveform_list()
        if not data:
            return jsonify({"waveform": [], "count": 0})
        count = len(data)
        max_points = 500
        if count > max_points:
            step = count // max_points
            data = data[::step]
        return jsonify({"waveform": data, "count": len(data)})
    except Exception as exc:
        return jsonify({"waveform": [], "count": 0, "error": str(exc)})


@app.route("/connect")
def web_connect():
    ok = connect_scope()
    return jsonify({"ok": ok, "status": status_text})


@app.route("/run")
def web_run():
    if DEMO:
        return jsonify({"ok": True, "demo": True})
    return jsonify({"ok": _safe_write(":RUN")})


@app.route("/stop")
def web_stop():
    if DEMO:
        return jsonify({"ok": True, "demo": True})
    return jsonify({"ok": _safe_write(":STOP")})


@app.route("/autoscale")
def web_autoscale():
    if DEMO:
        return jsonify({"ok": True, "demo": True})
    return jsonify({"ok": _safe_write(":AUToscale")})


@app.route("/network_scan")
def web_network_scan():
    found = []
    base = ".".join(RIGOL_IP.split(".")[:3]) + "."
    for i in range(1, 255):
        ip = base + str(i)
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(0.05)
        if sock.connect_ex((ip, 5555)) == 0:
            found.append(ip)
        sock.close()
    return jsonify({"found": found})


@app.route("/export_csv")
def web_export_csv():
    data = _waveform_list()
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Sample", "Voltage"])
    for i, value in enumerate(data):
        writer.writerow([i, value])
    return Response(
        buffer.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=waveform.csv"},
    )


@app.route("/screenshot")
def web_screenshot():
    if DEMO or scope is None:
        return jsonify({"error": "Screenshot benoetigt ein verbundenes Geraet."}), 503
    try:
        scope.write(":DISP:DATA?")
        data = scope.read_raw()
        return Response(
            data[11:] if len(data) > 11 else data,
            mimetype="image/png",
            headers={"Content-Disposition": "attachment; filename=screenshot.png"},
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/report_pdf")
def web_report_pdf():
    if not HAS_REPORTLAB:
        return jsonify({"error": "reportlab nicht installiert."}), 503
    with _state_lock:
        freq, vpp = last_frequency, last_vpp
    buffer = io.BytesIO()
    pdf = pdf_canvas.Canvas(buffer)
    pdf.drawString(100, 800, "Rigol Report")
    pdf.drawString(100, 780, f"Frequenz: {format_readout(freq, 'Hz')}")
    pdf.drawString(100, 760, f"Vpp: {format_readout(vpp, 'V')}")
    pdf.save()
    buffer.seek(0)
    return Response(
        buffer.getvalue(),
        mimetype="application/pdf",
        headers={"Content-Disposition": "attachment; filename=rigol_report.pdf"},
    )


@app.route("/scpi", methods=["POST"])
def web_scpi():
    cmd = (request.json or {}).get("command", "")
    if DEMO:
        return jsonify({"result": f"(Demo) Echo: {cmd}"})
    if scope is None:
        return jsonify({"error": "Kein Geraet verbunden."}), 503
    try:
        return jsonify({"result": scope.query(cmd)})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/target", methods=["POST"])
def web_target():
    global trigger_source
    channel = (request.json or {}).get("channel", "CHAN1")
    trigger_source = channel
    if not DEMO:
        _safe_write(f":TRIGger:EDGE:SOURce {channel}")
    return jsonify({"channel": channel})


# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------
def main():
    if DEMO:
        print(f"Oszi-Service im DEMO-Modus -> http://{OSZI_HOST}:{OSZI_PORT}")
        threading.Thread(target=demo_loop, daemon=True).start()
    else:
        print(f"Oszi-Service -> http://{OSZI_HOST}:{OSZI_PORT} (Rigol: {RIGOL_IP})")
        connect_scope()
        threading.Thread(target=measurement_loop, daemon=True).start()
        threading.Thread(target=auto_reconnect, daemon=True).start()

    app.run(host=OSZI_HOST, port=OSZI_PORT, debug=False, use_reloader=False, threaded=True)


if __name__ == "__main__":
    main()
