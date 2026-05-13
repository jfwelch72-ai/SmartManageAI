import { logError } from "./utils/logger";
import { Router, type Response, NextFunction } from "express";
import { db } from "./db";
import { workflowTemplates, workflowStages, workflowApprovalSteps, workflowNotificationRules, workflowInstances } from "@shared/schema";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { z } from "zod";
import * as workflowEngine from "./services/workflowEngine";

const ENTITY_TYPES = ["CHANGE_ORDER", "SOV_PAY_APP", "TIME_APPROVAL", "PURCHASE_ORDER", "PURCHASE_REQUEST", "VENDOR_BILL", "TM_TICKET", "SUBMITTAL", "WARRANTY_CASE"] as const;
type WorkflowEntityType = (typeof ENTITY_TYPES)[number];
const TEMPLATE_STATUSES = ["ACTIVE", "INACTIVE", "DRAFT"] as const;
type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];
const NOTIFICATION_CHANNELS = ["EMAIL", "PUSH", "SMS", "SLACK", "TEAMS"] as const;
type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

const router = Router();

const createTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  entityType: z.enum(["CHANGE_ORDER", "SOV_PAY_APP", "TIME_APPROVAL", "PURCHASE_ORDER", "PURCHASE_REQUEST", "VENDOR_BILL", "TM_TICKET", "SUBMITTAL", "WARRANTY_CASE"]),
  isDefault: z.boolean().optional(),
  stages: z.array(z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    stageOrder: z.number().int().min(0),
    color: z.string().optional(),
    isInitial: z.boolean().optional(),
    isFinal: z.boolean().optional(),
    slaDurationHours: z.number().int().min(1).optional(),
    autoEscalateRole: z.string().optional(),
    approvalSteps: z.array(z.object({
      requiredRole: z.string().optional(),
      requiredUserId: z.string().optional(),
      requiredApprovalCount: z.number().int().min(1).optional(),
      stepOrder: z.number().int().min(1).optional(),
    })).optional(),
    notificationRules: z.array(z.object({
      triggerOnEnter: z.boolean().optional(),
      triggerOnExit: z.boolean().optional(),
      channel: z.enum(["EMAIL", "PUSH", "SMS", "SLACK", "TEAMS"]).optional(),
      recipientRole: z.string().optional(),
      recipientUserId: z.string().optional(),
      notifySubmitter: z.boolean().optional(),
      messageTemplate: z.string().optional(),
    })).optional(),
  })).min(1),
});

router.get("/", requireAuth, requireRole("ADMIN", "SUPER_ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json([]);

    const conditions = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(workflowTemplates.organizationId, orgId));
    }

    const entityTypeFilter = req.query.entityType as string | undefined;
    if (entityTypeFilter) {
      conditions.push(eq(workflowTemplates.entityType, entityTypeFilter as typeof workflowTemplates.entityType.enumValues[number]));
    }

    const templates = await db.select().from(workflowTemplates)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(workflowTemplates.updatedAt));

    if (templates.length === 0) return res.json([]);

    const templateIds = templates.map(t => t.id);
    const allStages = await db.select().from(workflowStages)
      .where(inArray(workflowStages.templateId, templateIds))
      .orderBy(asc(workflowStages.stageOrder));

    const stageIds = allStages.map(s => s.id);
    const [allApprovalSteps, allNotificationRules] = stageIds.length > 0
      ? await Promise.all([
          db.select().from(workflowApprovalSteps)
            .where(inArray(workflowApprovalSteps.stageId, stageIds))
            .orderBy(asc(workflowApprovalSteps.stepOrder)),
          db.select().from(workflowNotificationRules)
            .where(inArray(workflowNotificationRules.stageId, stageIds)),
        ])
      : [[], []];

    const stepsByStage = new Map<string, typeof allApprovalSteps>();
    for (const step of allApprovalSteps) {
      const arr = stepsByStage.get(step.stageId) || [];
      arr.push(step);
      stepsByStage.set(step.stageId, arr);
    }
    const rulesByStage = new Map<string, typeof allNotificationRules>();
    for (const rule of allNotificationRules) {
      const arr = rulesByStage.get(rule.stageId) || [];
      arr.push(rule);
      rulesByStage.set(rule.stageId, arr);
    }

    const stagesByTemplate = new Map<string, any[]>();
    for (const stage of allStages) {
      const enriched = {
        ...stage,
        approvalSteps: stepsByStage.get(stage.id) || [],
        notificationRules: rulesByStage.get(stage.id) || [],
      };
      const arr = stagesByTemplate.get(stage.templateId) || [];
      arr.push(enriched);
      stagesByTemplate.set(stage.templateId, arr);
    }

    const templatesWithStages = templates.map(template => ({
      ...template,
      stages: stagesByTemplate.get(template.id) || [],
    }));

    res.json(templatesWithStages);
  } catch (error) {
    next(error);
  }
});

router.get("/instances", requireAuth, requireRole("ADMIN", "SUPER_ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json([]);

    const conditions: ReturnType<typeof eq>[] = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(workflowInstances.organizationId, orgId));
    }

    const statusFilter = req.query.status as string | undefined;
    if (statusFilter) {
      conditions.push(eq(workflowInstances.status, statusFilter as typeof workflowInstances.status.enumValues[number]));
    }

    const rows = await db
      .select({
        id: workflowInstances.id,
        templateId: workflowInstances.templateId,
        organizationId: workflowInstances.organizationId,
        entityType: workflowInstances.entityType,
        entityId: workflowInstances.entityId,
        status: workflowInstances.status,
        startedAt: workflowInstances.startedAt,
        updatedAt: workflowInstances.updatedAt,
        completedAt: workflowInstances.completedAt,
        currentStageId: workflowInstances.currentStageId,
        stageName: workflowStages.name,
        stageColor: workflowStages.color,
        slaDurationHours: workflowStages.slaDurationHours,
        autoEscalateRole: workflowStages.autoEscalateRole,
        templateName: workflowTemplates.name,
      })
      .from(workflowInstances)
      .leftJoin(workflowStages, eq(workflowInstances.currentStageId, workflowStages.id))
      .leftJoin(workflowTemplates, eq(workflowInstances.templateId, workflowTemplates.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(workflowInstances.updatedAt));

    const now = new Date();
    const instancesWithBreachFlag = rows.map(row => ({
      ...row,
      slaBreached:
        row.slaDurationHours != null
          ? new Date(new Date(row.updatedAt).getTime() + row.slaDurationHours * 60 * 60 * 1000) < now
          : false,
      slaDeadline:
        row.slaDurationHours != null
          ? new Date(new Date(row.updatedAt).getTime() + row.slaDurationHours * 60 * 60 * 1000).toISOString()
          : null,
    }));

    res.json(instancesWithBreachFlag);
  } catch (error) {
    next(error);
  }
});

router.post("/instances/start", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      entityType: z.enum(["CHANGE_ORDER", "SOV_PAY_APP", "TIME_APPROVAL", "PURCHASE_ORDER", "PURCHASE_REQUEST", "VENDOR_BILL", "TM_TICKET", "SUBMITTAL", "WARRANTY_CASE"]),
      entityId: z.string().min(1),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ error: "Validation failed" });

    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const instance = await workflowEngine.startWorkflow(
      orgId,
      validation.data.entityType,
      validation.data.entityId,
      req.user!.id
    );

    if (!instance) return res.status(404).json({ error: "No workflow template found for this entity type" });

    res.status(201).json(instance);
  } catch (error) {
    next(error);
  }
});

router.post("/instances/:id/transition", requireAuth, requireRole("ADMIN", "SUPER_ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const schema = z.object({
      targetStageId: z.string().min(1),
      notes: z.string().optional(),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ error: "Validation failed" });

    const result = await workflowEngine.transitionStage(
      req.params.id,
      validation.data.targetStageId,
      req.user!.id,
      orgId,
      req.user!.role || "WORKER",
      validation.data.notes
    );

    if (!result.success) return res.status(400).json({ error: result.error });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/instances/entity/:entityType/:entityId", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const data = await workflowEngine.getInstanceForEntity(
      orgId,
      req.params.entityType,
      req.params.entityId
    );

    if (!data) return res.json(null);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/:id", requireAuth, requireRole("ADMIN", "SUPER_ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(404).json({ error: "Not found" });

    const [template] = await db.select().from(workflowTemplates)
      .where(eq(workflowTemplates.id, req.params.id))
      .limit(1);

    if (!template) return res.status(404).json({ error: "Template not found" });

    if (shouldFilter && orgId && template.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const stages = await db.select().from(workflowStages)
      .where(eq(workflowStages.templateId, template.id))
      .orderBy(asc(workflowStages.stageOrder));

    const stageIds = stages.map(s => s.id);
    const [approvalSteps, notifRules] = stageIds.length > 0
      ? await Promise.all([
          db.select().from(workflowApprovalSteps)
            .where(inArray(workflowApprovalSteps.stageId, stageIds))
            .orderBy(asc(workflowApprovalSteps.stepOrder)),
          db.select().from(workflowNotificationRules)
            .where(inArray(workflowNotificationRules.stageId, stageIds)),
        ])
      : [[], []];

    const stepsByStage = new Map<string, typeof approvalSteps>();
    for (const step of approvalSteps) {
      const arr = stepsByStage.get(step.stageId) || [];
      arr.push(step);
      stepsByStage.set(step.stageId, arr);
    }
    const rulesByStage = new Map<string, typeof notifRules>();
    for (const rule of notifRules) {
      const arr = rulesByStage.get(rule.stageId) || [];
      arr.push(rule);
      rulesByStage.set(rule.stageId, arr);
    }

    const stagesWithDetails = stages.map(stage => ({
      ...stage,
      approvalSteps: stepsByStage.get(stage.id) || [],
      notificationRules: rulesByStage.get(stage.id) || [],
    }));

    res.json({ ...template, stages: stagesWithDetails });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const validation = createTemplateSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Validation failed", details: validation.error.flatten() });
    }

    const { name, description, entityType, isDefault, stages } = validation.data;
    const targetOrgId = shouldFilter ? orgId! : (req.body.organizationId || orgId);

    if (!targetOrgId) return res.status(400).json({ error: "Organization ID required" });

    const [template] = await db.insert(workflowTemplates).values({
      organizationId: targetOrgId,
      name,
      description: description || null,
      entityType: entityType satisfies WorkflowEntityType,
      status: "DRAFT" satisfies TemplateStatus,
      isDefault: isDefault || false,
      createdById: req.user!.id,
    }).returning();

    const createdStages = [];
    for (const stageData of stages) {
      const [stage] = await db.insert(workflowStages).values({
        templateId: template.id,
        name: stageData.name,
        description: stageData.description || null,
        stageOrder: stageData.stageOrder,
        color: stageData.color || "#6366f1",
        allowedTransitions: [],
        isInitial: stageData.isInitial || false,
        isFinal: stageData.isFinal || false,
        slaDurationHours: stageData.slaDurationHours ?? null,
        autoEscalateRole: stageData.autoEscalateRole ?? null,
      }).returning();

      const approvalSteps = [];
      if (stageData.approvalSteps) {
        for (const step of stageData.approvalSteps) {
          const [created] = await db.insert(workflowApprovalSteps).values({
            stageId: stage.id,
            requiredRole: step.requiredRole || null,
            requiredUserId: step.requiredUserId || null,
            requiredApprovalCount: step.requiredApprovalCount || 1,
            stepOrder: step.stepOrder || 1,
          }).returning();
          approvalSteps.push(created);
        }
      }

      const notifRules = [];
      if (stageData.notificationRules) {
        for (const rule of stageData.notificationRules) {
          const channel: NotificationChannel = rule.channel || "EMAIL";
          const [created] = await db.insert(workflowNotificationRules).values({
            stageId: stage.id,
            triggerOnEnter: rule.triggerOnEnter ?? true,
            triggerOnExit: rule.triggerOnExit ?? false,
            channel,
            recipientRole: rule.recipientRole || null,
            recipientUserId: rule.recipientUserId || null,
            notifySubmitter: rule.notifySubmitter ?? false,
            messageTemplate: rule.messageTemplate || null,
          }).returning();
          notifRules.push(created);
        }
      }

      createdStages.push({ ...stage, approvalSteps, notificationRules: notifRules });
    }

    const stageIdMap = new Map(createdStages.map(s => [s.stageOrder, s.id]));
    for (let i = 0; i < createdStages.length; i++) {
      const nextStageId = createdStages[i + 1]?.id;
      const transitions = nextStageId ? [nextStageId] : [];
      await db.update(workflowStages)
        .set({ allowedTransitions: transitions })
        .where(eq(workflowStages.id, createdStages[i].id));
      createdStages[i].allowedTransitions = transitions;
    }

    res.status(201).json({ ...template, stages: createdStages });
  } catch (error) {
    next(error);
  }
});

router.put("/:id", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db.select().from(workflowTemplates)
      .where(eq(workflowTemplates.id, req.params.id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Template not found" });
    if (shouldFilter && orgId && existing.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const validation = createTemplateSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Validation failed", details: validation.error.flatten() });
    }

    const { name, description, entityType, isDefault, stages } = validation.data;

    const [updated] = await db.update(workflowTemplates)
      .set({
        name,
        description: description || null,
        entityType: entityType satisfies WorkflowEntityType,
        isDefault: isDefault || false,
        updatedAt: new Date(),
      })
      .where(eq(workflowTemplates.id, req.params.id))
      .returning();

    await db.delete(workflowStages).where(eq(workflowStages.templateId, req.params.id));

    const createdStages = [];
    for (const stageData of stages) {
      const [stage] = await db.insert(workflowStages).values({
        templateId: updated.id,
        name: stageData.name,
        description: stageData.description || null,
        stageOrder: stageData.stageOrder,
        color: stageData.color || "#6366f1",
        allowedTransitions: [],
        isInitial: stageData.isInitial || false,
        isFinal: stageData.isFinal || false,
        slaDurationHours: stageData.slaDurationHours ?? null,
        autoEscalateRole: stageData.autoEscalateRole ?? null,
      }).returning();

      if (stageData.approvalSteps) {
        for (const step of stageData.approvalSteps) {
          await db.insert(workflowApprovalSteps).values({
            stageId: stage.id,
            requiredRole: step.requiredRole || null,
            requiredUserId: step.requiredUserId || null,
            requiredApprovalCount: step.requiredApprovalCount || 1,
            stepOrder: step.stepOrder || 1,
          });
        }
      }

      if (stageData.notificationRules) {
        for (const rule of stageData.notificationRules) {
          const channel: NotificationChannel = rule.channel || "EMAIL";
          await db.insert(workflowNotificationRules).values({
            stageId: stage.id,
            triggerOnEnter: rule.triggerOnEnter ?? true,
            triggerOnExit: rule.triggerOnExit ?? false,
            channel,
            recipientRole: rule.recipientRole || null,
            recipientUserId: rule.recipientUserId || null,
            notifySubmitter: rule.notifySubmitter ?? false,
            messageTemplate: rule.messageTemplate || null,
          });
        }
      }

      createdStages.push(stage);
    }

    for (let i = 0; i < createdStages.length; i++) {
      const nextStageId = createdStages[i + 1]?.id;
      const transitions = nextStageId ? [nextStageId] : [];
      await db.update(workflowStages)
        .set({ allowedTransitions: transitions })
        .where(eq(workflowStages.id, createdStages[i].id));
    }

    const fullTemplate = await db.select().from(workflowTemplates)
      .where(eq(workflowTemplates.id, updated.id))
      .limit(1);
    const allStages = await db.select().from(workflowStages)
      .where(eq(workflowStages.templateId, updated.id))
      .orderBy(asc(workflowStages.stageOrder));

    res.json({ ...fullTemplate[0], stages: allStages });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/status", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const statusSchema = z.object({
      status: z.enum(["ACTIVE", "INACTIVE", "DRAFT"]),
    });
    const validation = statusSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ error: "Invalid status" });

    const [existing] = await db.select().from(workflowTemplates)
      .where(eq(workflowTemplates.id, req.params.id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Template not found" });
    if (shouldFilter && orgId && existing.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (validation.data.status === "ACTIVE") {
      await db.update(workflowTemplates)
        .set({ status: "INACTIVE", updatedAt: new Date() })
        .where(and(
          eq(workflowTemplates.organizationId, existing.organizationId),
          eq(workflowTemplates.entityType, existing.entityType),
          eq(workflowTemplates.status, "ACTIVE")
        ));
    }

    const [updated] = await db.update(workflowTemplates)
      .set({ status: validation.data.status satisfies TemplateStatus, updatedAt: new Date() })
      .where(eq(workflowTemplates.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db.select().from(workflowTemplates)
      .where(eq(workflowTemplates.id, req.params.id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Template not found" });
    if (shouldFilter && orgId && existing.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    await db.delete(workflowTemplates).where(eq(workflowTemplates.id, req.params.id));
    res.json({ message: "Template deleted" });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/clone", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [source] = await db.select().from(workflowTemplates)
      .where(eq(workflowTemplates.id, req.params.id))
      .limit(1);

    if (!source) return res.status(404).json({ error: "Template not found" });
    if (shouldFilter && orgId && source.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [clone] = await db.insert(workflowTemplates).values({
      organizationId: source.organizationId,
      name: `${source.name} (Copy)`,
      description: source.description,
      entityType: source.entityType,
      status: "DRAFT",
      isDefault: false,
      createdById: req.user!.id,
    }).returning();

    const sourceStages = await db.select().from(workflowStages)
      .where(eq(workflowStages.templateId, source.id))
      .orderBy(asc(workflowStages.stageOrder));

    const stageIdMap = new Map<string, string>();

    for (const stage of sourceStages) {
      const [newStage] = await db.insert(workflowStages).values({
        templateId: clone.id,
        name: stage.name,
        description: stage.description,
        stageOrder: stage.stageOrder,
        color: stage.color,
        allowedTransitions: [],
        isInitial: stage.isInitial,
        isFinal: stage.isFinal,
      }).returning();
      stageIdMap.set(stage.id, newStage.id);

      const steps = await db.select().from(workflowApprovalSteps)
        .where(eq(workflowApprovalSteps.stageId, stage.id));
      for (const step of steps) {
        await db.insert(workflowApprovalSteps).values({
          stageId: newStage.id,
          requiredRole: step.requiredRole,
          requiredUserId: step.requiredUserId,
          requiredApprovalCount: step.requiredApprovalCount,
          stepOrder: step.stepOrder,
        });
      }

      const rules = await db.select().from(workflowNotificationRules)
        .where(eq(workflowNotificationRules.stageId, stage.id));
      for (const rule of rules) {
        await db.insert(workflowNotificationRules).values({
          stageId: newStage.id,
          triggerOnEnter: rule.triggerOnEnter,
          triggerOnExit: rule.triggerOnExit,
          channel: rule.channel,
          recipientRole: rule.recipientRole,
          recipientUserId: rule.recipientUserId,
          notifySubmitter: rule.notifySubmitter,
          messageTemplate: rule.messageTemplate,
        });
      }
    }

    for (const stage of sourceStages) {
      const transitions = ((stage.allowedTransitions as string[]) || [])
        .map(id => stageIdMap.get(id))
        .filter(Boolean) as string[];
      const newId = stageIdMap.get(stage.id);
      if (newId) {
        await db.update(workflowStages)
          .set({ allowedTransitions: transitions })
          .where(eq(workflowStages.id, newId));
      }
    }

    const allStages = await db.select().from(workflowStages)
      .where(eq(workflowStages.templateId, clone.id))
      .orderBy(asc(workflowStages.stageOrder));

    res.status(201).json({ ...clone, stages: allStages });
  } catch (error) {
    next(error);
  }
});

export default router;
