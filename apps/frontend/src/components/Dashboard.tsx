'use client';

import { useDashboardStore } from '@/stores/dashboardStore';
import { useEffect, type ComponentType, type MouseEvent } from 'react';
import dynamic from 'next/dynamic';
import clsx from 'clsx';
import { OverlayMenu } from '@/components/OverlayMenu';
import { OsziView } from '@/components/oszi/OsziView';
import { MonitorView } from '@/components/MonitorView';
import { LogView } from '@/components/LogView';
import { RgbView } from '@/components/RgbView';
import { AutomationsView } from '@/components/AutomationsView';
import { SensorView } from '@/components/SensorView';
import { PluginsView } from '@/components/PluginsView';
import { PluginWidgets } from '@/components/PluginWidgets';
// xterm greift auf window/document zu -> client-only laden (kein SSR).
const TerminalView = dynamic(() => import('@/components/TerminalView').then((m) => m.TerminalView), { ssr: false });
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
const FULL_VIEWS = [...MONITOR_VIEWS, 'oszi', 'logs', 'rgb', 'automations', 'sensors', 'plugins', 'status', 'display', 'terminal'];

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
  { id: 'plugins', label: 'Plugin-Widgets' },
  { id: 'devices', label: 'Geräte' },
];

// Module views the user can pull onto the dashboard from the Anzeige view. Each
// view is self-contained (brings its own container), so it renders as an extra
// dashboard section. Hidden by default — the user opts a module in.
export const EMBEDDABLE_MODULES: { id: string; label: string; Component: ComponentType }[] = [
  { id: 'sensors', label: 'Sensor Hub', Component: SensorView },
  { id: 'rgb', label: 'RGB / LED', Component: RgbView },
  { id: 'automations', label: 'Automations', Component: AutomationsView },
  { id: 'logs', label: 'Log Center', Component: LogView },
  { id: 'oszi', label: 'Oszi', Component: OsziView },
];

// Cyan field styling shared by the device search box and filter dropdown.
const holoField =
  'rounded-none border border-accent/30 bg-darker/60 px-3 py-1.5 text-sm text-white ' +
  'placeholder:text-accent/30 outline-none transition-colors focus:border-accent focus:shadow-glow-sm';

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
          <p className="holo-label mt-0.5">{device.type}</p>
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
                    <div className="holo-label mt-0.5">{device.type}</div>
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

// "Anzeige" view: a list of switches that show/hide each dashboard section.
// State lives in the store (persisted to localStorage), so choices survive reloads.
export function DashboardSettingsView() {
  const dashboardWidgets = useDashboardStore((state) => state.dashboardWidgets);
  const toggleDashboardWidget = useDashboardStore((state) => state.toggleDashboardWidget);
  const dashboardModules = useDashboardStore((state) => state.dashboardModules);
  const toggleDashboardModule = useDashboardStore((state) => state.toggleDashboardModule);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-4 flex items-center gap-2">
        <HoloIcon name="layers" className="h-5 w-5 text-accent" />
        <h2
          className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent"
          style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}
        >
          Dashboard-Anzeige
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Sichtbare Bereiche">
          <p className="mb-2 text-[11px] text-accent/50">
            Wähle, welche Bereiche auf dem Dashboard erscheinen. Die Auswahl wird lokal gespeichert.
          </p>
          <ul className="divide-y divide-accent/10">
            {DASHBOARD_WIDGETS.map((widget) => {
              const visible = dashboardWidgets[widget.id] !== false;
              return (
                <li key={widget.id} className="flex items-center justify-between py-2.5">
                  <span className="font-mono text-sm text-white/90">{widget.label}</span>
                  <HoloSwitch
                    checked={visible}
                    onChange={() => toggleDashboardWidget(widget.id)}
                    label={widget.label}
                  />
                </li>
              );
            })}
          </ul>
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
    </header>
  );
}

export function Dashboard() {
  const {
    devices,
    events,
    wsConnected,
    loading,
    connectWebSocket,
    disconnectWebSocket,
    deviceFilter,
    searchQuery,
    setDeviceFilter,
    setSearchQuery,
    activeView,
    dashboardWidgets,
    hydrateDashboardWidgets,
    dashboardModules,
    hydrateDashboardModules,
  } = useDashboardStore();

  // A section is visible unless it was explicitly switched off in the Anzeige view.
  const shows = (id: string) => dashboardWidgets[id] !== false;
  // Extra module views the user pulled onto the dashboard (opt-in, default off).
  const enabledModules = EMBEDDABLE_MODULES.filter((m) => dashboardModules[m.id] === true);

  useEffect(() => {
    connectWebSocket();
    return () => disconnectWebSocket();
  }, []);

  // Apply the saved section/module visibility after mount (avoids an SSR hydration mismatch).
  useEffect(() => {
    hydrateDashboardWidgets();
    hydrateDashboardModules();
  }, []);

  return (
    <main className="holo-grid-bg relative min-h-screen overflow-x-hidden bg-dark text-white">
      {/* Fixed scanline texture behind all content */}
      <div className="holo-scanlines pointer-events-none fixed inset-0 z-0" />

      {/* Content (the constant holo flicker lives here, not on the modal/overlay) */}
      <div className="animate-holo-flicker relative z-10">
        {shows('header') && <Header />}

        {activeView === 'oszi' && <OsziView />}

        {MONITOR_VIEWS.includes(activeView) && <MonitorView />}

        {activeView === 'logs' && <LogView />}

        {activeView === 'rgb' && <RgbView />}

        {activeView === 'automations' && <AutomationsView />}

        {activeView === 'sensors' && <SensorView />}

        {activeView === 'plugins' && <PluginsView />}

        {activeView === 'status' && <StatusLedView />}

        {activeView === 'display' && <DashboardSettingsView />}

        {activeView === 'terminal' && <TerminalView />}

        {!FULL_VIEWS.includes(activeView) && (
        <>
        <div className="container mx-auto px-4 py-8">
          {/* Connection Status */}
          {shows('backendLink') && (
            <div className="mb-6 flex items-center justify-between">
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
          )}

          {/* Layout / profile switcher */}
          {shows('layoutBar') && <LayoutBar />}

          {/* System Overview */}
          {(shows('metrics') || shows('events')) && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              {shows('metrics') && (
                <div className={shows('events') ? 'lg:col-span-2' : 'lg:col-span-3'}>
                  <SystemMetricsWidget />
                </div>
              )}
              {shows('events') && (
                <div className={shows('metrics') ? '' : 'lg:col-span-3'}>
                  <EventsWidget events={events} />
                </div>
              )}
            </div>
          )}

          {/* Module status overview (LEDs) */}
          {shows('moduleStatus') && (
            <div className="mb-6">
              <ModuleStatusPanel />
            </div>
          )}

          {/* Metrics History Chart */}
          {shows('history') && (
            <div className="mb-8">
              <MetricsHistoryChart />
            </div>
          )}

          {/* Enabled plugin widgets */}
          {shows('plugins') && <PluginWidgets />}

          {/* Devices Section */}
          {shows('devices') && (
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
                <option value="local">Local</option>
                <option value="remote">Remote</option>
                <option value="esp32">ESP32</option>
                <option value="sensor">Sensor</option>
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
          )}
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
