'use client';

import { useDashboardStore } from '@/stores/dashboardStore';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Panel, HoloIcon, HoloCorners } from '@/components/holo';
import { WaveformCanvas } from '@/components/oszi/WaveformCanvas';
import {
  getStatus,
  getWaveform,
  sendCommand,
  sendScpi,
  setTarget,
  openResource,
  type OsziStatus,
} from '@/lib/oszi';

/* =========================================================================
   OsziView — native "Oszi"-Ansicht in DeskOS mit eigenem Untermenue.
   Bindet den Python/Flask-Oszi-Dienst ueber den Backend-Proxy /api/oszi/* an.
   ========================================================================= */

type Section = 'live' | 'console' | 'export';

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'live', label: 'Live', icon: 'chart' },
  { id: 'console', label: 'Konsole', icon: 'terminal' },
  { id: 'export', label: 'Export', icon: 'database' },
];

/* ------------------------------ kleine Bausteine ----------------------- */
function OsziButton({
  children,
  onClick,
  tone = 'default',
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: 'default' | 'go' | 'stop' | 'warn';
  className?: string;
}) {
  const tones: Record<string, string> = {
    default: 'border-accent/30 text-accent hover:border-accent hover:bg-accent/10',
    go: 'border-success/40 text-success hover:border-success hover:bg-success/10',
    stop: 'border-danger/40 text-danger hover:border-danger hover:bg-danger/10',
    warn: 'border-warning/40 text-warning hover:border-warning hover:bg-warning/10',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded-none border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors',
        tones[tone],
        className
      )}
    >
      {children}
    </button>
  );
}

function MeasureCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="holo-tile relative p-4">
      <HoloCorners />
      <div className="holo-label">{label}</div>
      <div className="mt-1 break-all font-mono text-2xl font-bold" style={{ color: accent }}>
        {value}
      </div>
    </div>
  );
}

/* ============================== Hauptansicht =========================== */
export function OsziView() {
  const setActiveView = useDashboardStore((s) => s.setActiveView);

  const [section, setSection] = useState<Section>('live');
  const [status, setStatus] = useState<OsziStatus | null>(null);
  const [reachable, setReachable] = useState(true);
  const [samples, setSamples] = useState<number[]>([]);

  // SCPI-Konsole
  const [scpiCmd, setScpiCmd] = useState('');
  const [scpiResult, setScpiResult] = useState('Bereit.');
  const [scpiError, setScpiError] = useState(false);
  const [scpiHistory, setScpiHistory] = useState<string[]>([]);
  const [trigger, setTrigger] = useState<'CHAN1' | 'CHAN2'>('CHAN1');

  // Steuerung (Live-Tab)
  const [cmdMsg, setCmdMsg] = useState<string | null>(null);

  // Export
  const [scanResult, setScanResult] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Status-Polling (alle 2 s)
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const s = await getStatus();
        if (active && mounted.current) {
          setStatus(s);
          setReachable(true);
          if (s.trigger === 'CHAN1' || s.trigger === 'CHAN2') setTrigger(s.trigger);
        }
      } catch {
        if (active && mounted.current) setReachable(false);
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // Wellenform-Polling (alle 500 ms, nur im Live-Tab)
  useEffect(() => {
    if (section !== 'live') return;
    let active = true;
    const tick = async () => {
      try {
        const w = await getWaveform();
        if (active && mounted.current) setSamples(w);
      } catch {
        /* still im naechsten Tick erneut versuchen */
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [section]);

  const connected =
    !!status && (status.demo === true || status.status.toLowerCase().includes('verbunden'));

  const handleScpi = async () => {
    const cmd = scpiCmd.trim();
    if (!cmd) return;
    setScpiResult('Sende…');
    setScpiError(false);
    try {
      const data = await sendScpi(cmd);
      if (data.error) {
        setScpiError(true);
        setScpiResult('Fehler: ' + data.error);
      } else {
        setScpiResult(data.result || '(keine Antwort)');
      }
      setScpiHistory((h) => [cmd, ...h.filter((c) => c !== cmd)].slice(0, 5));
    } catch {
      setScpiError(true);
      setScpiResult('Netzwerkfehler beim Senden des Befehls.');
    }
  };

  // Fire-and-forget Steuerbefehle (Verbinden/Start/Stop/Autoscale).
  // Wichtig: Fehler (z. B. HTTP 502, wenn der Oszi-Dienst offline ist) hier
  // abfangen, sonst wird die abgelehnte Promise zu einem "Unhandled Runtime
  // Error" und legt die Ansicht lahm.
  const runCommand = async (path: string, label: string) => {
    try {
      await sendCommand(path);
      setReachable(true);
      setCmdMsg(`${label}: OK`);
    } catch {
      setReachable(false);
      setCmdMsg(`${label} fehlgeschlagen — Oszi-Dienst nicht erreichbar.`);
    }
  };

  const handleTrigger = async (ch: 'CHAN1' | 'CHAN2') => {
    setTrigger(ch);
    try {
      await setTarget(ch);
    } catch {
      /* Status-Polling zeigt Fehler */
    }
  };

  const runScan = async () => {
    setScanResult('Scanne…');
    try {
      const data = await sendCommand('/network_scan');
      const found: string[] = data.found || [];
      setScanResult(found.length ? found.join('\n') : 'Keine Geräte gefunden.');
    } catch {
      setScanResult('Scan fehlgeschlagen.');
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Kopfzeile */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveView('dashboard')}
            aria-label="Zurück zum Dashboard"
            className="flex h-9 w-9 items-center justify-center rounded border border-accent/30 text-accent transition-colors hover:border-accent hover:bg-accent/10"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <HoloIcon name="chart" className="h-6 w-6 text-accent" />
          <div>
            <h1
              className="font-mono text-2xl font-bold tracking-[0.25em] text-accent"
              style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}
            >
              OSZI
            </h1>
            <p className="holo-label mt-0.5">Rigol Oszilloskop {status?.demo ? '· Demo' : ''}</p>
          </div>
        </div>

        <div
          className={clsx(
            'flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider ring-1 backdrop-blur',
            !reachable
              ? 'bg-danger/10 text-danger ring-danger/40'
              : connected
                ? 'bg-success/10 text-success ring-success/40'
                : 'bg-warning/10 text-warning ring-warning/40'
          )}
        >
          <span
            className={clsx(
              'h-2 w-2 rounded-full',
              !reachable ? 'bg-danger' : connected ? 'bg-success' : 'bg-warning'
            )}
          />
          {!reachable ? 'Dienst offline' : status?.status || 'Verbinde…'}
        </div>
      </div>

      {/* Untermenue */}
      <div className="mb-6 flex flex-wrap gap-2 border-b border-accent/20 pb-3">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={clsx(
              'flex items-center gap-2 rounded-none border px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all',
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

      {/* ===================== LIVE ===================== */}
      {section === 'live' && (
        <div className="space-y-6">
          <Panel title="Wellenform — CHAN1" badge={<span className="font-mono text-[10px] text-accent/60">{samples.length} Punkte</span>}>
            <WaveformCanvas samples={samples} />
          </Panel>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MeasureCard label="Frequenz" value={status?.frequency_readable || '-- Hz'} accent="#00ff88" />
            <MeasureCard label="Vpp" value={status?.vpp_readable || '-- V'} accent="#00d9ff" />
            <MeasureCard label="Vrms" value={status?.voltage_readable || '-- V'} accent="#a78bfa" />
          </div>

          <Panel title="Steuerung">
            <div className="flex flex-wrap gap-2">
              <OsziButton onClick={() => runCommand('/connect', 'Verbinden')}>Verbinden</OsziButton>
              <OsziButton tone="go" onClick={() => runCommand('/run', 'Start')}>Start</OsziButton>
              <OsziButton tone="stop" onClick={() => runCommand('/stop', 'Stop')}>Stop</OsziButton>
              <OsziButton tone="warn" onClick={() => runCommand('/autoscale', 'Autoscale')}>Autoscale</OsziButton>
            </div>
            {cmdMsg && (
              <div
                className={clsx(
                  'mt-3 font-mono text-[11px]',
                  reachable ? 'text-accent/70' : 'text-danger'
                )}
              >
                {cmdMsg}
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* ===================== KONSOLE ===================== */}
      {section === 'console' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title="SCPI Konsole">
            <div className="flex gap-2">
              <input
                type="text"
                value={scpiCmd}
                onChange={(e) => setScpiCmd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleScpi();
                }}
                placeholder=":MEASure:VPP? CHAN1"
                autoComplete="off"
                className="flex-1 rounded-none border border-accent/30 bg-darker/60 px-3 py-1.5 font-mono text-sm text-white outline-none transition-colors placeholder:text-accent/30 focus:border-accent focus:shadow-glow-sm"
              />
              <OsziButton onClick={handleScpi}>Senden</OsziButton>
            </div>
            <div
              className={clsx(
                'mt-3 min-h-[2rem] whitespace-pre-wrap break-all rounded border px-3 py-2 font-mono text-xs',
                scpiError ? 'border-danger/40 text-danger' : 'border-accent/20 text-accent/80'
              )}
            >
              {scpiResult}
            </div>
            {scpiHistory.length > 0 && (
              <div className="mt-3">
                <div className="holo-label mb-1">Letzte Befehle</div>
                {scpiHistory.map((cmd) => (
                  <div
                    key={cmd}
                    onClick={() => setScpiCmd(cmd)}
                    className="cursor-pointer py-0.5 font-mono text-[11px] text-accent/50 transition-colors hover:text-accent"
                  >
                    {cmd}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Triggerquelle">
            <div className="flex gap-2">
              {(['CHAN1', 'CHAN2'] as const).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => handleTrigger(ch)}
                  className={clsx(
                    'rounded-none border px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all',
                    trigger === ch
                      ? 'border-success bg-success/15 text-success shadow-glow-sm'
                      : 'border-accent/20 text-accent/50 hover:border-accent/50 hover:text-accent/80'
                  )}
                >
                  {ch}
                </button>
              ))}
            </div>
            <div className="mt-3 font-mono text-xs text-success">Aktiv: {trigger}</div>
            <p className="mt-3 text-[11px] leading-relaxed text-accent/40">
              Die Triggerquelle wird direkt an das Oszilloskop übermittelt. Änderungen
              werden sofort aktiv.
            </p>
          </Panel>
        </div>
      )}

      {/* ===================== EXPORT ===================== */}
      {section === 'export' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title="Export & Aufnahme">
            <div className="flex flex-wrap gap-2">
              <OsziButton onClick={() => openResource('/screenshot')}>Screenshot</OsziButton>
              <OsziButton onClick={() => openResource('/export_csv')}>CSV</OsziButton>
              <OsziButton onClick={() => openResource('/report_pdf')}>PDF</OsziButton>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-accent/40">
              Screenshot und PDF benötigen ein verbundenes Gerät. CSV exportiert die
              aktuell erfasste Wellenform.
            </p>
          </Panel>

          <Panel title="Netzwerk-Scan">
            <OsziButton onClick={runScan}>Scan starten</OsziButton>
            {scanResult !== null && (
              <pre className="mt-3 whitespace-pre-wrap break-all rounded border border-accent/20 px-3 py-2 font-mono text-[11px] text-accent/80">
                {scanResult}
              </pre>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
