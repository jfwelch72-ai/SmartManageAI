import { db } from "../db";
import {
  workflowTemplates, workflowStages, workflowApprovalSteps,
  workflowNotificationRules, workflowInstances,
  type WorkflowTemplate, type WorkflowStage, type WorkflowApprovalStep,
  type WorkflowNotificationRule, type WorkflowInstance,
} from "@shared/schema";
import { eq, and, asc } from "drizzle-orm";
import { logInfo, logError } from "../utils/logger";
import { notifyUsers, getApproverUserIds } from "./approvalNotificationService";

const WORKFLOW_ENTITY_TYPES = ["CHANGE_ORDER", "SOV_PAY_APP", "TIME_APPROVAL", "PURCHASE_ORDER", "PURCHASE_REQUEST", "VENDOR_BILL", "TM_TICKET"] as const;
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
    .limit(1);

  if (template) return template;

  const [defaultTemplate] = await db.select().from(workflowTemplates)
    .where(and(
      eq(workflowTemplates.organizationId, orgId),
      eq(workflowTemplates.entityType, entityType),
      eq(workflowTemplates.isDefault, true),
      eq(workflowTemplates.status, "ACTIVE" satisfies TemplateStatus)
    ))
    .limit(1);

  return defaultTemplate || null;
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

export async function startWorkflow(
  orgId: string,
  entityType: WorkflowEntityType,
  entityId: string,
  userId: string
): Promise<WorkflowInstance | null> {
  const template = await resolveTemplate(orgId, entityType);
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
      if (step.requiredRole && step.requiredRole === userRole) {
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

  await fireNotifications(instance.organizationId, currentStage.id, false, instance.entityId, instance.entityType, userId);
  await fireNotifications(instance.organizationId, targetStage.id, true, instance.entityId, instance.entityType, userId);

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

  if (!targetStageId && allowed.length === 1) {
    targetStageId = allowed[0];
  }

  if (!targetStageId) {
    return { delegated: true, success: false, error: `No matching workflow stage for status "${targetStatus}"` };
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

async function deliverByChannel(
  channel: NotificationChannel,
  recipientIds: string[],
  message: string,
  entityId: string,
  entityType: WorkflowEntityType
) {
  await notifyUsers(recipientIds, {
    type: "GENERAL",
    title: `Workflow Update (${channel})`,
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

      if (recipientIds.length === 0) continue;

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

  return { instance, stages, currentStage, template };
}
