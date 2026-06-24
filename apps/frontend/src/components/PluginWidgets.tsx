'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { useDashboardStore, type PluginInstance } from '@/stores/dashboardStore';
import { Panel, HoloIcon, StatBar } from '@/components/holo';

/* =========================================================================
   DeskOS plugin widgets (M6)

   Enabled plugins with a widget render here. Built-in functional plugins
   (clock, system-summary) show real content; external-service plugins show a
   "configure" placeholder until credentials are provided.
   ========================================================================= */

function ClockWidget() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <Panel title="Uhr">
      <div className="py-2 text-center">
        <div className="holo-value text-4xl tracking-wider">
          {now ? now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '--:--:--'}
        </div>
        <div className="holo-label mt-1">
          {now ? now.toLocaleDateString([], { weekday: 'long', day: '2-digit', month: 'long' }) : '—'}
        </div>
      </div>
    </Panel>
  );
}

function SystemSummaryWidget() {
  const m = useDashboardStore((s) => s.systemMetrics);
  const fmtRate = (b?: number) => (b == null ? 'N/A' : b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB/s` : `${Math.round((b ?? 0) / 1024)} KB/s`);
  return (
    <Panel title="System-Übersicht">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <StatBar label="CPU" value={m ? `${Math.round(m.cpu)}%` : 'N/A'} percent={m ? m.cpu : undefined} />
        <StatBar label="RAM" value={m ? `${Math.round(m.ram.percentage)}%` : 'N/A'} percent={m ? m.ram.percentage : undefined} />
        <StatBar label="Netz ↓" value={fmtRate(m?.network?.rxSec)} />
        <StatBar label="Netz ↑" value={fmtRate(m?.network?.txSec)} />
      </div>
    </Panel>
  );
}

function PlaceholderWidget({ plugin }: { plugin: PluginInstance }) {
  const setActiveView = useDashboardStore((s) => s.setActiveView);
  const configured = plugin.configured;
  return (
    <Panel title={plugin.name}>
      <div className="flex flex-col items-center gap-2 py-5 text-center">
        <HoloIcon name={plugin.icon} className="h-7 w-7 text-accent/50" />
        <p className="text-[12px] text-accent/55">{configured ? 'Verbinde…' : 'Konfiguration erforderlich'}</p>
        {!configured && (
          <button
            type="button"
            onClick={() => setActiveView('plugins')}
            className="rounded-none border border-accent/40 px-2.5 py-1 text-[10px] uppercase tracking-wider text-accent hover:bg-accent/10"
          >
            Einrichten
          </button>
        )}
      </div>
    </Panel>
  );
}

const BUILTIN_WIDGETS: Record<string, ComponentType> = {
  clock: ClockWidget,
  'system-summary': SystemSummaryWidget,
};

export function PluginWidgets() {
  const plugins = useDashboardStore((s) => s.plugins);
  const active = plugins.filter((p) => p.enabled && p.hasWidget);
  if (active.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="mb-4 flex items-center gap-2">
        <HoloIcon name="plug" className="h-5 w-5 text-accent" />
        <h2 className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent" style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}>
          Plugins
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {active.map((p) => {
          const Widget = BUILTIN_WIDGETS[p.id];
          return Widget ? <Widget key={p.id} /> : <PlaceholderWidget key={p.id} plugin={p} />;
        })}
      </div>
    </section>
  );
}
