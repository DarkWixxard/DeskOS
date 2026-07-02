'use client';

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import { useDashboardStore } from '@/stores/dashboardStore';
import { Panel, HoloIcon } from '@/components/holo';
import { getApiBaseUrl, getAuthToken, getBackendPort, installAuthFetch } from '@/lib/api';

/* =========================================================================
   DeskOS API-Console

   Ein eingebauter REST-Client (Mini-„Postman") für das DeskOS-Backend.
   Man wählt Methode + Pfad, schickt optional einen JSON-Body und sieht
   Status, Dauer, Header und den formatierten Antwort-Body – ohne die
   App zu verlassen.

   Base-URL und Auth-Token stammen aus derselben Quelle wie der Rest der
   App (lib/api): window.fetch ist bereits so gepatcht, dass der
   Authorization-Header automatisch mitgeschickt wird (installAuthFetch()).
   ========================================================================= */

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const METHODS: Method[] = ['GET', 'POST', 'PATCH', 'DELETE'];
// Nur diese Methoden tragen üblicherweise einen Request-Body.
const BODY_METHODS: Method[] = ['POST', 'PATCH'];

interface Endpoint {
  method: Method;
  path: string;
  desc: string;
  body?: string;
}

// Kuratierter Katalog der Backend-Endpunkte (siehe apps/backend/src/api/routes.ts).
// Nach Bereichen gruppiert; ein Klick füllt Methode, Pfad und ggf. Body vor.
const CATALOG: { group: string; items: Endpoint[] }[] = [
  {
    group: 'System',
    items: [
      { method: 'GET', path: '/health', desc: 'Health-Check (ohne Auth)' },
      { method: 'GET', path: '/api/system/metrics', desc: 'Aktuelle System-Metriken' },
      { method: 'GET', path: '/api/dashboard/summary', desc: 'Aggregierte Dashboard-Übersicht' },
      { method: 'GET', path: '/api/events?limit=50', desc: 'Event-Historie' },
      { method: 'GET', path: '/api/logs?limit=100', desc: 'Persistierte Logs' },
    ],
  },
  {
    group: 'Geräte & Sensoren',
    items: [
      { method: 'GET', path: '/api/devices', desc: 'Alle Geräte' },
      { method: 'GET', path: '/api/devices/:id', desc: 'Gerät + letzte Daten' },
      { method: 'GET', path: '/api/devices/:id/data?limit=100', desc: 'Verlauf eines Geräts' },
      { method: 'PATCH', path: '/api/devices/:id', desc: 'Gerät umbenennen', body: '{\n  "name": "Neuer Name"\n}' },
      { method: 'GET', path: '/api/sensors', desc: 'MQTT-/Sensor-Knoten' },
      {
        method: 'POST',
        path: '/api/devices/:id/command',
        desc: 'Kommando an MQTT-Knoten',
        body: '{\n  "action": "restart"\n}',
      },
    ],
  },
  {
    group: 'Benachrichtigungen',
    items: [
      { method: 'GET', path: '/api/notifications?limit=50', desc: 'Liste' },
      { method: 'GET', path: '/api/notifications/unread-count', desc: 'Ungelesen-Zähler' },
      { method: 'POST', path: '/api/notifications/read-all', desc: 'Alle als gelesen markieren' },
    ],
  },
  {
    group: 'WLED / RGB',
    items: [
      { method: 'GET', path: '/api/wled/lights', desc: 'Alle WLED-Lichter' },
      {
        method: 'POST',
        path: '/api/wled/lights/:id/state',
        desc: 'Licht schalten',
        body: '{\n  "on": true,\n  "brightness": 128\n}',
      },
    ],
  },
  {
    group: 'Layouts & Plugins',
    items: [
      { method: 'GET', path: '/api/layouts', desc: 'Layout-Profile' },
      { method: 'GET', path: '/api/plugins', desc: 'Installierte Plugins' },
      { method: 'GET', path: '/api/automations', desc: 'Automations-Regeln' },
    ],
  },
];

// Response-Status -> Holo-Farbe.
function statusColor(status: number): string {
  if (status <= 0) return 'text-danger border-danger/40';
  if (status < 300) return 'text-success border-success/40';
  if (status < 400) return 'text-accent border-accent/40';
  if (status < 500) return 'text-warning border-warning/40';
  return 'text-danger border-danger/40';
}

interface ResponseInfo {
  status: number;
  statusText: string;
  durationMs: number;
  headers: [string, string][];
  body: string;
  ok: boolean;
  error?: string;
}

// Antwort-Body hübsch machen: JSON einrücken, sonst Rohtext (gedeckelt).
const MAX_BODY_CHARS = 200_000;
function prettify(text: string, contentType: string | null): string {
  const capped = text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) + '\n… (gekürzt)' : text;
  if (contentType && contentType.includes('json')) {
    try {
      return JSON.stringify(JSON.parse(capped), null, 2);
    } catch {
      return capped;
    }
  }
  return capped;
}

// Kleine Request-Historie (letzte Anfragen) in localStorage, wie die übrigen
// Dashboard-Einstellungen. SSR-sicher.
const HISTORY_KEY = 'deskos.apiConsoleHistory';
interface HistoryEntry {
  method: Method;
  path: string;
  body?: string;
}
function loadHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}
function saveHistory(entries: HistoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

const holoField =
  'rounded-none border border-accent/30 bg-darker/60 px-3 py-1.5 text-sm text-white ' +
  'placeholder:text-accent/30 outline-none transition-colors focus:border-accent focus:shadow-glow-sm';

export function ApiConsoleView() {
  const setActiveView = useDashboardStore((s) => s.setActiveView);

  const [method, setMethod] = useState<Method>('GET');
  const [path, setPath] = useState('/api/devices');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<ResponseInfo | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // Base-URL nur auf dem Client bestimmen (SSR-sicher, vermeidet Hydration-Mismatch).
  const [baseUrl, setBaseUrl] = useState('');

  const hasToken = useMemo(() => getAuthToken() !== undefined, []);
  const showBody = BODY_METHODS.includes(method);

  useEffect(() => {
    // Auth-Fetch ist i. d. R. schon vom Store installiert – hier idempotent absichern.
    installAuthFetch();
    setBaseUrl(getApiBaseUrl());
    setHistory(loadHistory());
  }, []);

  const applyEndpoint = (ep: Endpoint) => {
    setMethod(ep.method);
    setPath(ep.path);
    setBody(ep.body ?? '');
    setResponse(null);
  };

  const rememberRequest = (entry: HistoryEntry) => {
    const next = [entry, ...history.filter((h) => !(h.method === entry.method && h.path === entry.path))].slice(0, 12);
    setHistory(next);
    saveHistory(next);
  };

  const send = async () => {
    if (sending) return;
    const trimmedPath = path.trim();
    if (!trimmedPath) return;
    const normalizedPath = trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`;

    // Body für POST/PATCH validieren (leerer Body ist erlaubt).
    let requestBody: string | undefined;
    if (showBody && body.trim()) {
      try {
        JSON.parse(body);
        requestBody = body;
      } catch (err) {
        setResponse({
          status: 0,
          statusText: '',
          durationMs: 0,
          headers: [],
          body: `Ungültiges JSON im Body:\n${err instanceof Error ? err.message : String(err)}`,
          ok: false,
          error: 'invalid-json',
        });
        return;
      }
    }

    setSending(true);
    setResponse(null);
    const url = getApiBaseUrl() + normalizedPath;
    const started = performance.now();
    try {
      const headers: Record<string, string> = {};
      if (requestBody) headers['Content-Type'] = 'application/json';
      const res = await fetch(url, { method, headers, body: requestBody });
      const durationMs = Math.round(performance.now() - started);
      const contentType = res.headers.get('content-type');
      const text = await res.text();
      setResponse({
        status: res.status,
        statusText: res.statusText,
        durationMs,
        headers: Array.from(res.headers.entries()),
        body: prettify(text, contentType),
        ok: res.ok,
      });
      rememberRequest({ method, path: normalizedPath, body: showBody ? body : undefined });
    } catch (err) {
      const durationMs = Math.round(performance.now() - started);
      setResponse({
        status: 0,
        statusText: 'Network Error',
        durationMs,
        headers: [],
        body: `Anfrage fehlgeschlagen:\n${err instanceof Error ? err.message : String(err)}\n\nBackend erreichbar? URL: ${url}`,
        ok: false,
        error: 'network',
      });
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Strg/⌘ + Enter schickt die Anfrage ab (praktisch aus dem Body heraus).
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="container mx-auto px-4 py-8" onKeyDown={onKeyDown}>
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
            <HoloIcon name="code" className="h-5 w-5 text-accent" />
            <h2
              className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent"
              style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}
            >
              API Console
            </h2>
          </div>
        </div>
        <span
          className={clsx(
            'rounded-none border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider',
            hasToken ? 'text-success border-success/40' : 'text-accent/50 border-accent/20'
          )}
          title={hasToken ? 'Requests tragen automatisch den DeskOS-Token' : 'Kein Token gesetzt (Auth deaktiviert)'}
        >
          {hasToken ? 'AUTH · TOKEN' : 'AUTH · AUS'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        {/* ===================== Left: request + response ===================== */}
        <div className="flex flex-col gap-4">
          <Panel title="Request">
            <div className="flex flex-col gap-3">
              {/* Method + Path + Send */}
              <div className="flex flex-wrap items-stretch gap-2">
                <select
                  aria-label="HTTP-Methode"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as Method)}
                  className={clsx(holoField, 'cursor-pointer font-mono uppercase')}
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  aria-label="Pfad"
                  spellCheck={false}
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/api/devices"
                  className={clsx(holoField, 'min-w-[12rem] flex-1 font-mono')}
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={sending}
                  className="flex items-center gap-1.5 rounded-none border border-accent bg-accent/15 px-4 py-1.5 font-mono text-sm uppercase tracking-wider text-accent shadow-glow-sm transition-colors hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <HoloIcon name="zap" className="h-4 w-4" />
                  {sending ? 'Senden…' : 'Senden'}
                </button>
              </div>

              {/* Vollständige Ziel-URL zur Kontrolle */}
              <div className="truncate font-mono text-[10px] text-accent/45">
                → {baseUrl}
                {path.trim().startsWith('/') || !path.trim() ? '' : '/'}
                {path.trim()}
              </div>

              {/* JSON-Body (nur POST/PATCH) */}
              {showBody && (
                <div>
                  <label className="holo-label mb-1 block">Body (JSON)</label>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    spellCheck={false}
                    rows={6}
                    placeholder={'{\n  "key": "value"\n}'}
                    className={clsx(holoField, 'w-full resize-y font-mono text-[13px] leading-relaxed')}
                  />
                  {!['GET', 'DELETE'].includes(method) && (
                    <p className="mt-1 font-mono text-[10px] text-warning/70">
                      Achtung: {method} verändert echten Backend-Zustand.
                    </p>
                  )}
                </div>
              )}

              <p className="font-mono text-[10px] text-accent/40">Tipp: Strg/⌘ + Enter sendet die Anfrage.</p>
            </div>
          </Panel>

          <Panel
            title="Response"
            badge={
              response ? (
                <span className="flex items-center gap-2 font-mono text-[10px]">
                  <span className={clsx('rounded-none border px-2 py-0.5 uppercase tracking-wider', statusColor(response.status))}>
                    {response.status > 0 ? `${response.status} ${response.statusText}` : 'FEHLER'}
                  </span>
                  <span className="text-accent/50">{response.durationMs} ms</span>
                </span>
              ) : null
            }
          >
            {!response ? (
              <p className="py-10 text-center text-[12px] text-accent/40">
                Noch keine Anfrage gesendet. Wähle einen Endpunkt oder gib einen Pfad ein.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <pre className="max-h-[46vh] overflow-auto rounded-none border border-accent/15 bg-[#060a0f] p-3 font-mono text-[12px] leading-relaxed text-[#c8f5ff]">
                  {response.body || '(leerer Body)'}
                </pre>
                {response.headers.length > 0 && (
                  <details className="group">
                    <summary className="holo-label cursor-pointer select-none">
                      Response-Header ({response.headers.length})
                    </summary>
                    <div className="mt-2 space-y-0.5 border-l border-accent/15 pl-3 font-mono text-[11px]">
                      {response.headers.map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <span className="text-accent/60">{k}:</span>
                          <span className="break-all text-white/70">{v}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </Panel>
        </div>

        {/* ===================== Right: catalog + history ===================== */}
        <div className="flex flex-col gap-4">
          <Panel title="Endpunkte">
            <div className="max-h-[42vh] space-y-3 overflow-y-auto pr-1">
              {CATALOG.map((section) => (
                <div key={section.group}>
                  <div className="holo-label mb-1">{section.group}</div>
                  <ul className="space-y-1">
                    {section.items.map((ep) => (
                      <li key={`${ep.method} ${ep.path}`}>
                        <button
                          type="button"
                          onClick={() => applyEndpoint(ep)}
                          title={ep.desc}
                          className="group flex w-full items-center gap-2 rounded-none border border-accent/15 bg-accent/5 px-2 py-1.5 text-left transition-colors hover:border-accent/50 hover:bg-accent/10"
                        >
                          <span className={clsx('w-12 shrink-0 font-mono text-[9px] font-bold uppercase', statusMethodColor(ep.method))}>
                            {ep.method}
                          </span>
                          <span className="truncate font-mono text-[11px] text-white/75 group-hover:text-white">{ep.path}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Panel>

          {history.length > 0 && (
            <Panel
              title="Verlauf"
              badge={
                <button
                  type="button"
                  onClick={() => {
                    setHistory([]);
                    saveHistory([]);
                  }}
                  className="font-mono text-[10px] uppercase tracking-wider text-accent/50 transition-colors hover:text-danger"
                >
                  Leeren
                </button>
              }
            >
              <ul className="max-h-[24vh] space-y-1 overflow-y-auto pr-1">
                {history.map((h, i) => (
                  <li key={`${h.method} ${h.path} ${i}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setMethod(h.method);
                        setPath(h.path);
                        setBody(h.body ?? '');
                        setResponse(null);
                      }}
                      className="group flex w-full items-center gap-2 rounded-none px-1 py-1 text-left transition-colors hover:bg-accent/10"
                    >
                      <span className={clsx('w-12 shrink-0 font-mono text-[9px] font-bold uppercase', statusMethodColor(h.method))}>
                        {h.method}
                      </span>
                      <span className="truncate font-mono text-[11px] text-white/70 group-hover:text-white">{h.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Backend">
            <div className="space-y-1 font-mono text-[11px]">
              <div className="flex justify-between">
                <span className="text-accent/50">Port</span>
                <span className="text-white/80">{getBackendPort()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-accent/50">Auth</span>
                <span className="text-white/80">{hasToken ? 'Token aktiv' : 'deaktiviert'}</span>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

// Farbe des Methoden-Kürzels (GET grün, schreibende Methoden wärmer).
function statusMethodColor(method: Method): string {
  switch (method) {
    case 'GET':
      return 'text-success';
    case 'POST':
      return 'text-accent';
    case 'PATCH':
      return 'text-warning';
    case 'DELETE':
      return 'text-danger';
    default:
      return 'text-accent';
  }
}
