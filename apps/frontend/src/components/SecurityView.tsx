'use client';

import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { useDashboardStore } from '@/stores/dashboardStore';
import { Panel, HoloIcon } from '@/components/holo';
import { getApiBaseUrl, getAuthToken } from '@/lib/api';

/* =========================================================================
   DeskOS Security-Center

   Bedienoberfläche für die (bereits im Backend vorhandene) Sicherheit:
   Shared-Token-Auth, CORS, Rate-Limit, Security-Header und offene
   Verbindungen. Die Ansicht zeigt nur, OB ein Token gesetzt ist – niemals
   den Token selbst. Alle Werte kommen live aus `/api/security/status`.
   ========================================================================= */

// Antwort von GET /api/security/status (geheimnis-frei).
interface SecurityStatus {
  auth: {
    enabled: boolean;
    scheme: string;
    accepts: string[];
    websocketProtected: boolean;
  };
  cors: { mode: 'all' | 'allowlist' | 'mirror'; origins: string[] };
  rateLimit: { windowMs: number; max: number };
  headers: { helmet: boolean };
  connections: { websocketClients: number };
  server: { env: string; uptimeSec: number };
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

const CORS_LABEL: Record<SecurityStatus['cors']['mode'], string> = {
  all: 'Alle Origins (*)',
  allowlist: 'Allowlist',
  mirror: 'Anfrage-Origin gespiegelt',
};

// Zeile „Label ─ Wert" im Info-Panel.
function InfoRow({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="holo-label">{label}</span>
      <span
        className={clsx(
          'truncate font-mono text-sm',
          tone === 'ok' ? 'text-success' : tone === 'warn' ? 'text-danger' : 'text-white/85'
        )}
      >
        {value}
      </span>
    </div>
  );
}

const holoButton =
  'flex items-center gap-1.5 rounded-none border border-accent/30 px-3 py-1.5 font-mono ' +
  'text-[11px] uppercase tracking-wider text-accent/80 transition-colors ' +
  'hover:border-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40';

export function SecurityView() {
  const wsConnected = useDashboardStore((s) => s.wsConnected);
  const setActiveView = useDashboardStore((s) => s.setActiveView);

  // Ob das Frontend selbst einen Token mitschickt (Build-Zeit-Konstante).
  const [clientHasToken, setClientHasToken] = useState(false);
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setClientHasToken(getAuthToken() !== undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/security/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus((await res.json()) as SecurityStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Netzwerkfehler');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const authOn = status?.auth.enabled ?? false;

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
            <HoloIcon name="shield" className="h-5 w-5 text-accent" />
            <h2
              className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent"
              style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}
            >
              Security
            </h2>
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className={holoButton}>
          <HoloIcon name="refresh" className="h-4 w-4" />
          {loading ? 'Lade…' : 'Aktualisieren'}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-none border border-danger/40 px-3 py-2 font-mono text-[12px] text-danger">
          ✗ Security-Status nicht abrufbar · {error}
        </div>
      )}

      {/* ===================== Auth-Status (Hauptindikator) ===================== */}
      <div
        className={clsx(
          'mb-4 flex items-center gap-4 rounded-none border px-4 py-4',
          authOn ? 'border-success/40 bg-success/5' : 'border-danger/40 bg-danger/5'
        )}
      >
        <div
          className={clsx(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-full ring-1',
            authOn ? 'bg-success/10 text-success ring-success/40' : 'bg-danger/10 text-danger ring-danger/40'
          )}
        >
          <HoloIcon name="shield" className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <div
            className={clsx(
              'font-mono text-lg font-bold uppercase tracking-[0.2em]',
              authOn ? 'text-success' : 'text-danger'
            )}
          >
            {authOn ? 'Geschützt' : 'Ungeschützt'}
          </div>
          <p className="mt-0.5 text-[12px] text-accent/60">
            {authOn
              ? 'API und WebSocket verlangen den Shared-Token (DESKOS_TOKEN).'
              : 'Kein DESKOS_TOKEN gesetzt – API und WebSocket sind offen. Für den Zugriff im LAN einen Token setzen.'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ===================== Authentifizierung ===================== */}
        <Panel title="Authentifizierung">
          <p className="mb-2 text-[11px] text-accent/50">
            Gemeinsames LAN-Geheimnis (Shared-Token). Der Token selbst wird hier nie angezeigt.
          </p>
          <div className="divide-y divide-accent/10">
            <InfoRow
              label="API-Auth"
              value={authOn ? 'aktiv' : 'deaktiviert'}
              tone={authOn ? 'ok' : 'warn'}
            />
            <InfoRow
              label="WebSocket-Auth"
              value={status?.auth.websocketProtected ? 'aktiv' : 'deaktiviert'}
              tone={status?.auth.websocketProtected ? 'ok' : 'warn'}
            />
            <InfoRow label="Verfahren" value={status?.auth.scheme ?? '…'} />
            <InfoRow
              label="Dieses Frontend"
              value={clientHasToken ? 'sendet Token' : 'ohne Token'}
              tone={authOn ? (clientHasToken ? 'ok' : 'warn') : undefined}
            />
          </div>
          {authOn && !clientHasToken && (
            <p className="mt-3 rounded-none border border-danger/40 px-3 py-2 font-mono text-[11px] text-danger">
              Auth ist aktiv, aber dieses Frontend sendet keinen Token
              (NEXT_PUBLIC_DESKOS_TOKEN). Zugriffe schlagen mit 401 fehl.
            </p>
          )}
          {status && (
            <div className="mt-3">
              <div className="holo-label mb-1">Token akzeptiert via</div>
              <div className="flex flex-wrap gap-1.5">
                {status.auth.accepts.map((a) => (
                  <span
                    key={a}
                    className="rounded-none border border-accent/25 px-2 py-0.5 font-mono text-[10px] text-accent/70"
                  >
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Panel>

        {/* ===================== Netzwerk / Zugriff ===================== */}
        <Panel title="Netzwerk & Zugriff">
          <p className="mb-2 text-[11px] text-accent/50">
            CORS, Rate-Limit und Security-Header schützen das Backend vor fremden Origins und Missbrauch.
          </p>
          <div className="divide-y divide-accent/10">
            <InfoRow label="CORS-Modus" value={status ? CORS_LABEL[status.cors.mode] : '…'} />
            <InfoRow
              label="Rate-Limit"
              value={
                status
                  ? `${status.rateLimit.max} / ${Math.round(status.rateLimit.windowMs / 1000)} s`
                  : '…'
              }
            />
            <InfoRow
              label="Security-Header"
              value={status?.headers.helmet ? 'helmet aktiv' : 'aus'}
              tone={status?.headers.helmet ? 'ok' : undefined}
            />
            <InfoRow label="WebSocket" value={wsConnected ? 'verbunden' : 'getrennt'} />
          </div>
          {status && status.cors.mode === 'allowlist' && status.cors.origins.length > 0 && (
            <div className="mt-3">
              <div className="holo-label mb-1">Erlaubte Origins</div>
              <div className="flex flex-wrap gap-1.5">
                {status.cors.origins.map((o) => (
                  <span
                    key={o}
                    className="rounded-none border border-accent/25 px-2 py-0.5 font-mono text-[10px] text-accent/70"
                  >
                    {o}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Panel>

        {/* ===================== Verbindungen ===================== */}
        <Panel title="Verbindungen">
          <p className="mb-2 text-[11px] text-accent/50">Aktuell mit dem Backend verbundene Clients.</p>
          <div className="flex items-end gap-3">
            <span className="holo-value text-4xl">{status?.connections.websocketClients ?? '—'}</span>
            <span className="holo-label pb-1">aktive WebSocket-Clients</span>
          </div>
        </Panel>

        {/* ===================== Server ===================== */}
        <Panel title="Server">
          <p className="mb-2 text-[11px] text-accent/50">Laufzeit-Umgebung des Backends.</p>
          <div className="divide-y divide-accent/10">
            <InfoRow label="Umgebung" value={status?.server.env ?? '…'} />
            <InfoRow label="Uptime" value={status ? formatUptime(status.server.uptimeSec) : '…'} />
          </div>
          {status?.server.env !== 'production' && status && (
            <p className="mt-3 text-[11px] text-accent/40">
              Hinweis: Für den produktiven Betrieb NODE_ENV=production, ein gesetztes DESKOS_TOKEN und
              – bei Zugriff über ein Netzwerk – HTTPS empfohlen.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
