'use client';

import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';
import { useDashboardStore, type DeskNotification } from '@/stores/dashboardStore';
import { HoloIcon, HoloCorners } from '@/components/holo';
import { timeAgo } from '@/lib/time';

/* =========================================================================
   DeskOS Notification Center (M2)

   Right-hand slide-over listing curated notifications (alerts, device status
   changes, errors) pushed live from the backend. Toggled by the header bell
   button and the Overlay "Alerts" tile.
   ========================================================================= */

const LEVEL_STYLES: Record<DeskNotification['level'], { border: string; text: string; icon: string }> = {
  info: { border: 'border-accent', text: 'text-accent', icon: 'bell' },
  success: { border: 'border-success', text: 'text-success', icon: 'shield' },
  warn: { border: 'border-warning', text: 'text-warning', icon: 'zap' },
  error: { border: 'border-danger', text: 'text-danger', icon: 'bell' },
};

function NotificationRow({ n }: { n: DeskNotification }) {
  const markRead = useDashboardStore((s) => s.markNotificationRead);
  const style = LEVEL_STYLES[n.level] ?? LEVEL_STYLES.info;
  return (
    <button
      type="button"
      onClick={() => !n.read && markRead(n.id)}
      className={clsx(
        'group w-full border-l-2 px-3 py-2.5 text-left transition-colors',
        style.border,
        n.read ? 'bg-transparent opacity-60 hover:opacity-90' : 'bg-accent/[0.04] hover:bg-accent/[0.08]'
      )}
    >
      <div className="flex items-center gap-2">
        <HoloIcon name={style.icon} className={clsx('h-4 w-4 shrink-0', style.text)} />
        <span className="flex-1 truncate font-mono text-sm text-white/90">{n.title}</span>
        {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-accent shadow-glow-sm" />}
      </div>
      <p className="mt-1 pl-6 text-[12px] text-white/65">{n.message}</p>
      <p className="mt-1 pl-6 font-mono text-[10px] text-accent/40">
        {n.source} · {timeAgo(n.timestamp)}
      </p>
    </button>
  );
}

export function NotificationCenter() {
  const open = useDashboardStore((s) => s.notificationsOpen);
  const setOpen = useDashboardStore((s) => s.setNotificationsOpen);
  const notifications = useDashboardStore((s) => s.notifications);
  const unreadCount = useDashboardStore((s) => s.unreadCount);
  const markAllRead = useDashboardStore((s) => s.markAllNotificationsRead);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="notif-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label="Benachrichtigungen"
        >
          <button
            type="button"
            aria-label="Schließen"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="holo-panel absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-darker/95 backdrop-blur"
          >
            <HoloCorners />
            <div className="flex items-center justify-between border-b border-accent/20 px-4 py-3">
              <div className="flex items-center gap-2">
                <HoloIcon name="bell" className="h-5 w-5 text-accent" />
                <h2 className="font-mono text-sm font-bold uppercase tracking-[0.2em] text-accent">Benachrichtigungen</h2>
                {unreadCount > 0 && (
                  <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] text-accent ring-1 ring-accent/40">
                    {unreadCount} neu
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => markAllRead()}
                  disabled={unreadCount === 0}
                  className="text-[10px] uppercase tracking-wider text-accent/70 transition-colors hover:text-accent disabled:opacity-30"
                >
                  Alle gelesen
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Schließen"
                  className="flex h-7 w-7 items-center justify-center rounded border border-accent/30 text-accent transition-colors hover:bg-accent/10"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="px-4 py-10 text-center text-[12px] text-accent/40">Keine Benachrichtigungen</p>
              ) : (
                <div className="divide-y divide-accent/5">
                  {notifications.map((n) => (
                    <NotificationRow key={n.id} n={n} />
                  ))}
                </div>
              )}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
