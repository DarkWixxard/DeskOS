// Spotify Service (Media-Plugin)
//
// Echte Anbindung des Spotify-Katalog-Plugins über die Spotify Web API:
//   - OAuth 2.0 Authorization-Code-Flow (Login im Browser-Popup)
//   - Access-Token-Verwaltung inkl. automatischem Refresh
//   - "Now Playing" (aktueller Titel) abrufen
//   - Wiedergabesteuerung (Play / Pause / Next / Previous)
//
// Client-ID/Secret kommen aus den Plugin-Settings (UI) oder optional aus den
// Umgebungsvariablen SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET. Der Refresh-Token
// wird in den Plugin-Settings persistiert (überlebt Neustarts) und – wie alle
// Secrets – nie über die REST-API herausgegeben.

import { randomUUID } from 'crypto';
import { eventSystem } from '../core/EventSystem';
import type { PluginRegistry } from './PluginRegistry';
import type { SpotifyStatus, SpotifyTrack } from '@shared/types';

const PLUGIN_ID = 'spotify';
const ACCOUNTS_BASE = 'https://accounts.spotify.com';
const API_BASE = 'https://api.spotify.com/v1';

// Benötigte Scopes: Wiedergabestatus lesen, aktuell laufenden Titel lesen,
// Wiedergabe steuern.
const SCOPES = ['user-read-playback-state', 'user-read-currently-playing', 'user-modify-playback-state'].join(' ');

// OAuth-States verfallen nach 10 Minuten (CSRF-Schutz).
const STATE_TTL_MS = 10 * 60 * 1000;

interface Credentials {
  clientId: string;
  clientSecret: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export type PlaybackAction = 'play' | 'pause' | 'next' | 'previous';

export class SpotifyService {
  private readonly registry: PluginRegistry;
  private readonly redirectUri: string;
  private readonly requestTimeoutMs = 8000;

  private accessToken: string | null = null;
  private accessTokenExpiry = 0; // epoch ms (mit 60s Sicherheitsabstand)
  private refreshToken: string | null = null;
  private refreshing: Promise<string | null> | null = null;
  private readonly pendingStates = new Map<string, number>();

  constructor(registry: PluginRegistry) {
    this.registry = registry;
    const port = process.env.BACKEND_PORT || process.env.PORT || 4001;
    // Spotify verlangt für Loopback-Redirects ausdrücklich 127.0.0.1 (nicht
    // "localhost"). Per SPOTIFY_REDIRECT_URI überschreibbar (z. B. LAN/Tailscale).
    this.redirectUri = process.env.SPOTIFY_REDIRECT_URI || `http://127.0.0.1:${port}/api/spotify/callback`;
  }

  /** Persistierten Refresh-Token aus den Plugin-Settings laden (beim Start). */
  restore(): void {
    const refresh = this.registry.getSettings(PLUGIN_ID).refreshToken;
    if (refresh) this.refreshToken = refresh;
  }

  // ------------------------------------------------------------------ status

  private credentials(): Credentials | null {
    const s = this.registry.getSettings(PLUGIN_ID);
    const clientId = (s.clientId || process.env.SPOTIFY_CLIENT_ID || '').trim();
    const clientSecret = (s.clientSecret || process.env.SPOTIFY_CLIENT_SECRET || '').trim();
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  }

  getStatus(): SpotifyStatus {
    return {
      hasCredentials: this.credentials() !== null,
      connected: this.refreshToken !== null,
      redirectUri: this.redirectUri,
    };
  }

  // -------------------------------------------------------------- OAuth flow

  /** Baut die Spotify-Login-URL (Authorization-Code-Flow) inkl. CSRF-State. */
  getAuthUrl(): string {
    const creds = this.credentials();
    if (!creds) throw new Error('Spotify Client ID/Secret fehlen – bitte zuerst im Plugin hinterlegen.');
    const state = randomUUID();
    this.pendingStates.set(state, Date.now());
    this.pruneStates();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: creds.clientId,
      scope: SCOPES,
      redirect_uri: this.redirectUri,
      state,
    });
    return `${ACCOUNTS_BASE}/authorize?${params.toString()}`;
  }

  /** Verarbeitet den OAuth-Callback: Code gegen Tokens tauschen + speichern. */
  async handleCallback(code: string, state: string): Promise<void> {
    if (!this.pendingStates.has(state)) throw new Error('Ungültiger oder abgelaufener OAuth-State.');
    this.pendingStates.delete(state);
    const creds = this.credentials();
    if (!creds) throw new Error('Spotify Client ID/Secret fehlen.');

    const tokens = await this.tokenRequest(
      creds,
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri })
    );
    this.applyTokens(tokens);
    if (tokens.refresh_token) {
      await this.storeRefreshToken(tokens.refresh_token);
    }
    eventSystem.emit('spotify:connected', { connected: true }, 'spotify-service');
  }

  /** Trennt die Verbindung: Tokens verwerfen + Refresh-Token aus DB entfernen. */
  async disconnect(): Promise<void> {
    this.accessToken = null;
    this.accessTokenExpiry = 0;
    this.refreshToken = null;
    await this.registry.clearSettings(PLUGIN_ID, ['refreshToken']);
    eventSystem.emit('spotify:connected', { connected: false }, 'spotify-service');
  }

  private pruneStates(): void {
    const now = Date.now();
    for (const [state, created] of this.pendingStates) {
      if (now - created > STATE_TTL_MS) this.pendingStates.delete(state);
    }
  }

  // ------------------------------------------------------------------ tokens

  private applyTokens(t: TokenResponse): void {
    this.accessToken = t.access_token;
    // 60s früher erneuern, um Race-Conditions an der Ablaufgrenze zu vermeiden.
    this.accessTokenExpiry = Date.now() + Math.max(0, t.expires_in - 60) * 1000;
  }

  private async storeRefreshToken(token: string): Promise<void> {
    this.refreshToken = token;
    await this.registry.updateSettings(PLUGIN_ID, { refreshToken: token });
  }

  private async tokenRequest(creds: Credentials, body: URLSearchParams): Promise<TokenResponse> {
    const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
    const res = await fetch(`${ACCOUNTS_BASE}/api/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Spotify-Token-Fehler ${res.status}: ${detail}`);
    }
    return (await res.json()) as TokenResponse;
  }

  /** Gültigen Access-Token liefern (bei Bedarf via Refresh-Token erneuern). */
  private async validAccessToken(): Promise<string | null> {
    if (this.accessToken && Date.now() < this.accessTokenExpiry) return this.accessToken;
    if (!this.refreshToken) return null;
    // Parallele Aufrufe teilen sich denselben Refresh-Request.
    if (!this.refreshing) {
      this.refreshing = this.refreshAccessToken().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async refreshAccessToken(): Promise<string | null> {
    const creds = this.credentials();
    if (!creds || !this.refreshToken) return null;
    try {
      const tokens = await this.tokenRequest(
        creds,
        new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.refreshToken })
      );
      this.applyTokens(tokens);
      // Spotify kann den Refresh-Token rotieren.
      if (tokens.refresh_token && tokens.refresh_token !== this.refreshToken) {
        await this.storeRefreshToken(tokens.refresh_token);
      }
      return this.accessToken;
    } catch {
      // Refresh-Token ungültig -> Verbindung als getrennt behandeln.
      this.accessToken = null;
      this.accessTokenExpiry = 0;
      this.refreshToken = null;
      await this.registry.clearSettings(PLUGIN_ID, ['refreshToken']).catch(() => undefined);
      eventSystem.emit('spotify:connected', { connected: false }, 'spotify-service');
      return null;
    }
  }

  // --------------------------------------------------------------- Web API

  private async api(path: string, init?: RequestInit): Promise<Response | null> {
    const token = await this.validAccessToken();
    if (!token) return null;
    return fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
  }

  /** Aktuell laufenden Titel abrufen (null = nichts aktiv / nicht verbunden). */
  async getNowPlaying(): Promise<SpotifyTrack | null> {
    const res = await this.api('/me/player/currently-playing?additional_types=track').catch(() => null);
    if (!res || res.status === 204 || !res.ok) return null;
    const json = await res.json().catch(() => null);
    return this.toTrack(json);
  }

  /** Wiedergabe steuern. Liefert true bei Erfolg. */
  async control(action: PlaybackAction): Promise<boolean> {
    const route: Record<PlaybackAction, { method: string; path: string }> = {
      play: { method: 'PUT', path: '/me/player/play' },
      pause: { method: 'PUT', path: '/me/player/pause' },
      next: { method: 'POST', path: '/me/player/next' },
      previous: { method: 'POST', path: '/me/player/previous' },
    };
    const { method, path } = route[action];
    const res = await this.api(path, { method }).catch(() => null);
    // 204 = erfolgreich ohne Inhalt; 200 ebenfalls ok.
    return !!res && (res.ok || res.status === 204);
  }

  private toTrack(json: any): SpotifyTrack | null {
    const item = json?.item;
    if (!item) return null;
    const images: Array<{ url: string }> = item.album?.images ?? [];
    return {
      isPlaying: !!json.is_playing,
      title: item.name ?? '',
      artists: Array.isArray(item.artists) ? item.artists.map((a: any) => a?.name).filter(Boolean).join(', ') : '',
      album: item.album?.name ?? '',
      albumArt: images[0]?.url ?? null,
      durationMs: typeof item.duration_ms === 'number' ? item.duration_ms : 0,
      progressMs: typeof json.progress_ms === 'number' ? json.progress_ms : 0,
      trackUrl: item.external_urls?.spotify ?? null,
    };
  }
}

export const createSpotifyService = (registry: PluginRegistry): SpotifyService => new SpotifyService(registry);
