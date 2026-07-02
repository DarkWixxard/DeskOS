// Action Executor (M4)
//
// Executes automation / layout-scene actions by emitting bus events. The
// owning services react (NotificationService -> notification:push,
// WledService -> wled:command, WebSocketServer -> layout:set, SceneService ->
// scene:apply), so the AutomationEngine and LayoutService stay decoupled from
// those subsystems.

import { eventSystem } from './EventSystem';
import type { AutomationAction } from '@shared/types';

export function executeAction(action: AutomationAction, source: string, context?: Record<string, unknown>): void {
  switch (action.type) {
    case 'emit_event':
      eventSystem.emit(action.eventType, { message: action.message, context }, source, action.priority ?? 'normal');
      break;
    case 'notify':
      eventSystem.emit(
        'notification:push',
        { title: action.title, message: action.message, level: action.level ?? 'info' },
        source
      );
      break;
    case 'wled':
      eventSystem.emit(
        'wled:command',
        { target: action.target, on: action.on, brightness: action.brightness, color: action.color, effect: action.effect, mode: action.mode },
        source
      );
      break;
    case 'layout':
      eventSystem.emit('layout:set', { profileId: action.profileId, view: action.view }, source);
      break;
    case 'scene':
      // Delegated to the SceneService, which resolves the id and runs the
      // scene's own actions (guarding against scene->scene cycles).
      eventSystem.emit('scene:apply', { sceneId: action.sceneId }, source);
      break;
  }
}

export function executeActions(actions: AutomationAction[], source: string, context?: Record<string, unknown>): void {
  for (const action of actions) {
    try {
      executeAction(action, source, context);
    } catch (err) {
      console.error('[action-executor] action failed:', err);
    }
  }
}
