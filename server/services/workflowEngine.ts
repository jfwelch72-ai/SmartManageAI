import { db } from "../db";
import {
  workflowTemplates, workflowStages, workflowApprovalSteps,
  workflowNotificationRules, workflowInstances,
  type WorkflowTemplate, type WorkflowStage, type WorkflowApprovalStep,
  type WorkflowNotificationRule, type WorkflowInstance,
} from "@shared/schema";
import { eq, and, asc, desc, lt, isNull, or, sql } from "drizzle-orm";
import { logInfo, logWarn, logError } from "../utils/logger";
import { notifyUsers, getApproverUserIds, recordZeroRecipientSkip, type NotificationParams } from "./approvalNotificationService";
import { recordJobMetrics } from "../utils/jobMetrics";

const WORKFLOW_ENTITY_TYPES = ["CHANGE_ORDER", "SOV_PAY_APP", "TIME_APPROVAL", "PURCHASE_ORDER", "PURCHASE_REQUEST", "VENDOR_BILL", "TM_TICKET", "HAUL_TICKET", "INSPECTOR_REPORT", "MATERIAL_CERT", "SURETY_BOND", "SUBMITTAL", "WARRANTY_CASE"] as const;
type WorkflowEntityType = (typeof WORKFLOW_ENTITY_TYPES)[number];

type TemplateStatus = "ACTIVE" | "INACTIVE" | "DRAFT";
type InstanceStatus = "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
type NotificationChannel = "EMAIL" | "PUSH" | "SMS" | "SLACK" | "TEAMS";

interface PendingApproval {
  stageId: string;
  stepId: string;
  userId: string;
  approvedAt: string;
}

export async function resolveTemplate(orgId: string, entityType: WorkflowEntityType): Promise<WorkflowTemplate | null> {
  const [template] = await db.select().from(workflowTemplates)
    .where(and(
      eq(workflowTemplates.organizationId, orgId),
      eq(workflowTemplates.entityType, entityType),
      eq(workflowTemplates.status, "ACTIVE" satisfies TemplateStatus)
    ))
    .orderBy(desc(workflowTemplates.isDefault))
    .limit(1);

  return template || null;
}

export async function getTemplateStages(templateId: string): Promise<WorkflowStage[]> {
  return db.select().from(workflowStages)
    .where(eq(workflowStages.templateId, templateId))
    .orderBy(asc(workflowStages.stageOrder));
}

export async function getStageApprovalSteps(stageId: string): Promise<WorkflowApprovalStep[]> {
  return db.select().from(workflowApprovalSteps)
    .where(eq(workflowApprovalSteps.stageId, stageId))
    .orderBy(asc(workflowApprovalSteps.stepOrder));
}

export async function getStageNotificationRules(stageId: string): Promise<WorkflowNotificationRule[]> {
  return db.select().from(workflowNotificationRules)
    .where(eq(workflowNotificationRules.stageId, stageId));
}

export async function hasCustomWorkflow(orgId: string, entityType: WorkflowEntityType): Promise<boolean> {
  const template = await resolveTemplate(orgId, entityType);
  return !!template;
}

// Seed a three-stage WARRANTY_CASE default template for an org that has none.
// Stages: Acknowledged (initial) → In Repair (ADMIN/MANAGER approval gate to leave) → Repaired (final).
// The approval step is placed on the "In Repair" stage so that validateTransition,
// which enforces approval steps on the CURRENT stage before leaving it, fires
// correctly when transitioning In Repair → Repaired.
export async function seedWarrantyCaseDefaultTemplate(orgId: string, userId: string): Promise<WorkflowTemplate | null> {
  // Race-condition guard: another request may have seeded it concurrently.
  const existing = await resolveTemplate(orgId, "WARRANTY_CASE");
  if (existing) return existing;

  try {
    const [template] = await db.insert(workflowTemplates).values({
      organizationId: orgId,
      name: "Warranty Case (Default)",
      description: "Default lifecycle: Acknowledged → In Repair → Repaired",
      entityType: "WARRANTY_CASE" satisfies WorkflowEntityType,
      status: "ACTIVE" satisfies TemplateStatus,
      isDefault: true,
      createdById: userId,
    }).returning();

    const [stageAck] = await db.insert(workflowStages).values({
      templateId: template.id,
      name: "Acknowledged",
      description: "Case acknowledged; under initial review",
      stageOrder: 0,
      color: "#f59e0b",
      isInitial: true,
      isFinal: false,
      allowedTransitions: [],
    }).returning();

    const [stageRepair] = await db.insert(workflowStages).values({
      templateId: template.id,
      name: "In Repair",
      description: "Repair work is actively in progress; requires manager sign-off to mark repaired",
      stageOrder: 1,
      color: "#3b82f6",
      isInitial: false,
      isFinal: false,
      allowedTransitions: [],
    }).returning();

    const [stageRepaired] = await db.insert(workflowStages).values({
      templateId: template.id,
      name: "Repaired",
      description: "Repair complete and approved by manager",
      stageOrder: 2,
      color: "#22c55e",
      isInitial: false,
      isFinal: true,
      allowedTransitions: [],
    }).returning();

    // Wire forward transitions.
    await db.update(workflowStages)
      .set({ allowedTransitions: [stageRepair.id] })
      .where(eq(workflowStages.id, stageAck.id));
    await db.update(workflowStages)
      .set({ allowedTransitions: [stageRepaired.id] })
      .where(eq(workflowStages.id, stageRepair.id));

    // ADMIN or MANAGER approval gate on the "In Repair" stage (comma-separated
    // roles in requiredRole are evaluated as OR by transitionStage).
    // Placed here — not on the terminal Repaired stage — because validateTransition
    // enforces approval steps on the CURRENT stage before allowing the transition
    // out of it. The gate fires when the user tries to leave In Repair → Repaired.
    await db.insert(workflowApprovalSteps).values({
      stageId: stageRepair.id,
      requiredRole: "ADMIN,MANAGER",
      requiredApprovalCount: 1,
      stepOrder: 1,
    });

    logInfo("Seeded default WARRANTY_CASE workflow template", { templateId: template.id, orgId });
    return template;
  } catch (seedErr) {
    logWarn("Failed to seed default WARRANTY_CASE workflow template", { orgId, error: String(seedErr) });
    return null;
  }
}

export async function startWorkflow(
  orgId: string,
  entityType: WorkflowEntityType,
  entityId: string,
  userId: string
): Promise<WorkflowInstance | null> {
  let template = await resolveTemplate(orgId, entityType);

  // On first use, seed a sensible default for WARRANTY_CASE if the org has
  // no custom template configured yet.
  if (!template && entityType === "WARRANTY_CASE") {
    template = await seedWarrantyCaseDefaultTemplate(orgId, userId);
  }

  if (!template) return null;

  const [existing] = await db.select().from(workflowInstances)
    .where(and(
      eq(workflowInstances.organizationId, orgId),
      eq(workflowInstances.entityType, entityType),
      eq(workflowInstances.entityId, entityId),
      eq(workflowInstances.status, "IN_PROGRESS" satisfies InstanceStatus)
    ))
    .limit(1);

  if (existing) return existing;

  const stages = await getTemplateStages(template.id);
  const initialStage = stages.find(s => s.isInitial) || stages[0];
  if (!initialStage) return null;

  const [instance] = await db.insert(workflowInstances).values({
    templateId: template.id,
    organizationId: orgId,
    entityType: entityType,
    entityId,
    currentStageId: initialStage.id,
    status: "IN_PROGRESS" satisfies InstanceStatus,
    startedByUserId: userId,
    pendingApprovals: [],
    history: [{
      fromStageId: null,
      toStageId: initialStage.id,
      fromStageName: null,
      toStageName: initialStage.name,
      transitionedAt: new Date().toISOString(),
      transitionedByUserId: userId,
      notes: "Workflow started",
    }],
  }).returning();

  logInfo("Workflow instance started", { instanceId: instance.id, templateId: template.id, entityType, entityId });

  await fireNotifications(orgId, initialStage.id, true, entityId, entityType, userId);

  return instance;
}

interface ValidationResult {
  valid: boolean;
  reason?: string;
  instance?: WorkflowInstance;
  currentStage?: WorkflowStage;
  needsMoreApprovals?: boolean;
  approvalRecorded?: boolean;
}

export async function validateTransition(
  instanceId: string,
  targetStageId: string,
  orgId: string,
  userId: string,
  userRole: string
): Promise<ValidationResult> {
  const [instance] = await db.select().from(workflowInstances)
    .where(and(
      eq(workflowInstances.id, instanceId),
      eq(workflowInstances.organizationId, orgId)
    ))
    .limit(1);

  if (!instance || instance.status !== "IN_PROGRESS") {
    return { valid: false, reason: "Workflow instance not found or not in progress" };
  }

  if (!instance.currentStageId) {
    return { valid: false, reason: "No current stage" };
  }

  const [currentStage] = await db.select().from(workflowStages)
    .where(eq(workflowStages.id, instance.currentStageId))
    .limit(1);

  if (!currentStage) {
    return { valid: false, reason: "Current stage not found" };
  }

  const allowed = (currentStage.allowedTransitions as string[]) || [];
  if (!allowed.includes(targetStageId)) {
    return { valid: false, reason: `Transition from "${currentStage.name}" to target stage is not allowed` };
  }

  const approvalSteps = await getStageApprovalSteps(currentStage.id);
  if (approvalSteps.length > 0) {
    let isAuthorized = false;
    let matchedStep: WorkflowApprovalStep | null = null;

    for (const step of approvalSteps) {
      if (step.requiredUserId && step.requiredUserId === userId) {
        isAuthorized = true;
        matchedStep = step;
        break;
      }
      if (step.requiredRole && step.requiredRole.split(",").map(r => r.trim()).includes(userRole)) {
        isAuthorized = true;
        matchedStep = step;
        break;
      }
    }

    if (!isAuthorized) {
      const requiredRoles = approvalSteps
        .filter(s => s.requiredRole)
        .map(s => s.requiredRole);
      const requiredUsers = approvalSteps
        .filter(s => s.requiredUserId)
        .map(s => s.requiredUserId);
      return {
        valid: false,
        reason: `Approval gate: requires role [${requiredRoles.join(", ")}]${requiredUsers.length > 0 ? " or designated approver" : ""}`
      };
    }

    const existing = (instance.pendingApprovals || []) as PendingApproval[];
    const stageApprovals = existing.filter(a => a.stageId === currentStage.id);

    const alreadyApproved = stageApprovals.some(a => a.userId === userId);
    if (alreadyApproved) {
      return { valid: false, reason: "You have already approved this stage" };
    }

    const totalRequired = approvalSteps.reduce((sum, s) => sum + (s.requiredApprovalCount || 1), 0);
    const currentCount = stageApprovals.length + 1;

    if (currentCount < totalRequired) {
      const newApproval: PendingApproval = {
        stageId: currentStage.id,
        stepId: matchedStep!.id,
        userId,
        approvedAt: new Date().toISOString(),
      };

      await db.update(workflowInstances)
        .set({
          pendingApprovals: [...existing, newApproval],
          updatedAt: new Date(),
        })
        .where(eq(workflowInstances.id, instanceId));

      return {
        valid: false,
        needsMoreApprovals: true,
        approvalRecorded: true,
        reason: `Approval recorded (${currentCount}/${totalRequired}). ${totalRequired - currentCount} more needed.`,
      };
    }
  }

  // Enforce pending SLA-escalation entries for this stage.
  // Entries are written by processWorkflowSlaBreach with stepId="escalation:<role>"
  // and approvedAt="" (not yet resolved).
  // If the acting user's role matches the escalation role, resolve the entry
  // in-place and continue; otherwise block the transition.
  const allPending = (instance.pendingApprovals || []) as PendingApproval[];
  const unresolvedEscalations = allPending.filter(
    (a) => a.stageId === currentStage.id && a.stepId.startsWith("escalation:") && a.approvedAt === "",
  );
  if (unresolvedEscalations.length > 0) {
    const myEscalation = unresolvedEscalations.find(
      (a) => a.stepId === `escalation:${userRole}`,
    );
    if (!myEscalation) {
      const escalationRole = unresolvedEscalations[0].stepId.replace("escalation:", "");
      return {
        valid: false,
        reason: `SLA escalation pending: ${escalationRole} must approve before this stage can advance`,
      };
    }
    // Resolve: stamp approvedAt + userId so the entry is no longer blocking.
    const resolvedPending = allPending.map((a) =>
      a.stageId === currentStage.id && a.stepId === `escalation:${userRole}` && a.approvedAt === ""
        ? { ...a, userId, approvedAt: new Date().toISOString() }
        : a,
    );
    await db.update(workflowInstances)
      .set({ pendingApprovals: resolvedPending, updatedAt: new Date() })
      .where(eq(workflowInstances.id, instanceId));
    // Fall through to { valid: true } — the escalation is now resolved.
  }

  return { valid: true, instance, currentStage };
}

export async function transitionStage(
  instanceId: string,
  targetStageId: string,
  userId: string,
  orgId: string,
  userRole: string,
  notes?: string
): Promise<{ success: boolean; error?: string; instance?: WorkflowInstance; isCompleted?: boolean; needsMoreApprovals?: boolean; approvalRecorded?: boolean }> {
  const validation = await validateTransition(instanceId, targetStageId, orgId, userId, userRole);

  if (validation.needsMoreApprovals) {
    return {
      success: false,
      needsMoreApprovals: true,
      approvalRecorded: validation.approvalRecorded,
      error: validation.reason,
    };
  }

  if (!validation.valid) {
    return { success: false, error: validation.reason };
  }

  const { instance, currentStage } = validation;
  if (!instance || !currentStage) {
    return { success: false, error: "Invalid state" };
  }

  const [targetStage] = await db.select().from(workflowStages)
    .where(eq(workflowStages.id, targetStageId))
    .limit(1);

  if (!targetStage) {
    return { success: false, error: "Target stage not found" };
  }

  const history = Array.isArray(instance.history) ? [...instance.history] : [];
  history.push({
    fromStageId: currentStage.id,
    toStageId: targetStage.id,
    fromStageName: currentStage.name,
    toStageName: targetStage.name,
    transitionedAt: new Date().toISOString(),
    transitionedByUserId: userId,
    notes: notes || null,
  });

  const isCompleted = targetStage.isFinal;
  const completedStatus: InstanceStatus = "COMPLETED";
  const inProgressStatus: InstanceStatus = "IN_PROGRESS";

  const existingApprovals = (instance.pendingApprovals || []) as PendingApproval[];
  const clearedApprovals = existingApprovals.filter(a => a.stageId !== currentStage.id);

  const [updated] = await db.update(workflowInstances)
    .set({
      currentStageId: targetStage.id,
      status: isCompleted ? completedStatus : inProgressStatus,
      completedAt: isCompleted ? new Date() : undefined,
      pendingApprovals: clearedApprovals,
      history,
      updatedAt: new Date(),
    })
    .where(eq(workflowInstances.id, instanceId))
    .returning();

  logInfo("Workflow stage transitioned", {
    instanceId,
    from: currentStage.name,
    to: targetStage.name,
    isCompleted,
  });

  await fireNotifications(instance.organizationId, currentStage.id, false, instance.entityId, instance.entityType as WorkflowEntityType, userId);
  await fireNotifications(instance.organizationId, targetStage.id, true, instance.entityId, instance.entityType as WorkflowEntityType, userId);

  return { success: true, instance: updated, isCompleted };
}

export async function delegateEntityTransition(
  orgId: string,
  entityType: WorkflowEntityType,
  entityId: string,
  userId: string,
  userRole: string,
  targetStatus: string,
  notes?: string
): Promise<{ delegated: boolean; success?: boolean; error?: string; needsMoreApprovals?: boolean; approvalRecorded?: boolean }> {
  const template = await resolveTemplate(orgId, entityType);
  if (!template) {
    return { delegated: false };
  }

  let [instance] = await db.select().from(workflowInstances)
    .where(and(
      eq(workflowInstances.organizationId, orgId),
      eq(workflowInstances.entityType, entityType),
      eq(workflowInstances.entityId, entityId),
      eq(workflowInstances.status, "IN_PROGRESS" satisfies InstanceStatus)
    ))
    .limit(1);

  if (!instance) {
    const started = await startWorkflow(orgId, entityType, entityId, userId);
    if (!started) return { delegated: false };
    instance = started;
  }

  if (!instance.currentStageId) {
    return { delegated: true, success: false, error: "No current stage in workflow" };
  }

  const stages = await getTemplateStages(instance.templateId);
  const currentStage = stages.find(s => s.id === instance.currentStageId);
  if (!currentStage) {
    return { delegated: true, success: false, error: "Current stage not found" };
  }

  const allowed = (currentStage.allowedTransitions as string[]) || [];
  let targetStageId: string | null = null;

  for (const stageId of allowed) {
    const stage = stages.find(s => s.id === stageId);
    if (stage && stage.name.toUpperCase().replace(/\s+/g, "_") === targetStatus.toUpperCase().replace(/\s+/g, "_")) {
      targetStageId = stageId;
      break;
    }
  }

  if (!targetStageId) {
    // A template and active instance exist for this entity, but targetStatus
    // does not map to any allowed stage transition from the current stage.
    // Return fail-closed (delegated: true, success: false) so callers that use
    // this as a governance gate cannot silently bypass it via a naming mismatch —
    // the workflow IS governing this entity type and the transition is denied.
    return {
      delegated: true,
      success: false,
      error: `Target status '${targetStatus}' does not match any allowed stage transition from '${currentStage.name}' in the active workflow template.`,
    };
  }

  const result = await transitionStage(instance.id, targetStageId, userId, orgId, userRole, notes);
  return {
    delegated: true,
    success: result.success,
    error: result.error,
    needsMoreApprovals: result.needsMoreApprovals,
    approvalRecorded: result.approvalRecorded,
  };
}

const ENTITY_TYPE_NOTIFICATION_MAP: Record<WorkflowEntityType, string> = {
  CHANGE_ORDER: "CHANGE_ORDER_APPROVED",
  SOV_PAY_APP: "SOV_ITEM_COMPLETED",
  TIME_APPROVAL: "GENERAL",
  PURCHASE_ORDER: "PROCUREMENT_PO_SUBMITTED",
  PURCHASE_REQUEST: "PROCUREMENT_PR_SUBMITTED",
  VENDOR_BILL: "PAYABLE_CREATED",
  TM_TICKET: "TM_TICKET_SUBMITTED",
  HAUL_TICKET: "HAUL_TICKET_SUBMITTED",
  INSPECTOR_REPORT: "INSPECTOR_REPORT_SUBMITTED",
  MATERIAL_CERT: "MATERIAL_CERT_SUBMITTED",
  SURETY_BOND: "SURETY_BOND_ACTIVATED",
  SUBMITTAL: "GENERAL",
  WARRANTY_CASE: "GENERAL",
};

async function deliverByChannel(
  channel: NotificationChannel,
  recipientIds: string[],
  message: string,
  entityId: string,
  entityType: WorkflowEntityType
) {
  const notificationType = ENTITY_TYPE_NOTIFICATION_MAP[entityType] || "GENERAL";
  const entityLabel = entityType.replace(/_/g, " ");
  const title = `Workflow Update: ${entityLabel}`;

  await notifyUsers(recipientIds, {
    type: notificationType as NonNullable<NotificationParams["type"]>,
    title,
    message,
    relatedEntityId: entityId,
    relatedEntityType: entityType,
  });
}

async function fireNotifications(
  orgId: string,
  stageId: string,
  isEntering: boolean,
  entityId: string,
  entityType: WorkflowEntityType,
  actorUserId: string
) {
  try {
    const rules = await getStageNotificationRules(stageId);

    for (const rule of rules) {
      const shouldFire = isEntering ? rule.triggerOnEnter : rule.triggerOnExit;
      if (!shouldFire) continue;

      const recipientIds: string[] = [];

      if (rule.recipientUserId) {
        recipientIds.push(rule.recipientUserId);
      }

      if (rule.recipientRole) {
        const roleUsers = await getApproverUserIds(orgId, actorUserId, [rule.recipientRole]);
        recipientIds.push(...roleUsers);
      }

      if (rule.notifySubmitter) {
        recipientIds.push(actorUserId);
      }

      if (recipientIds.length === 0) {
        logWarn("Workflow notification rule resolved zero recipients", {
          workflowStageId: stageId,
          ruleId: rule.id,
          entityType,
          entityId,
          isEntering,
        });
        // Increment the same in-process counter that notifyUsers() uses so that
        // every zero-recipient miss (regardless of call path) appears in the
        // unified workflow_notification_no_recipient_total Prometheus metric.
        recordZeroRecipientSkip("WORKFLOW_NOTIFICATION", entityType);
        continue;
      }

      const uniqueRecipients = [...new Set(recipientIds)];
      const message = rule.messageTemplate || `Workflow update for ${entityType.replace(/_/g, " ")}`;
      const channel = (rule.channel || "EMAIL") as NotificationChannel;

      await deliverByChannel(channel, uniqueRecipients, message, entityId, entityType);
    }
  } catch (error) {
    logError("Failed to fire workflow notifications", { error: String(error), stageId });
  }
}

export async function getInstanceForEntity(orgId: string, entityType: string, entityId: string) {
  const [instance] = await db.select().from(workflowInstances)
    .where(and(
      eq(workflowInstances.organizationId, orgId),
      eq(workflowInstances.entityType, entityType as WorkflowEntityType),
      eq(workflowInstances.entityId, entityId)
    ))
    .limit(1);

  if (!instance) return null;

  const stages = await getTemplateStages(instance.templateId);
  const currentStage = instance.currentStageId
    ? stages.find(s => s.id === instance.currentStageId)
    : null;

  const [template] = await db.select().from(workflowTemplates)
    .where(eq(workflowTemplates.id, instance.templateId))
    .limit(1);

  const now = new Date();
  const slaBreached =
    currentStage?.slaDurationHours != null
      ? new Date(instance.updatedAt.getTime() + currentStage.slaDurationHours * 60 * 60 * 1000) < now
      : false;

  return { instance, stages, currentStage, template, slaBreached };
}

/**
 * Task #2833 — SLA breach sweep.
 * Scans all IN_PROGRESS workflow instances whose current stage has a
 * slaDurationHours set and fires the stage's notification rules when the
 * instance has been in that stage longer than the SLA allows. If the stage
 * also has an autoEscalateRole, logs a WARN (UI escalation is org-configurable).
 */
export async function processWorkflowSlaBreach(opts: { now?: Date } = {}): Promise<{ checked: number; breached: number }> {
  const now = opts.now ?? new Date();

  const breachingInstances = await db
    .select({
      instanceId: workflowInstances.id,
      organizationId: workflowInstances.organizationId,
      entityType: workflowInstances.entityType,
      entityId: workflowInstances.entityId,
      startedByUserId: workflowInstances.startedByUserId,
      updatedAt: workflowInstances.updatedAt,
      currentStageId: workflowInstances.currentStageId,
      slaDurationHours: workflowStages.slaDurationHours,
      autoEscalateRole: workflowStages.autoEscalateRole,
      stageName: workflowStages.name,
    })
    .from(workflowInstances)
    .innerJoin(workflowStages, eq(workflowInstances.currentStageId, workflowStages.id))
    .where(and(
      eq(workflowInstances.status, "IN_PROGRESS"),
      sql`${workflowStages.slaDurationHours} IS NOT NULL`,
      sql`${workflowInstances.updatedAt} + (${workflowStages.slaDurationHours} * interval '1 hour') < ${now}::timestamptz`,
    ));

  let breached = 0;
  for (const row of breachingInstances) {
    try {
      logWarn("Workflow SLA breached", {
        instanceId: row.instanceId,
        entityType: row.entityType,
        entityId: row.entityId,
        stageName: row.stageName,
        slaDurationHours: row.slaDurationHours,
        autoEscalateRole: row.autoEscalateRole ?? undefined,
      });

      const slaBreachParams: NotificationParams = {
        type: "GENERAL",
        title: `SLA Breach: ${row.stageName}`,
        message: `Workflow stage "${row.stageName}" for ${row.entityType} (${row.entityId}) has exceeded its ${row.slaDurationHours}h SLA. Immediate attention required.`,
        relatedEntityId: row.entityId,
        relatedEntityType: row.entityType as string,
      };

      if (row.autoEscalateRole) {
        // Resolve users that hold the escalation role in this org, then send
        // them a targeted SLA_BREACH notification so the right people are paged.
        const escalationUserIds = await getApproverUserIds(
          row.organizationId,
          row.startedByUserId ?? "",
          [row.autoEscalateRole],
        );
        if (escalationUserIds.length > 0) {
          await notifyUsers(escalationUserIds, slaBreachParams, row.organizationId);
          logInfo("Workflow SLA breach — escalation notifications sent", {
            instanceId: row.instanceId,
            escalationRole: row.autoEscalateRole,
            recipientCount: escalationUserIds.length,
          });
        } else {
          logWarn("Workflow SLA breach — autoEscalateRole has no users", {
            instanceId: row.instanceId,
            escalationRole: row.autoEscalateRole,
          });
        }

        // Move the instance into a role-owned pending escalation state so the
        // workflow is blocked until the escalation role explicitly approves.
        // This prevents the instance from silently advancing past a breached stage.
        const [liveInst] = await db
          .select({ pendingApprovals: workflowInstances.pendingApprovals })
          .from(workflowInstances)
          .where(eq(workflowInstances.id, row.instanceId))
          .limit(1);
        const pending = (liveInst?.pendingApprovals ?? []) as PendingApproval[];
        // Synthetic stepId encodes the escalation role so the check is stable
        // across repeated SLA breach ticks without requiring extra fields.
        const escalationStepId = `escalation:${row.autoEscalateRole}`;
        const alreadyEscalated = pending.some(
          (a) => a.stageId === row.currentStageId && a.stepId === escalationStepId,
        );
        if (!alreadyEscalated && row.currentStageId) {
          // Append an unapproved entry for the escalation role.  The stepId sentinel
          // (`escalation:<role>`) lets applyApproval distinguish it from a normal
          // approval step; userId and approvedAt are blank until the role acts.
          const escalationEntry: PendingApproval = {
            stageId: row.currentStageId,
            stepId: escalationStepId,
            userId: "",      // to be filled when the escalation role approves
            approvedAt: "",  // blank = not yet approved
          };
          await db.update(workflowInstances)
            .set({ pendingApprovals: [...pending, escalationEntry], updatedAt: now })
            .where(eq(workflowInstances.id, row.instanceId));
        } else {
          // Already escalated or no current stage — just bump updatedAt.
          await db.update(workflowInstances)
            .set({ updatedAt: now })
            .where(eq(workflowInstances.id, row.instanceId));
        }
      } else if (row.currentStageId) {
        // No escalation role — fire the stage's configured notification rules.
        await fireNotifications(
          row.organizationId,
          row.currentStageId,
          true,
          row.entityId,
          row.entityType as WorkflowEntityType,
          row.startedByUserId ?? "",
        );

        // Bump updatedAt so the same instance is not re-alarmed until it
        // actually spends another slaDurationHours in the stage.
        await db.update(workflowInstances)
          .set({ updatedAt: now })
          .where(eq(workflowInstances.id, row.instanceId));
      } else {
        await db.update(workflowInstances)
          .set({ updatedAt: now })
          .where(eq(workflowInstances.id, row.instanceId));
      }

      recordJobMetrics(`workflow_sla_breach:${row.entityType}`, { breached: 1 });
      breached++;
    } catch (err) {
      logError("SLA breach notification failed", {
        instanceId: row.instanceId,
        error: String(err),
      });
    }
  }

  return { checked: breachingInstances.length, breached };
}
