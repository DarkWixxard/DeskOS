// Tests für den SpotifyService (OAuth-/Status-Logik, ohne Netzwerk).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseService } from '../src/services/DatabaseService';
import { PluginRegistry } from '../src/services/PluginRegistry';
import { SpotifyService } from '../src/services/SpotifyService';

function tempDbPath(): string {
  return path.join(os.tmpdir(), `descos-spotify-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

async function freshRegistry(dbFile: string): Promise<PluginRegistry> {
  const db = new DatabaseService(dbFile);
  const reg = new PluginRegistry(db);
  await reg.restore();
  await reg.seedDefaults();
  await reg.install('spotify');
  return reg;
}

describe('SpotifyService', () => {
  const created: string[] = [];

  afterAll(() => {
    for (const f of created) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  });

  // Ohne ENV-Fallback testen, damit nur die Plugin-Settings zählen.
  beforeEach(() => {
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
    delete process.env.SPOTIFY_REDIRECT_URI;
  });

  test('Status: ohne Zugangsdaten weder credentials noch connected', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const reg = await freshRegistry(dbFile);
    const spotify = new SpotifyService(reg);

    const status = spotify.getStatus();
    expect(status.hasCredentials).toBe(false);
    expect(status.connected).toBe(false);
    expect(status.redirectUri).toContain('/api/spotify/callback');
    expect(status.redirectUri).toContain('127.0.0.1');
  });

  test('getAuthUrl wirft ohne Zugangsdaten', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const reg = await freshRegistry(dbFile);
    const spotify = new SpotifyService(reg);
    expect(() => spotify.getAuthUrl()).toThrow();
  });

  test('mit Zugangsdaten: hasCredentials true, valide Auth-URL inkl. State', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const reg = await freshRegistry(dbFile);
    await reg.updateSettings('spotify', { clientId: 'cid-123', clientSecret: 'secret-xyz' });
    const spotify = new SpotifyService(reg);

    expect(spotify.getStatus().hasCredentials).toBe(true);

    const url = new URL(spotify.getAuthUrl());
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid-123');
    expect(url.searchParams.get('redirect_uri')).toContain('/api/spotify/callback');
    expect(url.searchParams.get('scope')).toContain('user-modify-playback-state');
    expect((url.searchParams.get('state') ?? '').length).toBeGreaterThan(0);
  });

  test('handleCallback lehnt unbekannten State ab (CSRF-Schutz)', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const reg = await freshRegistry(dbFile);
    await reg.updateSettings('spotify', { clientId: 'cid', clientSecret: 'sec' });
    const spotify = new SpotifyService(reg);

    await expect(spotify.handleCallback('any-code', 'unknown-state')).rejects.toThrow();
  });

  test('restore lädt persistierten Refresh-Token; disconnect entfernt ihn', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const reg = await freshRegistry(dbFile);
    await reg.updateSettings('spotify', { clientId: 'cid', clientSecret: 'sec', refreshToken: 'refresh-abc' });

    const spotify = new SpotifyService(reg);
    spotify.restore();
    expect(spotify.getStatus().connected).toBe(true);

    await spotify.disconnect();
    expect(spotify.getStatus().connected).toBe(false);
    expect(reg.getSettings('spotify').refreshToken).toBeUndefined();
  });
});
