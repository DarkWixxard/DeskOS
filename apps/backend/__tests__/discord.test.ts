// Tests für den DiscordService (OAuth-/Status-Logik, ohne Netzwerk).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseService } from '../src/services/DatabaseService';
import { PluginRegistry } from '../src/services/PluginRegistry';
import { DiscordService } from '../src/services/DiscordService';

function tempDbPath(): string {
  return path.join(os.tmpdir(), `descos-discord-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

async function freshRegistry(dbFile: string): Promise<PluginRegistry> {
  const db = new DatabaseService(dbFile);
  const reg = new PluginRegistry(db);
  await reg.restore();
  await reg.seedDefaults();
  await reg.install('discord');
  return reg;
}

describe('DiscordService', () => {
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
    delete process.env.DISCORD_CLIENT_ID;
    delete process.env.DISCORD_CLIENT_SECRET;
    delete process.env.DISCORD_REDIRECT_URI;
  });

  test('Status: ohne Zugangsdaten weder credentials noch connected', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const reg = await freshRegistry(dbFile);
    const discord = new DiscordService(reg);

    const status = discord.getStatus();
    expect(status.hasCredentials).toBe(false);
    expect(status.connected).toBe(false);
    expect(status.redirectUri).toContain('/api/discord/callback');
  });

  test('getAuthUrl wirft ohne Zugangsdaten', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const reg = await freshRegistry(dbFile);
    const discord = new DiscordService(reg);
    expect(() => discord.getAuthUrl()).toThrow();
  });

  test('mit Zugangsdaten: hasCredentials true, valide Auth-URL inkl. State', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const reg = await freshRegistry(dbFile);
    await reg.updateSettings('discord', { clientId: 'cid-123', clientSecret: 'secret-xyz' });
    const discord = new DiscordService(reg);

    expect(discord.getStatus().hasCredentials).toBe(true);

    const url = new URL(discord.getAuthUrl());
    expect(url.origin + url.pathname).toBe('https://discord.com/api/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid-123');
    expect(url.searchParams.get('redirect_uri')).toContain('/api/discord/callback');
    expect(url.searchParams.get('scope')).toBe('identify');
    expect((url.searchParams.get('state') ?? '').length).toBeGreaterThan(0);
  });

  test('handleCallback lehnt unbekannten State ab (CSRF-Schutz)', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const reg = await freshRegistry(dbFile);
    await reg.updateSettings('discord', { clientId: 'cid', clientSecret: 'sec' });
    const discord = new DiscordService(reg);

    await expect(discord.handleCallback('any-code', 'unknown-state')).rejects.toThrow();
  });

  test('restore lädt persistierten Refresh-Token; disconnect entfernt ihn', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const reg = await freshRegistry(dbFile);
    await reg.updateSettings('discord', { clientId: 'cid', clientSecret: 'sec', refreshToken: 'refresh-abc' });

    const discord = new DiscordService(reg);
    discord.restore();
    expect(discord.getStatus().connected).toBe(true);

    await discord.disconnect();
    expect(discord.getStatus().connected).toBe(false);
    expect(reg.getSettings('discord').refreshToken).toBeUndefined();
  });
});
