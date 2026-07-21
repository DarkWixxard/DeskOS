'use client';

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  useDashboardStore,
  type DeejSlider,
  type DeejTarget,
  type DeejNoiseReduction,
} from '@/stores/dashboardStore';
import { Panel, HoloCorners, HoloIcon, HoloSwitch } from '@/components/holo';

/* =========================================================================
   DeskOS Audio – deej hardware volume mixer

   Integrates the open-source "deej" project (https://github.com/omriharel/deej):
   an Arduino/ESP with a row of sliders that streams its positions over USB
   serial. The backend reads the serial line, normalises each slider to 0–100 %
   and applies it to the mapped target (master / mic / an app) via the OS. This
   view shows the sliders live, lets you map each one, and — even without the
   hardware connected — lets you drag or simulate them to control the volume.
   ========================================================================= */

const TARGETS: { id: DeejTarget; label: string; icon: string; hint: string }[] = [
  { id: 'master', label: 'Master', icon: 'speaker', hint: 'System-Gesamtlautstärke' },
  { id: 'mic', label: 'Mikrofon', icon: 'activity', hint: 'Standard-Eingabegerät' },
  { id: 'app', label: 'App', icon: 'plug', hint: 'Eine oder mehrere Apps (Gruppe)' },
  { id: 'current', label: 'Aktiv', icon: 'monitor', hint: 'Gerade aktive App (nur Windows)' },
  { id: 'system', label: 'System', icon: 'gear', hint: 'System-/Benachrichtigungston' },
  { id: 'unmapped', label: 'Frei', icon: 'power', hint: 'Nicht zugewiesen' },
];

const NOISE_OPTIONS: { id: DeejNoiseReduction; label: string }[] = [
  { id: 'low', label: 'Niedrig (reaktiv)' },
  { id: 'default', label: 'Standard' },
  { id: 'high', label: 'Hoch (ruhig)' },
];

const field =
  'rounded-none border border-accent/30 bg-darker/60 px-3 py-1.5 text-sm text-white outline-none ' +
  'placeholder:text-accent/30 focus:border-accent focus:shadow-glow-sm';

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/* ------------------------------ Vertical fader ------------------------------ */
// A themed, draggable/keyboard-accessible vertical fader (0 at the bottom, 100
// at the top). Reports a rounded 0–100 value on every move.
function Fader({ value, onChange, accent }: { value: number; onChange: (v: number) => void; accent: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const setFromClientY = (clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    onChange(Math.round(clamp(100 - ((clientY - rect.top) / rect.height) * 100)));
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => setFromClientY(e.clientY);
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(clamp(value + 2));
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(clamp(value - 2));
    else if (e.key === 'Home') onChange(100);
    else if (e.key === 'End') onChange(0);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        e.preventDefault();
        setDragging(true);
        setFromClientY(e.clientY);
      }}
      className="relative mx-auto h-44 w-9 cursor-pointer touch-none select-none rounded-sm border border-accent/25 bg-darker/70 outline-none focus:border-accent focus:shadow-glow-sm"
    >
      {/* center rail */}
      <div className="absolute inset-y-2 left-1/2 w-[3px] -translate-x-1/2 bg-accent/15" />
      {/* fill from the bottom */}
      <div
        className="absolute inset-x-0 bottom-0 rounded-b-sm"
        style={{ height: `${value}%`, background: `linear-gradient(to top, ${accent}55, ${accent}18)` }}
      />
      {/* knob */}
      <div
        className="absolute left-1/2 h-3 w-7 -translate-x-1/2 rounded-sm border"
        style={{
          bottom: `calc(${value}% - 6px)`,
          background: accent,
          borderColor: accent,
          boxShadow: `0 0 8px ${accent}`,
        }}
      />
    </div>
  );
}

/* ------------------------------- Slider card -------------------------------- */
function SliderCard({ slider }: { slider: DeejSlider }) {
  const setDeejVolume = useDashboardStore((s) => s.setDeejVolume);
  const updateDeejSlider = useDashboardStore((s) => s.updateDeejSlider);

  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(slider.label);
  const [apps, setApps] = useState((slider.apps ?? []).join(', '));

  useEffect(() => setLabel(slider.label), [slider.label]);
  useEffect(() => setApps((slider.apps ?? []).join(', ')), [slider.apps]);

  // Turn the comma-separated text field into a clean process-name list.
  const commitApps = () => {
    const list = apps.split(',').map((a) => a.trim()).filter(Boolean);
    if (JSON.stringify(list) !== JSON.stringify(slider.apps ?? [])) {
      updateDeejSlider(slider.index, { apps: list });
    }
  };

  const target = TARGETS.find((t) => t.id === slider.target) ?? TARGETS[4];
  // Colour the fader by role: mic = amber, unmapped = dim, everything else cyan.
  const accent = slider.muted
    ? '#6e8299'
    : slider.target === 'mic'
      ? '#ffa500'
      : slider.target === 'unmapped'
        ? '#3a5566'
        : '#00d9ff';

  return (
    <Panel className="relative flex flex-col items-center">
      <HoloCorners />

      {/* Header: label + mapping gear */}
      <div className="mb-2 flex w-full items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <HoloIcon name={target.icon} className="h-4 w-4 shrink-0 text-accent/70" />
          <span className="truncate font-mono text-sm font-bold text-white">{slider.label}</span>
        </div>
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className="shrink-0 text-accent/50 transition-colors hover:text-accent"
          aria-label="Zuordnung bearbeiten"
        >
          <HoloIcon name="gear" className="h-4 w-4" />
        </button>
      </div>

      {/* Live value */}
      <div className="mb-1 font-mono text-2xl font-bold" style={{ color: accent, textShadow: `0 0 12px ${accent}66` }}>
        {Math.round(slider.value)}
        <span className="text-sm text-accent/40">%</span>
      </div>

      {/* Fader */}
      <Fader value={slider.value} onChange={(v) => setDeejVolume(slider.index, v)} accent={accent} />

      {/* Target chip + mute */}
      <div className="mt-3 flex w-full items-center justify-between gap-2">
        <span className="holo-label truncate">
          {target.label}
          {slider.target === 'app' && slider.apps?.length ? ` · ${slider.apps.join(' + ')}` : ''}
        </span>
        <button
          type="button"
          onClick={() => updateDeejSlider(slider.index, { muted: !slider.muted })}
          className={clsx(
            'flex items-center gap-1 border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-all',
            slider.muted ? 'border-danger/60 bg-danger/15 text-danger' : 'border-accent/25 text-accent/60 hover:border-accent/60'
          )}
        >
          <HoloIcon name={slider.muted ? 'power' : 'speaker'} className="h-3 w-3" />
          {slider.muted ? 'Stumm' : 'An'}
        </button>
      </div>

      {/* Mapping editor */}
      {editing && (
        <div className="mt-3 w-full space-y-2 border-t border-accent/15 pt-3">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => label.trim() && label !== slider.label && updateDeejSlider(slider.index, { label })}
            placeholder="Name"
            className="w-full border border-accent/30 bg-darker/60 px-2 py-1 text-sm text-white outline-none focus:border-accent"
          />
          <div className="grid grid-cols-3 gap-1">
            {TARGETS.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.hint}
                onClick={() => updateDeejSlider(slider.index, { target: t.id })}
                className={clsx(
                  'flex flex-col items-center gap-0.5 border px-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-all',
                  slider.target === t.id ? 'border-accent bg-accent/15 text-accent' : 'border-accent/20 text-accent/50 hover:border-accent/50'
                )}
              >
                <HoloIcon name={t.icon} className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </div>
          {slider.target === 'app' && (
            <>
              <input
                value={apps}
                onChange={(e) => setApps(e.target.value)}
                onBlur={commitApps}
                placeholder="Prozessname(n), z. B. spotify.exe, chrome.exe"
                className="w-full border border-accent/30 bg-darker/60 px-2 py-1 text-sm text-white outline-none focus:border-accent"
              />
              <p className="text-[10px] text-accent/40">Mehrere durch Komma trennen = Gruppe.</p>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ---------------------------- Connection panel ------------------------------ */
function ConnectionPanel() {
  const status = useDashboardStore((s) => s.deejStatus);
  const connectDeej = useDashboardStore((s) => s.connectDeej);
  const disconnectDeej = useDashboardStore((s) => s.disconnectDeej);
  const updateDeejConfig = useDashboardStore((s) => s.updateDeejConfig);
  const fetchDeejPorts = useDashboardStore((s) => s.fetchDeejPorts);
  const simulateDeej = useDashboardStore((s) => s.simulateDeej);

  const [ports, setPorts] = useState<{ path: string; manufacturer?: string }[]>([]);
  const [port, setPort] = useState('');
  const [baud, setBaud] = useState(9600);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status) {
      setPort(status.port);
      setBaud(status.baud);
    }
  }, [status?.port, status?.baud]);

  const scanPorts = async () => {
    const list = await fetchDeejPorts();
    setPorts(list);
    if (!port && list[0]) setPort(list[0].path);
  };

  const handleConnect = async () => {
    setBusy(true);
    setError(null);
    if (port !== status?.port || baud !== status?.baud) {
      await updateDeejConfig({ port, baud });
    }
    const err = await connectDeej();
    setError(err);
    setBusy(false);
  };

  // A random line for the current slider count — lets you see the mixer move
  // and drive the OS volume without the hardware plugged in.
  const testLine = () => {
    const n = status?.sliders.length ?? 4;
    const line = Array.from({ length: n }, () => Math.floor(Math.random() * 1024)).join('|');
    simulateDeej(line);
  };

  const connected = status?.connected ?? false;

  return (
    <Panel title="Verbindung" className="mb-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]">
        <span className="flex items-center gap-2">
          <span className={clsx('h-2.5 w-2.5 rounded-full', connected ? 'bg-success shadow-glow-sm' : 'bg-danger')} />
          <span className="holo-label">{connected ? 'Verbunden' : 'Getrennt'}</span>
        </span>
        <span className="text-accent/60">
          Plattform: <span className="text-white/80">{status?.platform ?? '—'}</span>
        </span>
        <span className="text-accent/60">
          Pro-App-Lautstärke:{' '}
          <span className={status?.perAppSupported ? 'text-success' : 'text-warning'}>
            {status?.perAppSupported ? 'ja' : 'nur Master/Mic'}
          </span>
        </span>
      </div>

      {status?.audioBackend && (
        <p
          className={clsx(
            'mb-3 border px-3 py-2 font-mono text-[11px]',
            /FAIL|MISS|ERR|stderr|unavailable/.test(status.audioBackend)
              ? 'border-warning/30 bg-warning/5 text-warning/90'
              : 'border-accent/20 bg-accent/[0.03] text-accent/70'
          )}
          title="Diagnose des Betriebssystem-Audio-Backends"
        >
          Audio-Backend: {status.audioBackend}
          {/APP-MISS/.test(status.audioBackend) && (
            <span className="mt-1 block text-warning/70">
              → Kein passender Audio-Stream. Trage exakt den <b>Prozessnamen</b> ein (siehe „sessions:" oben),
              und die App muss gerade Ton ausgeben.
            </span>
          )}
        </p>
      )}

      {status && !status.available && (
        <p className="mb-3 border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-warning/90">
          Das optionale Paket <code className="text-warning">serialport</code> ist nicht installiert. Die Regler
          lassen sich testen &amp; simulieren (und steuern die Lautstärke), echte Hardware wird aber erst nach
          <code className="mx-1 text-warning">npm i serialport</code> im Backend erkannt.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="holo-label">Serieller Port</span>
          <input
            list="deej-ports"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="/dev/ttyUSB0 · COM3"
            className={clsx(field, 'min-w-[190px]')}
          />
          <datalist id="deej-ports">
            {ports.map((p) => (
              <option key={p.path} value={p.path}>
                {p.manufacturer ? `${p.path} – ${p.manufacturer}` : p.path}
              </option>
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1">
          <span className="holo-label">Baud</span>
          <input
            type="number"
            value={baud}
            onChange={(e) => setBaud(Number(e.target.value))}
            className={clsx(field, 'w-28')}
          />
        </label>
        <button type="button" onClick={scanPorts} className="border border-accent/30 px-3 py-1.5 text-[11px] uppercase tracking-wider text-accent/80 transition-colors hover:border-accent hover:bg-accent/10">
          Ports scannen
        </button>
        {connected ? (
          <button type="button" onClick={disconnectDeej} className="border border-danger/50 px-3 py-1.5 text-[11px] uppercase tracking-wider text-danger transition-colors hover:bg-danger/10">
            Trennen
          </button>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            disabled={busy || !port}
            className="border border-success/50 bg-success/10 px-3 py-1.5 text-[11px] uppercase tracking-wider text-success transition-colors hover:bg-success/20 disabled:opacity-30"
          >
            {busy ? '…' : 'Verbinden'}
          </button>
        )}
        <button type="button" onClick={testLine} className="border border-accent/30 px-3 py-1.5 text-[11px] uppercase tracking-wider text-accent/80 transition-colors hover:border-accent hover:bg-accent/10">
          <HoloIcon name="zap" className="mr-1 inline h-3.5 w-3.5" />
          Test
        </button>
      </div>

      {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}

      {/* Behaviour options */}
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-accent/15 pt-3">
        <label className="flex items-center gap-2">
          <HoloSwitch checked={status?.invert ?? false} onChange={(v) => updateDeejConfig({ invert: v })} label="Regler invertieren" />
          <span className="text-[12px] text-white/80">Regler invertieren</span>
        </label>
        <label className="flex items-center gap-2 text-[12px] text-white/80">
          Rauschunterdrückung
          <select
            value={status?.noiseReduction ?? 'default'}
            onChange={(e) => updateDeejConfig({ noiseReduction: e.target.value as DeejNoiseReduction })}
            className={clsx(field, 'cursor-pointer py-1')}
          >
            {NOISE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[12px] text-white/80">
          Regler
          <select
            value={status?.sliders.length ?? 4}
            onChange={(e) => updateDeejConfig({ sliderCount: Number(e.target.value) })}
            className={clsx(field, 'cursor-pointer py-1')}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
    </Panel>
  );
}

/* --------------------------------- View ------------------------------------ */
export function DeejView() {
  const status = useDashboardStore((s) => s.deejStatus);
  const fetchDeej = useDashboardStore((s) => s.fetchDeej);
  const reloadDeejConfig = useDashboardStore((s) => s.reloadDeejConfig);
  const setActiveView = useDashboardStore((s) => s.setActiveView);

  useEffect(() => {
    fetchDeej();
  }, [fetchDeej]);

  const sliders = status?.sliders ?? [];

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
            <HoloIcon name="speaker" className="h-5 w-5 text-accent" />
            <h2 className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent" style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}>
              Audio · deej
            </h2>
          </div>
        </div>
        <a
          href="https://github.com/omriharel/deej"
          target="_blank"
          rel="noreferrer"
          className="holo-label transition-colors hover:text-accent"
        >
          deej Volume Mixer
        </a>
      </div>

      {status?.configActive && status.configPath && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border border-accent/25 bg-accent/[0.04] px-3 py-2">
          <span className="text-[12px] text-accent/80">
            <HoloIcon name="list" className="mr-1.5 inline h-4 w-4" />
            <code className="text-accent">config.yaml</code> ist aktiv und maßgeblich:{' '}
            <span className="break-all text-white/70">{status.configPath}</span>
          </span>
          <button
            type="button"
            onClick={() => reloadDeejConfig()}
            className="flex items-center gap-1.5 border border-accent/30 px-2.5 py-1 text-[11px] uppercase tracking-wider text-accent/80 transition-colors hover:border-accent hover:bg-accent/10"
          >
            <HoloIcon name="refresh" className="h-3.5 w-3.5" /> Neu laden
          </button>
        </div>
      )}

      <ConnectionPanel />

      {sliders.length === 0 ? (
        <Panel>
          <p className="py-10 text-center text-[12px] text-accent/40">Keine Regler konfiguriert.</p>
        </Panel>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {sliders.map((slider) => (
            <SliderCard key={slider.index} slider={slider} />
          ))}
        </div>
      )}
    </div>
  );
}
