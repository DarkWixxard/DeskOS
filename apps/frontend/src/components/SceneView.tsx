'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useDashboardStore, type Scene, type AutomationAction } from '@/stores/dashboardStore';
import { Panel, HoloCorners, HoloIcon } from '@/components/holo';

/* =========================================================================
   DeskOS Scenes (Szenen)

   A scene is a named, reusable snapshot of the desk ambience — primarily WLED
   lighting — that is applied with one click, and that automations / layout
   profiles reference (action type 'scene'). This view lists the saved scenes,
   applies them, lets you capture the current lighting as a new scene and remove
   scenes again.
   ========================================================================= */

const toRgbCss = (c?: [number, number, number]): string =>
  c ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : 'rgb(0, 217, 255)';

const toHex = (c?: [number, number, number]): string =>
  c ? '#' + c.map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('') : '#00d9ff';

const fromHex = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) || 0,
  parseInt(hex.slice(3, 5), 16) || 0,
  parseInt(hex.slice(5, 7), 16) || 0,
];

// A short human summary of what a scene does, from its action list.
function summarize(actions: AutomationAction[]): string {
  const counts = { wled: 0, notify: 0, layout: 0, scene: 0, emit_event: 0 } as Record<string, number>;
  for (const a of actions) counts[a.type] = (counts[a.type] ?? 0) + 1;
  const parts: string[] = [];
  if (counts.wled) parts.push(`${counts.wled}× Licht`);
  if (counts.notify) parts.push(`${counts.notify}× Notify`);
  if (counts.layout) parts.push(`${counts.layout}× Layout`);
  if (counts.scene) parts.push(`${counts.scene}× Szene`);
  if (counts.emit_event) parts.push(`${counts.emit_event}× Event`);
  return parts.length ? parts.join(' · ') : 'Keine Aktionen';
}

function SceneCard({ scene }: { scene: Scene }) {
  const applyScene = useDashboardStore((s) => s.applyScene);
  const updateScene = useDashboardStore((s) => s.updateScene);
  const deleteScene = useDashboardStore((s) => s.deleteScene);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(scene.name);
  const [editColor, setEditColor] = useState(toHex(scene.color));

  const accent = toRgbCss(scene.color);

  const saveEdit = async () => {
    await updateScene(scene.id, { name: editName.trim() || scene.name, color: fromHex(editColor) });
    setEditing(false);
  };

  return (
    <Panel className="relative">
      <HoloCorners />
      {/* Accent bar in the scene's colour. */}
      <div className="mb-3 h-1.5 w-full rounded-full" style={{ backgroundColor: accent, boxShadow: `0 0 10px ${accent}` }} />

      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-none border"
            style={{ borderColor: `${accent}66`, color: accent }}
          >
            <HoloIcon name={scene.icon ?? 'layers'} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate font-mono text-base font-bold text-white">{scene.name}</h3>
            <p className="holo-label">{summarize(scene.actions)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => setEditing((e) => !e)} className="text-accent/50 transition-colors hover:text-accent" aria-label="Bearbeiten">
            <HoloIcon name="gear" className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => window.confirm(`Szene „${scene.name}" löschen?`) && deleteScene(scene.id)}
            className="text-[10px] uppercase tracking-wider text-danger/70 transition-colors hover:text-danger"
          >
            Löschen
          </button>
        </div>
      </div>

      {editing && (
        <div className="mb-3 space-y-2 rounded-none border border-accent/15 bg-accent/[0.03] p-2.5">
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Name"
            className="w-full rounded-none border border-accent/30 bg-darker/60 px-2 py-1 text-sm text-white outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2">
            <span className="holo-label">Farbe</span>
            <input
              type="color"
              value={editColor}
              onChange={(e) => setEditColor(e.target.value)}
              className="h-8 w-12 cursor-pointer rounded-none border border-accent/30 bg-transparent"
              aria-label="Akzentfarbe"
            />
            <button type="button" onClick={saveEdit} className="ml-auto rounded-none border border-accent/40 px-2.5 py-1 text-[11px] uppercase tracking-wider text-accent hover:bg-accent/10">
              Speichern
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => applyScene(scene.id)}
        className="flex w-full items-center justify-center gap-1.5 rounded-none border border-accent/40 py-2 text-[11px] font-semibold uppercase tracking-wider text-accent transition-all hover:bg-accent/10 hover:shadow-glow-sm"
      >
        <HoloIcon name="power" className="h-4 w-4" /> Anwenden
      </button>
    </Panel>
  );
}

export function SceneView() {
  const scenes = useDashboardStore((s) => s.scenes);
  const fetchScenes = useDashboardStore((s) => s.fetchScenes);
  const createScene = useDashboardStore((s) => s.createScene);
  const setActiveView = useDashboardStore((s) => s.setActiveView);

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchScenes();
  }, [fetchScenes]);

  const handleCreate = async (capture: boolean) => {
    if (!name.trim()) return;
    setBusy(true);
    const ok = await createScene({ name: name.trim(), capture });
    setBusy(false);
    if (ok) setName('');
  };

  const field =
    'rounded-none border border-accent/30 bg-darker/60 px-3 py-1.5 text-sm text-white outline-none placeholder:text-accent/30 focus:border-accent focus:shadow-glow-sm';

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveView('dashboard')}
            className="flex items-center gap-1.5 rounded-none border border-accent/30 px-2.5 py-1.5 text-[11px] uppercase tracking-wider text-accent/80 transition-colors hover:border-accent hover:bg-accent/10"
          >
            <HoloIcon name="grid" className="h-4 w-4" /> Dashboard
          </button>
          <div className="flex items-center gap-2">
            <HoloIcon name="layers" className="h-5 w-5 text-accent" />
            <h2 className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent" style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}>
              Szenen
            </h2>
          </div>
        </div>
      </div>

      {/* Create scene */}
      <Panel title="Szene erstellen" className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (z. B. Fokus)"
            className={clsx(field, 'flex-1 min-w-[160px]')}
          />
          <button
            type="button"
            onClick={() => handleCreate(true)}
            disabled={busy || !name.trim()}
            title="Aktuellen WLED-Zustand als Szene speichern"
            className="flex items-center gap-1.5 rounded-none border border-accent/40 px-3 py-1.5 text-[11px] uppercase tracking-wider text-accent transition-colors hover:bg-accent/10 disabled:opacity-30"
          >
            <HoloIcon name="bulb" className="h-4 w-4" /> {busy ? '…' : 'Aus aktuellem Licht'}
          </button>
          <button
            type="button"
            onClick={() => handleCreate(false)}
            disabled={busy || !name.trim()}
            title="Leere Szene anlegen (später bearbeiten)"
            className="rounded-none border border-accent/20 px-3 py-1.5 text-[11px] uppercase tracking-wider text-accent/70 transition-colors hover:bg-accent/10 hover:text-accent disabled:opacity-30"
          >
            Leer anlegen
          </button>
        </div>
        <p className="mt-2 text-[11px] text-accent/40">
          „Aus aktuellem Licht" speichert den momentanen Zustand aller WLED-Lichter. Szenen lassen sich per Automation
          (Aktion „Szene ausführen") oder aus Layout-Profilen auslösen.
        </p>
      </Panel>

      {scenes.length === 0 ? (
        <Panel>
          <p className="py-10 text-center text-[12px] text-accent/40">Noch keine Szenen angelegt.</p>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {scenes.map((scene) => (
            <SceneCard key={scene.id} scene={scene} />
          ))}
        </div>
      )}
    </div>
  );
}
