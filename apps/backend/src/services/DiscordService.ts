// Discord Service (Communication-Plugin)
//
// Verbindet das eigene Discord-KONTO per OAuth 2.0 (Authorization-Code-Flow,
// "Login with Discord") – kein Bot-Token, kein Bot-User. Der Nutzer meldet
// sich mit seinem persönlichen Discord-Account an; DeskOS erhält damit nur
// Lesezugriff auf das öffentliche Profil (Scope "identify").
//
// Client-ID/Secret kommen aus den Plugin-Settings (UI) oder optional aus den
// Umgebungsvariablen DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET. Der
// Refresh-Token wird in den Plugin-Settings persistiert (überlebt Neustarts)
// und – wie alle Secrets – nie über die REST-API herausgegeben.

import { randomUUID } from 'crypto';
import { eventSystem } from '../core/EventSystem';
import type { PluginRegistry } from './PluginRegistry';
import type { DiscordStatus, DiscordUser } from '@shared/types';

const PLUGIN_ID = 'discord';
const OAUTH_BASE = 'https://discord.com/api/oauth2';
const API_BASE = 'https://discord.com/api/v10';

// "identify" reicht für Username/Avatar des eigenen Accounts – kein Zugriff
// auf Server, Nachrichten o.ä.
const SCOPES = 'identify';

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

interface DiscordApiUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export class DiscordService {
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
    this.redirectUri = process.env.DISCORD_REDIRECT_URI || `http://localhost:${port}/api/discord/callback`;
  }

  /** Persistierten Refresh-Token aus den Plugin-Settings laden (beim Start). */
  restore(): void {
    const refresh = this.registry.getSettings(PLUGIN_ID).refreshToken;
    if (refresh) this.refreshToken = refresh;
  }

  // ------------------------------------------------------------------ status

  private credentials(): Credentials | null {
    const s = this.registry.getSettings(PLUGIN_ID);
    const clientId = (s.clientId || process.env.DISCORD_CLIENT_ID || '').trim();
    const clientSecret = (s.clientSecret || process.env.DISCORD_CLIENT_SECRET || '').trim();
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  }

  getStatus(): DiscordStatus {
    return {
      hasCredentials: this.credentials() !== null,
      connected: this.refreshToken !== null,
      redirectUri: this.redirectUri,
    };
  }

  // -------------------------------------------------------------- OAuth flow

  /** Baut die Discord-Login-URL (Authorization-Code-Flow) inkl. CSRF-State. */
  getAuthUrl(): string {
    const creds = this.credentials();
    if (!creds) throw new Error('Discord Client ID/Secret fehlen – bitte zuerst im Plugin hinterlegen.');
    const state = randomUUID();
    this.pendingStates.set(state, Date.now());
    this.pruneStates();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: creds.clientId,
      scope: SCOPES,
      redirect_uri: this.redirectUri,
      state,
      prompt: 'consent',
    });
    return `${OAUTH_BASE}/authorize?${params.toString()}`;
  }

  /** Verarbeitet den OAuth-Callback: Code gegen Tokens tauschen + Profil laden. */
  async handleCallback(code: string, state: string): Promise<void> {
    if (!this.pendingStates.has(state)) throw new Error('Ungültiger oder abgelaufener OAuth-State.');
    this.pendingStates.delete(state);
    const creds = this.credentials();
    if (!creds) throw new Error('Discord Client ID/Secret fehlen.');

    const tokens = await this.tokenRequest(
      creds,
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri })
    );
    this.applyTokens(tokens);
    if (tokens.refresh_token) {
      await this.storeRefreshToken(tokens.refresh_token);
    }
    eventSystem.emit('discord:connected', { connected: true }, 'discord-service');
  }

  /** Trennt die Verbindung: Tokens verwerfen + Refresh-Token aus DB entfernen. */
  async disconnect(): Promise<void> {
    this.accessToken = null;
    this.accessTokenExpiry = 0;
    this.refreshToken = null;
    await this.registry.clearSettings(PLUGIN_ID, ['refreshToken']);
    eventSystem.emit('discord:connected', { connected: false }, 'discord-service');
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
    body.set('client_id', creds.clientId);
    body.set('client_secret', creds.clientSecret);
    const res = await fetch(`${OAUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Discord-Token-Fehler ${res.status}: ${detail}`);
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
      // Discord rotiert den Refresh-Token bei jeder Erneuerung.
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
      eventSystem.emit('discord:connected', { connected: false }, 'discord-service');
      return null;
    }
  }

  // --------------------------------------------------------------- Web API

  /** Eigenes Discord-Profil abrufen (null = nicht verbunden / Fehler). */
  async getProfile(): Promise<DiscordUser | null> {
    const token = await this.validAccessToken();
    if (!token) return null;
    const res = await fetch(`${API_BASE}/users/@me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    }).catch(() => null);
    if (!res || !res.ok) return null;
    const json = (await res.json().catch(() => null)) as DiscordApiUser | null;
    return json ? this.toUser(json) : null;
  }

  private toUser(u: DiscordApiUser): DiscordUser {
    return {
      id: u.id,
      username: u.username,
      globalName: u.global_name,
      avatarUrl: this.avatarUrl(u),
    };
  }

  private avatarUrl(u: DiscordApiUser): string | null {
    if (u.avatar) {
      const ext = u.avatar.startsWith('a_') ? 'gif' : 'png';
      return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${ext}`;
    }
    // Kein eigener Avatar -> Discords Standard-Avatar (Index aus der User-ID).
    const index = Number((BigInt(u.id) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }
}

export const createDiscordService = (registry: PluginRegistry): DiscordService => new DiscordService(registry);
