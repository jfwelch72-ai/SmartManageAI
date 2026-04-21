import { db } from "../db";
import {
  crmSequences,
  crmSequenceSteps,
  crmSequenceEnrollments,
  crmSequenceStepExecutions,
  crmSequenceEmailEvents,
  crmContacts,
  crmOrganisations,
  crmOpportunities,
  crmTasks,
  users,
  organizations,
  type CrmSequence,
  type CrmSequenceStep,
  type CrmSequenceEnrollment,
  type CrmSequenceStepExecution,
} from "@shared/schema";
import { and, eq, gte, lte, sql, isNull, desc, count, inArray } from "drizzle-orm";
import { sendEmail } from "./emailService";
import { insertNotification } from "./notificationService";
import { logError, logInfo } from "../utils/logger";

const PUBLIC_BASE_URL = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN.trim()}`
  : process.env.PUBLIC_BASE_URL || "";

export interface MergeContext {
  contact?: { firstName?: string | null; lastName?: string | null; email?: string | null; company?: string | null; title?: string | null };
  user?: { firstName?: string | null; lastName?: string | null; email?: string | null };
  opportunity?: { name?: string | null };
}

export function renderMergeTokens(template: string, ctx: MergeContext): string {
  if (!template) return template;
  const get = (path: string): string => {
    const parts = path.split(".");
    let v: any = ctx;
    for (const p of parts) {
      if (v == null) return "";
      v = v[p];
    }
    return v == null ? "" : String(v);
  };
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => get(key));
}

export async function buildMergeContext(
  contactId: string | null,
  senderId: string,
  opportunityId: string | null,
  organizationId?: string,
): Promise<MergeContext> {
  const ctx: MergeContext = {};
  if (contactId) {
    const contactWhere = organizationId
      ? and(eq(crmContacts.id, contactId), eq(crmContacts.organizationId, organizationId))
      : eq(crmContacts.id, contactId);
    const [c] = await db.select().from(crmContacts).where(contactWhere).limit(1);
    if (c) {
      let company: string | null = null;
      if (c.organisationId) {
        const [org] = await db.select().from(crmOrganisations).where(eq(crmOrganisations.id, c.organisationId)).limit(1);
        company = org?.name || null;
      }
      ctx.contact = { firstName: c.firstName, lastName: c.lastName, email: c.email, title: c.title, company };
    }
  }
  if (senderId) {
    const [u] = await db.select().from(users).where(eq(users.id, senderId)).limit(1);
    if (u) ctx.user = { firstName: u.firstName, lastName: u.lastName, email: u.email };
  }
  if (opportunityId) {
    const [opp] = await db.select().from(crmOpportunities).where(eq(crmOpportunities.id, opportunityId)).limit(1);
    if (opp) ctx.opportunity = { name: opp.name };
  }
  return ctx;
}

/**
 * Compute the scheduled send time for a step honoring business hours/weekdays.
 */
export function computeScheduledAt(
  startAt: Date,
  delayDays: number,
  sendHourLocal: number,
  opts: { weekdaysOnly: boolean; businessHoursOnly: boolean },
): Date {
  const d = new Date(startAt.getTime() + delayDays * 24 * 60 * 60 * 1000);
  if (opts.businessHoursOnly) {
    d.setHours(sendHourLocal, 0, 0, 0);
  }
  if (opts.weekdaysOnly) {
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() + 1);
    }
  }
  return d;
}

// ---- Send-time optimization helpers --------------------------------------

/** Get the year/month/day/hour of `date` as observed in `tz`. */
function getLocalParts(date: Date, tz: string): { year: number; month: number; day: number; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0; // some ICU versions emit "24" for midnight
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour };
}

/** Build a UTC Date that represents `Y-M-D H:00:00` in the given `tz`. */
function makeUtcFromLocal(year: number, month: number, day: number, hour: number, tz: string): Date {
  // We want f(utc).asUtcLike == desired, where f converts utc→local parts.
  // Newton iterate: utc <- utc + (desired - f(utc).asUtcLike).
  const desired = Date.UTC(year, month - 1, day, hour, 0, 0);
  let utc = desired;
  for (let i = 0; i < 4; i++) {
    const probe = new Date(utc);
    const local = getLocalParts(probe, tz);
    const localUtcLike = Date.UTC(local.year, local.month - 1, local.day, local.hour, 0, 0);
    const drift = desired - localUtcLike;
    if (drift === 0) break;
    utc += drift;
  }
  return new Date(utc);
}

/**
 * Shift `scheduledAt` forward to fall inside the recipient's preferred local-time window.
 * Used when a step has `sendTimeOptimized` enabled.
 *
 * - If `preferredHour` is provided and falls inside [windowStart, windowEnd], the result
 *   targets that exact hour. Otherwise the midpoint of the window is used.
 * - If `scheduledAt` (in `tz`) is already within [windowStart, windowEnd], it is left alone.
 * - If the local hour is before the window, the result targets `targetHour` on the same day.
 * - If the local hour is after the window, the result targets `targetHour` on the next day.
 *
 * The function only ever moves the send forward in time; it never returns an earlier date.
 */
export function applyOptimizedSendWindow(
  scheduledAt: Date,
  tz: string,
  windowStartHour: number,
  windowEndHour: number,
  preferredHour: number | null = null,
): Date {
  const start = Math.max(0, Math.min(23, Math.floor(windowStartHour)));
  const end = Math.max(start, Math.min(23, Math.floor(windowEndHour)));
  const target =
    preferredHour != null && preferredHour >= start && preferredHour <= end
      ? Math.floor(preferredHour)
      : Math.floor((start + end) / 2);

  const local = getLocalParts(scheduledAt, tz);

  if (local.hour >= start && local.hour <= end) {
    // Already inside the window — leave the original time alone.
    return scheduledAt;
  }

  let { year, month, day } = local;
  if (local.hour > end) {
    // Past the window — advance the local calendar day by one (DST-agnostic).
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
  }

  const candidate = makeUtcFromLocal(year, month, day, target, tz);
  // Defensive: never return a time earlier than the original schedule.
  return candidate.getTime() < scheduledAt.getTime() ? scheduledAt : candidate;
}

/**
 * Examine recent open/click history for a contact (across all sequences in the org)
 * and return the hour-of-day in `tz` that the contact most frequently engages, or
 * null if there isn't enough history yet.
 */
export async function getPreferredSendHourForContact(
  organizationId: string,
  contactId: string,
  tz: string,
  windowStartHour: number,
  windowEndHour: number,
): Promise<number | null> {
  // Pull OPEN/CLICK events for this contact's sequence executions (same org).
  const events = await db
    .select({ createdAt: crmSequenceEmailEvents.createdAt })
    .from(crmSequenceEmailEvents)
    .innerJoin(
      crmSequenceStepExecutions,
      eq(crmSequenceStepExecutions.id, crmSequenceEmailEvents.executionId),
    )
    .innerJoin(
      crmSequenceEnrollments,
      eq(crmSequenceEnrollments.id, crmSequenceStepExecutions.enrollmentId),
    )
    .where(and(
      eq(crmSequenceEnrollments.contactId, contactId),
      eq(crmSequenceEnrollments.organizationId, organizationId),
      inArray(crmSequenceEmailEvents.eventType, ["OPEN", "CLICK"]),
    ))
    .limit(500);

  if (events.length === 0) return null;

  const start = Math.max(0, Math.min(23, Math.floor(windowStartHour)));
  const end = Math.max(start, Math.min(23, Math.floor(windowEndHour)));
  const counts = new Map<number, number>();
  for (const ev of events) {
    if (!ev.createdAt) continue;
    const hour = getLocalParts(ev.createdAt as Date, tz).hour;
    if (hour < start || hour > end) continue;
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  let bestHour = start;
  let bestCount = -1;
  for (const [hour, count] of counts) {
    if (count > bestCount) {
      bestHour = hour;
      bestCount = count;
    }
  }
  return bestHour;
}

/**
 * After enrollment is created (or a step completes), schedule the next pending step execution.
 */
export async function scheduleNextStep(enrollmentId: string): Promise<void> {
  const [enrollment] = await db
    .select()
    .from(crmSequenceEnrollments)
    .where(eq(crmSequenceEnrollments.id, enrollmentId))
    .limit(1);
  if (!enrollment || enrollment.status !== "ACTIVE") return;

  const [seq] = await db.select().from(crmSequences).where(eq(crmSequences.id, enrollment.sequenceId)).limit(1);
  if (!seq) return;

  const steps = await db
    .select()
    .from(crmSequenceSteps)
    .where(eq(crmSequenceSteps.sequenceId, enrollment.sequenceId))
    .orderBy(crmSequenceSteps.stepOrder);

  if (enrollment.currentStepIndex >= steps.length) {
    // finished
    await db
      .update(crmSequenceEnrollments)
      .set({ status: "FINISHED", exitReason: "COMPLETED", exitedAt: new Date(), updatedAt: new Date() })
      .where(eq(crmSequenceEnrollments.id, enrollmentId));
    return;
  }

  const step = steps[enrollment.currentStepIndex];
  // Only treat non-terminal executions as "already exists". SKIPPED/FAILED rows
  // (e.g. left over from a pause or send-cap defer that was later skipped on
  // exit) must not block a resume from creating a fresh PENDING execution.
  const existing = await db
    .select()
    .from(crmSequenceStepExecutions)
    .where(and(
      eq(crmSequenceStepExecutions.enrollmentId, enrollmentId),
      eq(crmSequenceStepExecutions.stepId, step.id),
      inArray(crmSequenceStepExecutions.status, ["PENDING", "SENT", "COMPLETED"]),
    ))
    .limit(1);
  if (existing.length > 0) return;

  let scheduledAt = computeScheduledAt(enrollment.startAt, step.delayDays, step.sendHourLocal, {
    weekdaysOnly: seq.weekdaysOnly,
    businessHoursOnly: seq.businessHoursOnly,
  });

  // Send-time optimization: if the step opts in, defer the send into the
  // recipient's preferred local-time window (default 9-11am, configurable
  // per-sequence by the org). The window's "best hour" is informed by the
  // contact's prior open/click history when available.
  if (step.sendTimeOptimized && enrollment.contactId) {
    try {
      const [contact] = await db
        .select({ timezone: crmContacts.timezone })
        .from(crmContacts)
        .where(eq(crmContacts.id, enrollment.contactId))
        .limit(1);
      let tz = contact?.timezone || null;
      if (!tz && enrollment.senderId) {
        const [sender] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, enrollment.senderId)).limit(1);
        tz = sender?.timezone || null;
      }
      const effectiveTz = tz || "UTC";
      const startHour = seq.optimizedSendWindowStartHour ?? 9;
      const endHour = seq.optimizedSendWindowEndHour ?? 11;
      const preferred = await getPreferredSendHourForContact(
        enrollment.organizationId,
        enrollment.contactId,
        effectiveTz,
        startHour,
        endHour,
      );
      scheduledAt = applyOptimizedSendWindow(scheduledAt, effectiveTz, startHour, endHour, preferred);
    } catch (err) {
      logError("Send-time optimization failed; using base schedule", { enrollmentId, error: String(err) });
    }
  }

  await db.insert(crmSequenceStepExecutions).values({
    organizationId: enrollment.organizationId,
    enrollmentId,
    stepId: step.id,
    stepOrder: step.stepOrder,
    scheduledAt,
    status: "PENDING",
  });
}

/**
 * Inject open-tracking pixel and rewrite links for click tracking.
 */
export function injectTracking(html: string, executionId: string, baseUrl: string): string {
  if (!baseUrl) return html;
  const pixel = `<img src="${baseUrl}/api/crm/sequences/track/open/${executionId}.png" width="1" height="1" alt="" style="display:none" />`;
  // Rewrite anchor hrefs
  const rewritten = html.replace(/<a\s+([^>]*?)href="(https?:\/\/[^"]+)"/gi, (_m, attrs, url) => {
    const encoded = encodeURIComponent(url);
    return `<a ${attrs}href="${baseUrl}/api/crm/sequences/track/click/${executionId}?u=${encoded}"`;
  });
  return rewritten + pixel;
}

/**
 * Process due step executions. Sends emails or materializes manual tasks.
 */
export async function processDueExecutions(now: Date = new Date()): Promise<{ processed: number }> {
  const due = await db
    .select()
    .from(crmSequenceStepExecutions)
    .where(and(
      eq(crmSequenceStepExecutions.status, "PENDING"),
      lte(crmSequenceStepExecutions.scheduledAt, now),
    ))
    .limit(100);

  if (due.length === 0) return { processed: 0 };

  // Per-org send caps for today (count SENT executions today)
  const sendCountByKey = new Map<string, number>();
  const enrollmentCache = new Map<string, CrmSequenceEnrollment>();
  const stepCache = new Map<string, CrmSequenceStep>();
  const seqCache = new Map<string, CrmSequence>();

  let processed = 0;
  for (const exec of due) {
    try {
      let enrollment = enrollmentCache.get(exec.enrollmentId);
      if (!enrollment) {
        const [e] = await db.select().from(crmSequenceEnrollments).where(eq(crmSequenceEnrollments.id, exec.enrollmentId)).limit(1);
        if (!e) {
          await db.update(crmSequenceStepExecutions).set({ status: "SKIPPED", errorMessage: "Enrollment not found" }).where(eq(crmSequenceStepExecutions.id, exec.id));
          continue;
        }
        enrollment = e;
        enrollmentCache.set(e.id, e);
      }
      if (enrollment.status !== "ACTIVE") {
        await db.update(crmSequenceStepExecutions).set({ status: "SKIPPED", errorMessage: `Enrollment status: ${enrollment.status}` }).where(eq(crmSequenceStepExecutions.id, exec.id));
        continue;
      }

      let step = stepCache.get(exec.stepId);
      if (!step) {
        const [s] = await db.select().from(crmSequenceSteps).where(eq(crmSequenceSteps.id, exec.stepId)).limit(1);
        if (!s) continue;
        step = s;
        stepCache.set(s.id, s);
      }

      let seq = seqCache.get(enrollment.sequenceId);
      if (!seq) {
        const [s] = await db.select().from(crmSequences).where(eq(crmSequences.id, enrollment.sequenceId)).limit(1);
        if (!s) continue;
        seq = s;
        seqCache.set(s.id, s);
      }

      // A/B variant selection: if step.variantGroup is set, randomly pick a sibling variant
      // (or use the winner if a winner exists). Tracks selection via selectedVariantId.
      if (step.variantGroup) {
        try {
          const variants = await db.select().from(crmSequenceSteps).where(and(
            eq(crmSequenceSteps.sequenceId, step.sequenceId),
            eq(crmSequenceSteps.variantGroup, step.variantGroup),
          ));
          if (variants.length > 1) {
            const winner = variants.find((v) => v.isWinner);
            const chosen = winner ?? variants[Math.floor(Math.random() * variants.length)];
            if (chosen.id !== step.id) {
              step = chosen as CrmSequenceStep;
              stepCache.set(chosen.id, chosen as CrmSequenceStep);
            }
            await db.update(crmSequenceStepExecutions).set({ selectedVariantId: step.id }).where(eq(crmSequenceStepExecutions.id, exec.id));
          }
        } catch { /* non-fatal */ }
      }

      // SMS step delivery
      if (step.stepType === "SMS") {
        try {
          const { sendSms, isTwilioConfigured } = await import("./smsService");
          if (!isTwilioConfigured()) {
            await db.update(crmSequenceStepExecutions).set({ status: "SKIPPED", errorMessage: "Twilio not configured" }).where(eq(crmSequenceStepExecutions.id, exec.id));
            continue;
          }
          const ctx = await buildMergeContext(enrollment.contactId, enrollment.senderId, enrollment.opportunityId);
          const phone = (ctx.contact as any)?.phone;
          if (!phone) {
            await db.update(crmSequenceStepExecutions).set({ status: "SKIPPED", errorMessage: "Contact has no phone" }).where(eq(crmSequenceStepExecutions.id, exec.id));
            continue;
          }
          const body = renderMergeTokens(step.body || "", ctx);
          await sendSms(phone, body);
          await db.update(crmSequenceStepExecutions).set({ status: "SENT", sentAt: new Date() }).where(eq(crmSequenceStepExecutions.id, exec.id));
          await db.update(crmSequenceEnrollments)
            .set({ currentStepIndex: enrollment.currentStepIndex + 1, lastActivityAt: new Date(), updatedAt: new Date() })
            .where(eq(crmSequenceEnrollments.id, enrollment.id));
          enrollment = { ...enrollment, currentStepIndex: enrollment.currentStepIndex + 1 };
          enrollmentCache.set(enrollment.id, enrollment);
          await scheduleNextStep(enrollment.id);
        } catch (err: any) {
          await db.update(crmSequenceStepExecutions).set({ status: "FAILED", errorMessage: err?.message ?? "SMS failed" }).where(eq(crmSequenceStepExecutions.id, exec.id));
        }
        processed++;
        continue;
      }

      if (step.stepType === "AUTOMATED_EMAIL") {
        // Daily send cap is enforced per organization (across ALL sequences in that org).
        // The cap value applied is the current sequence's dailySendCap.
        const capKey = enrollment.organizationId;
        const cap = seq.dailySendCap;
        if (!sendCountByKey.has(capKey)) {
          const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
          // Count only AUTOMATED_EMAIL sends — manual tasks also use SENT
          // status but must not consume the email send quota.
          const [r] = await db
            .select({ c: count() })
            .from(crmSequenceStepExecutions)
            .innerJoin(crmSequenceSteps, eq(crmSequenceSteps.id, crmSequenceStepExecutions.stepId))
            .where(and(
              eq(crmSequenceStepExecutions.organizationId, enrollment.organizationId),
              eq(crmSequenceStepExecutions.status, "SENT"),
              eq(crmSequenceSteps.stepType, "AUTOMATED_EMAIL"),
              gte(crmSequenceStepExecutions.sentAt, startOfDay),
            ));
          sendCountByKey.set(capKey, Number(r?.c || 0));
        }
        const sentToday = sendCountByKey.get(capKey)!;
        if (sentToday >= cap) {
          // defer to tomorrow same hour
          const next = new Date(exec.scheduledAt);
          next.setDate(next.getDate() + 1);
          await db.update(crmSequenceStepExecutions).set({ scheduledAt: next }).where(eq(crmSequenceStepExecutions.id, exec.id));
          continue;
        }

        const ctx = await buildMergeContext(enrollment.contactId, enrollment.senderId, enrollment.opportunityId);
        const to = ctx.contact?.email;
        if (!to) {
          await db.update(crmSequenceStepExecutions).set({ status: "SKIPPED", errorMessage: "Contact has no email" }).where(eq(crmSequenceStepExecutions.id, exec.id));
          continue;
        }
        const subject = renderMergeTokens(step.subject || "", ctx);
        const bodyRaw = renderMergeTokens(step.body || "", ctx);
        const html = injectTracking(bodyRaw, exec.id, PUBLIC_BASE_URL);

        // Generate a stable, sequence-owned Message-ID so inbound In-Reply-To
        // headers can be matched precisely (thread-aware reply detection).
        const msgIdHost = (PUBLIC_BASE_URL || "smartmanage.local").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
        const outboundMessageId = `<seq-${exec.id}@${msgIdHost}>`;
        const ok = await sendEmail({
          to,
          subject: subject || "(no subject)",
          html,
          replyTo: ctx.user?.email || undefined,
          headers: { "Message-ID": outboundMessageId, "X-Sequence-Execution-Id": exec.id },
        });
        if (ok) {
          await db.update(crmSequenceStepExecutions).set({ status: "SENT", sentAt: new Date(), outboundMessageId }).where(eq(crmSequenceStepExecutions.id, exec.id));
          sendCountByKey.set(capKey, sentToday + 1);
          await db.update(crmSequenceEnrollments)
            .set({ currentStepIndex: enrollment.currentStepIndex + 1, lastActivityAt: new Date(), updatedAt: new Date() })
            .where(eq(crmSequenceEnrollments.id, enrollment.id));
          enrollment = { ...enrollment, currentStepIndex: enrollment.currentStepIndex + 1 };
          enrollmentCache.set(enrollment.id, enrollment);
          await scheduleNextStep(enrollment.id);
        } else {
          // Bounded exponential backoff: 5min, 30min, 2h, then permanent FAILED.
          const MAX_ATTEMPTS = 3;
          const nextAttempt = (exec.attemptCount ?? 0) + 1;
          if (nextAttempt < MAX_ATTEMPTS) {
            const backoffMin = [5, 30, 120][nextAttempt - 1] ?? 120;
            const nextAt = new Date(Date.now() + backoffMin * 60 * 1000);
            await db.update(crmSequenceStepExecutions)
              .set({
                status: "PENDING",
                attemptCount: nextAttempt,
                scheduledAt: nextAt,
                errorMessage: `Send failed (attempt ${nextAttempt}/${MAX_ATTEMPTS}); retrying at ${nextAt.toISOString()}`,
              })
              .where(eq(crmSequenceStepExecutions.id, exec.id));
          } else {
            await db.update(crmSequenceStepExecutions)
              .set({
                status: "FAILED",
                attemptCount: nextAttempt,
                errorMessage: `Email send failed after ${MAX_ATTEMPTS} attempts`,
              })
              .where(eq(crmSequenceStepExecutions.id, exec.id));
          }
        }
      } else {
        // Manual step → create CRM task
        const taskTitle = renderMergeTokens(step.subject || `${step.stepType} task`, await buildMergeContext(enrollment.contactId, enrollment.senderId, enrollment.opportunityId));
        const taskDesc = step.instructions || step.body || "";
        const [task] = await db.insert(crmTasks).values({
          organizationId: enrollment.organizationId,
          title: taskTitle,
          description: taskDesc,
          dueDate: exec.scheduledAt,
          status: "PENDING",
          priority: "NORMAL",
          assignedToId: enrollment.senderId,
          opportunityId: enrollment.opportunityId,
          contactId: enrollment.contactId,
          createdById: enrollment.senderId,
        }).returning();
        await db.update(crmSequenceStepExecutions).set({ status: "SENT", sentAt: new Date(), taskId: task.id }).where(eq(crmSequenceStepExecutions.id, exec.id));
        await insertNotification({
          userId: enrollment.senderId,
          organizationId: enrollment.organizationId,
          type: "REMINDER",
          title: `Sequence step due: ${taskTitle}`,
          message: `A ${step.stepType.replace("_", " ").toLowerCase()} step is due as part of a sequence.`,
          relatedEntityId: enrollment.id,
          relatedEntityType: "CRM_SEQUENCE_ENROLLMENT",
        });
      }
      processed++;
    } catch (err) {
      logError("Sequence execution failed", { execId: exec.id, error: String(err) });
      await db.update(crmSequenceStepExecutions).set({ status: "FAILED", errorMessage: String(err).substring(0, 500) }).where(eq(crmSequenceStepExecutions.id, exec.id));
    }
  }
  return { processed };
}

/**
 * Called when a manual step task is completed — advance the enrollment to the next step.
 */
export async function onManualStepCompleted(taskId: string): Promise<void> {
  const [exec] = await db
    .select()
    .from(crmSequenceStepExecutions)
    .where(eq(crmSequenceStepExecutions.taskId, taskId))
    .limit(1);
  if (!exec || exec.completedAt) return;
  await db.update(crmSequenceStepExecutions).set({ status: "COMPLETED", completedAt: new Date() }).where(eq(crmSequenceStepExecutions.id, exec.id));
  const [enrollment] = await db.select().from(crmSequenceEnrollments).where(eq(crmSequenceEnrollments.id, exec.enrollmentId)).limit(1);
  if (!enrollment || enrollment.status !== "ACTIVE") return;
  await db.update(crmSequenceEnrollments)
    .set({ currentStepIndex: enrollment.currentStepIndex + 1, lastActivityAt: new Date(), updatedAt: new Date() })
    .where(eq(crmSequenceEnrollments.id, enrollment.id));
  await scheduleNextStep(enrollment.id);
}

/**
 * Mark enrollment as exited (REPLIED / OPPORTUNITY_WON / OPPORTUNITY_LOST / MANUAL_REMOVE / BOUNCED).
 */
export async function exitEnrollment(
  enrollmentId: string,
  reason: "REPLIED" | "OPPORTUNITY_WON" | "OPPORTUNITY_LOST" | "MANUAL_REMOVE" | "BOUNCED",
  newStatus: "PAUSED" | "REPLIED" | "BOUNCED" | "REMOVED" | "FINISHED" = "REMOVED",
  extras: { bounceEmailMessageId?: string | null } = {},
): Promise<void> {
  const patch: Record<string, any> = { status: newStatus, exitReason: reason, exitedAt: new Date(), updatedAt: new Date() };
  if (extras.bounceEmailMessageId) patch.bounceEmailMessageId = extras.bounceEmailMessageId;
  await db.update(crmSequenceEnrollments)
    .set(patch)
    .where(eq(crmSequenceEnrollments.id, enrollmentId));
  // Cancel pending executions
  await db.update(crmSequenceStepExecutions)
    .set({ status: "SKIPPED", errorMessage: `Exited: ${reason}` })
    .where(and(
      eq(crmSequenceStepExecutions.enrollmentId, enrollmentId),
      eq(crmSequenceStepExecutions.status, "PENDING"),
    ));
}

/**
 * Auto-exit enrollments tied to an opportunity that just hit WON/LOST.
 */
export async function handleOpportunityStageChange(opportunityId: string, newStage: string): Promise<void> {
  if (newStage !== "WON" && newStage !== "LOST") return;
  const reason = newStage === "WON" ? "OPPORTUNITY_WON" : "OPPORTUNITY_LOST";
  // Auto-exit ALL non-terminal enrollments tied to this opportunity, not just
  // ACTIVE — a paused enrollment must also be completed when the deal closes.
  const active = await db
    .select()
    .from(crmSequenceEnrollments)
    .where(and(
      eq(crmSequenceEnrollments.opportunityId, opportunityId),
      inArray(crmSequenceEnrollments.status, ["ACTIVE", "PAUSED"]),
    ));
  for (const e of active) {
    await exitEnrollment(e.id, reason, "FINISHED");
    logInfo("Sequence enrollment auto-exited on opportunity stage", { enrollmentId: e.id, reason });
  }
}

/**
 * Record an email tracking event (open/click/reply/bounce).
 */
export async function recordEmailEvent(
  executionId: string,
  eventType: "OPEN" | "CLICK" | "REPLY" | "BOUNCE",
  payload: Record<string, any> = {},
  extras: { inboundEmailMessageId?: string | null } = {},
): Promise<void> {
  const [exec] = await db.select().from(crmSequenceStepExecutions).where(eq(crmSequenceStepExecutions.id, executionId)).limit(1);
  if (!exec) return;
  await db.insert(crmSequenceEmailEvents).values({
    organizationId: exec.organizationId,
    executionId,
    eventType,
    payload,
  });
  if (eventType === "OPEN") {
    await db.update(crmSequenceStepExecutions)
      .set({ openCount: sql`${crmSequenceStepExecutions.openCount} + 1` })
      .where(eq(crmSequenceStepExecutions.id, executionId));
  } else if (eventType === "CLICK") {
    await db.update(crmSequenceStepExecutions)
      .set({ clickCount: sql`${crmSequenceStepExecutions.clickCount} + 1` })
      .where(eq(crmSequenceStepExecutions.id, executionId));
  } else if (eventType === "REPLY") {
    await db.update(crmSequenceStepExecutions).set({ repliedAt: new Date() }).where(eq(crmSequenceStepExecutions.id, executionId));
    const [enrollment] = await db.select().from(crmSequenceEnrollments).where(eq(crmSequenceEnrollments.id, exec.enrollmentId)).limit(1);
    if (enrollment && enrollment.status === "ACTIVE") {
      await exitEnrollment(enrollment.id, "REPLIED", "REPLIED");
      await insertNotification({
        userId: enrollment.senderId,
        organizationId: enrollment.organizationId,
        type: "REMINDER",
        title: "Reply detected — sequence paused",
        message: "A contact replied to a sequence email. The enrollment has been paused.",
        relatedEntityId: enrollment.id,
        relatedEntityType: "CRM_SEQUENCE_ENROLLMENT",
      });
    }
  } else if (eventType === "BOUNCE") {
    await db.update(crmSequenceStepExecutions).set({ bouncedAt: new Date(), status: "BOUNCED" }).where(eq(crmSequenceStepExecutions.id, executionId));
    const [enrollment] = await db.select().from(crmSequenceEnrollments).where(eq(crmSequenceEnrollments.id, exec.enrollmentId)).limit(1);
    if (enrollment && enrollment.status === "ACTIVE") {
      await exitEnrollment(enrollment.id, "BOUNCED", "BOUNCED", { bounceEmailMessageId: extras.inboundEmailMessageId || null });
    } else if (enrollment && extras.inboundEmailMessageId && !enrollment.bounceEmailMessageId) {
      await db.update(crmSequenceEnrollments)
        .set({ bounceEmailMessageId: extras.inboundEmailMessageId, updatedAt: new Date() })
        .where(eq(crmSequenceEnrollments.id, enrollment.id));
    }
  }
}

/**
 * Match an inbound email to any active sequence enrollment in the same org and,
 * if a match is found, record a REPLY event on its most-recent SENT execution.
 *
 * Matching strategy: same-org + the inbound `fromAddress` matches the contact
 * email of an active/paused enrollment that has at least one SENT execution.
 * This is the standard fallback used by cadence tools when full thread/header
 * matching isn't yet wired through the inbound parser.
 */
export async function detectInboundReply(opts: {
  organizationId: string;
  fromAddress: string;
  isIncoming: boolean;
  receivedAt?: Date;
  inReplyTo?: string | null;
  references?: string | null;
}): Promise<{ matched: number }> {
  if (!opts.isIncoming || !opts.fromAddress) return { matched: 0 };
  const fromLower = opts.fromAddress.trim().toLowerCase();
  if (!fromLower) return { matched: 0 };

  // ----- Path A: thread-aware (preferred). Match by In-Reply-To / References
  // against the Message-ID we set on outbound sends. Zero false positives.
  const candidateMsgIds: string[] = [];
  const norm = (s: string) => s.trim();
  if (opts.inReplyTo) candidateMsgIds.push(norm(opts.inReplyTo));
  if (opts.references) {
    for (const ref of opts.references.split(/\s+/)) {
      const r = norm(ref);
      if (r) candidateMsgIds.push(r);
    }
  }
  if (candidateMsgIds.length > 0) {
    const exec = await db
      .select()
      .from(crmSequenceStepExecutions)
      .where(and(
        eq(crmSequenceStepExecutions.organizationId, opts.organizationId),
        inArray(crmSequenceStepExecutions.outboundMessageId, candidateMsgIds),
      ))
      .limit(1);
    if (exec.length > 0) {
      await recordEmailEvent(exec[0].id, "REPLY", {
        source: "inbound_email_threaded",
        from: fromLower,
        inReplyTo: opts.inReplyTo || null,
      });
      return { matched: 1 };
    }
    // Headers were present but didn't match a sequence Message-ID — this reply
    // is to a different (non-sequence) thread. Do NOT fall through to the
    // address-only heuristic; that would cause false positives.
    return { matched: 0 };
  }

  // ----- Path B: fallback when no In-Reply-To/References are available.
  // Match by org + sender address. Used by providers/parsers that do not yet
  // expose threading headers.
  const matchingContacts = await db
    .select({ id: crmContacts.id })
    .from(crmContacts)
    .where(and(
      eq(crmContacts.organizationId, opts.organizationId),
      sql`lower(${crmContacts.email}) = ${fromLower}`,
    ));
  if (matchingContacts.length === 0) return { matched: 0 };
  const contactIds = matchingContacts.map((c) => c.id);

  const enrollments = await db
    .select()
    .from(crmSequenceEnrollments)
    .where(and(
      eq(crmSequenceEnrollments.organizationId, opts.organizationId),
      inArray(crmSequenceEnrollments.contactId, contactIds),
      inArray(crmSequenceEnrollments.status, ["ACTIVE", "PAUSED"]),
    ));
  if (enrollments.length === 0) return { matched: 0 };

  let matched = 0;
  for (const enrollment of enrollments) {
    const [exec] = await db
      .select()
      .from(crmSequenceStepExecutions)
      .where(and(
        eq(crmSequenceStepExecutions.enrollmentId, enrollment.id),
        eq(crmSequenceStepExecutions.status, "SENT"),
      ))
      .orderBy(desc(crmSequenceStepExecutions.sentAt))
      .limit(1);
    if (!exec) continue;
    await recordEmailEvent(exec.id, "REPLY", { source: "inbound_email_fallback", from: fromLower });
    matched++;
  }
  return { matched };
}

/**
 * Detect inbound DSN/bounce notifications and auto-exit the matching enrollment
 * with reason BOUNCED. We identify a bounce by sender address (MAILER-DAEMON,
 * postmaster) or by a Delivery Status Notification subject, then locate the
 * original outbound Message-Id either in the In-Reply-To/References headers or
 * embedded in the bounce body.
 */
const BOUNCE_FROM_RE = /(mailer-daemon|postmaster|mail-daemon)@/i;
const BOUNCE_SUBJECT_RE = /(undelivered|undeliverable|delivery (status notification|failure)|failure notice|returned mail|mail delivery (failed|failure)|delivery has failed)/i;
const MSGID_RE = /<[^<>\s]+@[^<>\s]+>/g;

export function looksLikeBounce(opts: {
  fromAddress: string;
  subject?: string | null;
}): boolean {
  if (BOUNCE_FROM_RE.test(opts.fromAddress || "")) return true;
  if (opts.subject && BOUNCE_SUBJECT_RE.test(opts.subject)) return true;
  return false;
}

export async function detectInboundBounce(opts: {
  organizationId: string;
  fromAddress: string;
  isIncoming: boolean;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  inboundEmailMessageId?: string | null;
}): Promise<{ matched: number }> {
  if (!opts.isIncoming || !opts.fromAddress) return { matched: 0 };
  if (!looksLikeBounce({ fromAddress: opts.fromAddress, subject: opts.subject })) {
    return { matched: 0 };
  }

  const candidateMsgIds = new Set<string>();
  if (opts.inReplyTo) candidateMsgIds.add(opts.inReplyTo.trim());
  if (opts.references) {
    for (const ref of opts.references.split(/\s+/)) {
      const r = ref.trim();
      if (r) candidateMsgIds.add(r);
    }
  }
  // DSNs commonly embed the original message-id in the report body (e.g.
  // "Original-Message-ID: <...>" or referenced inline in the body text).
  const haystack = `${opts.bodyText || ""}\n${opts.bodyHtml || ""}`;
  const found = haystack.match(MSGID_RE);
  if (found) {
    for (const m of found) candidateMsgIds.add(m.trim());
  }
  if (candidateMsgIds.size === 0) return { matched: 0 };

  const exec = await db
    .select()
    .from(crmSequenceStepExecutions)
    .where(and(
      eq(crmSequenceStepExecutions.organizationId, opts.organizationId),
      inArray(crmSequenceStepExecutions.outboundMessageId, Array.from(candidateMsgIds)),
    ))
    .limit(1);
  if (exec.length === 0) return { matched: 0 };

  await recordEmailEvent(exec[0].id, "BOUNCE", {
    source: "inbound_dsn",
    from: opts.fromAddress.trim().toLowerCase(),
    subject: opts.subject || null,
    inboundEmailMessageId: opts.inboundEmailMessageId || null,
  }, { inboundEmailMessageId: opts.inboundEmailMessageId || null });
  return { matched: 1 };
}
