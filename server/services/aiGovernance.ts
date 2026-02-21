import { db } from "../db";
import { aiActionAudit } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { logInfo, logWarn, logError } from "../utils/logger";

export interface AiActionResult {
  success: boolean;
  output: any;
  tokensIn?: number;
  tokensOut?: number;
  costEstimate?: number;
  model?: string;
  rationale?: string;
}

export interface AiActionParams {
  orgId: string;
  userId: string | null;
  actionType: string;
  inputRefs: Record<string, any>;
  model?: string;
  execute: () => Promise<AiActionResult>;
  approvalRequired?: boolean;
}

const DEFAULT_LIMITS: Record<string, { actionsPerDay: number; tokensPerDay: number; costPerDay: number }> = {
  starter: { actionsPerDay: 10, tokensPerDay: 50000, costPerDay: 1 },
  professional: { actionsPerDay: 100, tokensPerDay: 500000, costPerDay: 10 },
  enterprise: { actionsPerDay: 500, tokensPerDay: 2000000, costPerDay: 50 },
};

export async function getOrgAiUsageToday(orgId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const result = await db.select({
    actionCount: sql<number>`count(*)`,
    totalTokensIn: sql<number>`coalesce(sum(${aiActionAudit.tokensIn}), 0)`,
    totalTokensOut: sql<number>`coalesce(sum(${aiActionAudit.tokensOut}), 0)`,
    totalCost: sql<number>`coalesce(sum(${aiActionAudit.costEstimate}::numeric), 0)`,
  }).from(aiActionAudit)
    .where(and(
      eq(aiActionAudit.organizationId, orgId),
      gte(aiActionAudit.createdAt, today)
    ));

  return result[0] || { actionCount: 0, totalTokensIn: 0, totalTokensOut: 0, totalCost: 0 };
}

export async function checkOrgLimits(orgId: string, planTier: string = "starter"): Promise<{ allowed: boolean; reason?: string }> {
  const limits = DEFAULT_LIMITS[planTier] || DEFAULT_LIMITS.starter;
  const usage = await getOrgAiUsageToday(orgId);

  if (Number(usage.actionCount) >= limits.actionsPerDay) {
    return { allowed: false, reason: `Daily action limit reached (${limits.actionsPerDay}/day)` };
  }
  if (Number(usage.totalTokensIn) + Number(usage.totalTokensOut) >= limits.tokensPerDay) {
    return { allowed: false, reason: `Daily token limit reached (${limits.tokensPerDay}/day)` };
  }
  if (Number(usage.totalCost) >= limits.costPerDay) {
    return { allowed: false, reason: `Daily cost limit reached ($${limits.costPerDay}/day)` };
  }

  return { allowed: true };
}

export async function executeAiAction(params: AiActionParams): Promise<AiActionResult> {
  const startTime = Date.now();

  const limitCheck = await checkOrgLimits(params.orgId);
  if (!limitCheck.allowed) {
    logWarn("AI action blocked by limits", { orgId: params.orgId, actionType: params.actionType, reason: limitCheck.reason });
    return { success: false, output: null, rationale: limitCheck.reason };
  }

  let result: AiActionResult;
  try {
    result = await params.execute();
  } catch (err) {
    logError("AI action execution failed", { orgId: params.orgId, actionType: params.actionType, error: String(err) });
    result = { success: false, output: null, rationale: String(err) };
  }

  const durationMs = Date.now() - startTime;

  try {
    await db.insert(aiActionAudit).values({
      organizationId: params.orgId,
      actorUserId: params.userId,
      actionType: params.actionType,
      model: result.model || params.model || "unknown",
      tokensIn: result.tokensIn || 0,
      tokensOut: result.tokensOut || 0,
      costEstimate: String(result.costEstimate || 0),
      inputRefs: params.inputRefs,
      outputRefs: result.output ? { summary: typeof result.output === "string" ? result.output.substring(0, 500) : "object" } : null,
      rationale: result.rationale || null,
      approvalRequired: params.approvalRequired || false,
      approvalStatus: params.approvalRequired ? "pending" : null,
      durationMs,
    });
  } catch (err) {
    logError("Failed to record AI audit", { error: String(err) });
  }

  logInfo("AI action completed", {
    orgId: params.orgId,
    actionType: params.actionType,
    success: result.success,
    durationMs,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  });

  return result;
}

export async function getAiAuditLog(orgId: string, limit: number = 50, offset: number = 0) {
  return db.select().from(aiActionAudit)
    .where(eq(aiActionAudit.organizationId, orgId))
    .orderBy(sql`${aiActionAudit.createdAt} DESC`)
    .limit(limit)
    .offset(offset);
}
