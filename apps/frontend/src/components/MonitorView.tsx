'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useDashboardStore, type MetricsSnapshot } from '@/stores/dashboardStore';
import { Panel, StatBar, RadialGauge, HoloIcon, HoloCorners } from '@/components/holo';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

/* =========================================================================
   DeskOS Monitoring Center (M1)

   One component, several entry points: the OverlayMenu tiles
   monitor/metrics/network/storage/processes all open this view focused on
   the matching section. Renders the rich SystemMetrics (CPU + temp, GPU,
   memory, network throughput, per-disk storage, top processes) for any
   device that reports metrics.
   ========================================================================= */

type Section = 'overview' | 'metrics' | 'network' | 'storage' | 'processes';

const SECTIONS: { id: Section; view: string; label: string; icon: string }[] = [
  { id: 'overview', view: 'monitor', label: 'Übersicht', icon: 'activity' },
  { id: 'metrics', view: 'metrics', label: 'Metrics', icon: 'chart' },
  { id: 'network', view: 'network', label: 'Netzwerk', icon: 'wifi' },
  { id: 'storage', view: 'storage', label: 'Speicher', icon: 'database' },
  { id: 'processes', view: 'processes', label: 'Prozesse', icon: 'list' },
];

const ACCENT = '#00d9ff';
const GREEN = '#00ff88';
const ORANGE = '#ffa500';
const PINK = '#ff4488';

/* ------------------------------ formatting ----------------------------- */
function fmtBytes(b?: number): string {
  if (b == null || !Number.isFinite(b)) return 'N/A';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
const fmtRate = (bps?: number): string => (bps == null ? 'N/A' : `${fmtBytes(bps)}/s`);
function fmtUptime(s?: number): string {
  if (s == null) return 'N/A';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}
const tempColor = (t?: number) => (t == null ? 'text-accent/50' : t >= 80 ? 'text-danger' : t >= 65 ? 'text-warning' : 'text-success');

/* ------------------------------ chart shell ---------------------------- */
const tooltipStyle = {
  backgroundColor: 'rgba(8,16,22,0.92)',
  border: '1px solid rgba(0,217,255,0.4)',
  borderRadius: '4px',
  fontSize: '12px',
  boxShadow: '0 0 16px rgba(0,217,255,0.25)',
};

interface SeriesDef {
  key: string;
  color: string;
}

function HoloLineChart({
  data,
  series,
  yMax,
  unit = '',
  height = 180,
}: {
  data: Record<string, number | string>[];
  series: SeriesDef[];
  yMax?: number;
  unit?: string;
  height?: number;
}) {
  if (data.length < 2) {
    return <p className="py-10 text-center text-[11px] text-accent/40">Sammle Daten…</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,217,255,0.12)" />
        <XAxis dataKey="time" tick={{ fill: 'rgba(0,217,255,0.5)', fontSize: 10 }} stroke="rgba(0,217,255,0.2)" interval="preserveStartEnd" />
        <YAxis
          domain={[0, yMax ?? 'auto']}
          tick={{ fill: 'rgba(0,217,255,0.5)', fontSize: 10 }}
          stroke="rgba(0,217,255,0.2)"
          tickFormatter={(v) => `${v}${unit}`}
          width={48}
        />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: ACCENT }} itemStyle={{ color: '#fff' }} formatter={(v: number, n: string) => [`${v}${unit}`, n]} />
        <Legend wrapperStyle={{ fontSize: '12px', color: 'rgba(0,217,255,0.7)' }} />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} dot={false} strokeWidth={2} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

const labelTime = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/* ------------------------------ sections ------------------------------- */
function OverviewSection({ m }: { m?: MetricsSnapshot }) {
  if (!m) return <Waiting />;
  const cpu = Math.round(m.cpu ?? 0);
  const ram = Math.round(m.ram?.percentage ?? 0);
  const gpus = m.gpus ?? [];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Panel title="CPU" badge={<span className="font-mono text-[10px] text-accent/60">{m.cpuModel ?? ''}</span>}>
        <div className="grid grid-cols-[150px_1fr] items-center gap-4">
          <RadialGauge value={cpu} label="Load" />
          <div className="grid grid-cols-1 gap-3">
            <StatBar label="Auslastung" value={`${cpu}%`} percent={cpu} />
            <div className="flex items-baseline justify-between">
              <span className="holo-label">Temperatur</span>
              <span className={clsx('holo-value text-sm', tempColor(m.cpuTempC))}>
                {m.cpuTempC != null ? `${m.cpuTempC} °C` : 'N/A'}
              </span>
            </div>
            <StatBar label="Kerne" value={m.cpuCores != null ? String(m.cpuCores) : 'N/A'} />
          </div>
        </div>
      </Panel>

      <Panel title="Arbeitsspeicher">
        <div className="grid grid-cols-[150px_1fr] items-center gap-4">
          <RadialGauge value={ram} label="RAM" />
          <div className="grid grid-cols-1 gap-3">
            <StatBar label="Belegt" value={`${ram}%`} percent={ram} />
            <StatBar label="Benutzt" value={fmtBytes(m.ram?.used)} />
            <StatBar label="Gesamt" value={fmtBytes(m.ram?.total)} />
          </div>
        </div>
      </Panel>

      <Panel title="System">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <StatBar label="Host" value={m.hostname ?? 'N/A'} />
          <StatBar label="Plattform" value={String(m.platform ?? 'N/A')} />
          <StatBar label="Uptime" value={fmtUptime(m.uptime)} />
          <StatBar label="Prozesse" value={m.processes?.count != null ? String(m.processes.count) : 'N/A'} />
          <StatBar label="Netz ↓" value={fmtRate(m.network?.rxSec)} />
          <StatBar label="Netz ↑" value={fmtRate(m.network?.txSec)} />
        </div>
      </Panel>

      <Panel title={`GPU${gpus.length > 1 ? `s (${gpus.length})` : ''}`} className="lg:col-span-2">
        {gpus.length === 0 ? (
          <p className="py-3 text-[11px] text-accent/40">Keine GPU erkannt</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {gpus.map((g, i) => (
              <div key={i} className="rounded-none border border-accent/15 bg-accent/[0.03] p-3">
                <p className="mb-2 truncate font-mono text-xs text-white/85">{g.model ?? g.vendor ?? `GPU ${i}`}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <StatBar label="Last" value={g.load != null ? `${Math.round(g.load)}%` : 'N/A'} percent={g.load} />
                  <div className="flex items-baseline justify-between">
                    <span className="holo-label">Temp</span>
                    <span className={clsx('holo-value text-sm', tempColor(g.tempC))}>{g.tempC != null ? `${g.tempC} °C` : 'N/A'}</span>
                  </div>
                  <StatBar
                    label="VRAM"
                    value={g.memTotal != null ? `${fmtBytes(g.memUsed)} / ${fmtBytes(g.memTotal)}` : 'N/A'}
                    percent={g.memUsed != null && g.memTotal ? (g.memUsed / g.memTotal) * 100 : undefined}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Speicher (primär)">
        {m.disk ? (
          <div className="grid grid-cols-1 gap-3">
            <StatBar label="Belegt" value={`${Math.round(m.disk.percentage)}%`} percent={m.disk.percentage} />
            <StatBar label="Frei" value={fmtBytes(m.disk.total - m.disk.used)} />
            <StatBar label="Gesamt" value={fmtBytes(m.disk.total)} />
          </div>
        ) : (
          <p className="py-3 text-[11px] text-accent/40">Keine Daten</p>
        )}
      </Panel>
    </div>
  );
}

function MetricsSection({ history }: { history: MetricsSnapshot[] }) {
  const hasGpu = history.some((h) => (h.gpus?.length ?? 0) > 0);
  const hasTemp = history.some((h) => h.cpuTempC != null || (h.gpus ?? []).some((g) => g.tempC != null));

  const loadData = useMemo(
    () =>
      history.map((m) => ({
        time: labelTime(m.timestamp),
        CPU: Math.round(m.cpu ?? 0),
        RAM: Math.round(m.ram?.percentage ?? 0),
        ...(hasGpu ? { GPU: Math.round(m.gpus?.[0]?.load ?? 0) } : {}),
      })),
    [history, hasGpu]
  );

  const tempData = useMemo(
    () =>
      history.map((m) => ({
        time: labelTime(m.timestamp),
        CPU: m.cpuTempC ?? 0,
        ...(history.some((h) => h.gpus?.[0]?.tempC != null) ? { GPU: m.gpus?.[0]?.tempC ?? 0 } : {}),
      })),
    [history]
  );

  return (
    <div className="grid grid-cols-1 gap-4">
      <Panel title="Auslastung (%)">
        <HoloLineChart
          data={loadData}
          yMax={100}
          unit="%"
          series={[
            { key: 'CPU', color: ACCENT },
            { key: 'RAM', color: GREEN },
            ...(hasGpu ? [{ key: 'GPU', color: ORANGE }] : []),
          ]}
        />
      </Panel>
      {hasTemp && (
        <Panel title="Temperatur (°C)">
          <HoloLineChart
            data={tempData}
            unit="°C"
            series={[
              { key: 'CPU', color: ORANGE },
              ...(history.some((h) => h.gpus?.[0]?.tempC != null) ? [{ key: 'GPU', color: PINK }] : []),
            ]}
          />
        </Panel>
      )}
    </div>
  );
}

function NetworkSection({ m, history }: { m?: MetricsSnapshot; history: MetricsSnapshot[] }) {
  const data = useMemo(
    () =>
      history.map((h) => ({
        time: labelTime(h.timestamp),
        Down: Math.round((h.network?.rxSec ?? 0) / 1024),
        Up: Math.round((h.network?.txSec ?? 0) / 1024),
      })),
    [history]
  );
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Panel title="Download">
          <div className="holo-value text-2xl text-accent">{fmtRate(m?.network?.rxSec)}</div>
          <div className="holo-label mt-1">{m?.network?.iface ?? '—'}</div>
        </Panel>
        <Panel title="Upload">
          <div className="holo-value text-2xl text-success">{fmtRate(m?.network?.txSec)}</div>
          <div className="holo-label mt-1">gesamt ↑ {fmtBytes(m?.network?.txBytes)}</div>
        </Panel>
      </div>
      <Panel title="Durchsatz (KB/s)">
        {data.length < 2 ? (
          <p className="py-10 text-center text-[11px] text-accent/40">Sammle Daten…</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="rx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="tx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GREEN} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,217,255,0.12)" />
              <XAxis dataKey="time" tick={{ fill: 'rgba(0,217,255,0.5)', fontSize: 10 }} stroke="rgba(0,217,255,0.2)" interval="preserveStartEnd" />
              <YAxis tick={{ fill: 'rgba(0,217,255,0.5)', fontSize: 10 }} stroke="rgba(0,217,255,0.2)" width={48} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: ACCENT }} itemStyle={{ color: '#fff' }} formatter={(v: number, n: string) => [`${v} KB/s`, n]} />
              <Legend wrapperStyle={{ fontSize: '12px', color: 'rgba(0,217,255,0.7)' }} />
              <Area type="monotone" dataKey="Down" stroke={ACCENT} fill="url(#rx)" strokeWidth={2} isAnimationActive={false} />
              <Area type="monotone" dataKey="Up" stroke={GREEN} fill="url(#tx)" strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Panel>
    </div>
  );
}

function StorageSection({ m }: { m?: MetricsSnapshot }) {
  const disks = m?.disks ?? (m?.disk ? [{ mount: '/', used: m.disk.used, total: m.disk.total, percentage: m.disk.percentage }] : []);
  if (disks.length === 0) return <Waiting />;
  return (
    <Panel title="Dateisysteme">
      <div className="grid grid-cols-1 gap-4">
        {disks.map((d, i) => (
          <div key={i} className="rounded-none border border-accent/15 bg-accent/[0.03] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="truncate font-mono text-xs text-white/85">{d.mount ?? d.fs ?? `disk ${i}`}</span>
              <span className="holo-label">{d.type ?? ''}</span>
            </div>
            <StatBar label={`${fmtBytes(d.used)} / ${fmtBytes(d.total)}`} value={`${Math.round(d.percentage)}%`} percent={d.percentage} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ProcessSection({ m }: { m?: MetricsSnapshot }) {
  const top = m?.processes?.top ?? [];
  if (top.length === 0) return <Waiting />;
  return (
    <Panel title={`Top-Prozesse${m?.processes?.count != null ? ` · ${m.processes.count} gesamt` : ''}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="holo-label border-b border-accent/20">
              <th className="py-1.5 pr-2 font-normal">Prozess</th>
              <th className="py-1.5 px-2 font-normal">PID</th>
              <th className="py-1.5 px-2 text-right font-normal">CPU</th>
              <th className="py-1.5 pl-2 text-right font-normal">Speicher</th>
            </tr>
          </thead>
          <tbody className="font-mono text-[12px]">
            {top.map((p) => (
              <tr key={p.pid} className="border-b border-accent/5">
                <td className="max-w-[220px] truncate py-1.5 pr-2 text-white/85">{p.name}</td>
                <td className="px-2 py-1.5 text-accent/50">{p.pid}</td>
                <td className="px-2 py-1.5 text-right text-accent">{p.cpu}%</td>
                <td className="py-1.5 pl-2 text-right text-white/70">{fmtBytes(p.memBytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Waiting() {
  return (
    <Panel>
      <p className="py-10 text-center text-[12px] text-accent/40">Warte auf Metriken…</p>
    </Panel>
  );
}

/* -------------------------------- main --------------------------------- */
export function MonitorView() {
  const devices = useDashboardStore((s) => s.devices);
  const metricsByDevice = useDashboardStore((s) => s.metricsByDevice);
  const historyByDevice = useDashboardStore((s) => s.historyByDevice);
  const localDeviceId = useDashboardStore((s) => s.localDeviceId);
  const activeView = useDashboardStore((s) => s.activeView);
  const setActiveView = useDashboardStore((s) => s.setActiveView);

  const section: Section = SECTIONS.find((s) => s.view === activeView)?.id ?? 'overview';

  // Devices that have reported metrics (fallback: all devices).
  const monitorable = useMemo(() => {
    const withMetrics = devices.filter((d) => metricsByDevice[d.id]);
    return withMetrics.length ? withMetrics : devices;
  }, [devices, metricsByDevice]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default selection: local device, else first monitorable device.
  useEffect(() => {
    if (selectedId && monitorable.some((d) => d.id === selectedId)) return;
    const preferred = (localDeviceId && monitorable.find((d) => d.id === localDeviceId)?.id) || monitorable[0]?.id || null;
    setSelectedId(preferred);
  }, [monitorable, localDeviceId, selectedId]);

  const m = selectedId ? metricsByDevice[selectedId] : undefined;
  const history = (selectedId ? historyByDevice[selectedId] : undefined) ?? [];
  const selectedDevice = devices.find((d) => d.id === selectedId);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header / controls */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveView('dashboard')}
            className="flex items-center gap-1.5 rounded-none border border-accent/30 px-2.5 py-1.5 text-[11px] uppercase tracking-wider text-accent/80 transition-colors hover:border-accent hover:bg-accent/10"
          >
            <HoloIcon name="grid" className="h-4 w-4" /> Dashboard
          </button>
          <div className="flex items-center gap-2">
            <HoloIcon name="activity" className="h-5 w-5 text-accent" />
            <h2 className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent" style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}>
              Monitoring
            </h2>
          </div>
        </div>

        {monitorable.length > 0 && (
          <select
            value={selectedId ?? ''}
            onChange={(e) => setSelectedId(e.target.value)}
            className="cursor-pointer rounded-none border border-accent/30 bg-darker/60 px-3 py-1.5 text-sm text-white outline-none transition-colors focus:border-accent focus:shadow-glow-sm"
          >
            {monitorable.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.id === localDeviceId ? ' (lokal)' : ''} · {d.status}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Section tabs */}
      <div className="mb-5 flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveView(s.view)}
            className={clsx(
              'flex items-center gap-1.5 rounded-none border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-all',
              section === s.id
                ? 'border-accent bg-accent/15 text-accent shadow-glow-sm'
                : 'border-accent/20 text-accent/50 hover:border-accent/50 hover:text-accent/80'
            )}
          >
            <HoloIcon name={s.icon} className="h-4 w-4" />
            {s.label}
          </button>
        ))}
      </div>

      {/* Selected device banner */}
      {selectedDevice && (
        <div className="relative mb-4 flex items-center justify-between rounded-none border border-accent/15 bg-accent/[0.03] px-4 py-2">
          <HoloCorners />
          <span className="font-mono text-sm text-white/85">{selectedDevice.name}</span>
          <span className="holo-label">
            {selectedDevice.type} · {m ? `aktualisiert ${labelTime(m.timestamp)}` : 'keine Metriken'}
          </span>
        </div>
      )}

      {/* Section content */}
      {!m && monitorable.length === 0 ? (
        <Waiting />
      ) : section === 'overview' ? (
        <OverviewSection m={m} />
      ) : section === 'metrics' ? (
        <MetricsSection history={history} />
      ) : section === 'network' ? (
        <NetworkSection m={m} history={history} />
      ) : section === 'storage' ? (
        <StorageSection m={m} />
      ) : (
        <ProcessSection m={m} />
      )}
    </div>
  );
}
