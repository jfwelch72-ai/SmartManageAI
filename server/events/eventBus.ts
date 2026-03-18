import { eq } from "drizzle-orm";
import { db } from "../db";
import { domainEvents } from "@shared/schema";
import type { DomainEvent, DomainEventType } from "./eventTypes";
import { ALL_DOMAIN_EVENT_TYPES } from "./eventTypes";
import { logError, logInfo } from "../utils/logger";

type GenericHandler = (event: DomainEvent) => void | Promise<void>;

class TypedEventBus {
  private readonly listeners = new Map<DomainEventType, GenericHandler[]>();

  constructor() {
    for (const type of ALL_DOMAIN_EVENT_TYPES) {
      this.listeners.set(type, []);
    }
  }

  /**
   * Subscribe to a specific domain event type.
   * Returns a cleanup function — call it to unsubscribe.
   */
  on<T extends DomainEventType>(
    type: T,
    handler: (event: Extract<DomainEvent, { type: T }>) => void | Promise<void>
  ): () => void {
    const handlers = this.listeners.get(type)!;
    // Safe cast: at dispatch time the event.type always matches T,
    // so passing a specific handler as a generic handler is safe at runtime.
    const genericHandler = handler as unknown as GenericHandler;
    handlers.push(genericHandler);
    return () => {
      const idx = handlers.indexOf(genericHandler);
      if (idx !== -1) handlers.splice(idx, 1);
    };
  }

  /**
   * Subscribe to every domain event type with a single handler.
   * Returns a cleanup function that unsubscribes from all event types.
   */
  onAll(handler: GenericHandler): () => void {
    const cleanups = ALL_DOMAIN_EVENT_TYPES.map(type => this.on(type, handler));
    return () => cleanups.forEach(c => c());
  }

  /** Returns the number of listeners currently registered for a given event type. */
  getListenerCount(type: DomainEventType): number {
    return this.listeners.get(type)?.length ?? 0;
  }

  /**
   * Internal: dispatch an event to all registered listeners, then mark the
   * persisted domain_events row PROCESSED when all listeners succeed, or
   * FAILED (with a reason) if any listener rejects.
   */
  private async dispatch(rowId: string, event: DomainEvent): Promise<void> {
    const handlers = this.listeners.get(event.type) ?? [];

    // Run all handlers concurrently; collect results without swallowing rejections.
    const results = await Promise.allSettled(
      handlers.map(handler => Promise.resolve().then(() => handler(event)))
    );

    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    );

    if (failures.length > 0) {
      for (const f of failures) {
        logError(`EventBus: listener error for "${event.type}"`, {
          error: String(f.reason),
          eventType: event.type,
          eventId: rowId,
        });
      }

      const failureReason =
        `${failures.length}/${results.length} listener(s) failed: ` +
        failures.map(f => String(f.reason)).join("; ");

      await db
        .update(domainEvents)
        .set({ status: "FAILED", failureReason })
        .where(eq(domainEvents.id, rowId))
        .catch(err =>
          logError("EventBus: failed to mark event FAILED", {
            error: String(err),
            eventId: rowId,
          })
        );
    } else {
      await db
        .update(domainEvents)
        .set({ status: "PROCESSED", processedAt: new Date() })
        .where(eq(domainEvents.id, rowId))
        .catch(err =>
          logError("EventBus: failed to mark event PROCESSED", {
            error: String(err),
            eventId: rowId,
          })
        );
    }
  }

  /**
   * Persist the event to domain_events (PENDING) then fire-and-forget dispatch.
   *
   * Routes should `await` this so that durability is guaranteed before the HTTP
   * response is sent, while listener execution remains non-blocking.
   *
   * If the DB insert fails the error propagates to the caller — durability is
   * enforced strictly; no event is dispatched without a persisted row.
   */
  async emit(event: DomainEvent): Promise<void> {
    // Persistence is mandatory: if this throws, the error propagates to the route.
    const [row] = await db
      .insert(domainEvents)
      .values({
        type: event.type,
        version: event.version,
        orgId: event.orgId,
        actorId: event.actorId,
        payload: event.payload as Record<string, unknown>,
        status: "PENDING",
      })
      .returning({ id: domainEvents.id });

    // Dispatch fire-and-forget; dispatch() marks the row PROCESSED or FAILED when done.
    setImmediate(() => { void this.dispatch(row.id, event); });
  }

  /**
   * Re-dispatch a stale PENDING event from the database without creating a new row.
   * Used by the startup replay job for crash-recovery.
   */
  async replay(rowId: string, event: DomainEvent): Promise<void> {
    logInfo("EventBus replay: re-dispatching PENDING event", {
      eventId: rowId,
      eventType: event.type,
    });
    setImmediate(() => { void this.dispatch(rowId, event); });
  }
}

export const eventBus = new TypedEventBus();
