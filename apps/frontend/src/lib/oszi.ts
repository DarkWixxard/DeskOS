// API-Client fuer den Oszi-Service.
// Alle Aufrufe gehen ueber das DeskOS-Backend, das sie unter /api/oszi/*
// an den Python/Flask-Dienst weiterleitet. Die Backend-Basis-URL (inkl.
// konfigurierbarem Port) kommt zentral aus lib/api.

import { getApiBaseUrl } from './api';

/** Vollstaendige URL fuer einen Oszi-Endpunkt, z. B. osziUrl('/run'). */
export function osziUrl(path: string): string {
  return `${getApiBaseUrl()}/api/oszi${path}`;
}

export interface OsziStatus {
  status: string;
  demo?: boolean;
  trigger?: string;
  frequency_readable?: string;
  vpp_readable?: string;
  voltage_readable?: string;
}

export async function getStatus(): Promise<OsziStatus> {
  const res = await fetch(osziUrl('/api/status'));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getWaveform(): Promise<number[]> {
  const res = await fetch(osziUrl('/api/waveform'));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.waveform as number[]) || [];
}

/** Einfacher GET-Befehl (/run, /stop, /connect, /autoscale, /network_scan). */
export async function sendCommand(path: string): Promise<any> {
  const res = await fetch(osziUrl(path));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}

export async function sendScpi(command: string): Promise<{ result?: string; error?: string }> {
  const res = await fetch(osziUrl('/scpi'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  });
  return res.json();
}

export async function setTarget(channel: 'CHAN1' | 'CHAN2'): Promise<{ channel: string }> {
  const res = await fetch(osziUrl('/target'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel }),
  });
  return res.json();
}

/** Oeffnet einen Download/eine Ressource (CSV, Screenshot, PDF) in neuem Tab. */
export function openResource(path: string): void {
  if (typeof window !== 'undefined') {
    window.open(osziUrl(path), '_blank');
  }
}
