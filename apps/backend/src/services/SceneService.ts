// Scene Service (Szenen)
//
// A Scene is a named, reusable snapshot of the desk ambience — primarily
// lighting (WLED), generally a bundle of the automation action types. It is the
// reusable building block behind the "Scenes" tile, the M4 "Szene ausführen"
// automation action and the layout profiles (which reference a scene instead of
// duplicating WLED actions).
//
// Decoupling: applying a scene runs its actions through the shared
// ActionExecutor (bus events), so this service never talks to WLED/Notification
// directly. Automations/layouts trigger a scene via the `scene:apply` event
// (emitted by the ActionExecutor for a `scene` action); attach() listens for it.

import { eventSystem, DeskOSEvent } from '../core/EventSystem';
import { executeActions } from '../core/ActionExecutor';
import { wledService } from './WledService';
import { v4 as uuidv4 } from 'uuid';
import type { DatabaseService } from './DatabaseService';
import type { Scene, AutomationAction } from '@shared/types';

interface SceneRow {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  actions: string;
}

// Seeded scenes target 'all' WLED lights (like the layout defaults); users can
// edit them or capture their own via the API/UI.
const DEFAULT_SCENES: Scene[] = [
  { id: 'scene-focus', name: 'Fokus', icon: 'bulb', color: [255, 240, 210], actions: [{ type: 'wled', target: 'all', on: true, brightness: 90, color: [255, 240, 210], mode: 'manual' }] },
  { id: 'scene-relax', name: 'Entspannen', icon: 'bulb', color: [255, 150, 60], actions: [{ type: 'wled', target: 'all', on: true, brightness: 45, color: [255, 150, 60], mode: 'manual' }] },
  { id: 'scene-movie', name: 'Kino', icon: 'camera', color: [60, 40, 140], actions: [{ type: 'wled', target: 'all', on: true, brightness: 20, color: [60, 40, 140], mode: 'manual' }] },
  { id: 'scene-party', name: 'Party', icon: 'zap', color: [255, 0, 150], actions: [{ type: 'wled', target: 'all', on: true, brightness: 100, color: [255, 0, 150], mode: 'manual' }] },
  { id: 'scene-off', name: 'Aus', icon: 'power', color: [40, 40, 55], actions: [{ type: 'wled', target: 'all', on: false, mode: 'manual' }] },
];

export class SceneService {
  private readonly db: DatabaseService;
  private readonly scenes = new Map<string, Scene>();
  // Scene ids currently being applied — guards against scene->scene cycles.
  private readonly applying = new Set<string>();

  constructor(db: DatabaseService) {
    this.db = db;
  }

  // ---------------------------------------------------------------- lifecycle

  async restore(): Promise<void> {
    const rows = await this.db.all<SceneRow>('SELECT * FROM scenes');
    for (const row of rows) {
      this.scenes.set(row.id, {
        id: row.id,
        name: row.name,
        icon: row.icon ?? undefined,
        color: this.parseColor(row.color),
        actions: this.parseActions(row.actions),
      });
    }
  }

  async seedDefaults(): Promise<void> {
    if (this.scenes.size > 0) return;
    for (const scene of DEFAULT_SCENES) {
      await this.persist(scene);
      this.scenes.set(scene.id, scene);
    }
  }

  /** React to `scene:apply` events emitted by the ActionExecutor. */
  attach(): void {
    eventSystem.on('scene:apply', (e: DeskOSEvent) => {
      const id = (e.payload as { sceneId?: string })?.sceneId;
      if (id) void this.apply(id);
    });
  }

  // -------------------------------------------------------------------- CRUD

  list(): Scene[] {
    return Array.from(this.scenes.values());
  }

  get(id: string): Scene | null {
    return this.scenes.get(id) ?? null;
  }

  async create(input: Omit<Scene, 'id'>): Promise<Scene> {
    const scene: Scene = { id: uuidv4(), ...input, actions: input.actions ?? [] };
    await this.persist(scene);
    this.scenes.set(scene.id, scene);
    this.emitUpdate();
    return scene;
  }

  async update(id: string, patch: Partial<Omit<Scene, 'id'>>): Promise<Scene | null> {
    const current = this.scenes.get(id);
    if (!current) return null;
    const updated: Scene = { ...current, ...patch, id };
    await this.persist(updated);
    this.scenes.set(id, updated);
    this.emitUpdate();
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    if (!this.scenes.has(id)) return false;
    await this.db.run('DELETE FROM scenes WHERE id = ?', [id]);
    this.scenes.delete(id);
    this.emitUpdate();
    return true;
  }

  // ------------------------------------------------------------------- apply

  /** Run a scene's actions. Emits `scene:applied`; cycle-safe. */
  async apply(id: string): Promise<Scene | null> {
    const scene = this.scenes.get(id);
    if (!scene) return null;
    // A scene reached again while it is still applying (direct self-reference or
    // an A->B->A cycle) is skipped instead of looping forever.
    if (this.applying.has(id)) return scene;

    this.applying.add(id);
    try {
      // Nested `scene` actions emit `scene:apply`, which this service handles
      // synchronously within executeActions, so the guard above sees them.
      executeActions(scene.actions, `scene:${id}`);
    } finally {
      this.applying.delete(id);
    }
    eventSystem.emit('scene:applied', { sceneId: id, name: scene.name }, 'scene-service');
    return scene;
  }

  // ----------------------------------------------------------------- capture

  /**
   * Build WLED actions from the lights' current live state, so the user can
   * save "the way the desk looks right now" as a scene. Offline lights (no
   * cached state) are skipped.
   */
  captureLightActions(): AutomationAction[] {
    return wledService
      .listLights()
      .filter((light) => light.state)
      .map((light) => ({
        type: 'wled' as const,
        target: light.id,
        on: light.state!.on,
        brightness: light.state!.brightness,
        color: light.state!.color,
        effect: light.state!.effect,
        mode: light.mode,
      }));
  }

  // --------------------------------------------------------------- internals

  private emitUpdate(): void {
    eventSystem.emit('scene:update', this.list(), 'scene-service');
  }

  private async persist(scene: Scene): Promise<void> {
    await this.db.run(
      `INSERT INTO scenes (id, name, icon, color, actions, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon, color = excluded.color, actions = excluded.actions`,
      [scene.id, scene.name, scene.icon ?? null, scene.color ? JSON.stringify(scene.color) : null, JSON.stringify(scene.actions), Date.now()]
    );
  }

  private parseActions(value: string): AutomationAction[] {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private parseColor(value: string | null): [number, number, number] | undefined {
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) && parsed.length === 3 ? (parsed as [number, number, number]) : undefined;
    } catch {
      return undefined;
    }
  }
}

export const createSceneService = (db: DatabaseService): SceneService => new SceneService(db);
