'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useDashboardStore, type Device } from '@/stores/dashboardStore';
import { Panel, HoloCorners, HoloIcon } from '@/components/holo';
import { getApiBaseUrl } from '@/lib/api';
import { DEVICE_TYPE_OPTIONS, deviceTypeLabel, type DeviceType } from '@shared/types';

/* =========================================================================
   DeskOS Device Center – detail view (M2)

   Tabbed device modal: Infos / Einstellungen / Logs / Firmware.
   ========================================================================= */

type Tab = 'info' | 'settings' | 'logs' | 'firmware';

const STATUS_STYLES: Record<string, string> = {
  online: 'text-success ring-success/40 bg-success/10',
  offline: 'text-danger ring-danger/40 bg-danger/10',
  error: 'text-warning ring-warning/40 bg-warning/10',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={clsx('rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1', STATUS_STYLES[status] ?? '')}>
      {status}
    </span>
  );
}

function Chip({ label }: { label: string }) {
  return <span className="rounded-none border border-accent/20 bg-accent/5 px-2 py-0.5 font-mono text-[10px] text-accent/70">{label}</span>;
}

function fmtBytes(b?: number): string {
  if (b == null || !Number.isFinite(b)) return 'N/A';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'info', label: 'Infos', icon: 'cpu' },
  { id: 'settings', label: 'Einstellungen', icon: 'gear' },
  { id: 'logs', label: 'Logs', icon: 'list' },
  { id: 'firmware', label: 'Firmware', icon: 'plug' },
];

export function DeviceDetail() {
  const device = useDashboardStore((s) => s.selectedDevice);
  const selectDevice = useDashboardStore((s) => s.selectDevice);
  const metricsByDevice = useDashboardStore((s) => s.metricsByDevice);
  const notifications = useDashboardStore((s) => s.notifications);
  const renameDevice = useDashboardStore((s) => s.renameDevice);
  const removeDevice = useDashboardStore((s) => s.removeDevice);
  const updateDeviceType = useDashboardStore((s) => s.updateDeviceType);

  const [tab, setTab] = useState<Tab>('info');
  const [nameInput, setNameInput] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset to the Infos tab and sync the rename field whenever a device opens.
  useEffect(() => {
    if (device) {
      setTab('info');
      setNameInput(device.name);
    }
  }, [device?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = device ? metricsByDevice[device.id] : undefined;
  const deviceLogs = useMemo(
    () => (device ? notifications.filter((n) => n.deviceId === device.id) : []),
    [notifications, device]
  );

  if (!device) return null;

  const metaEntries = Object.entries(device.metadata ?? {});

  const handleSave = async () => {
    if (!nameInput.trim() || nameInput.trim() === device.name) return;
    setSaving(true);
    await renameDevice(device.id, nameInput.trim());
    setSaving(false);
  };

  const handleRemove = async () => {
    if (!window.confirm(`Gerät ${device.name} wirklich entfernen?`)) return;
    const ok = await removeDevice(device.id);
    if (!ok) window.alert('Gerät konnte nicht entfernt werden.');
  };

  const handleTypeChange = async (type: DeviceType) => {
    if (type === device.type) return;
    const ok = await updateDeviceType(device.id, type);
    if (!ok) window.alert('Kategorie konnte nicht geändert werden.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => selectDevice(null)}>
      <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <Panel className="relative">
          <HoloCorners />
          {/* Header */}
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate font-mono text-lg font-bold tracking-wider text-accent" style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}>
                {device.name}
              </h2>
              <div className="mt-1 flex items-center gap-2">
                <span className="holo-label">{deviceTypeLabel(device.type)}</span>
                <StatusPill status={device.status} />
              </div>
            </div>
            <button type="button" className="text-xl leading-none text-accent/60 transition-colors hover:text-accent" onClick={() => selectDevice(null)} aria-label="Schließen">
              ✕
            </button>
          </div>

          {/* Tabs */}
          <div className="mb-4 flex flex-wrap gap-2 border-b border-accent/15 pb-3">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={clsx(
                  'flex items-center gap-1.5 rounded-none border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition-all',
                  tab === t.id ? 'border-accent bg-accent/15 text-accent' : 'border-accent/20 text-accent/50 hover:border-accent/50 hover:text-accent/80'
                )}
              >
                <HoloIcon name={t.icon} className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="min-h-[180px] text-sm">
            {tab === 'info' && (
              <div className="space-y-3">
                <Row label="Zuletzt gesehen" value={new Date(device.lastSeen).toLocaleString()} />
                <div>
                  <p className="holo-label mb-1.5">Fähigkeiten</p>
                  <div className="flex flex-wrap gap-1">
                    {device.capabilities.length ? device.capabilities.map((c) => <Chip key={c} label={c} />) : <span className="text-[11px] text-accent/40">—</span>}
                  </div>
                </div>
                {m && (
                  <div>
                    <p className="holo-label mb-1.5">Live</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[12px]">
                      <Row label="CPU" value={`${Math.round(m.cpu ?? 0)}%`} />
                      <Row label="RAM" value={`${Math.round(m.ram?.percentage ?? 0)}%`} />
                      {m.cpuTempC != null && <Row label="Temp" value={`${m.cpuTempC} °C`} />}
                      {m.network && <Row label="Netz ↓" value={`${fmtBytes(m.network.rxSec)}/s`} />}
                    </div>
                  </div>
                )}
                {metaEntries.length > 0 && (
                  <div>
                    <p className="holo-label mb-1.5">Metadaten</p>
                    <div className="space-y-1 font-mono text-[12px]">
                      {metaEntries.map(([k, v]) => (
                        <Row key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'settings' && (
              <div className="space-y-4">
                <div>
                  <label className="holo-label mb-1.5 block">Name</label>
                  <div className="flex gap-2">
                    <input
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      className="flex-1 rounded-none border border-accent/30 bg-darker/60 px-3 py-1.5 text-sm text-white outline-none focus:border-accent focus:shadow-glow-sm"
                    />
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving || !nameInput.trim() || nameInput.trim() === device.name}
                      className="rounded-none border border-accent/40 px-3 py-1.5 text-[11px] uppercase tracking-wider text-accent transition-colors hover:bg-accent/10 disabled:opacity-30"
                    >
                      {saving ? '…' : 'Speichern'}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="holo-label mb-1.5 block">Kategorie</label>
                  <select
                    value={device.type}
                    onChange={(e) => handleTypeChange(e.target.value as DeviceType)}
                    className="w-full cursor-pointer rounded-none border border-accent/30 bg-darker/60 px-3 py-1.5 text-sm text-white outline-none focus:border-accent focus:shadow-glow-sm"
                  >
                    {DEVICE_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="border-t border-accent/15 pt-3">
                  <p className="holo-label mb-1.5">Gefahrenzone</p>
                  <button
                    type="button"
                    onClick={handleRemove}
                    className="rounded-none border border-danger/40 px-3 py-1.5 text-[11px] uppercase tracking-wider text-danger transition-colors hover:bg-danger/10"
                  >
                    Gerät entfernen
                  </button>
                </div>
              </div>
            )}

            {tab === 'logs' && (
              <div>
                {deviceLogs.length === 0 ? (
                  <p className="py-6 text-center text-[12px] text-accent/40">Keine gerätebezogenen Meldungen</p>
                ) : (
                  <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                    {deviceLogs.map((n) => (
                      <div key={n.id} className="border-l-2 border-accent/40 pl-2.5">
                        <p className="text-[12px] text-white/85">{n.title}</p>
                        <p className="font-mono text-[10px] text-accent/45">
                          {new Date(n.timestamp).toLocaleString()} · {n.message}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'firmware' && <FirmwareTab device={device} />}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function FirmwareTab({ device }: { device: Device }) {
  const meta = (device.metadata ?? {}) as Record<string, unknown>;
  const isMqtt = meta.mqtt === true;
  const isWled = meta.kind === 'wled';
  const ip = String(meta.ip ?? '');

  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [otaUrl, setOtaUrl] = useState('');
  const [status, setStatus] = useState('');

  const send = async (cmd: Record<string, unknown>, label: string) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/devices/${encodeURIComponent(device.id)}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cmd),
      });
      const body = await res.json();
      setStatus(body?.sent ? `${label}: gesendet ✓` : `${label}: Node nicht erreichbar`);
    } catch {
      setStatus(`${label}: Fehler`);
    }
  };

  const inputCls = 'w-full rounded-none border border-accent/30 bg-darker/60 px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent';
  const btnCls = 'rounded-none border border-accent/40 px-3 py-1.5 text-[11px] uppercase tracking-wider text-accent transition-colors hover:bg-accent/10';

  if (isWled) {
    return (
      <div className="space-y-3 py-2">
        <p className="text-[12px] text-accent/60">WLED-Updates laufen über die eigene Web-Oberfläche.</p>
        <a href={ip ? `http://${ip}/update` : '#'} target="_blank" rel="noreferrer" className={clsx(btnCls, 'inline-block')}>
          OTA-Update öffnen ({ip})
        </a>
      </div>
    );
  }

  if (!isMqtt) {
    return <p className="py-8 text-center text-[12px] text-accent/40">Firmware-Verwaltung für diesen Gerätetyp nicht verfügbar.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="holo-label mb-1.5">Steuerung</p>
        <button type="button" onClick={() => send({ action: 'restart' }, 'Neustart')} className={btnCls}>
          <HoloIcon name="refresh" className="inline h-3.5 w-3.5" /> Neustart
        </button>
      </div>

      <div className="border-t border-accent/15 pt-3">
        <p className="holo-label mb-1.5">WLAN konfigurieren</p>
        <div className="space-y-2">
          <input value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="SSID" className={inputCls} />
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Passwort" className={inputCls} />
          <button type="button" disabled={!ssid} onClick={() => send({ action: 'wifi', ssid, password }, 'WLAN')} className={clsx(btnCls, 'disabled:opacity-30')}>
            Senden
          </button>
        </div>
      </div>

      <div className="border-t border-accent/15 pt-3">
        <p className="holo-label mb-1.5">OTA-Update</p>
        <div className="space-y-2">
          <input value={otaUrl} onChange={(e) => setOtaUrl(e.target.value)} placeholder="Firmware-URL (.bin)" className={inputCls} />
          <button type="button" disabled={!otaUrl} onClick={() => send({ action: 'ota', url: otaUrl }, 'OTA')} className={clsx(btnCls, 'disabled:opacity-30')}>
            Update starten
          </button>
        </div>
      </div>

      {status && <p className="text-[11px] text-accent/70">{status}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="holo-label shrink-0">{label}</span>
      <span className="truncate text-right font-mono text-[12px] text-white/85">{value}</span>
    </div>
  );
}
