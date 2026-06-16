'use client';

import { useDashboardStore } from '@/stores/dashboardStore';
import { useEffect, type MouseEvent } from 'react';
import clsx from 'clsx';
import { OverlayMenu } from '@/components/OverlayMenu';
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

export function StatusBadge({ status }: { status: string }) {
  const statusClasses = {
    online: 'status-online bg-green-900/30',
    offline: 'status-offline bg-red-900/30',
    error: 'status-error bg-yellow-900/30',
  };

  return (
    <span
      className={clsx(
        'px-3 py-1 rounded-full text-sm font-semibold',
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
      className="widget cursor-pointer hover:border-accent"
      onClick={() => selectDevice(device)}
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="text-lg font-bold">{device.name}</h3>
          <p className="text-sm text-gray-400">{device.type}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={device.status} />
          <button
            type="button"
            className="text-xs text-red-400 hover:text-red-500"
            onClick={handleRemove}
          >
            Entfernen
          </button>
        </div>
      </div>
      <div className="text-sm text-gray-400">
        {device.capabilities.join(', ')}
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
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={() => selectDevice(null)}
    >
      <div
        className="widget max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="widget-title mb-0">{selectedDevice.name}</h2>
          <button
            type="button"
            className="text-gray-400 hover:text-white text-xl leading-none"
            onClick={() => selectDevice(null)}
          >
            ✕
          </button>
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Typ</span>
            <span className="capitalize">{selectedDevice.type}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Status</span>
            <StatusBadge status={selectedDevice.status} />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Zuletzt gesehen</span>
            <span className="text-gray-300">
              {new Date(selectedDevice.lastSeen).toLocaleString()}
            </span>
          </div>
          <div>
            <p className="text-gray-400 mb-2">Fähigkeiten</p>
            <div className="flex flex-wrap gap-1">
              {selectedDevice.capabilities.map((cap: string) => (
                <span
                  key={cap}
                  className="text-xs bg-accent/20 text-accent px-2 py-1 rounded"
                >
                  {cap}
                </span>
              ))}
            </div>
          </div>
        </div>
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

  return (
    <div className="widget">
      <h2 className="widget-title">System Metrics</h2>
      {systemMetrics && (
        <p className="text-xs text-gray-500 mb-3">
          {systemMetrics.hostname} · {systemMetrics.platform}
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-gray-400 text-sm">CPU</p>
          <p className="text-2xl font-bold text-accent">
            {systemMetrics ? `${Math.round(systemMetrics.cpu)}%` : 'N/A'}
          </p>
        </div>
        <div>
          <p className="text-gray-400 text-sm">RAM</p>
          <p className="text-2xl font-bold text-accent">
            {systemMetrics ? `${Math.round(systemMetrics.ram.percentage)}%` : 'N/A'}
          </p>
          {systemMetrics && (
            <p className="text-xs text-gray-500">
              {formatBytes(systemMetrics.ram.used)} / {formatBytes(systemMetrics.ram.total)}
            </p>
          )}
        </div>
        <div>
          <p className="text-gray-400 text-sm">DISK</p>
          <p className="text-2xl font-bold text-accent">
            {systemMetrics?.disk ? `${Math.round(systemMetrics.disk.percentage)}%` : 'N/A'}
          </p>
          {systemMetrics?.disk && (
            <p className="text-xs text-gray-500">
              {formatBytes(systemMetrics.disk.used)} / {formatBytes(systemMetrics.disk.total)}
            </p>
          )}
        </div>
        <div>
          <p className="text-gray-400 text-sm">UPTIME</p>
          <p className="text-2xl font-bold text-accent">
            {systemMetrics ? formatUptime(systemMetrics.uptime) : 'N/A'}
          </p>
        </div>
      </div>
    </div>
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
    <div className="widget max-h-64 overflow-y-auto">
      <h2 className="widget-title">Recent Events</h2>
      {recent.length === 0 ? (
        <p className="text-gray-500 text-sm">Keine Events vorhanden</p>
      ) : (
        <div className="space-y-2">
          {recent.map((event) => (
            <div
              key={event.id}
              className={clsx(
                'text-sm border-l-2 pl-3 py-1',
                PRIORITY_BORDER[event.priority] ?? 'border-accent'
              )}
            >
              <p className="text-gray-300">{event.type}</p>
              <p className="text-xs text-gray-500">
                {event.source && (
                  <span className="text-gray-600 mr-1">[{event.source}]</span>
                )}
                {new Date(event.timestamp).toLocaleTimeString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
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
    <div className="widget">
      <h2 className="widget-title">Metrics History</h2>
      {data.length < 2 ? (
        <p className="text-gray-500 text-sm text-center py-8">
          Sammle Daten…
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
            <XAxis
              dataKey="time"
              tick={{ fill: '#6b7280', fontSize: 10 }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: '#6b7280', fontSize: 10 }}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1a1a1a',
                border: '1px solid #374151',
                borderRadius: '6px',
                fontSize: '12px',
              }}
              formatter={(value: number, name: string) => [`${value}%`, name]}
            />
            <Legend
              wrapperStyle={{ fontSize: '12px', color: '#9ca3af' }}
            />
            <Line
              type="monotone"
              dataKey="CPU"
              stroke="#00d9ff"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="RAM"
              stroke="#00ff88"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export function Header() {
  return (
    <header className="bg-darker border-b border-gray-700 py-6">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-accent">DeskOS</h1>
        <p className="text-gray-400">Modular Monitoring & Control System</p>
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
  } = useDashboardStore();

  useEffect(() => {
    connectWebSocket();
    return () => disconnectWebSocket();
  }, []);

  return (
    <main className="min-h-screen bg-dark">
      <Header />

      <div className="container mx-auto px-4 py-8">
        {/* Connection Status */}
        <div className="mb-6 p-4 bg-darker border border-gray-700 rounded-lg">
          <div className="flex items-center gap-2">
            <div
              className={clsx(
                'w-3 h-3 rounded-full',
                wsConnected ? 'bg-green-500' : 'bg-red-500'
              )}
            />
            <span className="text-sm">
              {wsConnected ? 'Connected to Backend' : 'Disconnected from Backend'}
            </span>
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
          <h2 className="text-2xl font-bold text-accent mb-4">Devices</h2>
          <div className="mb-4 flex items-center gap-3">
            <input
              type="text"
              placeholder="Search devices..."
              className="input input-sm bg-darker"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <select
              value={deviceFilter}
              onChange={(e) => setDeviceFilter(e.target.value as any)}
              className="select select-sm bg-darker"
            >
              <option value="all">All types</option>
              <option value="local">Local</option>
              <option value="remote">Remote</option>
              <option value="esp32">ESP32</option>
              <option value="sensor">Sensor</option>
            </select>
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-400">Loading devices...</div>
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

      {/* Device Detail Modal */}
      <DeviceDetailModal />

      {/* Holographic overlay launcher (toggle with ` / F2 or the core button) */}
      <OverlayMenu />
    </main>
  );
}
