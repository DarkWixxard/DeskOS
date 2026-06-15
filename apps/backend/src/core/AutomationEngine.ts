import { eventSystem, DeskOSEvent } from './EventSystem';

export interface AutomationCondition {
  field: string;
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  value: number;
}

export interface AutomationRule {
  id: string;
  name: string;
  trigger: {
    type: 'threshold';
    condition: AutomationCondition;
  };
  actions: Array<{
    type: 'emit_event';
    payload: {
      eventType: string;
      priority?: 'low' | 'normal' | 'high' | 'critical';
      message?: string;
    };
  }>;
  enabled: boolean;
  cooldownMs: number;
  lastFired: number;
}

export class AutomationEngine {
  private rules: Map<string, AutomationRule> = new Map();

  constructor() {
    eventSystem.on('*', (event: DeskOSEvent) => {
      if (typeof event.type === 'string' && event.type.endsWith(':data')) {
        this.evaluateAll(event.payload as Record<string, unknown>);
      }
    });
  }

  addRule(rule: Omit<AutomationRule, 'lastFired'>): AutomationRule {
    const fullRule: AutomationRule = { ...rule, lastFired: 0 };
    this.rules.set(rule.id, fullRule);
    return fullRule;
  }

  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  getRule(ruleId: string): AutomationRule | null {
    return this.rules.get(ruleId) || null;
  }

  getAllRules(): AutomationRule[] {
    return Array.from(this.rules.values());
  }

  private getNestedValue(obj: Record<string, unknown>, field: string): number | undefined {
    const parts = field.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return typeof current === 'number' ? current : undefined;
  }

  private checkCondition(condition: AutomationCondition, context: Record<string, unknown>): boolean {
    const actual = this.getNestedValue(context, condition.field);
    if (actual === undefined) return false;
    switch (condition.operator) {
      case 'gt':  return actual > condition.value;
      case 'lt':  return actual < condition.value;
      case 'gte': return actual >= condition.value;
      case 'lte': return actual <= condition.value;
      case 'eq':  return actual === condition.value;
    }
  }

  private evaluateAll(context: Record<string, unknown>): void {
    const now = Date.now();
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      if (now - rule.lastFired < rule.cooldownMs) continue;
      if (!this.checkCondition(rule.trigger.condition, context)) continue;

      rule.lastFired = now;
      for (const action of rule.actions) {
        if (action.type === 'emit_event') {
          eventSystem.emit(
            action.payload.eventType,
            { message: action.payload.message ?? `Rule "${rule.name}" triggered`, context },
            'automation-engine',
            action.payload.priority ?? 'normal'
          );
        }
      }
    }
  }
}

export const automationEngine = new AutomationEngine();
