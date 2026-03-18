export { eventBus } from "./eventBus";
export type { DomainEvent, DomainEventType } from "./eventTypes";

import { registerAuditListener } from "./listeners/auditListener";
import { registerNotificationListener } from "./listeners/notificationListener";
import { registerOutboxListener } from "./listeners/outboxListener";

let initialized = false;

export function initializeEventBus(): void {
  if (initialized) return;
  initialized = true;

  registerAuditListener();
  registerNotificationListener();
  registerOutboxListener();
}
