// Event System - Herz des DeskOS
import { v4 as uuidv4 } from 'uuid';
import type { DeskOSEvent, EventPriority } from '@shared/types';

// Re-exported so existing imports (`import { DeskOSEvent } from './EventSystem'`)
// keep working while the canonical definition lives in @shared/types.
export type { DeskOSEvent };

export interface EventHandler {
  (event: DeskOSEvent): Promise<void> | void;
}

// A focused pub/sub bus with event history. Uses its own handler map (rather
// than Node's EventEmitter) so `emit` can be async and `on`/`once` can return
// an unsubscribe function.
export class EventSystem {
  private eventHistory: DeskOSEvent[] = [];
  private maxHistorySize = 10000;
  private eventHandlers: Map<string, EventHandler[]> = new Map();

  /**
   * Publish an event to the system
   */
  async emit(type: string, payload: unknown, source: string = 'system', priority: EventPriority = 'normal'): Promise<void> {
    const event: DeskOSEvent = {
      id: uuidv4(),
      type,
      timestamp: Date.now(),
      source,
      payload,
      priority
    };

    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    const handlers = this.eventHandlers.get(type) || [];
    const wildcardHandlers = this.eventHandlers.get('*') || [];

    for (const handler of [...handlers, ...wildcardHandlers]) {
      try {
        await Promise.resolve(handler(event));
      } catch (error) {
        console.error(`Error in event handler for ${type}:`, error);
      }
    }
  }

  /**
   * Subscribe to events
   */
  on(type: string, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(type)) {
      this.eventHandlers.set(type, []);
    }
    this.eventHandlers.get(type)!.push(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.eventHandlers.get(type);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  /**
   * Subscribe once
   */
  once(type: string, handler: EventHandler): () => void {
    const wrappedHandler = async (event: DeskOSEvent) => {
      await Promise.resolve(handler(event));
      unsubscribe();
    };

    const unsubscribe = this.on(type, wrappedHandler);
    return unsubscribe;
  }

  /**
   * Get event history
   */
  getHistory(type?: string, limit: number = 100): DeskOSEvent[] {
    let events = [...this.eventHistory];
    
    if (type) {
      events = events.filter(e => e.type === type);
    }

    return events.slice(-limit);
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }
}

export const eventSystem = new EventSystem();
