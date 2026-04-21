import { db } from "../db";
import {
  crmAutomations, crmAutomationRuns,
  crmOpportunities, crmTasks, crmContacts,
  notifications,
  crmSequenceEnrollments,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { logInfo, logError } from "../utils/logger";
import { sendSms, isTwilioConfigured } from "./smsService";

export type AutomationTrigger = "STAGE_CHANGE" | "IDLE_DAYS" | "SCORE_THRESHOLD" | "FORM_SUBMIT" | "FIELD_CHANGE" | "EMAIL_REPLY";

export interface AutomationContext {
  orgId: string;
  trigger: AutomationTrigger;
  entityType: "OPPORTUNITY" | "CONTACT" | "ORGANISATION";
  entityId: string;
  context?: Record<string, any>;
}

interface ActionConfig {
  type: "ASSIGN" | "NOTIFY" | "CREATE_TASK" | "ENROLL_SEQUENCE" | "UPDATE_FIELD" | "WEBHOOK" | "SEND_SMS";
  config: Record<string, any>;
}

export async function runAutomationsForTrigger(ctx: AutomationContext): Promise<{ matched: number; executed: number }> {
  const automations = await db.select().from(crmAutomations).where(and(
    eq(crmAutomations.organizationId, ctx.orgId),
    eq(crmAutomations.trigger, ctx.trigger),
    eq(crmAutomations.isActive, true),
  ));

  let executed = 0;
  for (const auto of automations) {
    if (!matchesTrigger(auto.triggerConfig as any, ctx)) continue;
    const ok = await runSingleAutomation({ id: auto.id, actions: auto.actions }, ctx);
    if (ok) executed++;
  }
  if (executed > 0) logInfo("CRM automations executed", { trigger: ctx.trigger, executed, of: automations.length });
  return { matched: automations.length, executed };
}

/**
 * Execute a single, already-loaded automation against a context. Used by the
 * idle-days background sweep so it can dedupe per (automation, entity) without
 * relying on the engine re-evaluating every active automation for the org.
 *
 * Note: this intentionally does NOT call matchesTrigger — the caller is
 * responsible for deciding whether the automation should fire.
 */
export async function runSingleAutomation(automation: { id: string; actions: unknown }, ctx: AutomationContext): Promise<boolean> {
  try {
    const actions = (automation.actions as ActionConfig[]) || [];
    for (const action of actions) {
      await executeAction(action, automation.id, ctx);
    }
    await db.insert(crmAutomationRuns).values({
      organizationId: ctx.orgId,
      automationId: automation.id,
      entityType: ctx.entityType,
      entityId: ctx.entityId,
      status: "SUCCESS",
      details: { trigger: ctx.trigger, context: ctx.context ?? {} },
    } as any);
    return true;
  } catch (e) {
    logError("Automation run failed", { automationId: automation.id }, e as Error);
    try {
      await db.insert(crmAutomationRuns).values({
        organizationId: ctx.orgId,
        automationId: automation.id,
        entityType: ctx.entityType,
        entityId: ctx.entityId,
        status: "FAILED",
        errorMessage: (e as Error).message,
      } as any);
    } catch { /* ignore */ }
    return false;
  }
}

function matchesTrigger(cfg: Record<string, any> | null, ctx: AutomationContext): boolean {
  if (!cfg) return true;
  switch (ctx.trigger) {
    case "STAGE_CHANGE": {
      const newStage = ctx.context?.newStage;
      const oldStage = ctx.context?.oldStage;
      if (cfg.toStage && newStage !== cfg.toStage) return false;
      if (cfg.fromStage && oldStage !== cfg.fromStage) return false;
      return true;
    }
    case "SCORE_THRESHOLD": {
      const score = ctx.context?.score ?? 0;
      const min = Number(cfg.scoreMin ?? 0);
      return score >= min;
    }
    case "IDLE_DAYS": {
      const idle = ctx.context?.idleDays ?? 0;
      return idle >= Number(cfg.idleDays ?? 7);
    }
    case "FORM_SUBMIT": {
      if (cfg.formId && ctx.context?.formId !== cfg.formId) return false;
      return true;
    }
    default:
      return true;
  }
}

async function executeAction(action: ActionConfig, automationId: string, ctx: AutomationContext): Promise<void> {
  switch (action.type) {
    case "ASSIGN": {
      if (ctx.entityType !== "OPPORTUNITY") return;
      const userId = action.config.userId;
      if (!userId) return;
      await db.update(crmOpportunities).set({ assignedToId: userId, updatedAt: new Date() })
        .where(and(eq(crmOpportunities.id, ctx.entityId), eq(crmOpportunities.organizationId, ctx.orgId)));
      return;
    }
    case "NOTIFY": {
      const userIds: string[] = action.config.userIds || [];
      const title = action.config.title || "CRM automation alert";
      const message = action.config.message || `Triggered by ${ctx.trigger}`;
      for (const uid of userIds) {
        try {
          await db.insert(notifications).values({
            userId: uid,
            organizationId: ctx.orgId,
            type: "CRM_AUTOMATION",
            title,
            message,
            relatedEntityId: ctx.entityId,
            relatedEntityType: ctx.entityType === "OPPORTUNITY" ? "CRM_OPPORTUNITY" : "CRM_CONTACT",
          } as any);
        } catch { /* ignore */ }
      }
      return;
    }
    case "CREATE_TASK": {
      const due = action.config.dueInDays ? new Date(Date.now() + Number(action.config.dueInDays) * 24 * 60 * 60 * 1000) : new Date(Date.now() + 24 * 60 * 60 * 1000);
      const opportunityId = ctx.entityType === "OPPORTUNITY" ? ctx.entityId : null;
      let contactId = ctx.entityType === "CONTACT" ? ctx.entityId : null;
      // Task #702: when no explicit assignee is configured, route the
      // auto-created task to the contact owner so the relationship handoff
      // is preserved.
      let assignedToId: string | null = action.config.assignedToId ?? null;
      if (!assignedToId) {
        if (!contactId && opportunityId) {
          const [opp] = await db.select({ contactId: crmOpportunities.contactId })
            .from(crmOpportunities).where(eq(crmOpportunities.id, opportunityId)).limit(1);
          if (opp?.contactId) contactId = opp.contactId;
        }
        if (contactId) {
          const [c] = await db.select({ ownerId: crmContacts.ownerId })
            .from(crmContacts).where(eq(crmContacts.id, contactId)).limit(1);
          if (c?.ownerId) assignedToId = c.ownerId;
        }
      }
      await db.insert(crmTasks).values({
        organizationId: ctx.orgId,
        title: action.config.title || "CRM automation task",
        description: action.config.description || `Created by automation`,
        dueDate: due,
        assignedToId,
        opportunityId,
        contactId,
      } as any);
      return;
    }
    case "ENROLL_SEQUENCE": {
      const sequenceId = action.config.sequenceId;
      if (!sequenceId) return;
      let contactId = ctx.entityType === "CONTACT" ? ctx.entityId : null;
      let opportunityId = ctx.entityType === "OPPORTUNITY" ? ctx.entityId : null;
      if (opportunityId && !contactId) {
        const [opp] = await db.select().from(crmOpportunities).where(eq(crmOpportunities.id, opportunityId)).limit(1);
        if (opp?.contactId) contactId = opp.contactId;
      }
      if (!contactId) return;
      // Task #702: prefer the contact owner as the cadence sender so
      // sequence ownership follows the relationship handoff. Fall back to
      // the explicitly configured senderId if the contact has no owner.
      let senderId: string | undefined = action.config.senderId;
      const [c] = await db.select({ ownerId: crmContacts.ownerId })
        .from(crmContacts).where(eq(crmContacts.id, contactId)).limit(1);
      if (c?.ownerId) senderId = c.ownerId;
      if (!senderId) return;
      try {
        await db.insert(crmSequenceEnrollments).values({
          organizationId: ctx.orgId,
          sequenceId,
          contactId,
          opportunityId,
          senderId,
          status: "ACTIVE",
          startAt: new Date(),
        } as any);
      } catch { /* unique constraint or other - ignore */ }
      return;
    }
    case "UPDATE_FIELD": {
      if (ctx.entityType !== "OPPORTUNITY") return;
      const field = String(action.config.field || "");
      const value = action.config.value;
      const allowed = ["stage", "probability", "assignedToId", "source", "notes"];
      if (!allowed.includes(field)) return;
      await db.update(crmOpportunities).set({ [field]: value, updatedAt: new Date() } as any)
        .where(and(eq(crmOpportunities.id, ctx.entityId), eq(crmOpportunities.organizationId, ctx.orgId)));
      return;
    }
    case "WEBHOOK": {
      const url = action.config.url;
      if (!url) return;
      try {
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            automationId,
            trigger: ctx.trigger,
            entityType: ctx.entityType,
            entityId: ctx.entityId,
            context: ctx.context ?? {},
          }),
        });
      } catch (e) {
        logError("Webhook action failed", { url }, e as Error);
      }
      return;
    }
    case "SEND_SMS": {
      if (!isTwilioConfigured()) return;
      let phone = action.config.phone as string | undefined;
      if (!phone && ctx.entityType === "CONTACT") {
        const [c] = await db.select().from(crmContacts).where(eq(crmContacts.id, ctx.entityId)).limit(1);
        phone = c?.phone ?? undefined;
      }
      if (!phone) return;
      await sendSms(phone, action.config.message || "Update on your inquiry");
      return;
    }
  }
}
