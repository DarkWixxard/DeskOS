'use client';

import { useDashboardStore } from '@/stores/dashboardStore';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { HoloIcon, Panel, Sparkline, RadialGauge, StatBar } from '@/components/holo';
import { getBackendPort } from '@/lib/api';

/* =========================================================================
   DeskOS Overlay Menu — holographic "mobiGlas" style launcher.

   Toggle with the floating core button (bottom-right), the backtick key
   ( ` ) or F2. While open: Esc / the core button closes it, ArrowLeft /
   ArrowRight (or Q / E) switch grid pages.
   ========================================================================= */

/* ------------------------------ Modules -------------------------------- */
interface ModuleDef {
  id: string;
  label: string;
  icon: string;
  filter?: 'all' | 'local' | 'remote' | 'esp32' | 'sensor';
  view?: string;
}

const PAGES: { title: string; modules: ModuleDef[] }[] = [
  {
    title: 'SYSTEM',
    modules: [
      { id: 'overview', label: 'Overview', icon: 'grid' },
      { id: 'devices', label: 'Devices', icon: 'cpu', filter: 'all' },
      { id: 'monitor', label: 'System Monitor', icon: 'activity', view: 'monitor' },
      { id: 'metrics', label: 'Metrics', icon: 'chart', view: 'metrics' },
      { id: 'events', label: 'Log Center', icon: 'list', view: 'logs' },
      { id: 'automations', label: 'Automations', icon: 'zap', view: 'automations' },
      { id: 'network', label: 'Network', icon: 'wifi', view: 'network' },
      { id: 'storage', label: 'Storage', icon: 'database', view: 'storage' },
      { id: 'terminal', label: 'Terminal', icon: 'terminal' },
      { id: 'alerts', label: 'Alerts', icon: 'bell' },
      { id: 'api', label: 'API Console', icon: 'code' },
      { id: 'settings', label: 'Settings', icon: 'gear' },
    ],
  },
  {
    title: 'HARDWARE & CONTROL',
    modules: [
      { id: 'remote', label: 'Remote PCs', icon: 'monitor', filter: 'remote' },
      { id: 'esp32', label: 'ESP32', icon: 'cpu', filter: 'esp32' },
      { id: 'sensors', label: 'Sensor Hub', icon: 'thermometer', view: 'sensors' },
      { id: 'rgb', label: 'RGB / LED', icon: 'bulb', view: 'rgb' },
      { id: 'displays', label: 'Displays', icon: 'monitor' },
      { id: 'audio', label: 'Audio', icon: 'speaker' },
      { id: 'power', label: 'Power', icon: 'power' },
      { id: 'cameras', label: 'Cameras', icon: 'camera' },
      { id: 'security', label: 'Security', icon: 'shield' },
      { id: 'scenes', label: 'Scenes', icon: 'layers' },
      { id: 'plugins', label: 'Plugins', icon: 'plug' },
      { id: 'oszi', label: 'Oszi', icon: 'chart', view: 'oszi' },
      { id: 'labs', label: 'Labs', icon: 'flask' },
    ],
  },
];

/* ------------------------------ Helpers -------------------------------- */
function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/* ============================== Main ================================== */
export function OverlayMenu() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [now, setNow] = useState<Date | null>(null);

  const systemMetrics = useDashboardStore((s) => s.systemMetrics);
  const metricsHistory = useDashboardStore((s) => s.metricsHistory);
  const devices = useDashboardStore((s) => s.devices);
  const events = useDashboardStore((s) => s.events);
  const wsConnected = useDashboardStore((s) => s.wsConnected);
  const setDeviceFilter = useDashboardStore((s) => s.setDeviceFilter);
  const setActiveView = useDashboardStore((s) => s.setActiveView);
  const setNotificationsOpen = useDashboardStore((s) => s.setNotificationsOpen);

  // Derived, real data from the store
  const online = devices.filter((d) => d.status === 'online').length;
  const offline = devices.length - online;
  const cpu = systemMetrics ? Math.round(systemMetrics.cpu) : 0;
  const ram = systemMetrics ? Math.round(systemMetrics.ram.percentage) : 0;
  const disk = systemMetrics?.disk ? Math.round(systemMetrics.disk.percentage) : null;
  const cpuSeries = metricsHistory.map((m) => Math.round(m.cpu));
  const recentEvents = events.slice(-5).reverse();

  // Live clock (set on mount only -> no hydration mismatch)
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable);

      if (e.key === 'Escape') {
        if (open) setOpen(false);
        return;
      }
      if (typing) return;

      if (e.key === '`' || e.key === 'F2') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (!open) return;
      if (e.key === 'ArrowRight' || e.key === 'e' || e.key === 'E') {
        setPage((p) => Math.min(p + 1, PAGES.length - 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'q' || e.key === 'Q') {
        setPage((p) => Math.max(p - 1, 0));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Lock background scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const handleModule = (mod: ModuleDef) => {
    // The Alerts tile opens the Notification Center slide-over.
    if (mod.id === 'alerts') {
      setNotificationsOpen(true);
      setOpen(false);
      return;
    }
    if (mod.filter) setDeviceFilter(mod.filter);
    // Tiles without an explicit view return to the main dashboard, so picking a
    // filter tile never leaves you stuck inside a sub-view (oszi/monitor/…).
    setActiveView(mod.view ?? 'dashboard');
    setOpen(false);
  };

  const timeStr = now
    ? now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : '--:--:--';
  const dateStr = now
    ? now.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '--.--.----';

  const activePage = PAGES[page];

  return (
    <>
      {/* Floating trigger (the "core" button) */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="DeskOS Menü öffnen"
          className="group fixed bottom-6 right-6 z-40 flex items-center gap-3"
        >
          <span className="hidden rounded bg-darker/80 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-accent/80 ring-1 ring-accent/30 backdrop-blur sm:block">
            Menu · <span className="text-accent/50">`</span>
          </span>
          <span className="relative flex h-14 w-14 items-center justify-center">
            <span className="animate-holo-spin absolute inset-0 rounded-full border border-dashed border-accent/40" />
            <span className="animate-holo-spin-rev absolute inset-1.5 rounded-full border border-accent/25" />
            <span className="absolute inset-2.5 rounded-full bg-accent/10 shadow-glow ring-1 ring-accent/50 transition-all group-hover:bg-accent/20 group-hover:shadow-glow-lg" />
            <HoloIcon name="refresh" className="relative h-6 w-6 text-accent transition-transform group-hover:scale-110" />
          </span>
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            role="dialog"
            aria-modal="true"
            aria-label="DeskOS Overlay Menü"
            className="fixed inset-0 z-50 overflow-y-auto"
          >
            {/* Backdrop */}
            <button
              type="button"
              aria-label="Menü schließen"
              onClick={() => setOpen(false)}
              className="absolute inset-0 cursor-default bg-black/80 backdrop-blur-sm"
            />

            {/* Content */}
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.985 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="holo-grid-bg holo-scanlines animate-holo-flicker relative mx-auto flex min-h-full max-w-[1500px] flex-col gap-4 p-4 md:p-6 lg:p-8"
            >
              {/* ---------------- Top bar ---------------- */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <HoloIcon name="grid" className="h-6 w-6 text-accent" />
                  <div>
                    <div className="font-mono text-lg font-bold tracking-[0.3em] text-accent" style={{ textShadow: '0 0 14px rgba(0,217,255,0.6)' }}>
                      DESK<span className="text-white/90">OS</span>
                    </div>
                    <div className="holo-label">Modular Monitoring & Control</div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="hidden text-right sm:block">
                    <div className="holo-value text-lg leading-none">{timeStr}</div>
                    <div className="holo-label mt-1">{dateStr}</div>
                  </div>
                  <div
                    className={clsx(
                      'flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider ring-1 backdrop-blur',
                      wsConnected
                        ? 'bg-success/10 text-success ring-success/40'
                        : 'bg-danger/10 text-danger ring-danger/40'
                    )}
                  >
                    <span className={clsx('h-2 w-2 rounded-full', wsConnected ? 'bg-success' : 'bg-danger')} />
                    {wsConnected ? 'Online' : 'Offline'}
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Schließen"
                    className="flex h-9 w-9 items-center justify-center rounded border border-accent/30 text-accent transition-colors hover:border-accent hover:bg-accent/10"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* ---------------- Body grid ---------------- */}
              <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_280px]">
                {/* ===== Left column ===== */}
                <motion.div
                  initial={{ opacity: 0, x: -24 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.05 }}
                  className="hidden flex-col gap-4 lg:flex"
                >
                  <Panel title="System Load">
                    <Sparkline values={cpuSeries} />
                    <div className="mt-1 flex justify-between font-mono text-[10px] text-accent/50">
                      <span>CPU %</span>
                      <span>{cpuSeries.length} pts</span>
                    </div>
                  </Panel>

                  <Panel title="Event Log" badge={<span className="font-mono text-[10px] text-accent">{events.length} TOTAL</span>}>
                    {recentEvents.length === 0 ? (
                      <p className="py-2 text-[11px] text-accent/40">Keine Events</p>
                    ) : (
                      <div className="space-y-1.5">
                        {recentEvents.map((ev) => (
                          <div key={ev.id} className="flex items-center gap-2 border-l-2 border-accent/40 pl-2">
                            <span className="font-mono text-[10px] text-accent/50">
                              {new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                            </span>
                            <span className="truncate text-[11px] text-white/80">{ev.type}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>

                  <Panel title="Vitals Monitoring" badge={<span className="font-mono text-[10px] text-success">OK</span>}>
                    <RadialGauge value={cpu} label="CPU Load" />
                  </Panel>

                  <Panel title="System Status" className="flex-1">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      <StatBar label="CPU" value={`${cpu}%`} percent={cpu} />
                      <StatBar label="RAM" value={`${ram}%`} percent={ram} />
                      <StatBar label="Disk" value={disk != null ? `${disk}%` : 'N/A'} percent={disk ?? 0} />
                      <StatBar label="Uptime" value={systemMetrics ? formatUptime(systemMetrics.uptime) : 'N/A'} />
                    </div>
                  </Panel>
                </motion.div>

                {/* ===== Center: app grid ===== */}
                <div className="flex flex-col">
                  {/* quick-access toolbar */}
                  <div className="mb-4 flex items-center justify-center gap-2">
                    {['activity', 'zap', 'database', 'bell', 'gear'].map((ic) => (
                      <div
                        key={ic}
                        className="flex h-9 w-9 items-center justify-center rounded border border-accent/20 bg-accent/5 text-accent/70"
                      >
                        <HoloIcon name={ic} className="h-4 w-4" />
                      </div>
                    ))}
                  </div>

                  <AnimatePresence mode="wait">
                    <motion.div
                      key={page}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.2 }}
                      className="grid flex-1 grid-cols-3 content-start gap-3 sm:grid-cols-4 lg:grid-cols-5"
                    >
                      {activePage.modules.map((mod) => (
                        <button
                          key={mod.id}
                          type="button"
                          onClick={() => handleModule(mod)}
                          className="holo-tile group flex aspect-square flex-col items-center justify-center gap-2 p-2 text-center"
                        >
                          <HoloIcon
                            name={mod.icon}
                            className="h-7 w-7 text-accent/80 transition-all group-hover:text-accent group-hover:drop-shadow-[0_0_8px_rgba(0,217,255,0.7)] sm:h-8 sm:w-8"
                          />
                          <span className="text-[10px] font-medium uppercase leading-tight tracking-wider text-white/70 group-hover:text-white sm:text-[11px]">
                            {mod.label}
                          </span>
                        </button>
                      ))}
                    </motion.div>
                  </AnimatePresence>

                  {/* page dots */}
                  <div className="mt-4 flex items-center justify-center gap-2">
                    {PAGES.map((p, i) => (
                      <button
                        key={p.title}
                        type="button"
                        aria-label={`Seite ${i + 1}: ${p.title}`}
                        onClick={() => setPage(i)}
                        className={clsx(
                          'flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[11px] transition-all',
                          i === page
                            ? 'border-accent bg-accent/20 text-accent shadow-glow-sm'
                            : 'border-accent/25 text-accent/40 hover:border-accent/60 hover:text-accent/70'
                        )}
                      >
                        {i + 1}
                      </button>
                    ))}
                    <span className="ml-3 holo-label">{activePage.title}</span>
                  </div>
                </div>

                {/* ===== Right column ===== */}
                <motion.div
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.05 }}
                  className="hidden flex-col gap-4 lg:flex"
                >
                  <Panel title="Backend Link">
                    <div className="holo-value text-2xl">{wsConnected ? 'CONNECTED' : 'OFFLINE'}</div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <div className="holo-label">Protocol</div>
                        <div className="font-mono text-white/80">WS · REST</div>
                      </div>
                      <div>
                        <div className="holo-label">Port</div>
                        <div className="font-mono text-white/80">{getBackendPort()}</div>
                      </div>
                    </div>
                  </Panel>

                  <Panel title="Device Status">
                    <div className="grid grid-cols-3 text-center">
                      <div>
                        <div className="holo-value text-2xl text-success">{online}</div>
                        <div className="holo-label mt-1">Online</div>
                      </div>
                      <div>
                        <div className="holo-value text-2xl text-danger">{offline}</div>
                        <div className="holo-label mt-1">Offline</div>
                      </div>
                      <div>
                        <div className="holo-value text-2xl">{devices.length}</div>
                        <div className="holo-label mt-1">Total</div>
                      </div>
                    </div>
                  </Panel>

                  <Panel title="Local Host" className="flex-1">
                    {systemMetrics ? (
                      <div className="space-y-3">
                        <div>
                          <div className="holo-label">Hostname</div>
                          <div className="truncate font-mono text-sm text-white/85">{systemMetrics.hostname}</div>
                        </div>
                        <div>
                          <div className="holo-label">Platform</div>
                          <div className="font-mono text-sm capitalize text-white/85">{systemMetrics.platform}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <StatBar label="CPU" value={`${cpu}%`} percent={cpu} />
                          <StatBar label="RAM" value={`${ram}%`} percent={ram} />
                        </div>
                      </div>
                    ) : (
                      <p className="py-2 text-[11px] text-accent/40">Warte auf Metriken…</p>
                    )}
                  </Panel>
                </motion.div>
              </div>

              {/* ---------------- Bottom bar ---------------- */}
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-widest text-accent/50">
                  <span><span className="text-accent">Esc</span> Exit</span>
                  <span><span className="text-accent">Q</span> Grid Left</span>
                  <span><span className="text-accent">E</span> Grid Right</span>
                  <span><span className="text-accent">`</span> Toggle</span>
                </div>

                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    aria-label="Vorherige Seite"
                    onClick={() => setPage((p) => Math.max(p - 1, 0))}
                    disabled={page === 0}
                    className="text-accent/60 transition-colors hover:text-accent disabled:opacity-20"
                  >
                    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 6l-6 6 6 6" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Menü schließen"
                    className="group relative flex h-12 w-12 items-center justify-center"
                  >
                    <span className="animate-holo-spin absolute inset-0 rounded-full border border-dashed border-accent/40" />
                    <span className="absolute inset-1.5 rounded-full bg-accent/10 shadow-glow ring-1 ring-accent/60 transition-all group-hover:bg-accent/25" />
                    <HoloIcon name="refresh" className="relative h-5 w-5 text-accent" />
                  </button>

                  <button
                    type="button"
                    aria-label="Nächste Seite"
                    onClick={() => setPage((p) => Math.min(p + 1, PAGES.length - 1))}
                    disabled={page === PAGES.length - 1}
                    className="text-accent/60 transition-colors hover:text-accent disabled:opacity-20"
                  >
                    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                </div>

                <div className="hidden items-center gap-3 text-accent/50 sm:flex">
                  <HoloIcon name="bell" className="h-4 w-4" />
                  <HoloIcon name="activity" className="h-4 w-4" />
                  <HoloIcon name="gear" className="h-4 w-4" />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
