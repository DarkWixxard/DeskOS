'use client';

import clsx from 'clsx';
import { useDashboardStore } from '@/stores/dashboardStore';
import { HoloIcon } from '@/components/holo';

/* Layout/profile switcher (M4): one-click activation applies the profile's
   scene (RGB etc.) and can switch the dashboard view. */
export function LayoutBar() {
  const layouts = useDashboardStore((s) => s.layouts);
  const activeId = useDashboardStore((s) => s.activeLayoutId);
  const activate = useDashboardStore((s) => s.activateLayout);

  if (layouts.length === 0) return null;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <span className="holo-label mr-1 flex items-center gap-1.5">
        <HoloIcon name="layers" className="h-4 w-4 text-accent/70" /> Profil
      </span>
      {layouts.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => activate(p.id)}
          className={clsx(
            'flex items-center gap-1.5 rounded-none border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-all',
            activeId === p.id
              ? 'border-accent bg-accent/15 text-accent shadow-glow-sm'
              : 'border-accent/20 text-accent/60 hover:border-accent/50 hover:text-accent/90'
          )}
        >
          <HoloIcon name={p.icon ?? 'layers'} className="h-4 w-4" />
          {p.name}
        </button>
      ))}
    </div>
  );
}
