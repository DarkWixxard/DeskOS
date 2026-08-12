"""
Oszi-USB-Doctor -- Diagnose fuer die RIGOL/VISA-Anbindung.

Zeigt, welches VISA-Backend aktiv ist, welche Ressourcen gefunden werden, ob
pyusb + ein libusb-Backend verfuegbar sind, und gibt konkrete naechste Schritte
aus (vor allem fuer Windows). Steuert das Geraet NICHT.

Aufruf:  npm run oszi:doctor   (oder: python services/oszi/doctor.py)
"""

import platform


def main():
    print("=== DeskOS Oszi-Doctor ===")
    print(f"System: {platform.system()} {platform.machine()} / Python {platform.python_version()}")

    try:
        import pyvisa
    except Exception as exc:
        print(f"[FEHLER] pyvisa nicht importierbar: {exc}")
        print("  -> npm run setup:oszi")
        return

    print(f"pyvisa: {getattr(pyvisa, '__version__', '?')}")
    rm = None
    backend = "?"
    try:
        rm = pyvisa.ResourceManager()
        backend = str(rm.visalib)
        print(f"VISA-Backend: {backend}")
    except Exception as exc:
        print(f"[FEHLER] ResourceManager: {exc}")

    is_py_backend = "py" in backend.lower()

    has_pyusb = False
    try:
        import usb.core  # noqa: F401
        has_pyusb = True
        print("pyusb: OK")
    except Exception as exc:
        print(f"pyusb: FEHLT ({exc})")

    has_libusb = False
    if has_pyusb:
        try:
            import usb.backend.libusb1 as libusb1
            has_libusb = libusb1.get_backend() is not None
            print(f"libusb-Backend: {'OK' if has_libusb else 'nicht gefunden'}")
        except Exception as exc:
            print(f"libusb-Backend: FEHLT ({exc})")

    resources = ()
    if rm is not None:
        try:
            resources = rm.list_resources()
        except Exception as exc:
            print(f"[FEHLER] list_resources: {exc}")
    usb_res = [r for r in resources if "USB" in r.upper()]
    print(f"Ressourcen: {resources or '()'}")
    print(f"USB-Ressourcen: {usb_res or '()'}")
    rigol = [r for r in usb_res if "1AB1" in r.upper()]
    if rigol:
        print(f"RIGOL (VID 1AB1) erkannt: {rigol}")

    print("")
    print("--- Empfehlung ---")
    if usb_res:
        print("Eine USB-Ressource ist sichtbar. Meldet der Dienst trotzdem 'Kein Rigol',")
        print("pruefe *IDN? (Geraet eingeschaltet, richtiger USB-Anschluss/Kabel).")
        return
    if is_py_backend:
        if not has_pyusb or not has_libusb:
            print("pyvisa-py aktiv, aber pyusb/libusb fehlen -> USB unmoeglich.")
            print("  Fix:  npm run setup:oszi   (installiert pyusb + libusb-package)")
        else:
            print("pyvisa-py + pyusb/libusb vorhanden, aber kein USB-Geraet sichtbar.")
            if platform.system() == "Windows":
                print("  Windows: Der USB-Schnittstelle des Scopes mit *Zadig* den Treiber")
                print("  'WinUSB' (oder libusbK) zuweisen, dann erneut pruefen.")
                print("  Einfacher: Rigol UltraSigma bzw. NI-VISA installieren -> bringt")
                print("  VISA + TMC-Treiber mit, dann laeuft es ueber deren Backend.")
            else:
                print("  Linux: udev-Regel fuer Rigol (idVendor=1ab1) setzen und sicherstellen,")
                print("  dass der Kernel-usbtmc-Treiber die Schnittstelle nicht haelt.")
    else:
        print("Ein VISA-Backend (NI-VISA/UltraSigma) ist aktiv, aber kein USB-Geraet")
        print("sichtbar. Pruefe: Rigol-USB-Treiber installiert? Geraet an und erkannt?")
        print("Bitness von Python und VISA muss uebereinstimmen (beide 64-bit).")


if __name__ == "__main__":
    main()
