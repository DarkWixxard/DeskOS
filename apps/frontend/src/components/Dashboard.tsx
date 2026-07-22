'use client';

import { useDashboardStore, useLabsFlag, type LayoutItem } from '@/stores/dashboardStore';
import { useEffect, useMemo, useState, type ComponentType, type MouseEvent } from 'react';
import dynamic from 'next/dynamic';
import clsx from 'clsx';
import { Reorder, useDragControls } from 'framer-motion';
import { DashboardGrid, type DashboardGridItem } from '@/components/DashboardGrid';
import { OverlayMenu } from '@/components/OverlayMenu';
import { OsziView } from '@/components/oszi/OsziView';
import { MonitorView } from '@/components/MonitorView';
import { LogView } from '@/components/LogView';
import { RgbView } from '@/components/RgbView';
import { SceneView } from '@/components/SceneView';
import { DisplaysView } from '@/components/DisplaysView';
import { DeejView } from '@/components/DeejView';
import { AutomationsView } from '@/components/AutomationsView';
import { SensorView } from '@/components/SensorView';
import { PluginsView } from '@/components/PluginsView';
import { PluginWidgets } from '@/components/PluginWidgets';
import { SpanishVocabWidget } from '@/components/SpanishVocabWidget';
// xterm greift auf window/document zu -> client-only laden (kein SSR).
const TerminalView = dynamic(() => import('@/components/TerminalView').then((m) => m.TerminalView), { ssr: false });
import { ApiConsoleView } from '@/components/ApiConsoleView';
import { DEVICE_TYPE_OPTIONS, deviceTypeLabel } from '@shared/types';
import { SettingsView } from '@/components/SettingsView';
import { SecurityView } from '@/components/SecurityView';
import { LabsView, LABS_CALM_MODE, LABS_DASHBOARD_CLOCK, LABS_COMPACT_MODE } from '@/components/LabsView';
import { LayoutBar } from '@/components/LayoutBar';
import { NotificationCenter } from '@/components/NotificationCenter';
import { DeviceDetail } from '@/components/DeviceDetail';
import { Panel, HoloCorners, HoloIcon, StatBar, RadialGauge, StatusLed, HoloSwitch } from '@/components/holo';
import { timeAgo } from '@/lib/time';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

// activeView values handled by the dedicated Monitoring Center (MonitorView).
const MONITOR_VIEWS = ['monitor', 'metrics', 'network', 'storage', 'processes'];
// All activeView values that replace the default dashboard with a full-page view.
const FULL_VIEWS = [...MONITOR_VIEWS, 'oszi', 'logs', 'rgb', 'scenes', 'displays', 'audio', 'automations', 'sensors', 'plugins', 'status', 'display', 'terminal', 'api', 'settings', 'security', 'labs'];

// Toggleable dashboard sections, shown as switches in the "Anzeige" view. The id
// is the key stored in dashboardWidgets; a missing id counts as visible.
export const DASHBOARD_WIDGETS: { id: string; label: string }[] = [
  { id: 'header', label: 'Kopfzeile (DESKOS / Glocke)' },
  { id: 'backendLink', label: 'Backend-Verbindung' },
  { id: 'layoutBar', label: 'Layout-Leiste' },
  { id: 'metrics', label: 'System-Metriken' },
  { id: 'events', label: 'Events' },
  { id: 'moduleStatus', label: 'Modul-Status (LEDs)' },
  { id: 'history', label: 'Metrics-Verlauf' },
  { id: 'spanishVocab', label: 'Spanisch-Vokabel' },
  { id: 'plugins', label: 'Plugin-Widgets' },
  { id: 'devices', label: 'Geräte' },
];

// Module views the user can pull onto the dashboard from the Anzeige view. Each
// view is self-contained (brings its own container), so it renders as an extra
// dashboard section. Hidden by default — the user opts a module in.
export const EMBEDDABLE_MODULES: { id: string; label: string; Component: ComponentType }[] = [
  { id: 'sensors', label: 'Sensor Hub', Component: SensorView },
  { id: 'rgb', label: 'RGB / LED', Component: RgbView },
  { id: 'scenes', label: 'Szenen', Component: SceneView },
  { id: 'displays', label: 'Displays', Component: DisplaysView },
  { id: 'audio', label: 'Audio (deej)', Component: DeejView },
  { id: 'automations', label: 'Automations', Component: AutomationsView },
  { id: 'logs', label: 'Log Center', Component: LogView },
  { id: 'oszi', label: 'Oszi', Component: OsziView },
];

// Cyan field styling shared by the device search box and filter dropdown.
const holoField =
  'rounded-none border border-accent/30 bg-darker/60 px-3 py-1.5 text-sm text-white ' +
  'placeholder:text-accent/30 outline-none transition-colors focus:border-accent focus:shadow-glow-sm';

// Secondary holo action button (matches LabsView/SettingsView).
const holoButton =
  'flex items-center gap-1.5 rounded-none border border-accent/30 px-3 py-1.5 font-mono ' +
  'text-[11px] uppercase tracking-wider text-accent/80 transition-colors ' +
  'hover:border-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40';

// Default size (12-col grid units) for each rearrangeable dashboard tile. Shared by
// the live grid (initial placement) and the "Anzeige" reorder list (single-column
// normalisation), so both agree on tile sizes. `header` is intentionally absent — it
// stays a fixed top bar, not a grid tile.
export const DASHBOARD_WIDGET_DEFAULTS: Record<
  string,
  { w: number; h: number; minW?: number; minH?: number }
> = {
  backendLink: { w: 12, h: 2, minH: 2 },
  layoutBar: { w: 12, h: 2, minH: 2 },
  metrics: { w: 8, h: 6, minW: 4, minH: 5 },
  events: { w: 4, h: 6, minW: 3, minH: 4 },
  moduleStatus: { w: 6, h: 7, minW: 4, minH: 4 },
  history: { w: 6, h: 7, minW: 4, minH: 4 },
  spanishVocab: { w: 4, h: 7, minW: 3, minH: 5 },
  plugins: { w: 12, h: 8, minW: 4, minH: 4 },
  devices: { w: 12, h: 10, minW: 4, minH: 6 },
};

// Canonical id/label list of the rearrangeable tiles (everything but the header).
const GRID_WIDGETS = DASHBOARD_WIDGETS.filter((w) => w.id !== 'header');

// Build a tidy single-column layout (each tile full width, stacked in the given
// order). Used when the user reorders the list in the "Anzeige" view.
function stackedLayout(orderIds: string[]): LayoutItem[] {
  let y = 0;
  return orderIds.map((id) => {
    const d = DASHBOARD_WIDGET_DEFAULTS[id] ?? { w: 12, h: 4 };
    const item: LayoutItem = { i: id, x: 0, y, w: 12, h: d.h, minW: d.minW, minH: d.minH };
    y += d.h;
    return item;
  });
}

// Reusable holo "chip" for capability tags.
function CapChip({ label }: { label: string }) {
  return (
    <span className="rounded-none border border-accent/20 bg-accent/5 px-2 py-0.5 font-mono text-[10px] text-accent/70">
      {label}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const statusClasses = {
    online: 'text-success ring-success/40 bg-success/10',
    offline: 'text-danger ring-danger/40 bg-danger/10',
    error: 'text-warning ring-warning/40 bg-warning/10',
  };

  return (
    <span
      className={clsx(
        'rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1',
        statusClasses[status as keyof typeof statusClasses]
      )}
    >
      {status.toUpperCase()}
    </span>
  );
}

export function DeviceCard({ device }: { device: any }) {
  const selectDevice = useDashboardStore((state) => state.selectDevice);
  const removeDevice = useDashboardStore((state) => state.removeDevice);

  const handleRemove = async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (window.confirm(`Gerät ${device.name} wirklich entfernen?`)) {
      const removed = await removeDevice(device.id);
      if (!removed) {
        window.alert('Gerät konnte nicht entfernt werden. Bitte überprüfe die Netzwerkverbindung.');
      }
    }
  };

  return (
    <div
      className="holo-tile group relative cursor-pointer p-4"
      onClick={() => selectDevice(device)}
    >
      <HoloCorners />
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-mono text-base font-bold text-white transition-colors group-hover:text-accent">
            {device.name}
          </h3>
          <p className="holo-label mt-0.5">{deviceTypeLabel(device.type)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={device.status} />
          <button
            type="button"
            className="text-[10px] uppercase tracking-wider text-danger/70 transition-colors hover:text-danger"
            onClick={handleRemove}
          >
            Entfernen
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {device.capabilities.map((cap: string) => (
          <CapChip key={cap} label={cap} />
        ))}
      </div>
    </div>
  );
}

// Small color-key shown in the Module-Status header (matches the sketch's legend).
function StatusLegend() {
  return (
    <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-accent/60">
      <span className="flex items-center gap-1.5">
        <StatusLed status="online" size={8} />
        Online
      </span>
      <span className="flex items-center gap-1.5">
        <StatusLed status="error" size={8} />
        Error
      </span>
      <span className="flex items-center gap-1.5">
        <StatusLed status="offline" size={8} />
        Offline
      </span>
    </div>
  );
}

// Consolidated "at a glance" overview: one panel listing every module/device as a
// row with a status LED, name, status text and how long ago it was last seen.
// Complements the individual DeviceCard tiles below. Reads `devices` straight from
// the store, so the LEDs update live as device:update events arrive over the socket.
export function ModuleStatusPanel({ title = 'Modul-Status' }: { title?: string }) {
  const devices = useDashboardStore((state) => state.devices);

  return (
    <Panel title={title} className="h-full" badge={<StatusLegend />}>
      {devices.length === 0 ? (
        <div className="py-8 text-center text-sm text-accent/40">Keine Module verbunden</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="holo-label text-left">
                <th className="w-8 py-1.5 pr-3 font-normal" aria-label="LED" />
                <th className="py-1.5 pr-3 font-normal">Modul</th>
                <th className="py-1.5 pr-3 font-normal">Status</th>
                <th className="py-1.5 text-right font-normal">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id} className="border-t border-accent/10">
                  <td className="py-2 pr-3">
                    <StatusLed status={device.status} />
                  </td>
                  <td className="py-2 pr-3">
                    <div className="truncate font-mono text-white">{device.name}</div>
                    <div className="holo-label mt-0.5">{deviceTypeLabel(device.type)}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <StatusBadge status={device.status} />
                  </td>
                  <td className="whitespace-nowrap py-2 text-right font-mono text-[11px] text-accent/60">
                    {timeAgo(device.lastSeen)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// Full-page version reached from the "Power / Status" overlay tile.
export function StatusLedView() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-4 flex items-center gap-2">
        <HoloIcon name="power" className="h-5 w-5 text-accent" />
        <h2
          className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent"
          style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}
        >
          Modul-Status
        </h2>
      </div>
      <ModuleStatusPanel title="Alle Module" />
    </div>
  );
}

// Backend-connection status as a stand-alone dashboard tile (reads the socket
// state straight from the store so it stays live).
export function BackendLinkWidget() {
  const wsConnected = useDashboardStore((state) => state.wsConnected);
  return (
    <div className="flex h-full items-center justify-between px-1">
      <span className="holo-label">Backend Link</span>
      <div
        className={clsx(
          'flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider ring-1 backdrop-blur',
          wsConnected
            ? 'bg-success/10 text-success ring-success/40'
            : 'bg-danger/10 text-danger ring-danger/40'
        )}
      >
        <span className={clsx('h-2 w-2 rounded-full', wsConnected ? 'bg-success' : 'bg-danger')} />
        {wsConnected ? 'Connected to Backend' : 'Disconnected from Backend'}
      </div>
    </div>
  );
}

// The Devices section (heading + search/filter + device grid) as a self-contained
// tile. Extracted from Dashboard() so it can live in the rearrangeable grid; reads
// everything it needs from the store.
export function DevicesWidget() {
  const devices = useDashboardStore((state) => state.devices);
  const loading = useDashboardStore((state) => state.loading);
  const deviceFilter = useDashboardStore((state) => state.deviceFilter);
  const searchQuery = useDashboardStore((state) => state.searchQuery);
  const setDeviceFilter = useDashboardStore((state) => state.setDeviceFilter);
  const setSearchQuery = useDashboardStore((state) => state.setSearchQuery);

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <HoloIcon name="cpu" className="h-5 w-5 text-accent" />
        <h2
          className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent"
          style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}
        >
          Devices
        </h2>
      </div>
      <div className="mb-4 flex items-center gap-3">
        <input
          type="text"
          placeholder="Search devices..."
          className={holoField}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <select
          value={deviceFilter}
          onChange={(e) => setDeviceFilter(e.target.value as any)}
          className={clsx(holoField, 'cursor-pointer')}
        >
          <option value="all">All types</option>
          {DEVICE_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-8 text-accent/50">Loading devices...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {devices
            .filter((d) => deviceFilter === 'all' || d.type === deviceFilter)
            .filter((d) =>
              searchQuery
                ? (d.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                  (d.metadata && JSON.stringify(d.metadata).toLowerCase().includes(searchQuery.toLowerCase()))
                : true
            )
            .map((device) => (
              <DeviceCard key={device.id} device={device} />
            ))}
        </div>
      )}
    </section>
  );
}

// Thin toolbar above the dashboard grid: enter/leave the "Anordnen" (arrange) mode
// and reset the saved layout. Lets the user start free drag & drop without a detour
// through the Anzeige menu.
function DashboardToolbar() {
  const editMode = useDashboardStore((state) => state.dashboardEditMode);
  const toggleEdit = useDashboardStore((state) => state.toggleDashboardEditMode);
  const resetLayout = useDashboardStore((state) => state.resetDashboardLayout);

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-h-[1.75rem] items-center">
        {editMode && (
          <span className="font-mono text-[11px] uppercase tracking-wider text-accent/60">
            Kacheln am Griff ziehen · Ecke unten rechts = Größe ändern
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {editMode && (
          <button type="button" onClick={() => resetLayout()} className={holoButton}>
            <HoloIcon name="refresh" className="h-4 w-4" />
            Layout zurücksetzen
          </button>
        )}
        <button
          type="button"
          onClick={() => toggleEdit()}
          className={clsx(
            holoButton,
            editMode && 'border-success/60 bg-success/10 text-success hover:border-success'
          )}
        >
          <HoloIcon name={editMode ? 'check' : 'grip'} className="h-4 w-4" />
          {editMode ? 'Fertig' : 'Anordnen'}
        </button>
      </div>
    </div>
  );
}

// One draggable row in the "Anzeige" reorder list. Drag is bound to the grip handle
// only (dragListener={false} + dragControls) so tapping the visibility switch never
// starts a drag.
function WidgetOrderRow({
  id,
  label,
  visible,
  onToggle,
}: {
  id: string;
  label: string;
  visible: boolean;
  onToggle: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      className="flex items-center justify-between gap-2 border border-accent/15 bg-darker/40 px-2 py-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onPointerDown={(e) => controls.start(e)}
          className="cursor-grab touch-none text-accent/40 transition-colors hover:text-accent"
          aria-label={`${label} verschieben`}
        >
          <HoloIcon name="grip" className="h-4 w-4" />
        </button>
        <span className="truncate font-mono text-sm text-white/90">{label}</span>
      </div>
      <HoloSwitch checked={visible} onChange={onToggle} label={label} />
    </Reorder.Item>
  );
}

// "Anzeige" view: show/hide each dashboard section, reorder the tiles, or jump into
// the free drag & drop arrange mode. State lives in the store (persisted to
// localStorage), so every choice survives reloads.
export function DashboardSettingsView() {
  const dashboardWidgets = useDashboardStore((state) => state.dashboardWidgets);
  const toggleDashboardWidget = useDashboardStore((state) => state.toggleDashboardWidget);
  const dashboardModules = useDashboardStore((state) => state.dashboardModules);
  const toggleDashboardModule = useDashboardStore((state) => state.toggleDashboardModule);
  const dashboardLayout = useDashboardStore((state) => state.dashboardLayout);
  const setDashboardLayout = useDashboardStore((state) => state.setDashboardLayout);
  const setDashboardEditMode = useDashboardStore((state) => state.setDashboardEditMode);
  const setActiveView = useDashboardStore((state) => state.setActiveView);
  const resetDashboardLayout = useDashboardStore((state) => state.resetDashboardLayout);

  const headerWidget = DASHBOARD_WIDGETS.find((w) => w.id === 'header');
  const headerVisible = dashboardWidgets['header'] !== false;

  // Tile order for the reorder list: follow the saved 2D positions (top-to-bottom,
  // then left-to-right); tiles without a saved slot keep their catalogue order.
  const orderIds = useMemo(() => {
    const ids = GRID_WIDGETS.map((w) => w.id);
    const placed = ids
      .filter((id) => dashboardLayout.some((l) => l.i === id))
      .sort((a, b) => {
        const la = dashboardLayout.find((l) => l.i === a)!;
        const lb = dashboardLayout.find((l) => l.i === b)!;
        return la.y - lb.y || la.x - lb.x;
      });
    const rest = ids.filter((id) => !placed.includes(id));
    return [...placed, ...rest];
  }, [dashboardLayout]);

  const labelFor = (id: string) => GRID_WIDGETS.find((w) => w.id === id)?.label ?? id;

  const startArrange = () => {
    setDashboardEditMode(true);
    setActiveView('dashboard');
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <HoloIcon name="layers" className="h-5 w-5 text-accent" />
          <h2
            className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent"
            style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}
          >
            Dashboard-Anzeige
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={startArrange} className={holoButton}>
            <HoloIcon name="grip" className="h-4 w-4" />
            Anordnen-Modus
          </button>
          <button type="button" onClick={() => resetDashboardLayout()} className={holoButton}>
            <HoloIcon name="refresh" className="h-4 w-4" />
            Zurücksetzen
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Bereiche & Reihenfolge">
          <p className="mb-3 text-[11px] text-accent/50">
            Schalter blenden Bereiche ein/aus. Am <span className="text-accent/80">Griff</span> ziehst du
            die Reihenfolge – das ordnet die Kacheln in einer sauberen Spalte. Für freies Verschieben
            &amp; Größe-Ändern den <span className="text-accent/80">Anordnen-Modus</span> starten.
          </p>

          {/* Header stays a fixed top bar (not a grid tile) — visibility only. */}
          <div className="mb-2 flex items-center justify-between gap-2 border border-dashed border-accent/15 bg-darker/30 px-2 py-2">
            <span className="truncate font-mono text-sm text-white/70">
              {headerWidget?.label ?? 'Kopfzeile'}
              <span className="ml-2 text-[10px] uppercase tracking-wider text-accent/40">feste Leiste</span>
            </span>
            <HoloSwitch
              checked={headerVisible}
              onChange={() => toggleDashboardWidget('header')}
              label={headerWidget?.label ?? 'Kopfzeile'}
            />
          </div>

          <Reorder.Group
            axis="y"
            values={orderIds}
            onReorder={(next) => setDashboardLayout(stackedLayout(next as string[]))}
            className="space-y-2"
          >
            {orderIds.map((id) => (
              <WidgetOrderRow
                key={id}
                id={id}
                label={labelFor(id)}
                visible={dashboardWidgets[id] !== false}
                onToggle={() => toggleDashboardWidget(id)}
              />
            ))}
          </Reorder.Group>
        </Panel>

        <Panel title="Module auf dem Dashboard">
          <p className="mb-2 text-[11px] text-accent/50">
            Hole einzelne Module direkt aufs Dashboard – ihr Inhalt erscheint dann als zusätzlicher
            Abschnitt. Die Module bleiben weiterhin auch über das Menü erreichbar.
          </p>
          <ul className="divide-y divide-accent/10">
            {EMBEDDABLE_MODULES.map((mod) => {
              const shown = dashboardModules[mod.id] === true;
              return (
                <li key={mod.id} className="flex items-center justify-between py-2.5">
                  <span className="font-mono text-sm text-white/90">{mod.label}</span>
                  <HoloSwitch
                    checked={shown}
                    onChange={() => toggleDashboardModule(mod.id)}
                    label={mod.label}
                  />
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

export function SystemMetricsWidget() {
  const systemMetrics = useDashboardStore((state) => state.systemMetrics);

  const formatUptime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatBytes = (bytes: number): string => {
    const gb = bytes / 1024 ** 3;
    return `${gb.toFixed(1)} GB`;
  };

  const cpu = systemMetrics ? Math.round(systemMetrics.cpu) : 0;
  const ram = systemMetrics ? Math.round(systemMetrics.ram.percentage) : 0;
  const disk = systemMetrics?.disk ? Math.round(systemMetrics.disk.percentage) : null;

  return (
    <Panel
      title="System Metrics"
      className="h-full"
      badge={
        systemMetrics ? (
          <span className="font-mono text-[10px] text-accent/60">
            {systemMetrics.hostname} · {systemMetrics.platform}
          </span>
        ) : null
      }
    >
      <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[150px_1fr]">
        <RadialGauge value={cpu} label="CPU Load" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <StatBar
            label="RAM"
            value={systemMetrics ? `${ram}%` : 'N/A'}
            percent={systemMetrics ? ram : undefined}
          />
          <StatBar
            label="Disk"
            value={disk != null ? `${disk}%` : 'N/A'}
            percent={disk ?? undefined}
          />
          <StatBar
            label="Uptime"
            value={systemMetrics ? formatUptime(systemMetrics.uptime) : 'N/A'}
          />
          <StatBar
            label="Memory"
            value={
              systemMetrics
                ? `${formatBytes(systemMetrics.ram.used)} / ${formatBytes(systemMetrics.ram.total)}`
                : 'N/A'
            }
          />
        </div>
      </div>
    </Panel>
  );
}

const PRIORITY_BORDER: Record<string, string> = {
  low: 'border-gray-500',
  normal: 'border-accent',
  high: 'border-warning',
  critical: 'border-danger',
};

export function EventsWidget({ events }: { events: any[] }) {
  const recent = events.slice(-10).reverse();

  return (
    <Panel
      title="Recent Events"
      className="flex h-full flex-col"
      badge={<span className="font-mono text-[10px] text-accent">{events.length} TOTAL</span>}
    >
      {recent.length === 0 ? (
        <p className="py-2 text-[11px] text-accent/40">Keine Events vorhanden</p>
      ) : (
        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {recent.map((event) => (
            <div
              key={event.id}
              className={clsx(
                'border-l-2 pl-3 py-1',
                PRIORITY_BORDER[event.priority] ?? 'border-accent/40'
              )}
            >
              <p className="truncate text-[11px] text-white/80">{event.type}</p>
              <p className="font-mono text-[10px] text-accent/50">
                {event.source && <span className="mr-1 text-accent/35">[{event.source}]</span>}
                {new Date(event.timestamp).toLocaleTimeString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function MetricsHistoryChart() {
  const metricsHistory = useDashboardStore((state) => state.metricsHistory);

  const data = metricsHistory.map((m) => ({
    time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    CPU: Math.round(m.cpu),
    RAM: Math.round(m.ram.percentage),
  }));

  return (
    <Panel title="Metrics History">
      {data.length < 2 ? (
        <p className="py-8 text-center text-[11px] text-accent/40">Sammle Daten…</p>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <filter id="holo-line-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,217,255,0.12)" />
            <XAxis
              dataKey="time"
              tick={{ fill: 'rgba(0,217,255,0.5)', fontSize: 10 }}
              stroke="rgba(0,217,255,0.2)"
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: 'rgba(0,217,255,0.5)', fontSize: 10 }}
              stroke="rgba(0,217,255,0.2)"
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(8,16,22,0.92)',
                border: '1px solid rgba(0,217,255,0.4)',
                borderRadius: '4px',
                fontSize: '12px',
                boxShadow: '0 0 16px rgba(0,217,255,0.25)',
              }}
              labelStyle={{ color: '#00d9ff' }}
              itemStyle={{ color: '#fff' }}
              cursor={{ stroke: 'rgba(0,217,255,0.3)' }}
              formatter={(value: number, name: string) => [`${value}%`, name]}
            />
            <Legend wrapperStyle={{ fontSize: '12px', color: 'rgba(0,217,255,0.7)' }} />
            <Line
              type="monotone"
              dataKey="CPU"
              stroke="#00d9ff"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
              filter="url(#holo-line-glow)"
            />
            <Line
              type="monotone"
              dataKey="RAM"
              stroke="#00ff88"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
              filter="url(#holo-line-glow)"
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

export function Header() {
  const unreadCount = useDashboardStore((state) => state.unreadCount);
  const setNotificationsOpen = useDashboardStore((state) => state.setNotificationsOpen);

  // Labs experiment: an optional live clock in the header. Time is set on mount
  // only (starts null) so the server and first client render match — no mismatch.
  const showClock = useLabsFlag(LABS_DASHBOARD_CLOCK);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    if (!showClock) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [showClock]);

  return (
    <header className="border-b border-accent/20 bg-darker/40 py-6 backdrop-blur">
      <div className="container mx-auto flex items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-3">
          <HoloIcon name="grid" className="h-7 w-7 text-accent" />
          <div>
            <h1
              className="font-mono text-3xl font-bold tracking-[0.3em] text-accent"
              style={{ textShadow: '0 0 14px rgba(0,217,255,0.6)' }}
            >
              DESK<span className="text-white/90">OS</span>
            </h1>
            <p className="holo-label mt-0.5">Modular Monitoring &amp; Control System</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {showClock && (
            <div className="hidden text-right sm:block">
              <div className="holo-value text-lg leading-none">
                {now
                  ? now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                  : '--:--:--'}
              </div>
              <div className="holo-label mt-1">
                {now ? now.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' }) : '--.--.----'}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setNotificationsOpen(true)}
            className="relative flex h-10 w-10 items-center justify-center rounded-none border border-accent/30 text-accent transition-colors hover:bg-accent/10"
            aria-label="Benachrichtigungen öffnen"
          >
            <HoloIcon name="bell" className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1 font-mono text-[10px] font-bold text-white shadow-glow-sm">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

export function Dashboard() {
  const {
    events,
    plugins,
    connectWebSocket,
    disconnectWebSocket,
    activeView,
    dashboardWidgets,
    hydrateDashboardWidgets,
    dashboardModules,
    hydrateDashboardModules,
    hydrateLabsFlags,
    hydrateDashboardLayout,
  } = useDashboardStore();

  // Labs experiment: the "Ruhemodus" flag drops the holo flicker + scanline motion.
  const calm = useLabsFlag(LABS_CALM_MODE);

  // Labs experiment: "Kompaktmodus (7-Zoll)" forces the compact density scale on
  // any display by tagging <html data-compact>. Small screens already compact
  // themselves via CSS media queries — this only adds the manual override.
  const compact = useLabsFlag(LABS_COMPACT_MODE);
  useEffect(() => {
    const root = document.documentElement;
    if (compact) root.setAttribute('data-compact', 'on');
    else root.removeAttribute('data-compact');
    return () => root.removeAttribute('data-compact');
  }, [compact]);

  // A section is visible unless it was explicitly switched off in the Anzeige view.
  const shows = (id: string) => dashboardWidgets[id] !== false;
  // Extra module views the user pulled onto the dashboard (opt-in, default off).
  const enabledModules = EMBEDDABLE_MODULES.filter((m) => dashboardModules[m.id] === true);

  // The rearrangeable dashboard tiles: every visible grid widget, wrapped for the
  // free 2D grid. The plugins tile is skipped when no plugin widget is active
  // (PluginWidgets renders nothing then — we don't want an empty tile taking space).
  const hasPluginWidgets = plugins.some((p) => p.enabled && p.hasWidget);
  const nodeFor = (id: string) => {
    switch (id) {
      case 'backendLink':
        return <BackendLinkWidget />;
      case 'layoutBar':
        return <LayoutBar />;
      case 'metrics':
        return <SystemMetricsWidget />;
      case 'events':
        return <EventsWidget events={events} />;
      case 'moduleStatus':
        return <ModuleStatusPanel />;
      case 'history':
        return <MetricsHistoryChart />;
      case 'spanishVocab':
        return <SpanishVocabWidget />;
      case 'plugins':
        return <PluginWidgets />;
      case 'devices':
        return <DevicesWidget />;
      default:
        return null;
    }
  };
  const gridItems: DashboardGridItem[] = GRID_WIDGETS.filter(
    (w) => shows(w.id) && (w.id !== 'plugins' || hasPluginWidgets)
  ).map((w) => ({
    id: w.id,
    label: w.label,
    node: nodeFor(w.id),
    defaultLayout: DASHBOARD_WIDGET_DEFAULTS[w.id] ?? { w: 12, h: 4 },
  }));

  useEffect(() => {
    connectWebSocket();
    return () => disconnectWebSocket();
  }, []);

  // Apply the saved section/module/labs/layout state after mount (avoids an SSR hydration mismatch).
  useEffect(() => {
    hydrateDashboardWidgets();
    hydrateDashboardModules();
    hydrateLabsFlags();
    hydrateDashboardLayout();
  }, []);

  return (
    <main className="holo-grid-bg relative min-h-screen overflow-x-hidden bg-dark text-white">
      {/* Fixed scanline texture behind all content (hidden in Labs "Ruhemodus") */}
      {!calm && <div className="holo-scanlines pointer-events-none fixed inset-0 z-0" />}

      {/* Content (the constant holo flicker lives here — off in Labs "Ruhemodus") */}
      <div className={clsx('relative z-10', !calm && 'animate-holo-flicker')}>
        {shows('header') && <Header />}

        {activeView === 'oszi' && <OsziView />}

        {MONITOR_VIEWS.includes(activeView) && <MonitorView />}

        {activeView === 'logs' && <LogView />}

        {activeView === 'rgb' && <RgbView />}

        {activeView === 'scenes' && <SceneView />}

        {activeView === 'displays' && <DisplaysView />}

        {activeView === 'audio' && <DeejView />}

        {activeView === 'automations' && <AutomationsView />}

        {activeView === 'sensors' && <SensorView />}

        {activeView === 'plugins' && <PluginsView />}

        {activeView === 'status' && <StatusLedView />}

        {activeView === 'display' && <DashboardSettingsView />}

        {activeView === 'terminal' && <TerminalView />}

        {activeView === 'api' && <ApiConsoleView />}

        {activeView === 'settings' && <SettingsView />}

        {activeView === 'security' && <SecurityView />}

        {activeView === 'labs' && <LabsView />}

        {!FULL_VIEWS.includes(activeView) && (
        <>
        <div className="container mx-auto px-4 py-8">
          {/* Arrange-mode toolbar + the free 2D grid of dashboard tiles */}
          <DashboardToolbar />
          <DashboardGrid items={gridItems} />
        </div>

        {/* Module views pulled onto the dashboard via the Anzeige view */}
        {enabledModules.map(({ id, Component }) => (
          <Component key={id} />
        ))}
        </>
        )}
      </div>

      {/* Device Detail (tabbed) */}
      <DeviceDetail />

      {/* Notification Center (right-hand slide-over) */}
      <NotificationCenter />

      {/* Holographic overlay launcher (toggle with Ctrl/Cmd+K, ` / F2 or the core button) */}
      <OverlayMenu />
    </main>
  );
}
