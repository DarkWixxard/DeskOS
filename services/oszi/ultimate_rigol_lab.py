import tkinter as tk
from tkinter import ttk
from tkinter import filedialog
from tkinter import messagebox

import threading
import time
import csv
import socket
import sys
import os

HAS_PYVISA = False
HAS_NUMPY = False
HAS_FFT = False
HAS_MATPLOTLIB = False
HAS_FLASK = False
HAS_MQTT = False
HAS_REPORTLAB = False

try:
    import pyvisa
    HAS_PYVISA = True
except ImportError:
    pyvisa = None

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    np = None

try:
    from scipy.fft import fft
    HAS_FFT = True
except ImportError:
    fft = None
    if HAS_NUMPY:
        from numpy.fft import fft
        HAS_FFT = True

try:
    from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
    from matplotlib.figure import Figure
    HAS_MATPLOTLIB = True
except ImportError:
    FigureCanvasTkAgg = None
    Figure = None

try:
    from flask import Flask, jsonify, render_template
    HAS_FLASK = True
except ImportError:
    Flask = None
    jsonify = None
    render_template = None

try:
    import paho.mqtt.client as mqtt
    HAS_MQTT = True
except ImportError:
    mqtt = None

try:
    from reportlab.pdfgen import canvas
    HAS_REPORTLAB = True
except ImportError:
    canvas = None

# =====================================================
# KONFIGURATION
# =====================================================
RIGOL_IP = "192.168.1.45"
MQTT_BROKER = "localhost"

# =====================================================
# GLOBALE VARIABLEN
# =====================================================
scope = None
running = False
logging_active = False

waveform_data = np.array([]) if HAS_NUMPY else []

# =====================================================
# VISA
# =====================================================
if HAS_PYVISA:
    try:
        rm = pyvisa.ResourceManager()
    except Exception as exc:
        rm = None
        print("PyVISA ResourceManager konnte nicht erstellt werden:", exc)
else:
    rm = None
    print("pyvisa nicht installiert. Scope-Verbindung deaktiviert.")

# =====================================================
# MQTT
# =====================================================
if HAS_MQTT:
    try:
        mqtt_client = mqtt.Client()
        mqtt_client.connect(MQTT_BROKER, 1883)
    except Exception as exc:
        mqtt_client = None
        print("MQTT nicht verbunden:", exc)
else:
    mqtt_client = None
    print("paho-mqtt nicht installiert. MQTT Export deaktiviert.")

# =====================================================
# WEBSERVER
# =====================================================
if HAS_FLASK:
    app = Flask(__name__)

    @app.route('/')
    def dashboard():
        return render_template('dashboard.html')

    @app.route('/api/status')
    def api_status():
        return jsonify({
            'status': status_var.get() if 'status_var' in globals() else 'N/A',
            'frequency': nice_number(last_frequency),
            'vpp': nice_number(last_vpp),
            'voltage': nice_number(last_voltage),
            'frequency_readable': format_readout(last_frequency, 'Hz'),
            'vpp_readable': format_readout(last_vpp, 'V'),
            'voltage_readable': format_readout(last_voltage, 'V RMS')
        })

    @app.route('/api/waveform')
    def api_waveform():
        global waveform_data
        try:
            if waveform_data is None or len(waveform_data) == 0:
                return jsonify({'waveform': [], 'count': 0})
            if HAS_NUMPY and hasattr(waveform_data, 'tolist'):
                data = waveform_data.tolist()
            else:
                data = list(waveform_data)
            count = len(data)
            max_points = 500
            if count > max_points:
                step = count // max_points
                data = data[::step]
            return jsonify({'waveform': data, 'count': len(data)})
        except Exception as exc:
            return jsonify({'waveform': [], 'count': 0, 'error': str(exc)})

    @app.route('/run')
    def web_run():
        run_scope()
        return 'RUN'

    @app.route('/stop')
    def web_stop():
        stop_scope()
        return 'STOP'

    @app.route('/connect')
    def web_connect():
        connect_scope()
        return 'CONNECT'

    @app.route('/autoscale')
    def web_autoscale():
        autoscale_scope()
        return 'AUTOSCALE'

    @app.route('/screenshot')
    def web_screenshot():
        save_screenshot()
        return 'SCREENSHOT'

    @app.route('/export_csv')
    def web_export_csv():
        export_csv()
        return 'EXPORT_CSV'

    @app.route('/report_pdf')
    def web_report_pdf():
        create_pdf_report()
        return 'REPORT_PDF'

    @app.route('/network_scan')
    def web_network_scan():
        network_scan()
        return 'NETWORK_SCAN'

    @app.route('/dark_mode')
    def web_dark_mode():
        dark_mode()
        return 'DARK_MODE'

    @app.route('/scpi', methods=['POST'])
    def web_scpi():
        from flask import request
        cmd = request.json.get('command', '')
        try:
            result = scope.query(cmd)
            return jsonify({'result': result})
        except Exception as exc:
            return jsonify({'error': str(exc)}), 500

    @app.route('/target', methods=['POST'])
    def web_target():
        from flask import request
        target = request.json.get('channel', 'CHAN1')
        trigger_var.set(target)
        set_trigger()
        return jsonify({'channel': target})
else:
    app = None
    print("Flask nicht installiert. Webserver deaktiviert.")

# =====================================================
# WEB THREAD
# =====================================================
def start_webserver():
    if not HAS_FLASK or app is None:
        return

    app.run(
        host='0.0.0.0',
        port=int(os.environ.get("OSZI_PORT", "4002")),
        debug=False,
        use_reloader=False
    )

# =====================================================
# WEB DASHBOARD UND HILFSFUNKTIONEN
# =====================================================
last_frequency = None
last_vpp = None
last_voltage = None


def nice_number(value):
    try:
        val = float(value)
    except Exception:
        return None

    if abs(val) >= 1000:
        return f"{val:,.0f}"
    if abs(val) >= 1:
        return f"{val:,.2f}".rstrip('0').rstrip('.')
    if val == 0:
        return "0"
    return f"{val:,.3f}".rstrip('0').rstrip('.')


def format_readout(value, unit):
    nice_val = nice_number(value)
    return f"{nice_val} {unit}" if nice_val is not None else "N/A"

# =====================================================
# VERBINDUNG
# =====================================================
def connect_scope():
    global scope

    if not HAS_PYVISA or rm is None:
        status_var.set("pyvisa nicht verfügbar")
        messagebox.showerror(
            "Verbindung fehlgeschlagen",
            "pyvisa ist nicht installiert oder konnte nicht geladen werden."
        )
        return

# ==========================================
# 1. LAN VERBINDUNG VERSUCHEN
# ==========================================

    try:

        status_var.set(
            "Versuche LAN Verbindung..."
        )

        lan_resource = (
            f"TCPIP::{RIGOL_IP}::INSTR"
        )

        test_scope = rm.open_resource(
            lan_resource
        )

        test_scope.timeout = 10000

        idn = test_scope.query("*IDN?")

        if "RIGOL" in idn.upper():

            scope = test_scope

            status_var.set(
                f"LAN Verbunden: {idn.strip()}"
            )

            scope.write(":WAV:MODE NORM")
            scope.write(":WAV:FORM ASC")

            print(
                "LAN Verbindung erfolgreich"
            )

            return

    except Exception as lan_error:

        print(
            "LAN Fehler:"
        )

        print(lan_error)

# ==========================================
# 2. USB VERBINDUNG VERSUCHEN
# ==========================================

    try:

        status_var.set(
            "Versuche USB Verbindung..."
        )

        resources = rm.list_resources()

        print(resources)

        for resource in resources:

            if "USB" in resource.upper():

                try:

                    print(
                        f"Teste {resource}"
                    )

                    test_scope = (
                        rm.open_resource(
                            resource
                        )
                    )

                    test_scope.timeout = 10000

                    idn = test_scope.query(
                        "*IDN?"
                    )

                    print(idn)

                    if "RIGOL" in idn.upper():

                        scope = test_scope

                        status_var.set(
                            f"USB Verbunden: {idn.strip()}"
                        )

                        scope.write(
                            ":WAV:MODE NORM"
                        )

                        scope.write(
                            ":WAV:FORM ASC"
                        )

                        print(
                            "USB Verbindung erfolgreich"
                        )

                        return

                except Exception as usb_error:

                    print(
                        f"USB Fehler bei {resource}"
                    )

                    print(usb_error)

    except Exception as usb_main_error:

        print(
            "USB Hauptfehler:"
        )

        print(usb_main_error)

# ==========================================
# KEIN GERÄT GEFUNDEN
# ==========================================

    status_var.set(
        "Kein Rigol gefunden"
    )

    messagebox.showerror(
        "Verbindung fehlgeschlagen",
        "Weder LAN noch USB Rigol gefunden."
    )



# =====================================================
# AUTO RECONNECT
# =====================================================
def auto_reconnect():

    global scope

    while True:

        try:

            if scope:
                scope.query("*IDN?")

        except:

            print("Reconnect...")

            try:
                connect_scope()
            except:
                pass

        time.sleep(5)

# =====================================================
# RUN
# =====================================================
def run_scope():

    try:
        scope.write(":RUN")
    except Exception as e:
        print(e)

# =====================================================
# STOP
# =====================================================
def stop_scope():

    try:
        scope.write(":STOP")
    except Exception as e:
        print(e)

# =====================================================
# AUTOSCALE
# =====================================================
def autoscale_scope():

    try:
        scope.write(":AUToscale")
    except Exception as e:
        print(e)

# =====================================================
# TRIGGER
# =====================================================
def set_trigger():

    try:

        source = trigger_var.get()

        scope.write(
            f":TRIGger:EDGE:SOURce {source}"
        )

    except Exception as e:
        print(e)

# =====================================================
# SCREENSHOT
# =====================================================
def save_screenshot():

    try:

        scope.write(":DISP:DATA?")

        data = scope.read_raw()

        filename = filedialog.asksaveasfilename(
            defaultextension='.png'
        )

        if filename:

            with open(filename, 'wb') as f:
                f.write(data)

    except Exception as e:
        print(e)

# =====================================================
# WAVEFORM HOLEN
# =====================================================
def get_waveform(channel="CHAN1"):

    global waveform_data

    try:

        scope.write(f":WAV:SOUR {channel}")

        scope.write(":WAV:DATA?")

        raw = scope.read_raw()

        data = raw[11:]

        text = data.decode(errors='ignore')

        values = text.split(',')

        waveform = []

        for value in values:

            try:
                waveform.append(float(value))
            except:
                pass

        waveform_data = np.array(waveform) if HAS_NUMPY else waveform

        return waveform_data

    except Exception as e:

        print(e)

        return np.array([]) if HAS_NUMPY else []

# =====================================================
# FFT
# =====================================================
def calculate_fft(waveform):

    try:

        if fft is None or len(waveform) == 0:
            return np.array([]) if HAS_NUMPY else []

        result = fft(waveform)

        if HAS_NUMPY:
            result = np.abs(result)

        return result

    except:

        return np.array([]) if HAS_NUMPY else []

# =====================================================
# HARMONIC ANALYSIS
# =====================================================
def harmonic_analysis(fft_data):

    try:
        if fft_data is None or len(fft_data) == 0:
            harmonic_var.set('Keine FFT-Daten')
            return

        if HAS_NUMPY:
            peak = int(np.argmax(fft_data))
        else:
            peak = max(range(len(fft_data)), key=lambda i: fft_data[i])

        harmonic_var.set(
            f"Dominante Frequenz Bin: {peak}"
        )

    except:
        pass

# =====================================================
# UART DECODER
# =====================================================
def uart_decode(waveform):

    bits = []

    for sample in waveform:

        if sample > 0:
            bits.append('1')
        else:
            bits.append('0')

    decoded = ''.join(bits[:64])

    uart_text.delete('1.0', tk.END)
    uart_text.insert(tk.END, decoded)

# =====================================================
# SPI DECODER
# =====================================================
def spi_decode(waveform):

    result = "SPI Decode Placeholder"

    spi_text.delete('1.0', tk.END)
    spi_text.insert(tk.END, result)

# =====================================================
# I2C DECODER
# =====================================================
def i2c_decode(waveform):

    result = "I2C Decode Placeholder"

    i2c_text.delete('1.0', tk.END)
    i2c_text.insert(tk.END, result)

# =====================================================
# CSV EXPORT
# =====================================================
def export_csv():

    try:

        filename = filedialog.asksaveasfilename(
            defaultextension='.csv'
        )

        if filename:

            with open(filename, 'w', newline='') as file:

                writer = csv.writer(file)

                writer.writerow([
                    'Sample',
                    'Voltage'
                ])

                for i, value in enumerate(waveform_data):

                    writer.writerow([
                        i,
                        value
                    ])

    except Exception as e:
        print(e)

# =====================================================
# PDF REPORT
# =====================================================
def create_pdf_report():

    if not HAS_REPORTLAB or canvas is None:
        messagebox.showwarning(
            "PDF nicht erstellt",
            "reportlab ist nicht installiert. Installiere reportlab für PDF-Export."
        )
        return

    filename = filedialog.asksaveasfilename(
        defaultextension='.pdf'
    )

    if not filename:
        return

    pdf = canvas.Canvas(filename)

    pdf.drawString(
        100,
        800,
        "Rigol Report"
    )

    pdf.drawString(
        100,
        780,
        freq_var.get()
    )

    pdf.drawString(
        100,
        760,
        vpp_var.get()
    )

    pdf.save()

# =====================================================
# MQTT EXPORT
# =====================================================
def mqtt_export(freq, vpp):

    if mqtt_client is None:
        return

    try:

        mqtt_client.publish(
            'rigol/frequency',
            freq
        )

        mqtt_client.publish(
            'rigol/vpp',
            vpp
        )

    except Exception as e:
        print('MQTT publish fehlgeschlagen:', e)

# =====================================================
# SCPI KONSOLE
# =====================================================
def send_scpi():

    try:

        cmd = scpi_entry.get()

        result = scope.query(cmd)

        scpi_output.insert(
            tk.END,
            f"> {cmd}\n{result}\n"
        )

    except Exception as e:

        scpi_output.insert(
            tk.END,
            str(e) + '\n'
        )

# =====================================================
# NETZWERKSCAN
# =====================================================
def network_scan():

    found = []

    base = '192.168.1.'

    for i in range(1, 255):

        ip = base + str(i)

        sock = socket.socket(
            socket.AF_INET,
            socket.SOCK_STREAM
        )

        sock.settimeout(0.05)

        result = sock.connect_ex((ip, 5555))

        if result == 0:
            found.append(ip)

        sock.close()

    device_text.delete('1.0', tk.END)

    for ip in found:
        device_text.insert(tk.END, ip + '\n')

# =====================================================
# LIVE UPDATE
# =====================================================
def update_loop():

    global running, last_frequency, last_vpp, last_voltage

    running = True

    while running:

        try:

            # =====================================
            # KEINE VERBINDUNG
            # =====================================

            if scope is None:
                time.sleep(1)
                continue

            # =====================================
            # WAVEFORM HOLEN
            # =====================================

            waveform = get_waveform('CHAN1')

            if len(waveform) > 0:
                fft_data = calculate_fft(waveform)

                if HAS_MATPLOTLIB and canvas_plot is not None and ax is not None:
                    ax.clear()
                    ax.plot(waveform)
                    ax.set_title('Waveform')
                    canvas_plot.draw()

                if HAS_MATPLOTLIB and fft_canvas is not None and fft_ax is not None:
                    fft_ax.clear()
                    fft_ax.plot(fft_data)
                    fft_ax.set_title('FFT')
                    fft_canvas.draw()

                harmonic_analysis(fft_data)
                uart_decode(waveform)
                spi_decode(waveform)
                i2c_decode(waveform)

            freq = scope.query(
                ':MEASure:FREQuency? CHAN1'
            ).strip()

            vpp = scope.query(
                ':MEASure:VPP? CHAN1'
            ).strip()

            voltage = None
            try:
                voltage = scope.query(':MEASure:VRMS? CHAN1').strip()
            except Exception:
                voltage = None

            last_frequency = freq
            last_vpp = vpp
            last_voltage = voltage

            freq_var.set(
                f'Frequency: {format_readout(freq, "Hz")}'
            )

            vpp_var.set(
                f'Vpp: {format_readout(vpp, "V")}')

            if voltage is not None:
                vpp_var.set(
                    f'Vpp: {format_readout(vpp, "V")} | Vrms: {format_readout(voltage, "V")}')

            mqtt_export(freq, vpp)

        except Exception as e:
            print(e)

        time.sleep(1)

# =====================================================
# DARK MODE
# =====================================================
def dark_mode():

    root.configure(bg='#202020')

# =====================================================
# GUI
# =====================================================
root = tk.Tk()

root.title('Ultimate Rigol Lab Suite')
root.geometry('1800x1000')

# =====================================================
# VARIABLEN
# =====================================================
status_var = tk.StringVar()
status_var.set('Nicht verbunden')

freq_var = tk.StringVar()
vpp_var = tk.StringVar()
harmonic_var = tk.StringVar()

trigger_var = tk.StringVar()
trigger_var.set('CHAN1')

# =====================================================
# TITEL
# =====================================================
headline = tk.Label(
    root,
    text='Ultimate Rigol Lab Suite',
    font=('Arial', 18, 'bold')
)

headline.pack(pady=10)

# =====================================================
# STATUS
# =====================================================
status = tk.Label(
    root,
    textvariable=status_var
)

status.pack()

# =====================================================
# BUTTONS
# =====================================================
button_frame = tk.Frame(root)
button_frame.pack(pady=10)

buttons = [
    ('Connect', connect_scope),
    ('RUN', run_scope),
    ('STOP', stop_scope),
    ('Autoscale', autoscale_scope),
    ('Screenshot', save_screenshot),
    ('CSV Export', export_csv),
    ('PDF Report', create_pdf_report),
    ('Network Scan', network_scan),
    ('Dark Mode', dark_mode)
]

for i, (text, cmd) in enumerate(buttons):

    btn = tk.Button(
        button_frame,
        text=text,
        width=15,
        command=cmd
    )

    btn.grid(row=0, column=i, padx=5)

# =====================================================
# TRIGGER
# =====================================================
trigger_frame = tk.Frame(root)
trigger_frame.pack()

trigger_menu = ttk.Combobox(
    trigger_frame,
    textvariable=trigger_var,
    values=['CHAN1', 'CHAN2']
)

trigger_menu.grid(row=0, column=0)

trigger_btn = tk.Button(
    trigger_frame,
    text='Set Trigger',
    command=set_trigger
)

trigger_btn.grid(row=0, column=1)

# =====================================================
# MESSWERTE
# =====================================================
measurement_frame = tk.Frame(root)
measurement_frame.pack(pady=10)

freq_label = tk.Label(
    measurement_frame,
    textvariable=freq_var
)

freq_label.pack()

vpp_label = tk.Label(
    measurement_frame,
    textvariable=vpp_var
)

vpp_label.pack()

harmonic_label = tk.Label(
    measurement_frame,
    textvariable=harmonic_var
)

harmonic_label.pack()

# =====================================================
# WAVEFORM PLOT
# =====================================================
if HAS_MATPLOTLIB and Figure is not None and FigureCanvasTkAgg is not None:
    fig = Figure(figsize=(8,4), dpi=100)
    ax = fig.add_subplot(111)

    canvas_plot = FigureCanvasTkAgg(
        fig,
        master=root
    )

    canvas_plot.get_tk_widget().pack(
        fill=tk.BOTH,
        expand=True
    )
else:
    ax = None
    canvas_plot = None
    placeholder_plot = tk.Label(
        root,
        text='Matplotlib nicht installiert. Diagramme deaktiviert.',
        fg='red'
    )
    placeholder_plot.pack(fill=tk.BOTH, expand=True)

# =====================================================
# FFT PLOT
# =====================================================
if HAS_MATPLOTLIB and Figure is not None and FigureCanvasTkAgg is not None:
    fft_fig = Figure(figsize=(8,3), dpi=100)
    fft_ax = fft_fig.add_subplot(111)

    fft_canvas = FigureCanvasTkAgg(
        fft_fig,
        master=root
    )

    fft_canvas.get_tk_widget().pack(
        fill=tk.BOTH,
        expand=True
    )
else:
    fft_ax = None
    fft_canvas = None
    placeholder_fft = tk.Label(
        root,
        text='Matplotlib nicht installiert. FFT deaktiviert.',
        fg='red'
    )
    placeholder_fft.pack(fill=tk.BOTH, expand=True)

# =====================================================
# NOTEBOOK
# =====================================================
notebook = ttk.Notebook(root)
notebook.pack(fill=tk.BOTH, expand=True)

# =====================================================
# UART TAB
# =====================================================
uart_frame = tk.Frame(notebook)
notebook.add(uart_frame, text='UART')

uart_text = tk.Text(uart_frame, height=10)
uart_text.pack(fill=tk.BOTH, expand=True)

# =====================================================
# SPI TAB
# =====================================================
spi_frame = tk.Frame(notebook)
notebook.add(spi_frame, text='SPI')

spi_text = tk.Text(spi_frame, height=10)
spi_text.pack(fill=tk.BOTH, expand=True)

# =====================================================
# I2C TAB
# =====================================================
i2c_frame = tk.Frame(notebook)
notebook.add(i2c_frame, text='I2C')

i2c_text = tk.Text(i2c_frame, height=10)
i2c_text.pack(fill=tk.BOTH, expand=True)

# =====================================================
# SCPI TAB
# =====================================================
scpi_frame = tk.Frame(notebook)
notebook.add(scpi_frame, text='SCPI')

scpi_entry = tk.Entry(scpi_frame)
scpi_entry.pack(fill=tk.X)

scpi_button = tk.Button(
    scpi_frame,
    text='Send',
    command=send_scpi
)

scpi_button.pack()

scpi_output = tk.Text(scpi_frame)
scpi_output.pack(fill=tk.BOTH, expand=True)

# =====================================================
# DEVICE TAB
# =====================================================
device_frame = tk.Frame(notebook)
notebook.add(device_frame, text='Devices')

device_text = tk.Text(device_frame)
device_text.pack(fill=tk.BOTH, expand=True)

# =====================================================
# THREADS
# =====================================================
threading.Thread(
    target=update_loop,
    daemon=True
).start()

threading.Thread(
    target=auto_reconnect,
    daemon=True
).start()

threading.Thread(
    target=start_webserver,
    daemon=True
).start()

# =====================================================
# START
# =====================================================
root.mainloop()