// Shared time helpers.

// Relative "time ago" label (German), e.g. "vor 5s" / "vor 3m" / "vor 2h".
// Falls back to a localized date once the gap exceeds a day. Used by the
// Notification Center and the Module-Status panel so both format timestamps
// the same way.
export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `vor ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `vor ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h}h`;
  return new Date(ts).toLocaleDateString();
}
