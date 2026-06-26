# Overlay-Menü & Tastatur-Befehle

Das **Overlay-Menü** (`OverlayMenu`) ist der holografische „mobiGlas"-Launcher von DeskOS:
ein Vollbild-Overlay, über das du alle Module erreichst (Monitor, RGB, Automationen,
Sensoren, Plugins, Logs …) – **ohne die Maus zu bewegen**.

Quelle: [`apps/frontend/src/components/OverlayMenu.tsx`](./apps/frontend/src/components/OverlayMenu.tsx)

---

## Menü öffnen / schließen

Es gibt mehrere Wege, das Menü zu öffnen:

| Befehl | Wirkung | Funktioniert wo |
|--------|---------|-----------------|
| **Strg + K** (Mac: **⌘ + K**) | Menü auf/zu | **empfohlen** – jede Tastatur, auch während du in einem Feld tippst |
| **`** (Backtick) | Menü auf/zu | überall außer in Eingabefeldern |
| **F2** | Menü auf/zu | überall außer in Eingabefeldern |
| **Core-Button** (unten rechts) | Menü öffnen | per Maus |
| **Esc** | Menü schließen | wenn offen |
| Klick auf den abgedunkelten Hintergrund | Menü schließen | per Maus |

> **Tipp:** **Strg + K** ist der zuverlässigste Befehl. Er ist der übliche
> „Befehl/Launcher"-Shortcut (wie in vielen Apps die Befehlspalette) und funktioniert
> unabhängig vom Tastatur-Layout.

---

## Navigation im offenen Menü

| Befehl | Wirkung |
|--------|---------|
| **E** oder **→** | eine Grid-Seite weiter |
| **Q** oder **←** | eine Grid-Seite zurück |
| Klick auf die Seitenpunkte (`1` / `2`) | direkt zu einer Seite springen |
| **Esc** | Menü schließen |

Das Menü hat aktuell zwei Seiten:

1. **SYSTEM** – Overview, Devices, System Monitor, Metrics, Log Center,
   Automations, Network, Storage, Terminal, Alerts, API Console, Settings
2. **HARDWARE & CONTROL** – Remote PCs, ESP32, Sensor Hub, RGB / LED, Displays,
   Audio, Power, Cameras, Security, Scenes, Plugins, Oszi, Labs

---

## Warum die `` ` ``-Taste auf deutschen Tastaturen nicht funktionierte

Ursprünglich ließ sich das Menü nur über `` ` `` (Backtick) oder **F2** öffnen.

Auf einer **deutschen Tastatur (QWERTZ)** ist `` ` `` allerdings eine **tote Taste**
(*dead key*): Sie wartet auf das nächste Zeichen, um z. B. `à` zu bilden, und liefert
im Browser **kein sauberes `keydown`-Event** mit dem Zeichen `` ` ``. Dadurch konnte der
Code den Tastendruck nicht erkennen – der dokumentierte Shortcut tat schlicht nichts.

**Web-basiert ist dabei kein Hindernis:** Tastatur-Shortcuts sind im Browser problemlos
möglich. Das Problem war allein die tote Taste.

### Der Fix

- **Strg / ⌘ + K** als layout-unabhängiger Befehl hinzugefügt (funktioniert auf jeder
  Tastatur, auch in Eingabefeldern).
- Zusätzlich reagiert der Code jetzt auf die **physische** Backtick-Taste über
  `e.code === 'Backquote'`, sodass die Taste auch auf Dead-Key-Layouts wie QWERTZ
  zum Umschalten genutzt werden kann.
- **F2** bleibt unverändert als zusätzliche Alternative.

---

## Technische Details

Die Tastatur-Logik sitzt in einem `keydown`-Listener auf `window`
(in `OverlayMenu.tsx`):

```ts
// Ctrl/Cmd + K — universal toggle. Works on every keyboard layout and
// even while typing in a field, so it is the reliable "open menu" command.
if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
  e.preventDefault();
  setOpen((o) => !o);
  return;
}

if (e.key === 'Escape') {
  if (open) setOpen(false);
  return;
}
if (typing) return; // keine Shortcuts, während in einem Feld getippt wird

// Backtick / F2. `e.code === 'Backquote'` matcht auch Layouts (z. B. QWERTZ),
// wo die physische Taste ein Dead-Key ist und kein '`' via e.key liefert.
if (e.key === '`' || e.code === 'Backquote' || e.key === 'F2') {
  e.preventDefault();
  setOpen((o) => !o);
  return;
}
```

Wichtige Punkte:

- **`Strg/⌘ + K`** wird *vor* der Tipp-Prüfung behandelt und funktioniert daher auch in
  Eingabefeldern. `e.preventDefault()` verhindert die Standard-Aktion des Browsers.
- **`` ` `` / F2** werden nur ausgewertet, wenn gerade **nicht** in einem
  `INPUT` / `TEXTAREA` / `SELECT` / `contentEditable`-Element getippt wird – damit du
  z. B. im Suchfeld weiterhin normal tippen kannst.
- Beim Öffnen wird das Hintergrund-Scrolling gesperrt (`document.body.style.overflow`).

---

## Eigenen Shortcut einstellen

Möchtest du eine andere Taste (z. B. die Leertaste, eine Funktionstaste oder eine
andere Kombination), passe den `keydown`-Handler in
[`apps/frontend/src/components/OverlayMenu.tsx`](./apps/frontend/src/components/OverlayMenu.tsx)
an. Beispiel – Menü zusätzlich mit **Strg + Leertaste** öffnen:

```ts
if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
  e.preventDefault();
  setOpen((o) => !o);
  return;
}
```

Wenn du den Hinweis im UI ändern möchtest, gibt es zwei Stellen in derselben Datei:

- den **Core-Button** unten rechts (`Menu · Ctrl K`)
- die **Hilfeleiste** am unteren Rand des offenen Menüs (`Ctrl K · F2 Toggle`)
