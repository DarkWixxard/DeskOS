'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useDashboardStore } from '@/stores/dashboardStore';
import { Panel, HoloIcon } from '@/components/holo';
import { getApiBaseUrl } from '@/lib/api';
import type { LogEntry, LogLevel } from '@shared/types';

/* =========================================================================
   DeskOS Log Center (M2)

   Searchable / filterable view over the persisted log table (/api/logs).
   ========================================================================= */

const LEVELS: (LogLevel | 'all')[] = ['all', 'error', 'warn', 'info', 'debug'];

const LEVEL_COLOR: Record<string, string> = {
  error: 'text-danger',
  warn: 'text-warning',
  info: 'text-accent',
  debug: 'text-accent/40',
};

export function LogView() {
  const setActiveView = useDashboardStore((s) => s.setActiveView);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState<LogLevel | 'all'>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const base = getApiBaseUrl();
      const url = `${base}/api/logs?limit=500${level !== 'all' ? `&level=${level}` : ''}`;
      const res = await fetch(url);
      setLogs((await res.json()) as LogEntry[]);
    } catch (e) {
      console.error('Unable to load logs:', e);
    } finally {
      setLoading(false);
    }
  }, [level]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        l.message.toLowerCase().includes(q) ||
        l.source.toLowerCase().includes(q) ||
        (l.metadata ? JSON.stringify(l.metadata).toLowerCase().includes(q) : false)
    );
  }, [logs, query]);

  const field =
    'rounded-none border border-accent/30 bg-darker/60 px-3 py-1.5 text-sm text-white outline-none ' +
    'placeholder:text-accent/30 transition-colors focus:border-accent focus:shadow-glow-sm';

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
            <HoloIcon name="list" className="h-5 w-5 text-accent" />
            <h2 className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent" style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}>
              Log Center
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input type="text" placeholder="Logs durchsuchen…" value={query} onChange={(e) => setQuery(e.target.value)} className={field} />
          <select value={level} onChange={(e) => setLevel(e.target.value as LogLevel | 'all')} className={clsx(field, 'cursor-pointer')}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l === 'all' ? 'Alle Level' : l.toUpperCase()}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => load()}
            className="flex h-9 w-9 items-center justify-center rounded-none border border-accent/30 text-accent transition-colors hover:bg-accent/10"
            aria-label="Aktualisieren"
          >
            <HoloIcon name="refresh" className={clsx('h-4 w-4', loading && 'animate-holo-spin')} />
          </button>
        </div>
      </div>

      <Panel badge={<span className="font-mono text-[10px] text-accent/60">{filtered.length} Einträge</span>}>
        {filtered.length === 0 ? (
          <p className="py-10 text-center text-[12px] text-accent/40">{loading ? 'Lade…' : 'Keine Logs'}</p>
        ) : (
          <div className="max-h-[65vh] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-darker/90 backdrop-blur">
                <tr className="holo-label border-b border-accent/20">
                  <th className="py-1.5 pr-3 font-normal">Zeit</th>
                  <th className="py-1.5 px-3 font-normal">Level</th>
                  <th className="py-1.5 px-3 font-normal">Quelle</th>
                  <th className="py-1.5 pl-3 font-normal">Meldung</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[12px]">
                {filtered.map((l, i) => (
                  <tr key={l.id ?? i} className="border-b border-accent/5 align-top">
                    <td className="whitespace-nowrap py-1.5 pr-3 text-accent/50">{new Date(l.timestamp).toLocaleTimeString()}</td>
                    <td className={clsx('py-1.5 px-3 uppercase', LEVEL_COLOR[l.level] ?? 'text-white/70')}>{l.level}</td>
                    <td className="py-1.5 px-3 text-accent/60">{l.source}</td>
                    <td className="py-1.5 pl-3 text-white/85">{l.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
