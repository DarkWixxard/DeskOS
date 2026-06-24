'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  useDashboardStore,
  type AutomationRule,
  type AutomationTrigger,
  type AutomationAction,
} from '@/stores/dashboardStore';
import { Panel, HoloCorners, HoloIcon } from '@/components/holo';

/* =========================================================================
   DeskOS Automation Builder (M4) — no-code rule editor.
   ========================================================================= */

const FIELD =
  'rounded-none border border-accent/30 bg-darker/60 px-2.5 py-1.5 text-sm text-white outline-none placeholder:text-accent/30 focus:border-accent focus:shadow-glow-sm';

const OPERATORS: { v: 'gt' | 'lt' | 'gte' | 'lte' | 'eq'; label: string }[] = [
  { v: 'gt', label: '>' },
  { v: 'lt', label: '<' },
  { v: 'gte', label: '≥' },
  { v: 'lte', label: '≤' },
  { v: 'eq', label: '=' },
];
const OP_SYMBOL: Record<string, string> = { gt: '>', lt: '<', gte: '≥', lte: '≤', eq: '=' };
const METRIC_FIELDS = ['cpu', 'ram.percentage', 'cpuTempC', 'disk.percentage'];

const triggerDefaults: Record<AutomationTrigger['type'], AutomationTrigger> = {
  threshold: { type: 'threshold', field: 'cpu', operator: 'gt', value: 80 },
  event: { type: 'event', eventType: '' },
  device_status: { type: 'device_status', status: 'offline' },
  schedule: { type: 'schedule', time: '22:00' },
};

const actionDefaults: Record<AutomationAction['type'], AutomationAction> = {
  notify: { type: 'notify', title: '', message: '', level: 'info' },
  wled: { type: 'wled', target: 'all', on: true, brightness: 100, color: '#ff0000' },
  emit_event: { type: 'emit_event', eventType: '', message: '', priority: 'normal' },
  layout: { type: 'layout', view: 'dashboard' },
};

function triggerSummary(t: AutomationTrigger): string {
  switch (t.type) {
    case 'threshold':
      return `${t.field} ${OP_SYMBOL[t.operator]} ${t.value}`;
    case 'event':
      return `Event: ${t.eventType || '—'}`;
    case 'device_status':
      return `Gerät → ${t.status}`;
    case 'schedule':
      return `⏰ ${t.time}`;
    default:
      return '—';
  }
}
function actionSummary(a: AutomationAction): string {
  switch (a.type) {
    case 'notify':
      return `🔔 ${a.title || 'Benachrichtigung'}`;
    case 'wled':
      return `💡 WLED ${a.target}`;
    case 'emit_event':
      return `⚡ ${a.eventType || 'Event'}`;
    case 'layout':
      return `🗂 Layout`;
    default:
      return '—';
  }
}

export function AutomationsView() {
  const automations = useDashboardStore((s) => s.automations);
  const wledLights = useDashboardStore((s) => s.wledLights);
  const fetchAutomations = useDashboardStore((s) => s.fetchAutomations);
  const createAutomation = useDashboardStore((s) => s.createAutomation);
  const deleteAutomation = useDashboardStore((s) => s.deleteAutomation);
  const toggleAutomation = useDashboardStore((s) => s.toggleAutomation);
  const setActiveView = useDashboardStore((s) => s.setActiveView);

  const [name, setName] = useState('');
  const [cooldownSec, setCooldownSec] = useState(60);
  const [trigger, setTrigger] = useState<AutomationTrigger>(triggerDefaults.threshold);
  const [actions, setActions] = useState<AutomationAction[]>([{ ...actionDefaults.notify }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAutomations();
  }, [fetchAutomations]);

  const updateAction = (i: number, patch: Record<string, unknown>) =>
    setActions((arr) => arr.map((a, idx) => (idx === i ? ({ ...a, ...patch } as AutomationAction) : a)));
  const changeActionType = (i: number, type: AutomationAction['type']) =>
    setActions((arr) => arr.map((a, idx) => (idx === i ? { ...actionDefaults[type] } : a)));

  const canSave = name.trim().length > 0 && actions.length > 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const ok = await createAutomation({
      id: `rule-${Date.now()}`,
      name: name.trim(),
      trigger,
      actions,
      enabled: true,
      cooldownMs: Math.max(0, cooldownSec) * 1000,
    });
    setSaving(false);
    if (ok) {
      setName('');
      setTrigger(triggerDefaults.threshold);
      setActions([{ ...actionDefaults.notify }]);
    }
  };

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
          <HoloIcon name="zap" className="h-5 w-5 text-accent" />
          <h2 className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent" style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}>
            Automationen
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.1fr]">
        {/* Existing rules */}
        <Panel title="Regeln" badge={<span className="font-mono text-[10px] text-accent/60">{automations.length}</span>}>
          {automations.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-accent/40">Noch keine Regeln.</p>
          ) : (
            <div className="space-y-2">
              {automations.map((rule: AutomationRule) => (
                <div key={rule.id} className="relative rounded-none border border-accent/15 bg-accent/[0.03] p-3">
                  <HoloCorners />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm text-white/90">{rule.name}</p>
                      <p className="mt-0.5 text-[11px] text-accent/55">
                        {triggerSummary(rule.trigger)} → {rule.actions.map(actionSummary).join(', ')}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleAutomation(rule.id, !rule.enabled)}
                        className={clsx(
                          'rounded-none border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors',
                          rule.enabled ? 'border-success/50 text-success' : 'border-accent/30 text-accent/40'
                        )}
                      >
                        {rule.enabled ? 'Aktiv' : 'Aus'}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteAutomation(rule.id)}
                        className="text-[10px] uppercase tracking-wider text-danger/70 transition-colors hover:text-danger"
                      >
                        Löschen
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Builder */}
        <Panel title="Neue Regel">
          <div className="space-y-4">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (z. B. CPU zu heiß)" className={FIELD} />
              <div className="flex items-center gap-1.5">
                <input type="number" min={0} value={cooldownSec} onChange={(e) => setCooldownSec(Number(e.target.value))} className={clsx(FIELD, 'w-20')} />
                <span className="holo-label">s Pause</span>
              </div>
            </div>

            {/* Trigger */}
            <div>
              <p className="holo-label mb-1.5">Wenn (Trigger)</p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={trigger.type}
                  onChange={(e) => setTrigger({ ...triggerDefaults[e.target.value as AutomationTrigger['type']] })}
                  className={clsx(FIELD, 'cursor-pointer')}
                >
                  <option value="threshold">Schwellwert</option>
                  <option value="event">Event</option>
                  <option value="device_status">Gerätestatus</option>
                  <option value="schedule">Zeitplan</option>
                </select>

                {trigger.type === 'threshold' && (
                  <>
                    <select value={trigger.field} onChange={(e) => setTrigger({ ...trigger, field: e.target.value })} className={clsx(FIELD, 'cursor-pointer')}>
                      {METRIC_FIELDS.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                    <select value={trigger.operator} onChange={(e) => setTrigger({ ...trigger, operator: e.target.value as any })} className={clsx(FIELD, 'cursor-pointer')}>
                      {OPERATORS.map((o) => (
                        <option key={o.v} value={o.v}>{o.label}</option>
                      ))}
                    </select>
                    <input type="number" value={trigger.value} onChange={(e) => setTrigger({ ...trigger, value: Number(e.target.value) })} className={clsx(FIELD, 'w-24')} />
                  </>
                )}
                {trigger.type === 'event' && (
                  <input value={trigger.eventType} onChange={(e) => setTrigger({ ...trigger, eventType: e.target.value })} placeholder="z. B. alert:cpu-high" className={clsx(FIELD, 'flex-1 min-w-[160px]')} />
                )}
                {trigger.type === 'device_status' && (
                  <select value={trigger.status} onChange={(e) => setTrigger({ ...trigger, status: e.target.value as any })} className={clsx(FIELD, 'cursor-pointer')}>
                    <option value="online">online</option>
                    <option value="offline">offline</option>
                    <option value="error">error</option>
                  </select>
                )}
                {trigger.type === 'schedule' && (
                  <input type="time" value={trigger.time} onChange={(e) => setTrigger({ ...trigger, time: e.target.value })} className={FIELD} />
                )}
              </div>
            </div>

            {/* Actions */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="holo-label">Dann (Aktionen)</p>
                <button
                  type="button"
                  onClick={() => setActions((a) => [...a, { ...actionDefaults.notify }])}
                  className="text-[10px] uppercase tracking-wider text-accent/70 hover:text-accent"
                >
                  + Aktion
                </button>
              </div>
              <div className="space-y-2">
                {actions.map((action, i) => (
                  <div key={i} className="rounded-none border border-accent/15 bg-accent/[0.03] p-2.5">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <select value={action.type} onChange={(e) => changeActionType(i, e.target.value as AutomationAction['type'])} className={clsx(FIELD, 'cursor-pointer')}>
                        <option value="notify">Benachrichtigung</option>
                        <option value="wled">WLED steuern</option>
                        <option value="emit_event">Event auslösen</option>
                      </select>
                      {actions.length > 1 && (
                        <button type="button" onClick={() => setActions((a) => a.filter((_, idx) => idx !== i))} className="text-[10px] uppercase tracking-wider text-danger/60 hover:text-danger">
                          Entfernen
                        </button>
                      )}
                    </div>

                    {action.type === 'notify' && (
                      <div className="grid grid-cols-2 gap-2">
                        <input value={action.title} onChange={(e) => updateAction(i, { title: e.target.value })} placeholder="Titel" className={FIELD} />
                        <select value={action.level} onChange={(e) => updateAction(i, { level: e.target.value as any })} className={clsx(FIELD, 'cursor-pointer')}>
                          <option value="info">info</option>
                          <option value="success">success</option>
                          <option value="warn">warn</option>
                          <option value="error">error</option>
                        </select>
                        <input value={action.message} onChange={(e) => updateAction(i, { message: e.target.value })} placeholder="Nachricht" className={clsx(FIELD, 'col-span-2')} />
                      </div>
                    )}

                    {action.type === 'wled' && (
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={action.target} onChange={(e) => updateAction(i, { target: e.target.value })} className={clsx(FIELD, 'cursor-pointer')}>
                          <option value="all">Alle Lichter</option>
                          {wledLights.map((l) => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                          ))}
                        </select>
                        <label className="flex items-center gap-1.5 text-[11px] text-accent/70">
                          <input type="checkbox" checked={action.on ?? false} onChange={(e) => updateAction(i, { on: e.target.checked })} /> An
                        </label>
                        <input type="color" value={typeof action.color === 'string' ? action.color : '#ff0000'} onChange={(e) => updateAction(i, { color: e.target.value })} className="h-8 w-10 cursor-pointer border border-accent/30 bg-transparent" />
                        <input type="number" min={0} max={100} value={action.brightness ?? 100} onChange={(e) => updateAction(i, { brightness: Number(e.target.value) })} className={clsx(FIELD, 'w-20')} placeholder="Hell." />
                      </div>
                    )}

                    {action.type === 'emit_event' && (
                      <div className="grid grid-cols-2 gap-2">
                        <input value={action.eventType} onChange={(e) => updateAction(i, { eventType: e.target.value })} placeholder="event:type" className={FIELD} />
                        <select value={action.priority} onChange={(e) => updateAction(i, { priority: e.target.value as any })} className={clsx(FIELD, 'cursor-pointer')}>
                          <option value="low">low</option>
                          <option value="normal">normal</option>
                          <option value="high">high</option>
                          <option value="critical">critical</option>
                        </select>
                        <input value={action.message ?? ''} onChange={(e) => updateAction(i, { message: e.target.value })} placeholder="Nachricht (optional)" className={clsx(FIELD, 'col-span-2')} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={save}
              disabled={!canSave || saving}
              className="w-full rounded-none border border-accent/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-accent transition-colors hover:bg-accent/10 disabled:opacity-30"
            >
              {saving ? 'Speichere…' : 'Regel speichern'}
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
