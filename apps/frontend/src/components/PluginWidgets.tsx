'use client';

import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { useDashboardStore, type PluginInstance } from '@/stores/dashboardStore';
import { getApiBaseUrl } from '@/lib/api';
import { Panel, HoloIcon, StatBar } from '@/components/holo';
import type { SpotifyStatus, SpotifyTrack, DiscordStatus, DiscordUser, BambuStatus } from '@shared/types';

/* =========================================================================
   DeskOS plugin widgets (M6)

   Enabled plugins with a widget render here. Built-in functional plugins
   (clock, system-summary) show real content; external-service plugins show a
   "configure" placeholder until credentials are provided.
   ========================================================================= */

function ClockWidget() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <Panel title="Uhr">
      <div className="py-2 text-center">
        <div className="holo-value text-4xl tracking-wider">
          {now ? now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '--:--:--'}
        </div>
        <div className="holo-label mt-1">
          {now ? now.toLocaleDateString([], { weekday: 'long', day: '2-digit', month: 'long' }) : '—'}
        </div>
      </div>
    </Panel>
  );
}

function SystemSummaryWidget() {
  const m = useDashboardStore((s) => s.systemMetrics);
  const fmtRate = (b?: number) => (b == null ? 'N/A' : b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB/s` : `${Math.round((b ?? 0) / 1024)} KB/s`);
  return (
    <Panel title="System-Übersicht">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <StatBar label="CPU" value={m ? `${Math.round(m.cpu)}%` : 'N/A'} percent={m ? m.cpu : undefined} />
        <StatBar label="RAM" value={m ? `${Math.round(m.ram.percentage)}%` : 'N/A'} percent={m ? m.ram.percentage : undefined} />
        <StatBar label="Netz ↓" value={fmtRate(m?.network?.rxSec)} />
        <StatBar label="Netz ↑" value={fmtRate(m?.network?.txSec)} />
      </div>
    </Panel>
  );
}

function PlaceholderWidget({ plugin }: { plugin: PluginInstance }) {
  const setActiveView = useDashboardStore((s) => s.setActiveView);
  const configured = plugin.configured;
  return (
    <Panel title={plugin.name}>
      <div className="flex flex-col items-center gap-2 py-5 text-center">
        <HoloIcon name={plugin.icon} className="h-7 w-7 text-accent/50" />
        <p className="text-[12px] text-accent/55">{configured ? 'Verbinde…' : 'Konfiguration erforderlich'}</p>
        {!configured && (
          <button
            type="button"
            onClick={() => setActiveView('plugins')}
            className="rounded-none border border-accent/40 px-2.5 py-1 text-[10px] uppercase tracking-wider text-accent hover:bg-accent/10"
          >
            Einrichten
          </button>
        )}
      </div>
    </Panel>
  );
}

/* ----------------------------- Spotify --------------------------------- */

const fmtTime = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

function SpotifyWidget() {
  const setActiveView = useDashboardStore((s) => s.setActiveView);
  const base = getApiBaseUrl();
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [track, setTrack] = useState<SpotifyTrack | null>(null);
  const [busy, setBusy] = useState(false);
  // Lokaler Fortschritts-Ticker zwischen den Polls (alle 5s) für eine flüssige Leiste.
  const [now, setNow] = useState(Date.now());
  const polledAt = useRef(Date.now());

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`${base}/api/spotify/status`);
      if (res.ok) setStatus((await res.json()) as SpotifyStatus);
    } catch {
      /* ignore */
    }
  }, [base]);

  const loadTrack = useCallback(async () => {
    try {
      const res = await fetch(`${base}/api/spotify/now-playing`);
      const data = res.ok ? ((await res.json()) as SpotifyTrack | null) : null;
      setTrack(data);
      polledAt.current = Date.now();
    } catch {
      /* ignore */
    }
  }, [base]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Bei bestehender Verbindung den aktuellen Titel pollen.
  useEffect(() => {
    if (!status?.connected) return;
    void loadTrack();
    const id = setInterval(() => void loadTrack(), 5000);
    return () => clearInterval(id);
  }, [status?.connected, loadTrack]);

  // 1s-Ticker für die Fortschrittsanzeige.
  useEffect(() => {
    if (!track?.isPlaying) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [track?.isPlaying]);

  // Nach erfolgreichem Popup-Login den Status neu laden.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'deskos:spotify') void loadStatus();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [loadStatus]);

  const login = async () => {
    try {
      const res = await fetch(`${base}/api/spotify/login`);
      if (!res.ok) return;
      const { url } = (await res.json()) as { url: string };
      window.open(url, 'deskos-spotify-login', 'width=480,height=720');
    } catch {
      /* ignore */
    }
  };

  const control = async (action: 'play' | 'pause' | 'next' | 'previous') => {
    setBusy(true);
    // Optimistisch: Play/Pause sofort umschalten.
    if (track && (action === 'play' || action === 'pause')) {
      setTrack({ ...track, isPlaying: action === 'play' });
    }
    try {
      await fetch(`${base}/api/spotify/control/${action}`, { method: 'POST' });
    } catch {
      /* ignore */
    } finally {
      setTimeout(() => void loadTrack(), 500);
      setBusy(false);
    }
  };

  const disconnect = async () => {
    try {
      await fetch(`${base}/api/spotify/disconnect`, { method: 'POST' });
    } catch {
      /* ignore */
    }
    setTrack(null);
    void loadStatus();
  };

  // 1) Keine Zugangsdaten -> zur Plugin-Einrichtung schicken.
  if (status && !status.hasCredentials) {
    return (
      <Panel title="Spotify">
        <div className="flex flex-col items-center gap-2 py-5 text-center">
          <HoloIcon name="speaker" className="h-7 w-7 text-accent/50" />
          <p className="text-[12px] text-accent/55">Konfiguration erforderlich</p>
          <button
            type="button"
            onClick={() => setActiveView('plugins')}
            className="rounded-none border border-accent/40 px-2.5 py-1 text-[10px] uppercase tracking-wider text-accent hover:bg-accent/10"
          >
            Einrichten
          </button>
        </div>
      </Panel>
    );
  }

  // 2) Zugangsdaten vorhanden, aber noch nicht verbunden -> Login anbieten.
  if (status && !status.connected) {
    return (
      <Panel title="Spotify">
        <div className="flex flex-col items-center gap-2 py-5 text-center">
          <HoloIcon name="speaker" className="h-7 w-7 text-success/70" />
          <p className="text-[12px] text-accent/55">Mit deinem Spotify-Konto verbinden</p>
          <button
            type="button"
            onClick={() => void login()}
            className="rounded-none border border-success/50 px-3 py-1 text-[11px] uppercase tracking-wider text-success hover:bg-success/10"
          >
            Verbinden
          </button>
        </div>
      </Panel>
    );
  }

  // 3) Verbunden, aber nichts läuft.
  if (status && status.connected && !track) {
    return (
      <Panel title="Spotify">
        <div className="flex flex-col items-center gap-2 py-5 text-center">
          <HoloIcon name="speaker" className="h-7 w-7 text-accent/40" />
          <p className="text-[12px] text-accent/55">Aktuell wird nichts abgespielt</p>
          <button
            type="button"
            onClick={() => void disconnect()}
            className="text-[10px] uppercase tracking-wider text-danger/60 transition-colors hover:text-danger"
          >
            Trennen
          </button>
        </div>
      </Panel>
    );
  }

  // 4) Verbunden + Titel läuft -> Now Playing + Steuerung.
  if (status && status.connected && track) {
    const elapsed = track.isPlaying ? now - polledAt.current : 0;
    const progress = Math.min(track.durationMs, track.progressMs + elapsed);
    const percent = track.durationMs ? (progress / track.durationMs) * 100 : 0;
    const secondaryBtn =
      'flex h-8 w-8 items-center justify-center rounded-none border border-accent/30 text-accent/80 transition-colors hover:bg-accent/10 disabled:opacity-50';
    const primaryBtn =
      'flex h-10 w-10 items-center justify-center rounded-full border border-success/60 text-success transition-colors hover:bg-success/15 disabled:opacity-50';

    return (
      <Panel title="Spotify">
        <div className="flex gap-3">
          {track.albumArt ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={track.albumArt} alt={track.album} className="h-16 w-16 shrink-0 border border-accent/20 object-cover" />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center border border-accent/20 bg-accent/5">
              <HoloIcon name="speaker" className="h-7 w-7 text-accent/40" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm font-bold text-white" title={track.title}>
              {track.title || '—'}
            </p>
            <p className="truncate text-[12px] text-accent/60" title={track.artists}>
              {track.artists}
            </p>
            <div className="mt-2 h-1 w-full bg-accent/10">
              <div className="h-full bg-success shadow-glow-sm" style={{ width: `${percent}%`, transition: 'width 1s linear' }} />
            </div>
            <div className="mt-1 flex justify-between font-mono text-[10px] text-accent/40">
              <span>{fmtTime(progress)}</span>
              <span>{fmtTime(track.durationMs)}</span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-center gap-3">
          <button type="button" aria-label="Zurück" disabled={busy} onClick={() => void control('previous')} className={secondaryBtn}>
            <HoloIcon name="skip-back" className="h-4 w-4" />
          </button>
          {track.isPlaying ? (
            <button type="button" aria-label="Pause" disabled={busy} onClick={() => void control('pause')} className={primaryBtn}>
              <HoloIcon name="pause" className="h-5 w-5" />
            </button>
          ) : (
            <button type="button" aria-label="Wiedergabe" disabled={busy} onClick={() => void control('play')} className={primaryBtn}>
              <HoloIcon name="play" className="h-5 w-5" />
            </button>
          )}
          <button type="button" aria-label="Weiter" disabled={busy} onClick={() => void control('next')} className={secondaryBtn}>
            <HoloIcon name="skip-forward" className="h-4 w-4" />
          </button>
        </div>
      </Panel>
    );
  }

  // Initialer Ladezustand.
  return (
    <Panel title="Spotify">
      <div className="py-6 text-center text-[12px] text-accent/40">Lade…</div>
    </Panel>
  );
}

/* ----------------------------- Discord --------------------------------- */

function DiscordWidget() {
  const setActiveView = useDashboardStore((s) => s.setActiveView);
  const base = getApiBaseUrl();
  const [status, setStatus] = useState<DiscordStatus | null>(null);
  const [profile, setProfile] = useState<DiscordUser | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`${base}/api/discord/status`);
      if (res.ok) setStatus((await res.json()) as DiscordStatus);
    } catch {
      /* ignore */
    }
  }, [base]);

  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch(`${base}/api/discord/profile`);
      const data = res.ok ? ((await res.json()) as DiscordUser | null) : null;
      setProfile(data);
    } catch {
      /* ignore */
    }
  }, [base]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!status?.connected) return;
    void loadProfile();
  }, [status?.connected, loadProfile]);

  // Nach erfolgreichem Popup-Login den Status neu laden.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'deskos:discord') void loadStatus();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [loadStatus]);

  const login = async () => {
    try {
      const res = await fetch(`${base}/api/discord/login`);
      if (!res.ok) return;
      const { url } = (await res.json()) as { url: string };
      window.open(url, 'deskos-discord-login', 'width=480,height=720');
    } catch {
      /* ignore */
    }
  };

  const disconnect = async () => {
    try {
      await fetch(`${base}/api/discord/disconnect`, { method: 'POST' });
    } catch {
      /* ignore */
    }
    setProfile(null);
    void loadStatus();
  };

  // 1) Keine Zugangsdaten -> zur Plugin-Einrichtung schicken.
  if (status && !status.hasCredentials) {
    return (
      <Panel title="Discord">
        <div className="flex flex-col items-center gap-2 py-5 text-center">
          <HoloIcon name="shield" className="h-7 w-7 text-accent/50" />
          <p className="text-[12px] text-accent/55">Konfiguration erforderlich</p>
          <button
            type="button"
            onClick={() => setActiveView('plugins')}
            className="rounded-none border border-accent/40 px-2.5 py-1 text-[10px] uppercase tracking-wider text-accent hover:bg-accent/10"
          >
            Einrichten
          </button>
        </div>
      </Panel>
    );
  }

  // 2) Zugangsdaten vorhanden, aber noch nicht verbunden -> Login anbieten.
  if (status && !status.connected) {
    return (
      <Panel title="Discord">
        <div className="flex flex-col items-center gap-2 py-5 text-center">
          <HoloIcon name="shield" className="h-7 w-7 text-success/70" />
          <p className="text-[12px] text-accent/55">Mit deinem Discord-Konto verbinden</p>
          <button
            type="button"
            onClick={() => void login()}
            className="rounded-none border border-success/50 px-3 py-1 text-[11px] uppercase tracking-wider text-success hover:bg-success/10"
          >
            Verbinden
          </button>
        </div>
      </Panel>
    );
  }

  // 3) Verbunden -> Profil anzeigen.
  if (status && status.connected && profile) {
    return (
      <Panel title="Discord">
        <div className="flex items-center gap-3">
          {profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatarUrl} alt={profile.username} className="h-16 w-16 shrink-0 rounded-full border border-accent/20 object-cover" />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center border border-accent/20 bg-accent/5">
              <HoloIcon name="shield" className="h-7 w-7 text-accent/40" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm font-bold text-white">{profile.globalName || profile.username}</p>
            <p className="truncate text-[12px] text-accent/60">@{profile.username}</p>
            <button
              type="button"
              onClick={() => void disconnect()}
              className="mt-2 text-[10px] uppercase tracking-wider text-danger/60 transition-colors hover:text-danger"
            >
              Trennen
            </button>
          </div>
        </div>
      </Panel>
    );
  }

  // Initialer Ladezustand.
  return (
    <Panel title="Discord">
      <div className="py-6 text-center text-[12px] text-accent/40">Lade…</div>
    </Panel>
  );
}

/* ----------------------------- Bambu Lab ------------------------------- */

// Restzeit (Minuten) -> "1 h 12 min" bzw. "12 min".
const fmtEta = (min: number) => {
  if (!min || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
};

const BAMBU_STATE_LABEL: Record<string, string> = {
  RUNNING: 'Druckt',
  PAUSE: 'Pausiert',
  FINISH: 'Fertig',
  FAILED: 'Fehlgeschlagen',
  PREPARE: 'Vorbereitung',
  SLICING: 'Wird vorbereitet',
  IDLE: 'Bereit',
};

// Trennt die Cloud-Verbindung (verwirft das gespeicherte Token).
function BambuLogout({ base, onDone }: { base: string; onDone: () => void }) {
  const logout = async () => {
    try {
      await fetch(`${base}/api/bambu/cloud/logout`, { method: 'POST' });
    } catch {
      /* ignore */
    }
    onDone();
  };
  return (
    <button
      type="button"
      onClick={() => void logout()}
      className="text-[10px] uppercase tracking-wider text-danger/60 transition-colors hover:text-danger"
    >
      Cloud trennen
    </button>
  );
}

// Verbindungsauswahl: Bambu-Cloud-Login (E-Mail/Passwort + ggf. E-Mail-Code)
// oder Hinweis auf die lokale (LAN-)Einrichtung.
function BambuConnect({ base, onDone, onLocal }: { base: string; onDone: () => void; onLocal: () => void }) {
  const [step, setStep] = useState<'choose' | 'form' | 'code'>('choose');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [region, setRegion] = useState<'global' | 'china'>('global');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input =
    'w-full rounded-none border border-accent/30 bg-black/30 px-2 py-1 font-mono text-[12px] text-white outline-none focus:border-accent';
  const primary =
    'rounded-none border border-success/50 px-3 py-1 text-[11px] uppercase tracking-wider text-success transition-colors hover:bg-success/10 disabled:opacity-50';
  const ghost = 'text-[10px] uppercase tracking-wider text-accent/50 transition-colors hover:text-accent';

  const submitLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/api/bambu/cloud/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, region }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.status === 'ok') onDone();
      else if (data.status === 'verifyCode') setStep('code');
      else setError(data.message || data.error || 'Login fehlgeschlagen.');
    } catch {
      setError('Netzwerkfehler.');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/api/bambu/cloud/code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, region }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.status === 'ok') onDone();
      else setError(data.message || data.error || 'Code ungültig.');
    } catch {
      setError('Netzwerkfehler.');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'choose') {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <HoloIcon name="layers" className="h-7 w-7 text-accent/50" />
        <p className="text-[12px] text-accent/55">Drucker verbinden</p>
        <button type="button" onClick={() => setStep('form')} className={primary}>
          Bambu-Konto (Cloud)
        </button>
        <button type="button" onClick={onLocal} className={ghost}>
          oder lokal (LAN) einrichten
        </button>
      </div>
    );
  }

  if (step === 'code') {
    return (
      <div className="flex flex-col gap-2 py-3">
        <p className="text-[11px] text-accent/55">Verifizierungscode aus der E-Mail eingeben:</p>
        <input
          className={input}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Code"
          inputMode="numeric"
        />
        {error && <p className="text-[10px] text-danger">{error}</p>}
        <div className="mt-1 flex items-center justify-between">
          <button type="button" onClick={() => setStep('form')} className={ghost}>
            Zurück
          </button>
          <button type="button" disabled={busy || !code} onClick={() => void submitCode()} className={primary}>
            Bestätigen
          </button>
        </div>
      </div>
    );
  }

  // step === 'form'
  return (
    <div className="flex flex-col gap-2 py-3">
      <input
        className={input}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Bambu-E-Mail"
        type="email"
        autoComplete="username"
      />
      <input
        className={input}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Passwort"
        type="password"
        autoComplete="current-password"
      />
      <select className={input} value={region} onChange={(e) => setRegion(e.target.value as 'global' | 'china')}>
        <option value="global">Region: Global (EU/US)</option>
        <option value="china">Region: China</option>
      </select>
      {error && <p className="text-[10px] text-danger">{error}</p>}
      <div className="mt-1 flex items-center justify-between">
        <button type="button" onClick={() => setStep('choose')} className={ghost}>
          Zurück
        </button>
        <button type="button" disabled={busy || !email || !password} onClick={() => void submitLogin()} className={primary}>
          Anmelden
        </button>
      </div>
    </div>
  );
}

function BambuWidget() {
  const setActiveView = useDashboardStore((s) => s.setActiveView);
  const base = getApiBaseUrl();
  const [status, setStatus] = useState<BambuStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}/api/bambu/status`);
      if (res.ok) setStatus((await res.json()) as BambuStatus);
    } catch {
      /* ignore */
    }
  }, [base]);

  // Status alle 4s pollen (wie das Spotify-Widget – kein WebSocket nötig).
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [load]);

  const control = async (action: 'pause' | 'resume' | 'stop') => {
    setBusy(true);
    try {
      await fetch(`${base}/api/bambu/control/${action}`, { method: 'POST' });
    } catch {
      /* ignore */
    } finally {
      setTimeout(() => void load(), 800);
      setBusy(false);
    }
  };

  // 1) Kein Modus aktiv -> Verbindungsauswahl (Cloud-Login oder LAN-Hinweis).
  if (status && status.mode === 'none') {
    return (
      <Panel title="Bambu Lab A1">
        <BambuConnect base={base} onDone={() => void load()} onLocal={() => setActiveView('plugins')} />
      </Panel>
    );
  }

  // 2) Modus aktiv, aber Drucker (noch) nicht erreichbar.
  if (status && !status.online) {
    const cloud = status.mode === 'cloud';
    return (
      <Panel title="Bambu Lab A1">
        <div className="flex flex-col items-center gap-2 py-5 text-center">
          <HoloIcon name="layers" className="h-7 w-7 text-accent/40" />
          <p className="text-[12px] text-accent/55">
            {cloud ? 'Cloud verbunden – warte auf Druckerdaten …' : 'Drucker nicht erreichbar'}
          </p>
          <p className="text-[10px] text-accent/35">
            {cloud ? 'Der Drucker meldet sich, sobald er online ist.' : 'Verbindung wird versucht …'}
          </p>
          {cloud && <BambuLogout base={base} onDone={() => void load()} />}
        </div>
      </Panel>
    );
  }

  // 3) Drucker erreichbar.
  if (status && status.online) {
    const printing = status.gcodeState === 'RUNNING' || status.gcodeState === 'PAUSE';
    const paused = status.gcodeState === 'PAUSE';
    const label = BAMBU_STATE_LABEL[status.gcodeState] ?? status.gcodeState ?? 'Bereit';
    const btn = 'rounded-none border px-3 py-1 text-[11px] uppercase tracking-wider transition-colors disabled:opacity-50';

    const temps = (
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        <StatBar label="Düse" value={`${Math.round(status.nozzleTemp)}°C / ${Math.round(status.nozzleTarget)}°C`} />
        <StatBar label="Bett" value={`${Math.round(status.bedTemp)}°C / ${Math.round(status.bedTarget)}°C`} />
      </div>
    );

    // Kein aktiver Druck -> Bereitschaft + Temperaturen.
    if (!printing) {
      return (
        <Panel title="Bambu Lab A1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HoloIcon name="layers" className="h-5 w-5 text-success/70" />
              <span className="font-mono text-sm font-bold text-white">{label}</span>
            </div>
            <span className="holo-label">kein Druck aktiv</span>
          </div>
          {temps}
          {status.mode === 'cloud' && (
            <div className="mt-3 text-center">
              <BambuLogout base={base} onDone={() => void load()} />
            </div>
          )}
        </Panel>
      );
    }

    // Aktiver Druck -> Fortschritt, Restzeit, Layer, Temperaturen, Steuerung.
    const percent = Math.max(0, Math.min(100, status.progress));
    return (
      <Panel title="Bambu Lab A1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 flex-1 truncate font-mono text-sm font-bold text-white" title={status.jobName}>
            {status.jobName || 'Druck läuft'}
          </p>
          <span className={`shrink-0 text-[11px] uppercase tracking-wider ${paused ? 'text-warning' : 'text-success'}`}>{label}</span>
        </div>

        <div className="mt-2 h-1.5 w-full bg-accent/10">
          <div className="h-full bg-success shadow-glow-sm" style={{ width: `${percent}%`, transition: 'width 0.6s ease' }} />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-accent/50">
          <span>{Math.round(status.progress)} %</span>
          <span>
            Layer {status.layerNum}/{status.totalLayers}
          </span>
          <span>noch {fmtEta(status.remainingMin)}</span>
        </div>

        {temps}

        <div className="mt-3 flex items-center justify-center gap-2">
          {paused ? (
            <button type="button" disabled={busy} onClick={() => void control('resume')} className={`${btn} border-success/50 text-success hover:bg-success/10`}>
              Fortsetzen
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void control('pause')} className={`${btn} border-accent/40 text-accent hover:bg-accent/10`}>
              Pause
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void control('stop')} className={`${btn} border-danger/50 text-danger hover:bg-danger/10`}>
            Abbrechen
          </button>
        </div>
      </Panel>
    );
  }

  // Initialer Ladezustand.
  return (
    <Panel title="Bambu Lab A1">
      <div className="py-6 text-center text-[12px] text-accent/40">Lade…</div>
    </Panel>
  );
}

const BUILTIN_WIDGETS: Record<string, ComponentType> = {
  clock: ClockWidget,
  'system-summary': SystemSummaryWidget,
  spotify: SpotifyWidget,
  discord: DiscordWidget,
  bambu: BambuWidget,
};

export function PluginWidgets() {
  const plugins = useDashboardStore((s) => s.plugins);
  const active = plugins.filter((p) => p.enabled && p.hasWidget);
  if (active.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="mb-4 flex items-center gap-2">
        <HoloIcon name="plug" className="h-5 w-5 text-accent" />
        <h2 className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent" style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}>
          Plugins
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {active.map((p) => {
          const Widget = BUILTIN_WIDGETS[p.id];
          return Widget ? <Widget key={p.id} /> : <PlaceholderWidget key={p.id} plugin={p} />;
        })}
      </div>
    </section>
  );
}
