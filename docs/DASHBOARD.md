# Dashboard anpassen (Anzeige & freies Anordnen)

Das Dashboard ist **frei gestaltbar**: Kacheln lassen sich ein-/ausblenden, in der
Reihenfolge sortieren und per Drag & Drop in einem **2D-Raster** frei verschieben und
in der Größe ändern. Alle Einstellungen werden **lokal im Browser** (localStorage)
gespeichert und überleben Reloads.

Quellen:
[`Dashboard.tsx`](../apps/frontend/src/components/Dashboard.tsx),
[`DashboardGrid.tsx`](../apps/frontend/src/components/DashboardGrid.tsx),
[`dashboardStore.ts`](../apps/frontend/src/stores/dashboardStore.ts)

---

## Wo stelle ich das ein?

**Menüpunkt „Anzeige"** (Overlay-Menü → *Anzeige*, `activeView === 'display'`):

- **Bereiche & Reihenfolge** – je Kachel ein Sichtbarkeits-Schalter; am **Griff** (⣿)
  ziehst du die Reihenfolge. Ein Umsortieren ordnet die Kacheln in eine saubere,
  einspaltige Reihenfolge. Die **Kopfzeile** ist eine feste Leiste (nur ein/aus, nicht
  im Raster).
- **Anordnen-Modus** (Button) – springt aufs Dashboard und aktiviert das freie
  Verschieben/Größe-Ändern.
- **Zurücksetzen** – stellt Sichtbarkeit + Anordnung auf die Auslieferungswerte zurück.

**Direkt auf dem Dashboard** gibt es dieselbe Umschaltung über die Toolbar-Buttons
**„Anordnen"** ⇄ **„Fertig"**. Im Anordnen-Modus:

- Kachel am **Griff** (Kopfleiste) verschieben,
- an der **Ecke unten rechts** die Größe ziehen.

---

## Persistenz

localStorage-Keys (SSR-sicher, Muster wie `labsFlags`/`dashboardWidgets`):

| Key | Inhalt |
|-----|--------|
| `deskos.dashboardWidgets` | Sichtbarkeit je Bereich (`id → boolean`, fehlt = sichtbar) |
| `deskos.dashboardModules` | eingebettete Modul-Ansichten (`id → boolean`, fehlt = aus) |
| `deskos.dashboardLayout`  | freie 2D-Anordnung (Array `{ i, x, y, w, h }`) |

Der Anordnen-Modus selbst (`dashboardEditMode`) ist **transient** und wird bewusst
nicht gespeichert. Nach dem Mount lädt `Dashboard()` alle Maps via `hydrate*`-Actions
(vermeidet SSR-Hydration-Mismatch).

---

## Eine neue Kachel hinzufügen

1. Eintrag in **`DASHBOARD_WIDGETS`** ergänzen (`id` + `label`) – erzeugt Sichtbarkeits-
   Schalter und Zeile in der Reorder-Liste.
2. Default-Größe in **`DASHBOARD_WIDGET_DEFAULTS`** setzen (`w, h, minW?, minH?`, in
   12-Spalten-Einheiten).
3. In **`nodeFor(id)`** (in `Dashboard()`) die zu rendernde Komponente zurückgeben.

Das Grid selbst (`DashboardGrid`) ist generisch: es bekommt die sichtbaren Kacheln als
`{ id, label, node, defaultLayout }[]` und kümmert sich um Platzierung, Persistenz und
den Edit-Modus. Auf schmalen Screens (< 768 px) stapeln sich die Kacheln automatisch
einspaltig; editiert wird die Desktop-Anordnung.
