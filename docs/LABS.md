# Labs – experimentelle Funktionen

**Labs** ist der Hub für experimentelle / Beta-Funktionen von DeskOS – vergleichbar mit
„Google Labs" oder den `chrome://flags`. Erreichbar über die **Labs**-Kachel (🧪) im
Overlay-Menü (Seite *HARDWARE & CONTROL*).

Quelle: [`apps/frontend/src/components/LabsView.tsx`](../apps/frontend/src/components/LabsView.tsx)

---

## Idee

Nicht jede Funktion ist von Tag eins an fertig oder für jeden gedacht. Labs gibt solchen
Funktionen einen sichtbaren, klar als „experimentell" markierten Ort, an dem man sie
**einzeln per Schalter aktiviert** – ohne dass sie das Standard-Dashboard beeinflussen,
solange man sie nicht einschaltet.

- **Opt-in:** Jedes Experiment ist standardmäßig **AUS**.
- **Sofort wirksam:** Ein Umschalten greift ohne Reload.
- **Lokal gespeichert:** Die Auswahl liegt in `localStorage`
  (`deskos.labsFlags`) und überlebt Reloads – pro Browser/Gerät.
- **Reversibel:** „Zurücksetzen" schaltet alle Experimente wieder aus.

---

## Aktuelle Experimente

| Experiment | Reifegrad | Wirkung |
|------------|-----------|---------|
| **Ruhemodus** (`calm-mode`) | Beta | Schaltet das holografische Flackern und die Scanline-Textur ab – ruhigeres Bild, angenehm bei Bewegungsempfindlichkeit oder im Dauerbetrieb. |
| **Dashboard-Uhr** (`dashboard-clock`) | Experimentell | Blendet eine Live-Uhr mit Datum in die Kopfzeile des Dashboards ein (bisher nur im Overlay-Menü vorhanden). |
| **Kompaktmodus (7-Zoll)** (`compact-mode`) | Beta | Skaliert die gesamte Oberfläche dichter – ideal für kleine, fest montierte Touch-Panels (z. B. 7-Zoll-Displays, 800×480 / 1024×600). Erzwingt den kompakten Maßstab auf jedem Display; kleine Screens verdichten sich ohnehin automatisch (siehe [KIOSK.md](./KIOSK.md#7-zoll--kleine-touch-displays)). |

---

## Architektur

Labs ist bewusst **rein im Frontend** umgesetzt und lehnt sich an das bereits vorhandene
Sichtbarkeits-Muster von `dashboardWidgets` / `dashboardModules` an.

- **Store-Slice** in [`dashboardStore.ts`](../apps/frontend/src/stores/dashboardStore.ts):
  `labsFlags: Record<string, boolean>` plus `hydrateLabsFlags`, `toggleLabsFlag`,
  `resetLabsFlags`. Persistenz über denselben `localStorage`-Helfer wie die übrigen
  Sichtbarkeits-Maps (Schlüssel `deskos.labsFlags`).
- **Hook** `useLabsFlag('<id>')`: liest ein einzelnes Flag (Default `false`). Bis
  `hydrateLabsFlags()` nach dem Mount läuft, liefert er `false`, damit Server- und erstes
  Client-Rendering übereinstimmen (kein Hydration-Mismatch).
- **Katalog** `LABS_FEATURES` in `LabsView.tsx`: die Liste der Experimente (id, Label,
  Beschreibung, Icon, Reifegrad). Reihenfolge = Anzeigereihenfolge.

---

## Ein neues Experiment hinzufügen

1. **Flag-ID + Katalogeintrag** in `LabsView.tsx` ergänzen:

   ```ts
   export const LABS_MY_FEATURE = 'my-feature';

   export const LABS_FEATURES: LabsFeature[] = [
     // …
     {
       id: LABS_MY_FEATURE,
       label: 'Mein Feature',
       description: 'Was es tut und warum es experimentell ist.',
       icon: 'zap',
       stage: 'alpha', // 'alpha' | 'beta' | 'experimental'
     },
   ];
   ```

2. **An der Wirkungsstelle auslesen** und Verhalten daran koppeln:

   ```tsx
   import { useLabsFlag } from '@/stores/dashboardStore';
   import { LABS_MY_FEATURE } from '@/components/LabsView';

   const enabled = useLabsFlag(LABS_MY_FEATURE);
   // … enabled ? neuesVerhalten : bisherigesVerhalten
   ```

Das war's – der Schalter erscheint automatisch in der Labs-Ansicht, wird persistiert und ist
über „Zurücksetzen" abschaltbar.
