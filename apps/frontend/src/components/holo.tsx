'use client';

import { useMemo, type ReactNode } from 'react';
import clsx from 'clsx';

/* =========================================================================
   DeskOS holographic "mobiGlas" building blocks.

   Shared visual primitives (icons, frosted panels, corner brackets, gauges,
   sparklines, stat bars) used by both the OverlayMenu launcher and the main
   Dashboard so the whole UI shares one Star-Citizen-style language.
   ========================================================================= */

/* ----------------------------- Icons ----------------------------------- */
// Single <svg> wrapper, only the inner paths change per name. Keeps every
// icon perfectly sized and guarantees a valid fallback.
export const ICON_PATHS: Record<string, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  cpu: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="0.5" />
      <path d="M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2" />
    </>
  ),
  activity: <polyline points="3 12 7 12 10 5 14 19 17 12 21 12" />,
  chart: (
    <>
      <path d="M4 4v16h16" />
      <rect x="7" y="11" width="2.5" height="6" />
      <rect x="12" y="7" width="2.5" height="10" />
      <rect x="17" y="13" width="2.5" height="4" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </>
  ),
  zap: <polygon points="13 2 4 14 11 14 10 22 20 9 13 9 13 2" />,
  wifi: (
    <>
      <path d="M2 8.5a16 16 0 0 1 20 0" />
      <path d="M5 12a11 11 0 0 1 14 0" />
      <path d="M8.5 15.5a6 6 0 0 1 7 0" />
      <circle cx="12" cy="19" r="1" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
      <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>
  ),
  code: <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  thermometer: (
    <>
      <path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z" />
      <path d="M12 9v6" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1.3 1.6 1.5 2.5h5c.2-.9.7-1.7 1.5-2.5A6 6 0 0 0 12 3z" />
    </>
  ),
  power: (
    <>
      <path d="M12 3v9" />
      <path d="M6.3 7.3a8 8 0 1 0 11.4 0" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="12.5" r="3.2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  plug: (
    <>
      <path d="M9 2v6M15 2v6" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
      <path d="M12 17v5" />
    </>
  ),
  speaker: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9z" />
      <path d="M16 8.5a4 4 0 0 1 0 7M18.5 6a7 7 0 0 1 0 12" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5M3 16.5l9 5 9-5" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 4v5h-5" />
    </>
  ),
  flask: (
    <>
      <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />
      <path d="M7.5 15h9" />
    </>
  ),
  play: <polygon points="7 4 20 12 7 20 7 4" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </>
  ),
  'skip-forward': (
    <>
      <polygon points="5 4 15 12 5 20 5 4" />
      <line x1="19" y1="5" x2="19" y2="19" />
    </>
  ),
  'skip-back': (
    <>
      <polygon points="19 4 9 12 19 20 19 4" />
      <line x1="5" y1="5" x2="5" y2="19" />
    </>
  ),
};

export function HoloIcon({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICON_PATHS[name] ?? ICON_PATHS.grid}
    </svg>
  );
}

/* --------------------------- Building blocks --------------------------- */
export function HoloCorners() {
  return (
    <>
      <span className="holo-corner holo-corner-tl" />
      <span className="holo-corner holo-corner-tr" />
      <span className="holo-corner holo-corner-bl" />
      <span className="holo-corner holo-corner-br" />
    </>
  );
}

export function Panel({
  title,
  badge,
  children,
  className,
}: {
  title?: string;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('holo-panel p-3', className)}>
      <HoloCorners />
      {title && (
        <div className="mb-2 flex items-center justify-between">
          <span className="holo-label">{title}</span>
          {badge}
        </div>
      )}
      {children}
    </div>
  );
}

// Tiny inline sparkline drawn from a numeric series (0–100 range expected).
export function Sparkline({ values, height = 38 }: { values: number[]; height?: number }) {
  const width = 100;
  const path = useMemo(() => {
    if (values.length < 2) return null;
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const step = width / (values.length - 1);
    const pts = values.map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return [x, y] as const;
    });
    const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const area = `${line} L${width} ${height} L0 ${height} Z`;
    return { line, area };
  }, [values, height]);

  if (!path) {
    return <div className="flex h-[38px] items-center text-[10px] text-accent/40">Sammle Daten…</div>;
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-[38px] w-full">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(0,217,255,0.35)" />
          <stop offset="100%" stopColor="rgba(0,217,255,0)" />
        </linearGradient>
      </defs>
      <path d={path.area} fill="url(#spark-fill)" stroke="none" />
      <path d={path.line} fill="none" stroke="#00d9ff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Semicircular gauge (echoes the temperature gauge from the mobile shot).
export function RadialGauge({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  const color = v >= 85 ? '#ff0055' : v >= 60 ? '#ffa500' : '#00ff88';
  return (
    <div className="relative flex flex-col items-center">
      <svg viewBox="0 0 120 66" className="w-full max-w-[150px]">
        <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="rgba(0,217,255,0.15)" strokeWidth={8} strokeLinecap="round" />
        <path
          d="M10 60 A50 50 0 0 1 110 60"
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100"
          strokeDashoffset={100 - v}
          style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.4s ease', filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div className="-mt-7 text-center">
        <div className="font-mono text-2xl font-bold" style={{ color }}>
          {Math.round(v)}
          <span className="text-sm text-accent/50">%</span>
        </div>
        <div className="holo-label mt-0.5">{label}</div>
      </div>
    </div>
  );
}

// Status "LED": a small glowing dot whose color follows a device/module status.
// online → green, error → amber, offline (or anything else) → red. Online LEDs
// gently pulse (holoPulse) like a live indicator. Pure presentation: the caller
// decides what status to pass in.
const LED_COLORS: Record<string, string> = {
  online: '#00ff88', // success
  error: '#ffa500', // warning
  offline: '#ff0055', // danger
};

export function StatusLed({ status, size = 12 }: { status: string; size?: number }) {
  const color = LED_COLORS[status] ?? LED_COLORS.offline;
  const live = status === 'online';
  return (
    <span
      className={clsx('inline-block shrink-0 rounded-full', live && 'animate-holo-pulse')}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        boxShadow: `0 0 7px ${color}, 0 0 2px ${color}`,
      }}
      role="img"
      aria-label={status}
      title={status}
    />
  );
}

// Compact label / value / progress-bar row used in the status grids.
export function StatBar({ label, value, percent }: { label: string; value: string; percent?: number }) {
  const p = percent != null ? Math.max(0, Math.min(100, percent)) : null;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="holo-label">{label}</span>
        <span className="holo-value text-sm">{value}</span>
      </div>
      {p != null && (
        <div className="mt-1 h-1 w-full bg-accent/10">
          <div className="h-full bg-accent shadow-glow-sm" style={{ width: `${p}%`, transition: 'width 0.6s ease' }} />
        </div>
      )}
    </div>
  );
}
