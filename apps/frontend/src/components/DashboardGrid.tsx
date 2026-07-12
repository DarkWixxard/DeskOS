'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Responsive, WidthProvider, type Layout, type Layouts } from 'react-grid-layout';
import { useDashboardStore, type LayoutItem } from '@/stores/dashboardStore';
import { HoloIcon } from '@/components/holo';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const Grid = WidthProvider(Responsive);

// One placeable tile: its id, a human label (shown on the drag handle) and the
// already-rendered widget. `defaultLayout` gives the size/min-size used when the
// tile has no saved position yet.
export interface DashboardGridItem {
  id: string;
  label: string;
  node: ReactNode;
  defaultLayout: { w: number; h: number; minW?: number; minH?: number };
}

// 12-column grid on wide screens; single column once it gets narrow so tiles never
// end up cramped on a phone. `lg`/`md` share 12 cols → the free arrangement applies
// down to ~996px, below that we stack.
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };
const COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 };
const ROW_HEIGHT = 30;
const MARGIN: [number, number] = [16, 16];
// The two 12-column breakpoints that carry the free arrangement (and get persisted).
const FREE_BREAKPOINTS = ['lg', 'md'];

// Flow tiles left-to-right at their default size, wrapping to the next row — the
// shipped default arrangement when nothing has been saved yet.
function flowLayout(items: DashboardGridItem[], cols: number): Layout[] {
  let x = 0;
  let y = 0;
  let rowH = 0;
  return items.map((it) => {
    const w = Math.min(it.defaultLayout.w, cols);
    if (x + w > cols) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    const item: Layout = {
      i: it.id,
      x,
      y,
      w,
      h: it.defaultLayout.h,
      minW: it.defaultLayout.minW,
      minH: it.defaultLayout.minH,
    };
    x += w;
    rowH = Math.max(rowH, it.defaultLayout.h);
    return item;
  });
}

// Single-column stack (each tile full width) for the narrow breakpoints.
function stackLayout(items: DashboardGridItem[], cols: number): Layout[] {
  let y = 0;
  return items.map((it) => {
    const item: Layout = {
      i: it.id,
      x: 0,
      y,
      w: cols,
      h: it.defaultLayout.h,
      minW: 1,
      minH: it.defaultLayout.minH,
    };
    y += it.defaultLayout.h;
    return item;
  });
}

// Merge the saved desktop arrangement with the current tile set: saved tiles keep
// their position/size, tiles without a saved slot (freshly enabled) land at the
// bottom so nothing overlaps.
function mergeFreeLayout(items: DashboardGridItem[], saved: LayoutItem[]): Layout[] {
  if (saved.length === 0) return flowLayout(items, COLS.lg);
  const maxY = saved.reduce((m, l) => Math.max(m, l.y + l.h), 0);
  return items.map((it, idx) => {
    const hit = saved.find((l) => l.i === it.id);
    if (hit) {
      return {
        i: it.id,
        x: hit.x,
        y: hit.y,
        w: hit.w,
        h: hit.h,
        minW: it.defaultLayout.minW,
        minH: it.defaultLayout.minH,
      };
    }
    return {
      i: it.id,
      x: 0,
      y: maxY + idx,
      w: Math.min(it.defaultLayout.w, COLS.lg),
      h: it.defaultLayout.h,
      minW: it.defaultLayout.minW,
      minH: it.defaultLayout.minH,
    };
  });
}

export function DashboardGrid({ items }: { items: DashboardGridItem[] }) {
  const dashboardLayout = useDashboardStore((s) => s.dashboardLayout);
  const editMode = useDashboardStore((s) => s.dashboardEditMode);
  const setDashboardLayout = useDashboardStore((s) => s.setDashboardLayout);

  // react-grid-layout's WidthProvider measures the DOM, so only render after mount
  // to avoid an SSR/first-client hydration mismatch (matches the store's hydrate flow).
  const [mounted, setMounted] = useState(false);
  const breakpointRef = useRef<string>('lg');
  useEffect(() => setMounted(true), []);

  const layouts: Layouts = useMemo(() => {
    const free = mergeFreeLayout(items, dashboardLayout);
    return {
      lg: free,
      md: free,
      sm: stackLayout(items, COLS.sm),
      xs: stackLayout(items, COLS.xs),
      xxs: stackLayout(items, COLS.xxs),
    };
  }, [items, dashboardLayout]);

  // A stable default arrangement to fall back to before mount (SSR / first paint):
  // a plain vertical stack so the markup is sensible without the grid engine.
  if (!mounted) {
    return (
      <div className="space-y-4">
        {items.map((it) => (
          <div key={it.id}>{it.node}</div>
        ))}
      </div>
    );
  }

  const persist = (all: Layouts) => {
    const bp = breakpointRef.current;
    // Only the free (12-col) breakpoints represent the desktop arrangement we save;
    // the narrow breakpoints are auto-stacked and must not overwrite it.
    if (!FREE_BREAKPOINTS.includes(bp)) return;
    const current = all[bp];
    if (!current) return;
    const next: LayoutItem[] = current.map((l) => ({
      i: l.i,
      x: l.x,
      y: l.y,
      w: l.w,
      h: l.h,
      minW: l.minW,
      minH: l.minH,
    }));
    setDashboardLayout(next);
  };

  return (
    <Grid
      className={clsx('deskos-grid', editMode && 'deskos-grid--editing')}
      layouts={layouts}
      breakpoints={BREAKPOINTS}
      cols={COLS}
      rowHeight={ROW_HEIGHT}
      margin={MARGIN}
      isDraggable={editMode}
      isResizable={editMode}
      draggableHandle=".deskos-drag-handle"
      compactType="vertical"
      onBreakpointChange={(bp) => {
        breakpointRef.current = bp;
      }}
      onLayoutChange={(_current, all) => {
        if (editMode) persist(all);
      }}
    >
      {items.map((it) => (
        <div
          key={it.id}
          className={clsx(
            'flex h-full flex-col overflow-hidden',
            editMode && 'rounded-none ring-1 ring-accent/40'
          )}
        >
          {editMode && (
            <div className="deskos-drag-handle flex cursor-move items-center gap-2 border-b border-accent/30 bg-darker/70 px-2 py-1">
              <HoloIcon name="grid" className="h-3.5 w-3.5 text-accent/70" />
              <span className="truncate font-mono text-[10px] uppercase tracking-wider text-accent/70">
                {it.label}
              </span>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto">{it.node}</div>
        </div>
      ))}
    </Grid>
  );
}
