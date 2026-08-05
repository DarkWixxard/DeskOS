'use client';

import { useCallback, useEffect, useState } from 'react';
import { Panel, HoloIcon, StatusLed } from '@/components/holo';
import { getApiBaseUrl } from '@/lib/api';
import { readingMeta, fmt } from '@/lib/sensorReadings';
import type { SensorNode } from '@shared/types';

/* =========================================================================
   Umgebungssensor-Kachel (BME280)

   Zeigt die Live-Werte eines Umgebungssensor-Nodes (Temperatur, Luftfeuchte,
   Luftdruck) direkt auf dem Dashboard. Nutzt denselben /api/sensors-Endpunkt
   wie der Sensor Hub, pollt aber nur einen einzelnen Node: bevorzugt einen
   "bme280"-Node (per Name / nodeId), sonst den ersten Node mit Umgebungs-
   Messwerten. So erscheinen Werte aus Node-RED (siehe docs/node-red-bme280.md)
   sofort auf dem Dashboard.
   ========================================================================= */

// Bevorzugte Reihenfolge der angezeigten Messwerte (der BME280 liefert diese drei).
const PREFERRED = ['temperature', 'humidity', 'pressure'];

// Node-Auswahl: erst per Name/nodeId "bme280", sonst der erste Node, der
// Umgebungswerte (Luftdruck oder Temperatur) meldet.
function pickNode(nodes: SensorNode[]): SensorNode | null {
  const isBme = (n: SensorNode) => {
    const nodeId = String((n.device.metadata as Record<string, unknown> | undefined)?.nodeId ?? '');
    return /bme ?280/i.test(n.device.name) || /bme ?280/i.test(nodeId);
  };
  return (
    nodes.find(isBme) ??
    nodes.find(
      (n) => n.latest && (typeof n.latest.pressure === 'number' || typeof n.latest.temperature === 'number')
    ) ??
    null
  );
}

export function SensorWidget() {
  const [node, setNode] = useState<SensorNode | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/sensors`);
      const nodes = (await res.json()) as SensorNode[];
      setNode(pickNode(nodes));
    } catch (e) {
      console.error('Unable to load sensor widget:', e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  const latest = node?.latest ?? null;
  // Bevorzugte Messwerte zuerst, danach alle weiteren numerischen Keys.
  const keys = latest
    ? [
        ...PREFERRED.filter((k) => typeof latest[k] === 'number'),
        ...Object.keys(latest).filter((k) => !PREFERRED.includes(k) && typeof latest[k] === 'number'),
      ]
    : [];

  return (
    <Panel
      title="Umgebungssensor"
      className="flex h-full flex-col"
      badge={
        node ? (
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-accent/60">
            <StatusLed status={node.device.status} size={9} />
            {node.device.status === 'online' ? 'online' : 'offline'}
          </span>
        ) : undefined
      }
    >
      {!node ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
          <HoloIcon name="thermometer" className="h-6 w-6 text-accent/30" />
          <p className="text-[11px] text-accent/40">{loaded ? 'Kein Umgebungssensor verbunden.' : 'Lade…'}</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-3 flex items-center gap-2">
            <HoloIcon name="thermometer" className="h-4 w-4 shrink-0 text-accent/70" />
            <span className="truncate font-mono text-sm font-bold text-white">{node.device.name}</span>
          </div>

          {keys.length === 0 ? (
            <p className="py-6 text-center text-[11px] text-accent/40">Noch keine Messwerte…</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {keys.map((key) => {
                const meta = readingMeta(key);
                return (
                  <div key={key} className="rounded-none border border-accent/15 bg-accent/[0.03] p-2.5">
                    <div className="holo-label">{meta.label}</div>
                    <div className="holo-value mt-0.5 text-xl">
                      {fmt(latest![key])}
                      <span className="ml-1 text-[11px] text-accent/50">{meta.unit}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-auto pt-3">
            <span className="holo-label">BME280 · via MQTT / Node-RED</span>
          </div>
        </div>
      )}
    </Panel>
  );
}
