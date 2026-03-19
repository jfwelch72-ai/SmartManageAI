import { eventBus } from "../eventBus";
import { db } from "../../db";
import { auditLog, type InsertAuditLog } from "@shared/schema";
import { logError } from "../../utils/logger";
import type { DomainEvent } from "../eventTypes";

/**
 * Writes a structured EVENT row to the audit_log for every hiring domain event.
 * Only writes when actorId is a real user UUID (events from routes always have one).
 * Skips silently if actorId is absent to avoid FK violations from background flows.
 */
async function writeAuditEvent(event: DomainEvent, entityType: string, entityId: string): Promise<void> {
  if (!event.actorId) return;
  await db.insert(auditLog).values({
    userId: event.actorId,
    entityType,
    entityId,
    action: event.type as InsertAuditLog["action"],
    oldValue: null,
    newValue: JSON.stringify(event.payload),
  });
}

export function registerAuditListener(): void {
  eventBus.on("hiring.job_published", async (event) => {
    try {
      await writeAuditEvent(event, "hiring_job", event.payload.jobId);
    } catch (err) {
      logError("auditListener: hiring.job_published write failed", { error: String(err) });
    }
  });

  eventBus.on("hiring.candidate_applied", async (event) => {
    try {
      await writeAuditEvent(event, "hiring_candidate", event.payload.candidateId);
    } catch (err) {
      logError("auditListener: hiring.candidate_applied write failed", { error: String(err) });
    }
  });

  eventBus.on("hiring.candidate_stage_changed", async (event) => {
    try {
      await writeAuditEvent(event, "hiring_candidate", event.payload.candidateId);
    } catch (err) {
      logError("auditListener: hiring.candidate_stage_changed write failed", { error: String(err) });
    }
  });

  eventBus.on("hiring.candidate_hired", async (event) => {
    try {
      await writeAuditEvent(event, "hiring_candidate", event.payload.candidateId);
    } catch (err) {
      logError("auditListener: hiring.candidate_hired write failed", { error: String(err) });
    }
  });

  eventBus.on("hiring.interview_scheduled", async (event) => {
    try {
      await writeAuditEvent(event, "hiring_interview", event.payload.interviewId);
    } catch (err) {
      logError("auditListener: hiring.interview_scheduled write failed", { error: String(err) });
    }
  });

  eventBus.on("hiring.integration_connected", async (event) => {
    try {
      await writeAuditEvent(event, "hiring_integration", event.payload.integrationId);
    } catch (err) {
      logError("auditListener: hiring.integration_connected write failed", { error: String(err) });
    }
  });
}
