'use client';

import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { useDashboardStore } from '@/stores/dashboardStore';
import { Panel, HoloCorners, HoloIcon } from '@/components/holo';
import { getApiBaseUrl } from '@/lib/api';
import type { SensorNode } from '@shared/types';

/* =========================================================================
   DeskOS Sensor Hub + Module Manager (M5)

   Lists MQTT / sensor nodes with their latest readings and announced modules.
   ========================================================================= */

const READINGS: Record<string, { unit: string; label: string }> = {
  temperature: { unit: '°C', label: 'Temperatur' },
  humidity: { unit: '%', label: 'Luftfeuchte' },
  co2: { unit: 'ppm', label: 'CO₂' },
  light: { unit: 'lx', label: 'Licht' },
  noise: { unit: 'dB', label: 'Geräusch' },
};

const fmt = (v: unknown): string => (typeof v === 'number' ? `${Math.round(v * 10) / 10}` : String(v));

function NodeCard({ node, onCommand }: { node: SensorNode; onCommand: (id: string) => void }) {
  const d = node.device;
  const online = d.status === 'online';
  const readings = Object.entries(node.latest ?? {}).filter(([, v]) => typeof v === 'number');
  const hasLed = node.modules.some((m) => m.type === 'led');

  return (
    <Panel className="relative">
      <HoloCorners />
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={clsx('h-2.5 w-2.5 shrink-0 rounded-full', online ? 'bg-success shadow-glow-sm' : 'bg-danger')} />
          <div className="min-w-0">
            <h3 className="truncate font-mono text-base font-bold text-white">{d.name}</h3>
            <p className="holo-label">
              {d.type}
              {(d.metadata as any)?.fw ? ` · fw ${(d.metadata as any).fw}` : ''}
            </p>
          </div>
        </div>
        {hasLed && (
          <button
            type="button"
            onClick={() => onCommand(d.id)}
            className="rounded-none border border-accent/40 px-2.5 py-1 text-[10px] uppercase tracking-wider text-accent transition-colors hover:bg-accent/10"
          >
            LED-Test
          </button>
        )}
      </div>

      {/* Readings */}
      {readings.length === 0 ? (
        <p className="py-3 text-[11px] text-accent/40">Noch keine Messwerte…</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {readings.map(([key, value]) => {
            const meta = READINGS[key] ?? { unit: '', label: key };
            return (
              <div key={key} className="rounded-none border border-accent/15 bg-accent/[0.03] p-2.5">
                <div className="holo-label">{meta.label}</div>
                <div className="holo-value mt-0.5 text-lg">
                  {fmt(value)}
                  <span className="ml-1 text-[11px] text-accent/50">{meta.unit}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modules */}
      {node.modules.length > 0 && (
        <div className="mt-3 border-t border-accent/10 pt-2.5">
          <p className="holo-label mb-1.5">Module</p>
          <div className="flex flex-wrap gap-1">
            {node.modules.map((m) => (
              <span key={m.id} className="rounded-none border border-accent/20 bg-accent/5 px-2 py-0.5 font-mono text-[10px] text-accent/70">
                {m.id} · {m.type}
              </span>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

export function SensorView() {
  const setActiveView = useDashboardStore((s) => s.setActiveView);
  const [nodes, setNodes] = useState<SensorNode[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/sensors`);
      setNodes((await res.json()) as SensorNode[]);
    } catch (e) {
      console.error('Unable to load sensors:', e);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  const sendCommand = async (deviceId: string) => {
    try {
      await fetch(`${getApiBaseUrl()}/api/devices/${encodeURIComponent(deviceId)}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'led', color: [255, 0, 0] }),
      });
    } catch (e) {
      console.error('Command failed:', e);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setActiveView('dashboard')}
          className="flex items-center gap-1.5 rounded-none border border-accent/30 px-2.5 py-1.5 text-[11px] uppercase tracking-wider text-accent/80 transition-colors hover:border-accent hover:bg-accent/10"
        >
          <HoloIcon name="grid" className="h-4 w-4" /> Dashboard
        </button>
        <div className="flex items-center gap-2">
          <HoloIcon name="thermometer" className="h-5 w-5 text-accent" />
          <h2 className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent" style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}>
            Sensor Hub
          </h2>
        </div>
      </div>

      {nodes.length === 0 ? (
        <Panel>
          <p className="py-10 text-center text-[12px] text-accent/40">
            Keine Sensor-Nodes verbunden. Starte den Simulator:{' '}
            <code className="text-accent/70">npm run dev --workspace=apps/simulator</code>
          </p>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {nodes.map((node) => (
            <NodeCard key={node.device.id} node={node} onCommand={sendCommand} />
          ))}
        </div>
      )}
    </div>
  );
}
