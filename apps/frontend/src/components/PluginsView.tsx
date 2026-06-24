'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useDashboardStore, type PluginInstance } from '@/stores/dashboardStore';
import { Panel, HoloCorners, HoloIcon } from '@/components/holo';

/* =========================================================================
   DeskOS Plugin Marketplace (M6)
   ========================================================================= */

const CATEGORY_LABEL: Record<string, string> = {
  system: 'System',
  media: 'Medien',
  communication: 'Kommunikation',
  streaming: 'Streaming',
  gaming: 'Gaming',
  'smart-home': 'Smart Home',
};

function PluginCard({ plugin }: { plugin: PluginInstance }) {
  const action = useDashboardStore((s) => s.pluginAction);
  const saveSettings = useDashboardStore((s) => s.updatePluginSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(plugin.settings ?? {});

  return (
    <Panel className="relative flex flex-col">
      <HoloCorners />
      <div className="mb-2 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-none border border-accent/25 bg-accent/5 text-accent">
          <HoloIcon name={plugin.icon} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-mono text-sm font-bold text-white">{plugin.name}</h3>
            {plugin.builtin && <span className="rounded-none border border-success/40 px-1.5 text-[9px] uppercase text-success">built-in</span>}
          </div>
          <p className="holo-label">{CATEGORY_LABEL[plugin.category] ?? plugin.category}</p>
        </div>
      </div>

      <p className="mb-3 flex-1 text-[12px] text-white/60">{plugin.description}</p>

      <div className="flex flex-wrap items-center gap-2">
        {!plugin.installed ? (
          <button
            type="button"
            onClick={() => action(plugin.id, 'install')}
            className="rounded-none border border-accent/40 px-3 py-1 text-[11px] uppercase tracking-wider text-accent transition-colors hover:bg-accent/10"
          >
            Installieren
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => action(plugin.id, plugin.enabled ? 'disable' : 'enable')}
              className={clsx(
                'rounded-none border px-3 py-1 text-[11px] uppercase tracking-wider transition-colors',
                plugin.enabled ? 'border-success/50 text-success hover:bg-success/10' : 'border-accent/30 text-accent/60 hover:bg-accent/10'
              )}
            >
              {plugin.enabled ? 'Aktiv' : 'Aktivieren'}
            </button>
            {plugin.requiresAuth && (
              <button
                type="button"
                onClick={() => setShowSettings((v) => !v)}
                className="rounded-none border border-accent/30 px-2.5 py-1 text-[11px] uppercase tracking-wider text-accent/70 hover:bg-accent/10"
              >
                <HoloIcon name="gear" className="inline h-3.5 w-3.5" />
              </button>
            )}
            {!plugin.builtin && (
              <button
                type="button"
                onClick={() => action(plugin.id, 'uninstall')}
                className="text-[10px] uppercase tracking-wider text-danger/70 transition-colors hover:text-danger"
              >
                Deinstallieren
              </button>
            )}
          </>
        )}
      </div>

      {showSettings && plugin.settingsSchema && (
        <div className="mt-3 space-y-2 border-t border-accent/15 pt-3">
          {plugin.settingsSchema.map((f) => (
            <div key={f.key}>
              <label className="holo-label mb-1 block">{f.label}</label>
              <input
                type={f.type === 'password' ? 'password' : 'text'}
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                className="w-full rounded-none border border-accent/30 bg-darker/60 px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              saveSettings(plugin.id, draft);
              setShowSettings(false);
            }}
            className="rounded-none border border-accent/40 px-3 py-1 text-[11px] uppercase tracking-wider text-accent hover:bg-accent/10"
          >
            Speichern
          </button>
        </div>
      )}
    </Panel>
  );
}

export function PluginsView() {
  const plugins = useDashboardStore((s) => s.plugins);
  const fetchPlugins = useDashboardStore((s) => s.fetchPlugins);
  const setActiveView = useDashboardStore((s) => s.setActiveView);
  const [category, setCategory] = useState<string>('all');

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  const categories = useMemo(() => ['all', ...Array.from(new Set(plugins.map((p) => p.category)))], [plugins]);
  const filtered = category === 'all' ? plugins : plugins.filter((p) => p.category === category);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setActiveView('dashboard')}
          className="flex items-center gap-1.5 rounded-none border border-accent/30 px-2.5 py-1.5 text-[11px] uppercase tracking-wider text-accent/80 transition-colors hover:border-accent hover:bg-accent/10"
        >
          <HoloIcon name="grid" className="h-4 w-4" /> Dashboard
        </button>
        <div className="flex items-center gap-2">
          <HoloIcon name="plug" className="h-5 w-5 text-accent" />
          <h2 className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent" style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}>
            Plugin Marketplace
          </h2>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={clsx(
              'rounded-none border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider transition-all',
              category === c ? 'border-accent bg-accent/15 text-accent' : 'border-accent/20 text-accent/50 hover:border-accent/50 hover:text-accent/80'
            )}
          >
            {c === 'all' ? 'Alle' : CATEGORY_LABEL[c] ?? c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((p) => (
          <PluginCard key={p.id} plugin={p} />
        ))}
      </div>
    </div>
  );
}
