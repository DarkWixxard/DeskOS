'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useDashboardStore } from '@/stores/dashboardStore';
import { Panel, HoloIcon } from '@/components/holo';
import { getApiBaseUrl, getAuthToken, getBackendPort } from '@/lib/api';

/* =========================================================================
   DeskOS Settings

   App- und systemweite Einstellungen (Zahnrad-Kachel). Bewusst getrennt von
   der „Anzeige"-Ansicht (DashboardSettingsView), die nur regelt, welche
   Dashboard-Bereiche sichtbar sind. Hier bündeln wir Backend-/Verbindungs-
   Infos, System-Details, Benachrichtigungen und Layout-Aktionen – alle
   Steuerungen sind an echte Store-Actions bzw. das Backend gebunden.
   ========================================================================= */

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// Ergebnis eines Health-Checks gegen /health.
interface HealthResult {
  ok: boolean;
  status: number;
  durationMs: number;
  detail: string;
}

// Zeile „Label ─ Wert" im Info-Panel.
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="holo-label">{label}</span>
      <span className="truncate font-mono text-sm text-white/85">{value}</span>
    </div>
  );
}

// Einheitlicher Holo-Button (Sekundär-Aktion).
const holoButton =
  'flex items-center gap-1.5 rounded-none border border-accent/30 px-3 py-1.5 font-mono ' +
  'text-[11px] uppercase tracking-wider text-accent/80 transition-colors ' +
  'hover:border-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40';

export function SettingsView() {
  const wsConnected = useDashboardStore((s) => s.wsConnected);
  const systemMetrics = useDashboardStore((s) => s.systemMetrics);
  const unreadCount = useDashboardStore((s) => s.unreadCount);
  const setActiveView = useDashboardStore((s) => s.setActiveView);
  const connectWebSocket = useDashboardStore((s) => s.connectWebSocket);
  const disconnectWebSocket = useDashboardStore((s) => s.disconnectWebSocket);
  const markAllNotificationsRead = useDashboardStore((s) => s.markAllNotificationsRead);
  const resetDashboardLayout = useDashboardStore((s) => s.resetDashboardLayout);

  const hasToken = useMemo(() => getAuthToken() !== undefined, []);
  // Base-URL nur clientseitig bestimmen (SSR-sicher, kein Hydration-Mismatch).
  const [baseUrl, setBaseUrl] = useState('');
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState<HealthResult | null>(null);

  useEffect(() => {
    setBaseUrl(getApiBaseUrl());
  }, []);

  const runHealthCheck = async () => {
    if (checking) return;
    setChecking(true);
    setHealth(null);
    const url = `${getApiBaseUrl()}/health`;
    const started = performance.now();
    try {
      const res = await fetch(url);
      const durationMs = Math.round(performance.now() - started);
      let detail = res.ok ? 'Backend erreichbar' : `HTTP ${res.status}`;
      try {
        const json = (await res.json()) as { status?: string };
        if (json?.status) detail = `status: ${json.status}`;
      } catch {
        /* Antwort war kein JSON – Standard-Detail behalten */
      }
      setHealth({ ok: res.ok, status: res.status, durationMs, detail });
    } catch (err) {
      setHealth({
        ok: false,
        status: 0,
        durationMs: Math.round(performance.now() - started),
        detail: err instanceof Error ? err.message : 'Netzwerkfehler',
      });
    } finally {
      setChecking(false);
    }
  };

  const reconnect = () => {
    // Bestehenden Socket schließen und frisch verbinden.
    disconnectWebSocket();
    connectWebSocket();
  };

  const handleResetLayout = () => {
    if (window.confirm('Dashboard-Anzeige auf die Standardwerte zurücksetzen?')) {
      resetDashboardLayout();
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* --------------------------- Header --------------------------- */}
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
            <HoloIcon name="gear" className="h-5 w-5 text-accent" />
            <h2
              className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent"
              style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}
            >
              Settings
            </h2>
          </div>
        </div>
        <span
          className={clsx(
            'flex items-center gap-2 rounded-none border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider',
            wsConnected ? 'text-success border-success/40' : 'text-danger border-danger/40'
          )}
        >
          <span className={clsx('h-2 w-2 rounded-full', wsConnected ? 'bg-success' : 'bg-danger')} />
          {wsConnected ? 'Online' : 'Offline'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ===================== Verbindung / Backend ===================== */}
        <Panel title="Verbindung">
          <p className="mb-2 text-[11px] text-accent/50">
            Anbindung an das DeskOS-Backend (REST &amp; WebSocket).
          </p>
          <div className="divide-y divide-accent/10">
            <InfoRow label="Base-URL" value={baseUrl || '…'} />
            <InfoRow label="Port" value={getBackendPort()} />
            <InfoRow label="Auth" value={hasToken ? 'Token aktiv' : 'deaktiviert'} />
            <InfoRow label="WebSocket" value={wsConnected ? 'verbunden' : 'getrennt'} />
          </div>

          {health && (
            <div
              className={clsx(
                'mt-3 rounded-none border px-3 py-2 font-mono text-[11px]',
                health.ok ? 'border-success/40 text-success' : 'border-danger/40 text-danger'
              )}
            >
              {health.ok ? '✓' : '✗'} {health.detail}
              {health.status > 0 && <span className="text-accent/50"> · HTTP {health.status}</span>}
              <span className="text-accent/50"> · {health.durationMs} ms</span>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void runHealthCheck()} disabled={checking} className={holoButton}>
              <HoloIcon name="activity" className="h-4 w-4" />
              {checking ? 'Prüfe…' : 'Verbindung testen'}
            </button>
            <button type="button" onClick={reconnect} className={holoButton}>
              <HoloIcon name="refresh" className="h-4 w-4" />
              Neu verbinden
            </button>
          </div>
        </Panel>

        {/* ===================== System ===================== */}
        <Panel title="System">
          <p className="mb-2 text-[11px] text-accent/50">Angaben zum lokalen Host (Live-Metriken).</p>
          {systemMetrics ? (
            <div className="divide-y divide-accent/10">
              <InfoRow label="Hostname" value={systemMetrics.hostname} />
              <InfoRow label="Plattform" value={systemMetrics.platform} />
              <InfoRow label="Uptime" value={formatUptime(systemMetrics.uptime)} />
              <InfoRow label="CPU" value={`${Math.round(systemMetrics.cpu)} %`} />
              <InfoRow label="RAM" value={`${Math.round(systemMetrics.ram.percentage)} %`} />
            </div>
          ) : (
            <p className="py-6 text-center text-[12px] text-accent/40">Warte auf Metriken…</p>
          )}
        </Panel>

        {/* ===================== Benachrichtigungen ===================== */}
        <Panel title="Benachrichtigungen">
          <p className="mb-2 text-[11px] text-accent/50">
            {unreadCount > 0
              ? `${unreadCount} ungelesene Benachrichtigung${unreadCount === 1 ? '' : 'en'}.`
              : 'Keine ungelesenen Benachrichtigungen.'}
          </p>
          <button
            type="button"
            onClick={() => void markAllNotificationsRead()}
            disabled={unreadCount === 0}
            className={holoButton}
          >
            <HoloIcon name="bell" className="h-4 w-4" />
            Alle als gelesen markieren
          </button>
        </Panel>

        {/* ===================== Darstellung / Dashboard ===================== */}
        <Panel title="Darstellung">
          <p className="mb-2 text-[11px] text-accent/50">
            Welche Bereiche und Module auf dem Dashboard erscheinen, legst du in der Anzeige-Ansicht fest.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setActiveView('display')} className={holoButton}>
              <HoloIcon name="layers" className="h-4 w-4" />
              Anzeige-Einstellungen
            </button>
            <button
              type="button"
              onClick={handleResetLayout}
              className={clsx(holoButton, 'hover:border-danger hover:bg-danger/10 hover:text-danger')}
            >
              <HoloIcon name="refresh" className="h-4 w-4" />
              Dashboard zurücksetzen
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
