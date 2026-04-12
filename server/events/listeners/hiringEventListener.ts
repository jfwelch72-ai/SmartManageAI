import { eventBus } from "../eventBus";
import { safeJsonParse } from "../../responseHelper";
import { db } from "../../db";
import { notifications, users } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { logError, logInfo } from "../../utils/logger";
import { deliverNotifications } from "../../services/notificationDelivery";
import type {
  HiringJobPublishedEvent,
  HiringCandidateAppliedEvent,
  HiringCandidateStageChangedEvent,
  HiringCandidateHiredEvent,
  HiringInterviewScheduledEvent,
  HiringIntegrationConnectedEvent,
} from "../eventTypes";

type NotificationType = NonNullable<(typeof notifications.$inferInsert)["type"]>;

const HR_ROLES = ["ADMIN", "MANAGER"] as const;

async function getHrUserIds(orgId: string): Promise<string[]> {
  try {
    const roles: string[] = [...HR_ROLES];
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organizationId, orgId),
          eq(users.isActive, true),
          inArray(users.role, roles)
        )
      );
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

async function insertHiringNotifications(
  userIds: string[],
  type: NotificationType,
  title: string,
  message: string,
  relatedEntityId: string,
  relatedEntityType: string,
  organizationId?: string
): Promise<void> {
  if (userIds.length === 0) return;
  const records = userIds.map((userId) => ({
    userId,
    organizationId: organizationId || null,
    type,
    title,
    message,
    relatedEntityId,
    relatedEntityType,
  }));
  const inserted = await db.insert(notifications).values(records).returning();
  setImmediate(() => {
    deliverNotifications(inserted as Parameters<typeof deliverNotifications>[0]).catch(() => undefined);
  });
}

export function registerHiringEventListener(): void {
  eventBus.on("hiring.job_published", async (event: HiringJobPublishedEvent) => {
    try {
      logInfo("hiring.job_published", { orgId: event.orgId, jobId: event.payload.jobId, title: event.payload.title });
      await insertHiringNotifications(
        [event.actorId],
        "GENERAL",
        "Job Published",
        `Your job posting "${event.payload.title}" has been published successfully`,
        event.payload.jobId,
        "hiringJob",
        event.orgId
      );
    } catch (err) {
      logError("hiringEventListener: hiring.job_published failed", { error: String(err) });
    }
  });

  eventBus.on("hiring.candidate_applied", async (event: HiringCandidateAppliedEvent) => {
    try {
      logInfo("hiring.candidate_applied", { orgId: event.orgId, candidateId: event.payload.candidateId, fullName: event.payload.fullName });
      const hrIds = await getHrUserIds(event.orgId);
      await insertHiringNotifications(
        hrIds,
        "GENERAL",
        "New Candidate Application",
        `${event.payload.fullName} has submitted an application`,
        event.payload.candidateId,
        "hiringCandidate",
        event.orgId
      );
    } catch (err) {
      logError("hiringEventListener: hiring.candidate_applied failed", { error: String(err) });
    }
  });

  eventBus.on("hiring.candidate_stage_changed", async (event: HiringCandidateStageChangedEvent) => {
    try {
      logInfo("hiring.candidate_stage_changed", {
        orgId: event.orgId,
        candidateId: event.payload.candidateId,
        fromStage: event.payload.fromStage,
        toStage: event.payload.toStage,
      });
    } catch (err) {
      logError("hiringEventListener: hiring.candidate_stage_changed failed", { error: String(err) });
    }
  });

  eventBus.on("hiring.candidate_hired", async (event: HiringCandidateHiredEvent) => {
    try {
      logInfo("hiring.candidate_hired", { orgId: event.orgId, candidateId: event.payload.candidateId, fullName: event.payload.fullName });
      const adminIds = await getHrUserIds(event.orgId);
      await insertHiringNotifications(
        adminIds,
        "GENERAL",
        "Candidate Hired",
        `${event.payload.fullName} has been hired`,
        event.payload.candidateId,
        "hiringCandidate",
        event.orgId
      );
    } catch (err) {
      logError("hiringEventListener: hiring.candidate_hired failed", { error: String(err) });
    }
  });

  eventBus.on("hiring.interview_scheduled", async (event: HiringInterviewScheduledEvent) => {
    try {
      logInfo("hiring.interview_scheduled", {
        orgId: event.orgId,
        interviewId: event.payload.interviewId,
        candidateId: event.payload.candidateId,
        interviewType: event.payload.interviewType,
      });

      const recipientIds = new Set<string>();

      const { hiringInterviews } = await import("@shared/schema");
      const [interview] = await db
        .select({ interviewerUserIdsJson: hiringInterviews.interviewerUserIdsJson })
        .from(hiringInterviews)
        .where(eq(hiringInterviews.id, event.payload.interviewId))
        .limit(1);
      if (interview?.interviewerUserIdsJson) {
        try {
          const interviewerIds = safeJsonParse(interview.interviewerUserIdsJson, null);
          if (Array.isArray(interviewerIds)) {
            for (const id of interviewerIds) {
              if (typeof id === "string" && id) recipientIds.add(id);
            }
          }
        } catch {}
      }

      const hrIds = await getHrUserIds(event.orgId);
      for (const id of hrIds) recipientIds.add(id);

      const scheduleLabel = event.payload.scheduledAt
        ? ` for ${event.payload.scheduledAt}`
        : "";
      const typeLabel = event.payload.interviewType
        ? ` (${event.payload.interviewType})`
        : "";
      await insertHiringNotifications(
        Array.from(recipientIds),
        "GENERAL",
        "Interview Scheduled",
        `An interview${typeLabel} has been scheduled${scheduleLabel}`,
        event.payload.interviewId,
        "hiringInterview",
        event.orgId
      );
    } catch (err) {
      logError("hiringEventListener: hiring.interview_scheduled failed", { error: String(err) });
    }
  });

  eventBus.on("hiring.integration_connected", async (event: HiringIntegrationConnectedEvent) => {
    try {
      logInfo("hiring.integration_connected", { orgId: event.orgId, providerName: event.payload.providerName });
    } catch (err) {
      logError("hiringEventListener: hiring.integration_connected failed", { error: String(err) });
    }
  });
}
