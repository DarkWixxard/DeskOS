'use client';

import { useDashboardStore } from '@/stores/dashboardStore';
import { useEffect, type MouseEvent } from 'react';
import clsx from 'clsx';

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

export function SystemMetricsWidget() {
  const systemMetrics = useDashboardStore((state) => state.systemMetrics);

  const formatUptime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  return (
    <div className="widget">
      <h2 className="widget-title">System Metrics</h2>
      <div className="grid grid-cols-3 gap-4">
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

export function EventsWidget({ events }: { events: any[] }) {
  return (
    <div className="widget max-h-64 overflow-y-auto">
      <h2 className="widget-title">Recent Events</h2>
      <div className="space-y-2">
        {events.slice(-10).reverse().map((event) => (
          <div key={event.id} className="text-sm border-l-2 border-accent pl-3 py-1">
            <p className="text-gray-300">{event.type}</p>
            <p className="text-xs text-gray-500">
              {new Date(event.timestamp).toLocaleTimeString()}
            </p>
          </div>
        ))}
      </div>
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
              {wsConnected
                ? 'Connected to Backend'
                : 'Disconnected from Backend'}
            </span>
          </div>
        </div>

        {/* System Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2">
            <SystemMetricsWidget />
          </div>
          <div>
            <EventsWidget events={events} />
          </div>
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

          {/* Filter devices by type and search query */}
          {loading ? (
            <div className="text-center py-8 text-gray-400">
              Loading devices...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {devices
                .filter((d) => deviceFilter === 'all' ? true : d.type === deviceFilter)
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
    </main>
  );
}
