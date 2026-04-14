import { eventBus } from "../eventBus";
import { db } from "../../db";
import { changeOrders, projectRisks, projects, notifications, users } from "@shared/schema";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import {logError, logInfo, logWarn } from "../../utils/logger";
import { deliverNotifications } from "../../services/notificationDelivery";
import type { RiskStatusChangedEvent, ProjectCreatedEvent } from "../eventTypes";
import { openai, AI_MODEL_GPT5 } from "../../ai/openaiClient";
import { governedAiCall } from "../../services/aiGovernance";
import { sanitizeShortText, sanitizeText } from "../../sanitization";

const ADMIN_ROLES = ["ADMIN", "MANAGER"] as const;

async function getAdminUserIds(orgId: string): Promise<string[]> {
  try {
    const roles: string[] = [...ADMIN_ROLES];
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
    logWarn("Non-critical operation failed");
    return [];
  }
}

export function registerRiskEventListener(): void {
  eventBus.on("project.created", async (event: ProjectCreatedEvent) => {
    try {
      await generateInitialRiskSuggestions(event);
    } catch (err) {
      logError("riskEventListener: project.created risk suggestion failed", {
        error: String(err),
        projectId: event.payload.projectId,
      });
    }
  });

  eventBus.on("risk.status_changed", async (event: RiskStatusChangedEvent) => {
    try {
      const { payload } = event;

      if (payload.newStatus === "OCCURRED") {
        await handleRiskOccurred(event);
      }

      if (payload.linkedCostCode && (payload.newStatus === "OCCURRED" || payload.newStatus === "MITIGATING")) {
        await flagLinkedCostCodeForBudgetReview(event);
      }

      const adminIds = await getAdminUserIds(event.orgId);
      if (adminIds.length > 0 && payload.newStatus === "OCCURRED") {
        await insertRiskNotifications(
          adminIds,
          `Risk Occurred: ${payload.title}`,
          `Risk "${payload.title}" has materialized on project. ${payload.costImpactDollars ? `Estimated cost impact: $${payload.costImpactDollars.toLocaleString()}` : ""}`,
          payload.riskId,
          "project_risk",
          event.orgId
        );
      }

      logInfo(`riskEventListener: risk.status_changed processed`, {
        riskId: payload.riskId,
        oldStatus: payload.oldStatus,
        newStatus: payload.newStatus,
      });
    } catch (err) {
      logError("riskEventListener: risk.status_changed handler failed", {
        error: String(err),
        riskId: event.payload.riskId,
      });
    }
  });
}

async function handleRiskOccurred(event: RiskStatusChangedEvent): Promise<void> {
  const { payload, actorId } = event;

  const [risk] = await db
    .select()
    .from(projectRisks)
    .where(eq(projectRisks.id, payload.riskId))
    .limit(1);

  if (!risk) return;

  const shouldAutoCreateCO = payload.autoCreateChangeOrder && risk.linkedChangeOrderId === null && payload.costImpactDollars && payload.costImpactDollars > 0;

  if (shouldAutoCreateCO) {
    try {
      const maxCoNum = await db
        .select({
          max: sql<number>`COALESCE(MAX(CAST(${changeOrders.changeOrderNumber} AS INTEGER)), 0)`,
        })
        .from(changeOrders)
        .where(eq(changeOrders.projectId, payload.projectId));

      const nextNum = (maxCoNum[0]?.max || 0) + 1;

      const [newCO] = await db
        .insert(changeOrders)
        .values({
          projectId: payload.projectId,
          changeOrderNumber: String(nextNum),
          description: `Risk Occurred: ${payload.title}`,
          reason: `Risk "${payload.title}" materialized`,
          amount: String(payload.costImpactDollars),
          status: "PCO",
          requestedById: actorId,
        })
        .returning();

      if (newCO) {
        await db
          .update(projectRisks)
          .set({ linkedChangeOrderId: newCO.id, updatedAt: new Date() })
          .where(eq(projectRisks.id, payload.riskId));

        logInfo("riskEventListener: auto-created change order for occurred risk", {
          riskId: payload.riskId,
          changeOrderId: newCO.id,
        });
      }
    } catch (coErr) {
      logError("riskEventListener: failed to auto-create change order", {
        error: String(coErr),
        riskId: payload.riskId,
      });
    }
  }
}

async function flagLinkedCostCodeForBudgetReview(event: RiskStatusChangedEvent): Promise<void> {
  const { payload } = event;

  if (!payload.linkedCostCode) return;

  try {
    await eventBus.emit({
      type: "budget.alert_triggered",
      version: 1,
      orgId: event.orgId,
      actorId: event.actorId,
      timestamp: new Date(),
      payload: {
        projectId: payload.projectId,
        projectCode: "",
        costCode: payload.linkedCostCode,
        alertLevel: payload.newStatus === "OCCURRED" ? "CRITICAL" : "WARNING",
        thresholdPercent: 0,
        currentPercent: 0,
      },
    });

    logInfo("riskEventListener: flagged cost code for budget review", {
      riskId: payload.riskId,
      costCode: payload.linkedCostCode,
      alertLevel: payload.newStatus === "OCCURRED" ? "CRITICAL" : "WARNING",
    });
  } catch (err) {
    logError("riskEventListener: failed to flag cost code for budget review", {
      error: String(err),
      riskId: payload.riskId,
    });
  }
}

const VALID_CATEGORIES = ["FINANCIAL", "SCHEDULE", "SAFETY", "ENVIRONMENTAL", "REGULATORY", "SUBCONTRACTOR", "SUPPLY_CHAIN", "WEATHER", "DESIGN", "OTHER"] as const;

async function generateInitialRiskSuggestions(event: ProjectCreatedEvent): Promise<void> {
  const { payload } = event;

  const existingRisks = await db
    .select({ id: projectRisks.id })
    .from(projectRisks)
    .where(eq(projectRisks.projectId, payload.projectId))
    .limit(1);

  if (existingRisks.length > 0) return;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, payload.projectId))
    .limit(1);

  if (!project) return;

  const historicalRisks = await db
    .select({ category: projectRisks.category, title: projectRisks.title, riskScore: projectRisks.riskScore, status: projectRisks.status })
    .from(projectRisks)
    .where(eq(projectRisks.organizationId, project.gcOrganizationId!))
    .orderBy(desc(projectRisks.riskScore))
    .limit(20);

  const historicalContext = historicalRisks.length > 0
    ? `\n\nHistorical risk patterns from this organization's other projects:\n${historicalRisks.map(r => `- ${r.title} (${r.category}, score: ${r.riskScore}, status: ${r.status})`).join("\n")}`
    : "";

  try {
    const systemPrompt = `You are a construction risk management expert. Analyze the project details, contract information, and historical risk patterns to suggest initial risks.
Return a JSON object with a "risks" array. Each risk should have:
- title: string (concise risk title)
- description: string (detailed description)
- category: one of FINANCIAL, SCHEDULE, SAFETY, ENVIRONMENTAL, REGULATORY, SUBCONTRACTOR, SUPPLY_CHAIN, WEATHER, DESIGN, OTHER
- probability: number 1-5
- impact: number 1-5
- mitigationPlan: string

Consider the project type, contract value, timeline, location, and any historical patterns from the organization's prior projects. Suggest 3-5 targeted construction project risks.`;

    const userPrompt = `Project: ${project.name}
Status: ${project.status}
Budget: $${project.budget || "Not set"}
Contract Amount: $${project.contractAmount || "Not set"}
${project.startDate ? `Start Date: ${project.startDate}` : ""}
${project.endDate ? `End Date: ${project.endDate}` : ""}
${project.description ? `Description: ${project.description}` : ""}
${project.locationAddress ? `Location: ${project.locationAddress}` : ""}${historicalContext}`;

    const orgId = project.gcOrganizationId;
    if (!orgId) return;

    const governed = await governedAiCall({
      orgId,
      userId: "system",
      actionType: "risk_auto_generation",
      inputRefs: { projectId: payload.projectId },
      fn: async () => {
        const completion = await openai.chat.completions.create({
          model: AI_MODEL_GPT5,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
          max_completion_tokens: 1500,
        });
        const content = completion.choices[0]?.message?.content;
        if (!content) throw new Error("No response from AI");
        return { result: JSON.parse(content), completion };
      },
    });

    if (governed.blocked) {
      logWarn("riskEventListener: AI governance blocked auto-risk generation", { reason: governed.reason, projectId: payload.projectId });
      return;
    }

    const suggestions = governed.result.risks;
    if (!Array.isArray(suggestions) || suggestions.length === 0) return;

    for (const s of suggestions.slice(0, 5)) {
      const category = (VALID_CATEGORIES as readonly string[]).includes(s.category) ? s.category : "OTHER";
      const probability = Math.max(1, Math.min(5, Math.round(Number(s.probability) || 3)));
      const impact = Math.max(1, Math.min(5, Math.round(Number(s.impact) || 3)));

      await db.insert(projectRisks).values({
        projectId: payload.projectId,
        organizationId: orgId,
        title: sanitizeShortText(String(s.title || "Untitled Risk")),
        description: s.description ? sanitizeText(String(s.description)) : null,
        category,
        probability,
        impact,
        riskScore: probability * impact,
        status: "IDENTIFIED",
        mitigationPlan: s.mitigationPlan ? sanitizeText(String(s.mitigationPlan)) : null,
      });
    }

    logInfo("riskEventListener: auto-generated initial risk suggestions for new project", {
      projectId: payload.projectId,
      count: Math.min(suggestions.length, 5),
    });
  } catch (err) {
    logError("riskEventListener: AI risk generation failed for new project", {
      error: String(err),
      projectId: payload.projectId,
    });
  }
}

async function insertRiskNotifications(
  userIds: string[],
  title: string,
  message: string,
  relatedEntityId: string,
  relatedEntityType: string,
  organizationId?: string
): Promise<void> {
  if (userIds.length === 0) return;
  try {
    const inserted = await db.insert(notifications).values(
      userIds.map((userId) => ({
        userId,
        organizationId: organizationId || null,
        type: "SYSTEM" as const,
        title,
        message,
        relatedEntityId,
        relatedEntityType,
      }))
    ).returning();
    setImmediate(() => {
      deliverNotifications(inserted as Parameters<typeof deliverNotifications>[0]).catch(() => undefined);
    });
  } catch (err) {
    logError("riskEventListener: failed to insert notifications", {
      error: String(err),
    });
  }
}
