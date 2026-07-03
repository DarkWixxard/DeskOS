// Bambu Cloud API-Client (Login + Gerätesuche)
//
// Meldet sich am Bambu-Cloud-Konto an (E-Mail/Passwort, ggf. E-Mail-Code) und
// liefert das Access-Token, den MQTT-Benutzernamen (u_<uid>) sowie die
// gebundenen Drucker (Seriennummern). Wird vom BambuService genutzt, um die
// Cloud-MQTT-Verbindung aufzubauen – nötig für A1/P1, weil deren lokaler
// MQTT-Zugang nur im „LAN Only"-Modus offen ist (der die Cloud kappt).
//
// Referenz: greghesp/ha-bambulab (pybambu). Zugangsdaten werden nur transient
// verwendet; persistiert wird ausschließlich das Token (als Plugin-Secret).

export type BambuRegion = 'global' | 'china';

const HOSTS: Record<BambuRegion, { api: string; mqtt: string }> = {
  global: { api: 'https://api.bambulab.com', mqtt: 'us.mqtt.bambulab.com' },
  china: { api: 'https://api.bambulab.cn', mqtt: 'cn.mqtt.bambulab.com' },
};

// Header wie ein regulärer Bambu-Client, damit die (Cloudflare-geschützte)
// Login-API die Anfrage akzeptiert.
const HEADERS: Record<string, string> = {
  'User-Agent': 'bambu_network_agent/01.09.05.01',
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'X-BBL-Client-Name': 'OrcaSlicer',
  'X-BBL-Client-Type': 'slicer',
  'X-BBL-Client-Version': '01.09.05.01',
  'X-BBL-Language': 'en-US',
  'X-BBL-OS-Type': 'linux',
  'X-BBL-OS-Version': '6.2.0',
};

const TIMEOUT_MS = 15000;

export type LoginResult =
  | { status: 'ok'; token: string }
  | { status: 'verifyCode' } // E-Mail-Code angefordert
  | { status: 'tfa' } // App-2FA (aktuell nicht unterstützt)
  | { status: 'error'; message: string };

export interface BambuDevice {
  serial: string;
  name: string;
}

export function mqttHost(region: BambuRegion): string {
  return HOSTS[region].mqtt;
}

function apiBase(region: BambuRegion): string {
  return HOSTS[region].api;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Schritt 1: Login mit E-Mail + Passwort. */
export async function login(region: BambuRegion, email: string, password: string): Promise<LoginResult> {
  let res: Response;
  try {
    res = await postJson(`${apiBase(region)}/v1/user-service/user/login`, { account: email, password, apiError: '' });
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'Netzwerkfehler beim Login.' };
  }
  if (!res.ok) return { status: 'error', message: `Login fehlgeschlagen (HTTP ${res.status}).` };
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (typeof json.accessToken === 'string' && json.accessToken) return { status: 'ok', token: json.accessToken };
  if (json.loginType === 'verifyCode') {
    // E-Mail-Code anfordern (Fehler hier ignorieren – der User kann erneut anfordern).
    await postJson(`${apiBase(region)}/v1/user-service/user/sendemail/code`, { email, type: 'codeLogin' }).catch(() => undefined);
    return { status: 'verifyCode' };
  }
  if (json.loginType === 'tfa') return { status: 'tfa' };
  return { status: 'error', message: 'Login fehlgeschlagen – unerwartete Antwort.' };
}

/** Schritt 2: Login mit dem per E-Mail zugesandten Code abschließen. */
export async function loginWithCode(region: BambuRegion, email: string, code: string): Promise<LoginResult> {
  let res: Response;
  try {
    res = await postJson(`${apiBase(region)}/v1/user-service/user/login`, { account: email, code });
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'Netzwerkfehler beim Code-Login.' };
  }
  if (!res.ok) return { status: 'error', message: `Code-Login fehlgeschlagen (HTTP ${res.status}).` };
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof json.accessToken === 'string' && json.accessToken) return { status: 'ok', token: json.accessToken };
  return { status: 'error', message: 'Ungültiger oder abgelaufener Code.' };
}

/**
 * MQTT-Benutzernamen aus dem Access-Token (JWT) lesen. Bambu legt den Namen
 * bereits in der Form "u_<uid>" als `username`-Claim ab.
 */
export function usernameFromToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    return typeof payload.username === 'string' && payload.username ? payload.username : null;
  } catch {
    return null;
  }
}

/** Fallback: uid über die Preference-API holen und zu "u_<uid>" formen. */
export async function usernameFromApi(region: BambuRegion, token: string): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase(region)}/v1/design-user-service/my/preference`, {
      headers: { ...HEADERS, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const uid = json.uid;
    return uid ? `u_${uid}` : null;
  } catch {
    return null;
  }
}

/** Gebundene Drucker auflisten (Seriennummern). */
export async function listDevices(region: BambuRegion, token: string): Promise<BambuDevice[]> {
  try {
    const res = await fetch(`${apiBase(region)}/v1/iot-service/api/user/bind`, {
      headers: { ...HEADERS, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json().catch(() => ({}))) as { devices?: Array<Record<string, unknown>> };
    const devices = Array.isArray(json.devices) ? json.devices : [];
    return devices
      .map((d) => ({ serial: String(d.dev_id ?? ''), name: String(d.name ?? d.dev_id ?? '') }))
      .filter((d) => d.serial);
  } catch {
    return [];
  }
}
