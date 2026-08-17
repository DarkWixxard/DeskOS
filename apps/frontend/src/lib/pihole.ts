// Kleine Formatierer, die sich das Pi-hole-Widget und die Pi-hole-Ansicht teilen.

/** Große Zahlen kompakt: 1234 -> "1,2 k", 1234567 -> "1,2 M". */
export function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1).replace('.', ',')} k`;
  return Math.round(n).toLocaleString('de-DE');
}

/** Restlaufzeit in Sekunden -> "45 s" / "4:12 min" / "1 h 5 min". */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}

/** Gemeinsamer Sekundär-Button im Holo-Stil (wie in LabsView/SettingsView). */
export const PIHOLE_BTN =
  'rounded-none border border-accent/30 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ' +
  'text-accent/80 transition-colors hover:border-accent hover:bg-accent/10 ' +
  'disabled:cursor-not-allowed disabled:opacity-40';
