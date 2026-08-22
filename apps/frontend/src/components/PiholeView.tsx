'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useDashboardStore } from '@/stores/dashboardStore';
import { Panel, HoloCorners, HoloIcon, RadialGauge, StatusLed } from '@/components/holo';
import { fmtCount, fmtDuration, PIHOLE_BTN } from '@/lib/pihole';
import type { PiholeDetails, PiholeTopItem } from '@shared/types';

/* =========================================================================
   DeskOS Pi-hole-Ansicht

   Zeigt die Zahlen eines Pi-hole im LAN: Kennzahlen, 24-h-Verlauf und die
   Top-Listen. Alle Daten kommen über das DeskOS-Backend (/api/pihole/*), das
   den Pi-hole stellvertretend anspricht — im Browser liegt weder das
   App-Passwort noch ein CORS-Problem.
   ========================================================================= */

const DETAILS_REFRESH_MS = 30000;

const emptyDetails: PiholeDetails = {
  topQueries: [],
  topBlocked: [],
  topClients: [],
  queryTypes: [],
  upstreams: [],
  history: [],
};

/** Eine Kennzahl-Kachel der Kopfreihe. */
function Kpi({ label, value, accent }: { label: string; value: string; accent?: 'danger' | 'success' }) {
  return (
    <Panel className="relative">
      <HoloCorners />
      <p className="holo-label">{label}</p>
      <p
        className={clsx(
          'mt-1 font-mono text-2xl font-bold',
          accent === 'danger' ? 'text-danger' : accent === 'success' ? 'text-success' : 'text-white'
        )}
      >
        {value}
      </p>
    </Panel>
  );
}

/**
 * Top-Liste als Balken. Die Balkenbreite ist relativ zum größten Eintrag, damit
 * die Darstellung auch dann stimmt, wenn Pi-hole v5 Prozente statt Absolutwerte
 * liefert (Query-Typen, Upstreams).
 */
function TopList({ title, items, unit }: { title: string; items: PiholeTopItem[]; unit?: '%' }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <Panel title={title}>
      {items.length === 0 ? (
        <p className="py-6 text-center text-[11px] text-accent/40">Keine Daten</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.name}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate font-mono text-[11px] text-white/85" title={item.name}>
                  {item.name}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-accent/70">
                  {unit === '%' ? `${item.count.toFixed(1).replace('.', ',')} %` : fmtCount(item.count)}
                </span>
              </div>
              <div className="mt-1 h-1 w-full bg-accent/10">
                <div
                  className="h-full bg-accent shadow-glow-sm"
                  style={{ width: `${(item.count / max) * 100}%`, transition: 'width 0.6s ease' }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function PiholeView() {
  const setActiveView = useDashboardStore((s) => s.setActiveView);
  const status = useDashboardStore((s) => s.piholeStatus);
  const fetchPihole = useDashboardStore((s) => s.fetchPihole);
  const fetchDetails = useDashboardStore((s) => s.fetchPiholeDetails);
  const setBlocking = useDashboardStore((s) => s.setPiholeBlocking);

  const [details, setDetails] = useState<PiholeDetails>(emptyDetails);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      const d = await fetchDetails(refresh);
      if (d) setDetails(d);
    },
    [fetchDetails]
  );

  useEffect(() => {
    void fetchPihole();
    void load();
    const id = setInterval(() => void load(), DETAILS_REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchPihole, load]);

  const toggle = async (enabled: boolean, seconds?: number) => {
    setBusy(true);
    try {
      await setBlocking(enabled, seconds);
      await load(true); // Top-Listen/Verlauf direkt nachziehen
    } finally {
      setBusy(false);
    }
  };

  const chart = useMemo(
    () =>
      details.history.map((p) => ({
        time: new Date(p.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
        Gesamt: p.total,
        Geblockt: p.blocked,
      })),
    [details.history]
  );

  const configured = status?.hasCredentials ?? false;
  const online = status?.online ?? false;

  const header = (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => setActiveView('dashboard')}
        className="flex items-center gap-1.5 rounded-none border border-accent/30 px-2.5 py-1.5 text-[11px] uppercase tracking-wider text-accent/80 transition-colors hover:border-accent hover:bg-accent/10"
      >
        <HoloIcon name="grid" className="h-4 w-4" /> Dashboard
      </button>
      <div className="flex items-center gap-2">
        <HoloIcon name="shield" className="h-5 w-5 text-accent" />
        <h2
          className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent"
          style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}
        >
          Pi-hole
        </h2>
      </div>
      {status && configured && (
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-accent/50">
          <StatusLed status={online ? (status.blocking ? 'online' : 'error') : 'offline'} size={8} />
          {!online ? 'Offline' : status.blocking ? 'Blocking aktiv' : 'Blocking pausiert'}
          {status.apiVersion !== 'none' && ` · API ${status.apiVersion}`}
        </span>
      )}
    </div>
  );

  // 1) Noch nicht eingerichtet.
  if (!configured) {
    return (
      <div className="container mx-auto px-4 py-8">
        {header}
        <Panel>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <HoloIcon name="shield" className="h-9 w-9 text-accent/40" />
            <p className="text-[13px] text-accent/60">Pi-hole ist noch nicht eingerichtet.</p>
            <p className="max-w-md text-[11px] text-accent/40">
              Unter Plugins → Pi-hole die Adresse (z. B. <code className="text-accent/70">http://192.168.178.10</code>)
              und das App-Passwort hinterlegen. Pi-hole v6 und v5 werden beide erkannt.
            </p>
            <button type="button" onClick={() => setActiveView('plugins')} className={PIHOLE_BTN}>
              Zu den Plugins
            </button>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {header}

      {!online && (
        <Panel className="mb-4">
          <div className="flex items-center gap-3 py-2">
            <HoloIcon name="shield" className="h-6 w-6 shrink-0 text-danger/60" />
            <div>
              <p className="font-mono text-[12px] text-danger/80">Pi-hole nicht erreichbar</p>
              <p className="text-[11px] text-accent/45">{status?.error ?? 'Verbindung wird versucht …'}</p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void fetchPihole()}
              className={clsx(PIHOLE_BTN, 'ml-auto')}
            >
              Erneut prüfen
            </button>
          </div>
        </Panel>
      )}

      {/* Kennzahlen */}
      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Anfragen heute" value={fmtCount(status?.queriesToday ?? 0)} />
        <Kpi label="Geblockt heute" value={fmtCount(status?.blockedToday ?? 0)} accent="danger" />
        <Kpi
          label="Blockrate"
          value={`${(status?.blockedPercent ?? 0).toFixed(1).replace('.', ',')} %`}
          accent="success"
        />
        <Kpi label="Domains auf Blockliste" value={fmtCount(status?.domainsOnBlocklist ?? 0)} />
        <Kpi label="Aktive Clients" value={fmtCount(status?.uniqueClients ?? 0)} />
      </div>

      {/* Blocking-Steuerung + Blockrate */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="DNS-Blocking">
          <div className="flex items-center gap-4">
            <div className="w-[45%] shrink-0">
              <RadialGauge value={status?.blockedPercent ?? 0} label="geblockt" />
            </div>
            <div className="flex-1 space-y-2">
              {status?.blocking ? (
                <>
                  <p className="holo-label">Pausieren für</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" disabled={busy} onClick={() => void toggle(false, 30)} className={PIHOLE_BTN}>
                      30 s
                    </button>
                    <button type="button" disabled={busy} onClick={() => void toggle(false, 300)} className={PIHOLE_BTN}>
                      5 min
                    </button>
                    <button type="button" disabled={busy} onClick={() => void toggle(false, 3600)} className={PIHOLE_BTN}>
                      1 h
                    </button>
                    <button type="button" disabled={busy} onClick={() => void toggle(false)} className={PIHOLE_BTN}>
                      Dauerhaft
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="holo-label">Blocking ist aus</p>
                  {status?.blockingTimerSec != null && (
                    <p className="font-mono text-[11px] text-warning/80">
                      schaltet in {fmtDuration(status.blockingTimerSec)} zurück
                    </p>
                  )}
                  <button type="button" disabled={busy} onClick={() => void toggle(true)} className={PIHOLE_BTN}>
                    Blocking einschalten
                  </button>
                </>
              )}
              {status?.gravityLastUpdate && (
                <p className="pt-1 text-[10px] text-accent/35">
                  Blocklisten aktualisiert: {new Date(status.gravityLastUpdate).toLocaleString('de-DE')}
                </p>
              )}
            </div>
          </div>
        </Panel>

        {/* 24-h-Verlauf */}
        <Panel title="Verlauf (24 h)" className="lg:col-span-2">
          {chart.length < 2 ? (
            <p className="py-12 text-center text-[11px] text-accent/40">Keine Verlaufsdaten</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chart} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="pihole-total" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(0,217,255,0.45)" />
                    <stop offset="100%" stopColor="rgba(0,217,255,0)" />
                  </linearGradient>
                  <linearGradient id="pihole-blocked" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(255,0,85,0.45)" />
                    <stop offset="100%" stopColor="rgba(255,0,85,0)" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,217,255,0.12)" />
                <XAxis
                  dataKey="time"
                  tick={{ fill: 'rgba(0,217,255,0.5)', fontSize: 10 }}
                  stroke="rgba(0,217,255,0.2)"
                  interval="preserveStartEnd"
                  minTickGap={40}
                />
                <YAxis tick={{ fill: 'rgba(0,217,255,0.5)', fontSize: 10 }} stroke="rgba(0,217,255,0.2)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(8,16,22,0.92)',
                    border: '1px solid rgba(0,217,255,0.4)',
                    borderRadius: '4px',
                    fontSize: '12px',
                    boxShadow: '0 0 16px rgba(0,217,255,0.25)',
                  }}
                  labelStyle={{ color: '#00d9ff' }}
                  itemStyle={{ color: '#fff' }}
                  cursor={{ stroke: 'rgba(0,217,255,0.3)' }}
                />
                <Legend wrapperStyle={{ fontSize: '12px', color: 'rgba(0,217,255,0.7)' }} />
                <Area
                  type="monotone"
                  dataKey="Gesamt"
                  stroke="#00d9ff"
                  fill="url(#pihole-total)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="Geblockt"
                  stroke="#ff0055"
                  fill="url(#pihole-blocked)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      {/* Top-Listen */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <TopList title="Top-Domains" items={details.topQueries} />
        <TopList title="Top geblockt" items={details.topBlocked} />
        <TopList title="Top-Clients" items={details.topClients} />
        {/* v5 liefert Query-Typen als Prozentwerte, v6 als Absolutzahlen. */}
        <TopList
          title="Query-Typen"
          items={details.queryTypes}
          unit={status?.apiVersion === 'v5' ? '%' : undefined}
        />
      </div>

      {details.upstreams.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <TopList
            title="Upstream-Server"
            items={details.upstreams}
            unit={status?.apiVersion === 'v5' ? '%' : undefined}
          />
        </div>
      )}
    </div>
  );
}
