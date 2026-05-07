/**
 * Dunning service.
 *
 * Task #2482 — Billing & Subscription Productization.
 *
 * On a Stripe `invoice.payment_failed` webhook the subscription is set
 * to status `past_due` and `paymentFailedAt`/`gracePeriodEndsAt` are
 * stamped. A scheduler then drives this module on a cadence to send
 * reminder emails and, after the grace period expires, flip the org
 * to `suspended`.
 *
 * Suspended orgs keep READ access — the gate lives in the request
 * pipeline (see `requireSubscriptionWriteAccess`).
 */

import { db } from "../../db";
import {
  organizationSubscriptions,
  organizations,
  users,
  billingDunningEmails,
  subscriptionEvents,
} from "@shared/schema";
import { and, eq, isNotNull, isNull, lte, inArray } from "drizzle-orm";
import { sendEmail } from "../emailService";
import { logError, logInfo } from "../../utils/logger";
import { DUNNING_GRACE_PERIOD_DAYS } from "@shared/billing/plans";

export type DunningKind = "reminder_day_0" | "reminder_day_3" | "reminder_day_7" | "suspended";

const REMINDER_OFFSETS_DAYS: Record<Exclude<DunningKind, "suspended">, number> = {
  reminder_day_0: 0,
  reminder_day_3: 3,
  reminder_day_7: 7,
};

function daysSince(d: Date): number {
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}

async function adminEmailFor(organizationId: string): Promise<string | null> {
  const admins = await db
    .select({ email: users.email })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        inArray(users.role, ["ADMIN", "SUPER_ADMIN"]),
        eq(users.isActive, true),
      ),
    )
    .limit(1);
  return admins[0]?.email ?? null;
}

async function claimSendSlot(
  organizationId: string,
  kind: DunningKind,
  cycleStartedAt: Date,
  recipientEmail: string,
): Promise<boolean> {
  // We claim the (org, kind, cycle) slot via the unique index BEFORE
  // sending so two concurrent dunning workers can't both send the same
  // reminder. If the claim succeeds but the subsequent sendEmail
  // fails, the caller must `releaseSendSlot` so the next cycle can
  // retry — otherwise the row would permanently mask a transient
  // email-provider failure.
  try {
    await db.insert(billingDunningEmails).values({
      organizationId,
      kind,
      cycleStartedAt,
      recipientEmail,
    });
    return true;
  } catch (e: unknown) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "23505") return false; // already claimed by a prior cycle
    throw e;
  }
}

async function releaseSendSlot(
  organizationId: string,
  kind: DunningKind,
  cycleStartedAt: Date,
): Promise<void> {
  try {
    await db
      .delete(billingDunningEmails)
      .where(
        and(
          eq(billingDunningEmails.organizationId, organizationId),
          eq(billingDunningEmails.kind, kind),
          eq(billingDunningEmails.cycleStartedAt, cycleStartedAt),
        ),
      );
  } catch (e) {
    logError(
      "Failed to release dunning send slot after email failure",
      { organizationId, kind },
      e instanceof Error ? e : new Error(String(e)),
    );
  }
}

function emailBody(kind: DunningKind, orgName: string, gracePeriodEndsAt: Date): { subject: string; html: string; text: string } {
  const dueOn = gracePeriodEndsAt.toLocaleDateString();
  switch (kind) {
    case "reminder_day_0":
      return {
        subject: `${orgName}: We couldn't process your payment`,
        text: `We were unable to process your most recent payment for SmartManageAI. Please update your payment method by ${dueOn} to avoid suspension.`,
        html: `<p>We were unable to process your most recent payment for <strong>SmartManageAI</strong>.</p><p>Please update your payment method before <strong>${dueOn}</strong> to avoid suspension. You can update billing details from the <a href="${process.env.APP_BASE_URL ?? ""}/billing">Billing page</a>.</p>`,
      };
    case "reminder_day_3":
      return {
        subject: `${orgName}: Payment still failing — action needed`,
        text: `Your payment is still failing. Please update your billing method before ${dueOn} to keep your account active.`,
        html: `<p>Your most recent payment is still failing. Update your billing details before <strong>${dueOn}</strong> to keep ${orgName} active.</p>`,
      };
    case "reminder_day_7":
      return {
        subject: `${orgName}: Final notice before suspension`,
        text: `This is the final reminder. ${orgName} will be suspended on ${dueOn} unless payment is received. Suspended accounts retain READ-only access.`,
        html: `<p><strong>Final notice.</strong> ${orgName} will be suspended on <strong>${dueOn}</strong> unless payment succeeds. Suspended accounts keep read-only access to their data.</p>`,
      };
    case "suspended":
      return {
        subject: `${orgName}: Account suspended for non-payment`,
        text: `Your account has been suspended due to non-payment. Read access remains available; updating your payment method will restore full access.`,
        html: `<p>Your account has been <strong>suspended</strong> due to non-payment.</p><p>Read access is still available. Updating your payment method on the <a href="${process.env.APP_BASE_URL ?? ""}/billing">Billing page</a> will restore full access immediately.</p>`,
      };
  }
}

/**
 * Process the dunning state for ALL orgs with `payment_failed_at` set
 * but no payment success since then. Send any reminder emails that are
 * due, and suspend orgs whose grace window has elapsed.
 *
 * Safe to run on a fixed cadence (e.g. every 30 minutes) — every step
 * is idempotent via the (org, kind, cycle) uniqueness on
 * `billing_dunning_emails`.
 */
export async function runDunningCycle(now: Date = new Date()): Promise<{ remindersSent: number; suspended: number }> {
  const candidates = await db
    .select({
      sub: organizationSubscriptions,
      org: organizations,
    })
    .from(organizationSubscriptions)
    .innerJoin(organizations, eq(organizations.id, organizationSubscriptions.organizationId))
    .where(
      and(
        isNotNull(organizationSubscriptions.paymentFailedAt),
        eq(organizationSubscriptions.status, "past_due"),
      ),
    );

  let remindersSent = 0;
  let suspended = 0;

  for (const { sub, org } of candidates) {
    const failedAt = sub.paymentFailedAt!;
    const graceEnd = sub.gracePeriodEndsAt ?? new Date(failedAt.getTime() + DUNNING_GRACE_PERIOD_DAYS * 86_400_000);
    const elapsed = daysSince(failedAt);
    const recipient = await adminEmailFor(org.id);
    if (!recipient) {
      logInfo("Skipping dunning — no admin email", { orgId: org.id });
      continue;
    }

    for (const kind of Object.keys(REMINDER_OFFSETS_DAYS) as Array<keyof typeof REMINDER_OFFSETS_DAYS>) {
      if (elapsed >= REMINDER_OFFSETS_DAYS[kind]) {
        const claimed = await claimSendSlot(org.id, kind, failedAt, recipient);
        if (claimed) {
          const body = emailBody(kind, org.name, graceEnd);
          try {
            await sendEmail({ to: recipient, ...body });
            remindersSent++;
          } catch (e) {
            logError("Dunning email send failed", { orgId: org.id, kind }, e instanceof Error ? e : new Error(String(e)));
            // Release the claim so the next cycle retries instead of
            // permanently masking a transient email-provider failure.
            await releaseSendSlot(org.id, kind, failedAt);
          }
        }
      }
    }

    if (now >= graceEnd) {
      await db
        .update(organizationSubscriptions)
        .set({ status: "suspended", suspendedAt: now, updatedAt: now })
        .where(eq(organizationSubscriptions.id, sub.id));
      await db.insert(subscriptionEvents).values({
        organizationId: org.id,
        eventType: "suspended",
        previousValue: "past_due",
        newValue: "suspended",
        description: `Auto-suspended after ${DUNNING_GRACE_PERIOD_DAYS}-day dunning grace period`,
      });
      const claimedSus = await claimSendSlot(org.id, "suspended", failedAt, recipient);
      if (claimedSus) {
        const body = emailBody("suspended", org.name, graceEnd);
        try {
          await sendEmail({ to: recipient, ...body });
        } catch (e) {
          logError("Suspension email send failed", { orgId: org.id }, e instanceof Error ? e : new Error(String(e)));
          await releaseSendSlot(org.id, "suspended", failedAt);
        }
      }
      suspended++;
    }
  }

  if (remindersSent || suspended) {
    logInfo("Dunning cycle completed", { remindersSent, suspended });
  }
  return { remindersSent, suspended };
}

/**
 * Called from the Stripe `invoice.payment_succeeded` handler. Clears
 * dunning state and re-activates suspended orgs.
 */
export async function clearDunning(organizationId: string): Promise<void> {
  const [sub] = await db
    .select()
    .from(organizationSubscriptions)
    .where(eq(organizationSubscriptions.organizationId, organizationId))
    .limit(1);
  if (!sub) return;
  if (!sub.paymentFailedAt && sub.status !== "suspended" && sub.status !== "past_due") return;

  await db
    .update(organizationSubscriptions)
    .set({
      paymentFailedAt: null,
      gracePeriodEndsAt: null,
      suspendedAt: null,
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(organizationSubscriptions.id, sub.id));

  await db.insert(subscriptionEvents).values({
    organizationId,
    eventType: "dunning_cleared",
    previousValue: sub.status,
    newValue: "active",
    description: "Payment succeeded; dunning cycle cleared",
  });
}

void isNull;
void lte;
