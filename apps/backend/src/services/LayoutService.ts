// Layout / Profile Service (M4)
//
// Manages dashboard profiles (Gaming/Coding/…). Each profile carries a "scene"
// (a list of actions, reusing the automation action types) that is executed on
// activation, plus an optional dashboard view. Activation broadcasts
// `layout:set` so the frontend can reflect the active profile + switch view.

import { eventSystem } from '../core/EventSystem';
import { executeActions } from '../core/ActionExecutor';
import { v4 as uuidv4 } from 'uuid';
import type { DatabaseService } from './DatabaseService';
import type { LayoutProfile, AutomationAction } from '@shared/types';

interface LayoutRow {
  id: string;
  name: string;
  icon: string | null;
  view: string | null;
  actions: string;
}

const ACTIVE_KEY = 'activeLayout';

// Seeded profiles. WLED scenes target 'all' lights; users can edit via the API.
const DEFAULT_PROFILES: LayoutProfile[] = [
  { id: 'profile-gaming', name: 'Gaming', icon: 'zap', view: 'dashboard', actions: [{ type: 'wled', target: 'all', on: true, brightness: 100, color: [160, 0, 255], mode: 'manual' }] },
  { id: 'profile-coding', name: 'Coding', icon: 'code', view: 'dashboard', actions: [{ type: 'wled', target: 'all', on: true, brightness: 60, color: [255, 170, 80], mode: 'manual' }] },
  { id: 'profile-streaming', name: 'Streaming', icon: 'camera', view: 'dashboard', actions: [{ type: 'wled', target: 'all', on: true, brightness: 90, color: [255, 0, 150], mode: 'manual' }] },
  { id: 'profile-work', name: 'Work', icon: 'monitor', view: 'dashboard', actions: [{ type: 'wled', target: 'all', on: true, brightness: 100, color: [255, 255, 255], mode: 'manual' }] },
  { id: 'profile-minimal', name: 'Minimal', icon: 'power', view: 'dashboard', actions: [{ type: 'wled', target: 'all', on: true, brightness: 20, color: [80, 80, 120], mode: 'manual' }] },
];

export class LayoutService {
  private readonly db: DatabaseService;
  private readonly profiles = new Map<string, LayoutProfile>();
  private activeId: string | null = null;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  async restore(): Promise<void> {
    const rows = await this.db.all<LayoutRow>('SELECT * FROM layouts');
    for (const row of rows) {
      this.profiles.set(row.id, {
        id: row.id,
        name: row.name,
        icon: row.icon ?? undefined,
        view: row.view ?? undefined,
        actions: this.parseActions(row.actions),
      });
    }
    const active = await this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [ACTIVE_KEY]);
    this.activeId = active?.value ?? null;
  }

  async seedDefaults(): Promise<void> {
    if (this.profiles.size > 0) return;
    for (const profile of DEFAULT_PROFILES) {
      await this.persist(profile);
      this.profiles.set(profile.id, profile);
    }
  }

  list(): LayoutProfile[] {
    return Array.from(this.profiles.values());
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  get(id: string): LayoutProfile | null {
    return this.profiles.get(id) ?? null;
  }

  async create(input: Omit<LayoutProfile, 'id'>): Promise<LayoutProfile> {
    const profile: LayoutProfile = { id: uuidv4(), ...input, actions: input.actions ?? [] };
    await this.persist(profile);
    this.profiles.set(profile.id, profile);
    return profile;
  }

  async update(id: string, patch: Partial<Omit<LayoutProfile, 'id'>>): Promise<LayoutProfile | null> {
    const current = this.profiles.get(id);
    if (!current) return null;
    const updated: LayoutProfile = { ...current, ...patch, id };
    await this.persist(updated);
    this.profiles.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    if (!this.profiles.has(id)) return false;
    await this.db.run('DELETE FROM layouts WHERE id = ?', [id]);
    this.profiles.delete(id);
    if (this.activeId === id) {
      this.activeId = null;
      await this.db.run('DELETE FROM settings WHERE key = ?', [ACTIVE_KEY]);
    }
    return true;
  }

  /** Apply a profile: run its scene actions, mark active, broadcast. */
  async activate(id: string): Promise<LayoutProfile | null> {
    const profile = this.profiles.get(id);
    if (!profile) return null;

    executeActions(profile.actions, `layout:${id}`);
    this.activeId = id;
    await this.db.run(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [ACTIVE_KEY, id]
    );
    eventSystem.emit('layout:set', { profileId: id, view: profile.view, name: profile.name }, 'layout-service');
    return profile;
  }

  private async persist(profile: LayoutProfile): Promise<void> {
    await this.db.run(
      `INSERT INTO layouts (id, name, icon, view, actions, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon, view = excluded.view, actions = excluded.actions`,
      [profile.id, profile.name, profile.icon ?? null, profile.view ?? null, JSON.stringify(profile.actions), Date.now()]
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
}

export const createLayoutService = (db: DatabaseService): LayoutService => new LayoutService(db);
