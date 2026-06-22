'use client';

import { useDashboardStore } from '@/stores/dashboardStore';
import { useEffect, type MouseEvent } from 'react';
import clsx from 'clsx';
import { OverlayMenu } from '@/components/OverlayMenu';
import { OsziView } from '@/components/oszi/OsziView';
import { MonitorView } from '@/components/MonitorView';
import { Panel, HoloCorners, HoloIcon, StatBar, RadialGauge } from '@/components/holo';
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

export function DeviceDetailModal() {
  const selectedDevice = useDashboardStore((state) => state.selectedDevice);
  const selectDevice = useDashboardStore((state) => state.selectDevice);

  if (!selectedDevice) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={() => selectDevice(null)}
    >
      <div className="mx-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <Panel>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2
              className="truncate font-mono text-lg font-bold tracking-wider text-accent"
              style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}
            >
              {selectedDevice.name}
            </h2>
            <button
              type="button"
              className="text-accent/60 transition-colors hover:text-accent text-xl leading-none"
              onClick={() => selectDevice(null)}
              aria-label="Schließen"
            >
              ✕
            </button>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="holo-label">Typ</span>
              <span className="font-mono capitalize text-white/85">{selectedDevice.type}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="holo-label">Status</span>
              <StatusBadge status={selectedDevice.status} />
            </div>
            <div className="flex justify-between items-center">
              <span className="holo-label">Zuletzt gesehen</span>
              <span className="font-mono text-white/85">
                {new Date(selectedDevice.lastSeen).toLocaleString()}
              </span>
            </div>
            <div>
              <p className="holo-label mb-2">Fähigkeiten</p>
              <div className="flex flex-wrap gap-1">
                {selectedDevice.capabilities.map((cap: string) => (
                  <CapChip key={cap} label={cap} />
                ))}
              </div>
            </div>
          </div>
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
  return (
    <header className="border-b border-accent/20 bg-darker/40 py-6 backdrop-blur">
      <div className="container mx-auto flex items-center gap-3 px-4">
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
  } = useDashboardStore();

  useEffect(() => {
    connectWebSocket();
    return () => disconnectWebSocket();
  }, []);

  return (
    <main className="holo-grid-bg relative min-h-screen overflow-x-hidden bg-dark text-white">
      {/* Fixed scanline texture behind all content */}
      <div className="holo-scanlines pointer-events-none fixed inset-0 z-0" />

      {/* Content (the constant holo flicker lives here, not on the modal/overlay) */}
      <div className="animate-holo-flicker relative z-10">
        <Header />

        {activeView === 'oszi' && <OsziView />}

        {MONITOR_VIEWS.includes(activeView) && <MonitorView />}

        {activeView !== 'oszi' && !MONITOR_VIEWS.includes(activeView) && (
        <div className="container mx-auto px-4 py-8">
          {/* Connection Status */}
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

          {/* System Overview */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <div className="lg:col-span-2">
              <SystemMetricsWidget />
            </div>
            <div>
              <EventsWidget events={events} />
            </div>
          </div>

          {/* Metrics History Chart */}
          <div className="mb-8">
            <MetricsHistoryChart />
          </div>

          {/* Devices Section */}
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
        </div>
        )}
      </div>

      {/* Device Detail Modal */}
      <DeviceDetailModal />

      {/* Holographic overlay launcher (toggle with ` / F2 or the core button) */}
      <OverlayMenu />
    </main>
  );
}
