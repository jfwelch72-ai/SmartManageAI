import { EventEmitter } from "events";
import type { DomainEvent, DomainEventType } from "./eventTypes";
import { logError } from "../utils/logger";

type EventHandler<T extends DomainEvent> = (event: T) => void | Promise<void>;

class TypedEventBus {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
  }

  on<T extends DomainEventType>(
    type: T,
    handler: EventHandler<Extract<DomainEvent, { type: T }>>
  ): void {
    this.emitter.on(type, (event: Extract<DomainEvent, { type: T }>) => {
      Promise.resolve(handler(event)).catch((err) => {
        logError(`EventBus: listener error for "${type}"`, {
          error: String(err),
          eventType: type,
        });
      });
    });
  }

  emit(event: DomainEvent): void {
    setImmediate(() => {
      this.emitter.emit(event.type, event);
    });
  }
}

export const eventBus = new TypedEventBus();
