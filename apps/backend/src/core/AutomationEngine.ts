// Automation Engine v2 (M4)
import { eventSystem, DeskOSEvent } from './EventSystem';
import { executeActions } from './ActionExecutor';
import type { AutomationRule, AutomationTrigger, ThresholdTrigger } from '@shared/types';

// Canonical types live in @shared/types; re-exported for existing callers
// (PersistenceService imports AutomationRule from here).
export type { AutomationRule, AutomationTrigger } from '@shared/types';

export class AutomationEngine {
  private rules: Map<string, AutomationRule> = new Map();
  private scheduleTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Event-driven triggers (threshold / event / device_status).
    eventSystem.on('*', (event: DeskOSEvent) => this.onEvent(event));
    // Time-driven triggers (schedule), checked once per minute.
    this.scheduleTimer = setInterval(() => this.tickSchedules(), 60_000);
    this.scheduleTimer.unref?.();
  }

  stop(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
  }

  // ------------------------------------------------------------------ rules

  addRule(rule: Omit<AutomationRule, 'lastFired'>): AutomationRule {
    const fullRule: AutomationRule = { ...rule, lastFired: 0 };
    this.rules.set(rule.id, fullRule);
    eventSystem.emit('automation:added', fullRule, 'automation-engine');
    return fullRule;
  }

  /** Load a persisted rule without emitting (startup restore). */
  loadRule(rule: AutomationRule): AutomationRule {
    this.rules.set(rule.id, rule);
    return rule;
  }

  removeRule(ruleId: string): boolean {
    const removed = this.rules.delete(ruleId);
    if (removed) eventSystem.emit('automation:removed', { id: ruleId }, 'automation-engine');
    return removed;
  }

  setEnabled(ruleId: string, enabled: boolean): AutomationRule | null {
    const rule = this.rules.get(ruleId);
    if (!rule) return null;
    rule.enabled = enabled;
    eventSystem.emit('automation:updated', rule, 'automation-engine');
    return rule;
  }

  getRule(ruleId: string): AutomationRule | null {
    return this.rules.get(ruleId) || null;
  }

  getAllRules(): AutomationRule[] {
    return Array.from(this.rules.values());
  }

  // --------------------------------------------------------------- matching

  private onEvent(event: DeskOSEvent): void {
    // Ignore the engine's own bookkeeping events to avoid feedback loops.
    if (event.type.startsWith('automation:')) return;

    const now = Date.now();
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      if (now - rule.lastFired < rule.cooldownMs) continue;
      if (this.matchesEvent(rule.trigger, event)) {
        this.fire(rule, now, { event: event.type, payload: event.payload });
      }
    }
  }

  private matchesEvent(trigger: AutomationTrigger, event: DeskOSEvent): boolean {
    switch (trigger?.type) {
      case 'threshold':
        return (
          typeof event.type === 'string' &&
          event.type.endsWith(':data') &&
          this.checkThreshold(trigger, event.payload as Record<string, unknown>)
        );
      case 'event':
        return event.type === trigger.eventType;
      case 'device_status': {
        if (event.type !== 'device:status-changed') return false;
        const p = event.payload as { deviceId?: string; newStatus?: string };
        return p?.newStatus === trigger.status && (!trigger.deviceId || p?.deviceId === trigger.deviceId);
      }
      default:
        return false; // schedule (handled by timer) or unknown/legacy shape
    }
  }

  private tickSchedules(): void {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const day = now.getDay();
    const ts = now.getTime();

    for (const rule of this.rules.values()) {
      if (!rule.enabled || rule.trigger?.type !== 'schedule') continue;
      if (ts - rule.lastFired < Math.max(rule.cooldownMs, 60_000)) continue;
      const t = rule.trigger;
      if (t.time !== hhmm) continue;
      if (t.days && t.days.length > 0 && !t.days.includes(day)) continue;
      this.fire(rule, ts, { scheduled: hhmm });
    }
  }

  private fire(rule: AutomationRule, now: number, context: Record<string, unknown>): void {
    rule.lastFired = now;
    eventSystem.emit('automation:fired', { ruleId: rule.id, name: rule.name }, 'automation-engine');
    executeActions(rule.actions, `automation:${rule.id}`, context);
  }

  // --------------------------------------------------------------- helpers

  private getNestedValue(obj: Record<string, unknown>, field: string): number | undefined {
    const parts = field.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return typeof current === 'number' ? current : undefined;
  }

  private checkThreshold(trigger: ThresholdTrigger, context: Record<string, unknown>): boolean {
    const actual = this.getNestedValue(context, trigger.field);
    if (actual === undefined) return false;
    switch (trigger.operator) {
      case 'gt':
        return actual > trigger.value;
      case 'lt':
        return actual < trigger.value;
      case 'gte':
        return actual >= trigger.value;
      case 'lte':
        return actual <= trigger.value;
      case 'eq':
        return actual === trigger.value;
      default:
        return false;
    }
  }
}

export const automationEngine = new AutomationEngine();
