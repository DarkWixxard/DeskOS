'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  useDashboardStore,
  type DisplayPanel,
  type DisplaySource,
  type DisplayTransport,
} from '@/stores/dashboardStore';
import { Panel, HoloCorners, HoloIcon } from '@/components/holo';

/* =========================================================================
   DeskOS Displays – secondary info-panels / screens

   A "Display" is a small screen on the desk (ESP32/Pi TFT/OLED, e-ink or a
   browser tab) that DeskOS renders content onto. The backend renders the
   chosen source (clock / system / sensor / text) into a title + lines +
   accent color and pushes it to the panel; the same payload drives the live
   preview below. 'Virtual' panels are preview-only (no hardware needed).
   ========================================================================= */

const SOURCES: { id: DisplaySource; label: string; icon: string; hint: string }[] = [
  { id: 'clock', label: 'Uhr', icon: 'refresh', hint: 'Uhrzeit & Datum' },
  { id: 'system', label: 'System', icon: 'activity', hint: 'CPU / RAM / Temperatur' },
  { id: 'sensor', label: 'Sensor', icon: 'thermometer', hint: 'Letzter Sensor-Messwert' },
  { id: 'text', label: 'Text', icon: 'list', hint: 'Freier Text' },
  { id: 'blank', label: 'Aus', icon: 'power', hint: 'Leerer Screen' },
];

const TRANSPORTS: { id: DisplayTransport; label: string; hint: string }[] = [
  { id: 'virtual', label: 'Virtuell', hint: 'Nur Vorschau, keine Hardware' },
  { id: 'http', label: 'HTTP', hint: 'POST an eine IP/URL' },
  { id: 'mqtt', label: 'MQTT', hint: 'Kommando an einen ESP32-Node' },
];

const rgb = (c?: [number, number, number]) => (c ? `rgb(${c[0]},${c[1]},${c[2]})` : 'rgb(0,217,255)');

const field =
  'rounded-none border border-accent/30 bg-darker/60 px-3 py-1.5 text-sm text-white outline-none ' +
  'placeholder:text-accent/30 focus:border-accent focus:shadow-glow-sm';

/* ---------------------------- Screen preview --------------------------- */
// Renders the panel's current content as a little glowing screen. Brightness
// dims the whole screen; when the panel is off it goes dark.
function ScreenPreview({ panel }: { panel: DisplayPanel }) {
  const content = panel.content;
  const dark = !panel.on || panel.source === 'blank';
  const accent = rgb(content?.color);
  const brightness = Math.max(0.15, (panel.brightness ?? 80) / 100);

  return (
    <div
      className="relative flex aspect-[16/10] w-full flex-col items-center justify-center overflow-hidden rounded-sm border border-accent/25 bg-black p-3 text-center"
      style={{ boxShadow: dark ? 'none' : `inset 0 0 40px ${accent}22` }}
    >
      {/* faint scanlines to sell the "screen" look */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{ backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 3px)' }}
      />
      {dark ? (
        <span className="font-mono text-[10px] uppercase tracking-widest text-white/20">Screen aus</span>
      ) : (
        <div style={{ opacity: brightness }}>
          <div
            className="font-mono text-3xl font-bold leading-none"
            style={{ color: accent, textShadow: `0 0 14px ${accent}` }}
          >
            {content?.title || '—'}
          </div>
          {content?.lines?.map((line, i) => (
            <div key={i} className="mt-1.5 font-mono text-xs text-white/70">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Panel card ----------------------------- */
function DisplayCard({ panel }: { panel: DisplayPanel }) {
  const control = useDashboardStore((s) => s.controlDisplay);
  const update = useDashboardStore((s) => s.updateDisplay);
  const remove = useDashboardStore((s) => s.removeDisplay);
  const devices = useDashboardStore((s) => s.devices);

  const [bri, setBri] = useState(panel.brightness ?? 80);
  const [text, setText] = useState(panel.text ?? '');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(panel.name);
  const [editTarget, setEditTarget] = useState(panel.target);

  useEffect(() => setBri(panel.brightness ?? 80), [panel.brightness]);
  useEffect(() => setText(panel.text ?? ''), [panel.text]);

  // Sensor-capable devices to pick from when the source is 'sensor'.
  const sensorDevices = devices.filter((d) => d.type === 'sensor' || d.capabilities.includes('sensor'));

  const saveEdit = async () => {
    await update(panel.id, {
      name: editName.trim() || panel.name,
      target: editTarget.trim(),
    });
    setEditing(false);
  };

  return (
    <Panel className="relative">
      <HoloCorners />
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={clsx('h-2.5 w-2.5 shrink-0 rounded-full', panel.online ? 'bg-success shadow-glow-sm' : 'bg-danger')} />
          <div className="min-w-0">
            <h3 className="truncate font-mono text-base font-bold text-white">{panel.name}</h3>
            <p className="holo-label">
              {panel.transport}
              {panel.target ? ` · ${panel.target}` : ''}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => setEditing((e) => !e)} className="text-accent/50 transition-colors hover:text-accent" aria-label="Bearbeiten">
            <HoloIcon name="gear" className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => window.confirm(`${panel.name} entfernen?`) && remove(panel.id)}
            className="text-[10px] uppercase tracking-wider text-danger/70 transition-colors hover:text-danger"
          >
            Entfernen
          </button>
        </div>
      </div>

      {editing && (
        <div className="mb-3 space-y-2 rounded-none border border-accent/15 bg-accent/[0.03] p-2.5">
          <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name" className="w-full border border-accent/30 bg-darker/60 px-2 py-1 text-sm text-white outline-none focus:border-accent" />
          <select
            value={panel.transport}
            onChange={(e) => update(panel.id, { transport: e.target.value as DisplayTransport })}
            className="w-full cursor-pointer border border-accent/30 bg-darker/60 px-2 py-1 text-sm text-white outline-none focus:border-accent"
          >
            {TRANSPORTS.map((t) => (
              <option key={t.id} value={t.id}>{t.label} – {t.hint}</option>
            ))}
          </select>
          {panel.transport !== 'virtual' && (
            <input
              value={editTarget}
              onChange={(e) => setEditTarget(e.target.value)}
              placeholder={panel.transport === 'http' ? 'IP / URL (z. B. 192.168.178.60)' : 'Node-Id (z. B. panel-01)'}
              className="w-full border border-accent/30 bg-darker/60 px-2 py-1 text-sm text-white outline-none focus:border-accent"
            />
          )}
          <button type="button" onClick={saveEdit} className="border border-accent/40 px-2.5 py-1 text-[11px] uppercase tracking-wider text-accent hover:bg-accent/10">
            Speichern
          </button>
        </div>
      )}

      {/* Live preview */}
      <div className="mb-3">
        <ScreenPreview panel={panel} />
      </div>

      {/* Power + brightness */}
      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => control(panel.id, { on: !panel.on })}
          className={clsx(
            'flex items-center gap-1.5 border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-all',
            panel.on ? 'border-success bg-success/15 text-success' : 'border-accent/30 text-accent/60 hover:border-accent/60'
          )}
        >
          <HoloIcon name="power" className="h-4 w-4" />
          {panel.on ? 'An' : 'Aus'}
        </button>
        <div className="flex flex-1 items-center gap-2">
          <HoloIcon name="activity" className="h-4 w-4 shrink-0 text-accent/60" />
          <input
            type="range"
            min={0}
            max={100}
            value={bri}
            onChange={(e) => setBri(Number(e.target.value))}
            onMouseUp={(e) => control(panel.id, { brightness: Number((e.target as HTMLInputElement).value) })}
            onTouchEnd={(e) => control(panel.id, { brightness: Number((e.target as HTMLInputElement).value) })}
            className="h-1 w-full cursor-pointer appearance-none bg-accent/20 accent-accent"
            aria-label="Helligkeit"
          />
          <span className="w-9 text-right font-mono text-[11px] text-accent/70">{bri}%</span>
        </div>
      </div>

      {/* Source picker */}
      <div className="mb-2">
        <p className="holo-label mb-1.5">Inhalt</p>
        <div className="flex flex-wrap gap-2">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              title={s.hint}
              onClick={() => update(panel.id, { source: s.id })}
              className={clsx(
                'flex items-center gap-1 border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition-all',
                panel.source === s.id ? 'border-accent bg-accent/15 text-accent' : 'border-accent/20 text-accent/50 hover:border-accent/50 hover:text-accent/80'
              )}
            >
              <HoloIcon name={s.icon} className="h-3.5 w-3.5" />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Source-specific options */}
      {panel.source === 'text' && (
        <div className="mt-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => update(panel.id, { text })}
            rows={2}
            placeholder="Erste Zeile = Titel, weitere Zeilen darunter"
            className="w-full resize-none border border-accent/30 bg-darker/60 px-2 py-1.5 text-sm text-white outline-none focus:border-accent"
          />
        </div>
      )}
      {panel.source === 'sensor' && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <select
            value={panel.sensorDeviceId ?? ''}
            onChange={(e) => update(panel.id, { sensorDeviceId: e.target.value })}
            className="cursor-pointer border border-accent/30 bg-darker/60 px-2 py-1.5 text-sm text-white outline-none focus:border-accent"
          >
            <option value="">Sensor wählen…</option>
            {sensorDevices.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <input
            value={panel.sensorMetric ?? ''}
            onChange={(e) => update(panel.id, { sensorMetric: e.target.value })}
            placeholder="Feld (z. B. temperature)"
            className="border border-accent/30 bg-darker/60 px-2 py-1.5 text-sm text-white outline-none focus:border-accent"
          />
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------- View --------------------------------- */
export function DisplaysView() {
  const panels = useDashboardStore((s) => s.displayPanels);
  const fetchDisplays = useDashboardStore((s) => s.fetchDisplays);
  const addDisplay = useDashboardStore((s) => s.addDisplay);
  const setActiveView = useDashboardStore((s) => s.setActiveView);

  const [name, setName] = useState('');
  const [transport, setTransport] = useState<DisplayTransport>('virtual');
  const [target, setTarget] = useState('');
  const [source, setSource] = useState<DisplaySource>('clock');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchDisplays();
  }, [fetchDisplays]);

  const handleAdd = async () => {
    if (!name.trim()) return;
    setAdding(true);
    const ok = await addDisplay({ name: name.trim(), transport, target: target.trim(), source });
    setAdding(false);
    if (ok) {
      setName('');
      setTarget('');
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveView('dashboard')}
            className="flex items-center gap-1.5 border border-accent/30 px-2.5 py-1.5 text-[11px] uppercase tracking-wider text-accent/80 transition-colors hover:border-accent hover:bg-accent/10"
          >
            <HoloIcon name="grid" className="h-4 w-4" /> Dashboard
          </button>
          <div className="flex items-center gap-2">
            <HoloIcon name="monitor" className="h-5 w-5 text-accent" />
            <h2 className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent" style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}>
              Displays
            </h2>
          </div>
        </div>
      </div>

      {/* Add panel */}
      <Panel title="Display hinzufügen" className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (z. B. Desk-Panel)" className={clsx(field, 'flex-1 min-w-[160px]')} />
          <select value={transport} onChange={(e) => setTransport(e.target.value as DisplayTransport)} className={clsx(field, 'cursor-pointer')}>
            {TRANSPORTS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          {transport !== 'virtual' && (
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={transport === 'http' ? 'IP / URL' : 'Node-Id'}
              className={clsx(field, 'flex-1 min-w-[140px]')}
            />
          )}
          <select value={source} onChange={(e) => setSource(e.target.value as DisplaySource)} className={clsx(field, 'cursor-pointer')}>
            {SOURCES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleAdd}
            disabled={adding || !name.trim()}
            className="border border-accent/40 px-3 py-1.5 text-[11px] uppercase tracking-wider text-accent transition-colors hover:bg-accent/10 disabled:opacity-30"
          >
            {adding ? '…' : 'Hinzufügen'}
          </button>
        </div>
      </Panel>

      {panels.length === 0 ? (
        <Panel>
          <p className="py-10 text-center text-[12px] text-accent/40">Noch keine Displays konfiguriert.</p>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {panels.map((panel) => (
            <DisplayCard key={panel.id} panel={panel} />
          ))}
        </div>
      )}
    </div>
  );
}
