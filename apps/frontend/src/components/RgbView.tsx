'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useDashboardStore, type WledLight, type RgbMode } from '@/stores/dashboardStore';
import { Panel, HoloCorners, HoloIcon } from '@/components/holo';
import { getApiBaseUrl } from '@/lib/api';

/* =========================================================================
   DeskOS RGB Engine – WLED control (M3)
   ========================================================================= */

const MODES: { id: RgbMode; label: string; hint: string }[] = [
  { id: 'manual', label: 'Manuell', hint: 'Farbe & Effekt selbst setzen' },
  { id: 'temperature', label: 'Temperatur', hint: 'Farbe folgt CPU-Temperatur (grün→rot)' },
  { id: 'alarm', label: 'Alarm', hint: 'Rot bei kritischen Warnungen' },
];

// getDay() order: 0 = Sonntag .. 6 = Samstag.
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const toHex = (c?: [number, number, number]): string =>
  c ? '#' + c.map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('') : '#ffffff';

const fromHex = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) || 0,
  parseInt(hex.slice(3, 5), 16) || 0,
  parseInt(hex.slice(5, 7), 16) || 0,
];

function LightCard({ light }: { light: WledLight }) {
  const control = useDashboardStore((s) => s.controlWledLight);
  const setMode = useDashboardStore((s) => s.setWledMode);
  const removeLight = useDashboardStore((s) => s.removeWledLight);
  const updateLight = useDashboardStore((s) => s.updateWledLight);

  const [bri, setBri] = useState(light.state?.brightness ?? 50);
  const [effects, setEffects] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(light.name);
  const [editIp, setEditIp] = useState(light.ip);

  // Auto-off schedule (local mirror of light.offSchedule).
  const [offEnabled, setOffEnabled] = useState(light.offSchedule?.enabled ?? false);
  const [offTime, setOffTime] = useState(light.offSchedule?.time ?? '22:00');
  const [offDays, setOffDays] = useState<number[]>(light.offSchedule?.days ?? []);

  // Keep the brightness slider in sync with live state (unless mid-drag handled by onChange).
  useEffect(() => {
    setBri(light.state?.brightness ?? 50);
  }, [light.state?.brightness]);

  // Reflect schedule changes coming from the backend (other clients / restore).
  useEffect(() => {
    setOffEnabled(light.offSchedule?.enabled ?? false);
    if (light.offSchedule?.time) setOffTime(light.offSchedule.time);
    setOffDays(light.offSchedule?.days ?? []);
  }, [light.offSchedule?.enabled, light.offSchedule?.time, light.offSchedule?.days]);

  // Persist the schedule; empty days = jeden Tag.
  const saveSchedule = (next: { enabled?: boolean; time?: string; days?: number[] }) => {
    const enabled = next.enabled ?? offEnabled;
    const time = next.time ?? offTime;
    const days = next.days ?? offDays;
    setOffEnabled(enabled);
    setOffTime(time);
    setOffDays(days);
    updateLight(light.id, { offSchedule: { enabled, time, days: days.length ? days : undefined } });
  };

  const toggleDay = (idx: number) => {
    const current = offDays.length === 0 ? [...ALL_DAYS] : [...offDays];
    let nextDays = current.includes(idx) ? current.filter((d) => d !== idx) : [...current, idx].sort((a, b) => a - b);
    if (nextDays.length === 0) nextDays = [...ALL_DAYS]; // never leave an empty (= impossible) selection
    saveSchedule({ days: nextDays.length === ALL_DAYS.length ? [] : nextDays });
  };

  // Lazy-load the effect list once (best effort; empty when offline).
  useEffect(() => {
    let cancelled = false;
    fetch(`${getApiBaseUrl()}/api/wled/lights/${encodeURIComponent(light.id)}/effects`)
      .then((r) => r.json())
      .then((list) => !cancelled && Array.isArray(list) && setEffects(list))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [light.id]);

  const on = light.state?.on ?? false;
  const color = light.state?.color;

  const saveEdit = async () => {
    await updateLight(light.id, { name: editName.trim() || light.name, ip: editIp.trim() || light.ip });
    setEditing(false);
  };

  return (
    <Panel className="relative">
      <HoloCorners />
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={clsx('h-2.5 w-2.5 shrink-0 rounded-full', light.online ? 'bg-success shadow-glow-sm' : 'bg-danger')} />
          <div className="min-w-0">
            <h3 className="truncate font-mono text-base font-bold text-white">{light.name}</h3>
            <p className="holo-label">{light.ip}{light.ledCount ? ` · ${light.ledCount} LEDs` : ''}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => setEditing((e) => !e)} className="text-accent/50 transition-colors hover:text-accent" aria-label="Bearbeiten">
            <HoloIcon name="gear" className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => window.confirm(`${light.name} entfernen?`) && removeLight(light.id)}
            className="text-[10px] uppercase tracking-wider text-danger/70 transition-colors hover:text-danger"
          >
            Entfernen
          </button>
        </div>
      </div>

      {editing && (
        <div className="mb-3 space-y-2 rounded-none border border-accent/15 bg-accent/[0.03] p-2.5">
          <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name" className="w-full rounded-none border border-accent/30 bg-darker/60 px-2 py-1 text-sm text-white outline-none focus:border-accent" />
          <input value={editIp} onChange={(e) => setEditIp(e.target.value)} placeholder="IP-Adresse" className="w-full rounded-none border border-accent/30 bg-darker/60 px-2 py-1 text-sm text-white outline-none focus:border-accent" />
          <button type="button" onClick={saveEdit} className="rounded-none border border-accent/40 px-2.5 py-1 text-[11px] uppercase tracking-wider text-accent hover:bg-accent/10">
            Speichern
          </button>
        </div>
      )}

      {!light.online && <p className="mb-3 text-[11px] text-warning/80">Offline – Steuerung greift, sobald erreichbar.</p>}

      {/* Power + brightness */}
      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => control(light.id, { on: !on })}
          className={clsx(
            'flex items-center gap-1.5 rounded-none border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-all',
            on ? 'border-success bg-success/15 text-success' : 'border-accent/30 text-accent/60 hover:border-accent/60'
          )}
        >
          <HoloIcon name="power" className="h-4 w-4" />
          {on ? 'An' : 'Aus'}
        </button>
        <div className="flex flex-1 items-center gap-2">
          <HoloIcon name="bulb" className="h-4 w-4 shrink-0 text-accent/60" />
          <input
            type="range"
            min={0}
            max={100}
            value={bri}
            onChange={(e) => setBri(Number(e.target.value))}
            onMouseUp={(e) => control(light.id, { brightness: Number((e.target as HTMLInputElement).value) })}
            onTouchEnd={(e) => control(light.id, { brightness: Number((e.target as HTMLInputElement).value) })}
            className="h-1 w-full cursor-pointer appearance-none bg-accent/20 accent-accent"
          />
          <span className="w-9 text-right font-mono text-[11px] text-accent/70">{bri}%</span>
        </div>
      </div>

      {/* Color + effect */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <p className="holo-label mb-1">Farbe</p>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={toHex(color)}
              onChange={(e) => control(light.id, { color: fromHex(e.target.value) })}
              className="h-8 w-12 cursor-pointer rounded-none border border-accent/30 bg-transparent"
              aria-label="Farbe wählen"
            />
            <span className="font-mono text-[11px] text-accent/60">{toHex(color).toUpperCase()}</span>
          </div>
        </div>
        <div>
          <p className="holo-label mb-1">Effekt</p>
          <select
            value={light.state?.effect ?? 0}
            onChange={(e) => control(light.id, { effect: Number(e.target.value) })}
            className="w-full cursor-pointer rounded-none border border-accent/30 bg-darker/60 px-2 py-1.5 text-sm text-white outline-none focus:border-accent"
          >
            {effects.length > 0 ? (
              effects.map((name, i) => (
                <option key={i} value={i}>
                  {name}
                </option>
              ))
            ) : (
              <option value={light.state?.effect ?? 0}>{light.state?.effectName ?? 'Solid'}</option>
            )}
          </select>
        </div>
      </div>

      {/* Mode */}
      <div>
        <p className="holo-label mb-1.5">Modus</p>
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              title={m.hint}
              onClick={() => setMode(light.id, m.id)}
              className={clsx(
                'rounded-none border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition-all',
                light.mode === m.id ? 'border-accent bg-accent/15 text-accent' : 'border-accent/20 text-accent/50 hover:border-accent/50 hover:text-accent/80'
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Auto-off timer */}
      <div className="mt-3 border-t border-accent/10 pt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="holo-label">Auto-Aus (Zeitplan)</p>
          <button
            type="button"
            role="switch"
            aria-checked={offEnabled}
            onClick={() => saveSchedule({ enabled: !offEnabled })}
            className={clsx(
              'rounded-none border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors',
              offEnabled ? 'border-success/50 text-success' : 'border-accent/30 text-accent/40 hover:border-accent/60'
            )}
          >
            {offEnabled ? 'An' : 'Aus'}
          </button>
        </div>
        <div className={clsx('flex items-center gap-2 transition-opacity', !offEnabled && 'opacity-40')}>
          <span className="text-[11px] text-accent/60">Ausschalten um</span>
          <input
            type="time"
            value={offTime}
            disabled={!offEnabled}
            onChange={(e) => saveSchedule({ time: e.target.value })}
            className="rounded-none border border-accent/30 bg-darker/60 px-2 py-1 text-sm text-white outline-none focus:border-accent disabled:cursor-not-allowed"
            aria-label="Ausschaltzeit"
          />
        </div>
        <div className={clsx('mt-2 flex flex-wrap gap-1 transition-opacity', !offEnabled && 'opacity-40')}>
          {WEEKDAYS.map((label, idx) => {
            const active = offDays.length === 0 || offDays.includes(idx);
            return (
              <button
                key={idx}
                type="button"
                disabled={!offEnabled}
                onClick={() => toggleDay(idx)}
                title={offDays.length === 0 ? 'Jeden Tag' : undefined}
                className={clsx(
                  'w-7 rounded-none border py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-all disabled:cursor-not-allowed',
                  active ? 'border-accent bg-accent/15 text-accent' : 'border-accent/20 text-accent/40 hover:border-accent/50'
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

export function RgbView() {
  const lights = useDashboardStore((s) => s.wledLights);
  const fetchLights = useDashboardStore((s) => s.fetchWledLights);
  const addLight = useDashboardStore((s) => s.addWledLight);
  const setActiveView = useDashboardStore((s) => s.setActiveView);

  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchLights();
  }, [fetchLights]);

  const handleAdd = async () => {
    if (!name.trim() || !ip.trim()) return;
    setAdding(true);
    const ok = await addLight(name.trim(), ip.trim());
    setAdding(false);
    if (ok) {
      setName('');
      setIp('');
    }
  };

  const field = 'rounded-none border border-accent/30 bg-darker/60 px-3 py-1.5 text-sm text-white outline-none placeholder:text-accent/30 focus:border-accent focus:shadow-glow-sm';

  return (
    <div className="container mx-auto px-4 py-8">
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
            <HoloIcon name="bulb" className="h-5 w-5 text-accent" />
            <h2 className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent" style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}>
              RGB / WLED
            </h2>
          </div>
        </div>
      </div>

      {/* Add light */}
      <Panel title="Licht hinzufügen" className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (z. B. Schreibtisch)" className={clsx(field, 'flex-1 min-w-[160px]')} />
          <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="IP (z. B. 192.168.178.49)" className={clsx(field, 'flex-1 min-w-[160px]')} />
          <button
            type="button"
            onClick={handleAdd}
            disabled={adding || !name.trim() || !ip.trim()}
            className="rounded-none border border-accent/40 px-3 py-1.5 text-[11px] uppercase tracking-wider text-accent transition-colors hover:bg-accent/10 disabled:opacity-30"
          >
            {adding ? '…' : 'Hinzufügen'}
          </button>
        </div>
      </Panel>

      {lights.length === 0 ? (
        <Panel>
          <p className="py-10 text-center text-[12px] text-accent/40">Noch keine WLED-Lichter konfiguriert.</p>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {lights.map((light) => (
            <LightCard key={light.id} light={light} />
          ))}
        </div>
      )}
    </div>
  );
}
