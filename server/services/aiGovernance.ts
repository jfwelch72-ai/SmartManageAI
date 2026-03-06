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

const GPT4O_INPUT_COST_PER_TOKEN = 0.0000025;
const GPT4O_OUTPUT_COST_PER_TOKEN = 0.00001;
const GPT4O_MINI_INPUT_COST_PER_TOKEN = 0.00000015;
const GPT4O_MINI_OUTPUT_COST_PER_TOKEN = 0.0000006;

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const isMini = model.includes("mini");
  const inputCost = tokensIn * (isMini ? GPT4O_MINI_INPUT_COST_PER_TOKEN : GPT4O_INPUT_COST_PER_TOKEN);
  const outputCost = tokensOut * (isMini ? GPT4O_MINI_OUTPUT_COST_PER_TOKEN : GPT4O_OUTPUT_COST_PER_TOKEN);
  return Math.round((inputCost + outputCost) * 1000000) / 1000000;
}

export async function governedAiCall<T>(opts: {
  orgId: string;
  userId: string | null;
  actionType: string;
  inputRefs?: Record<string, any>;
  fn: () => Promise<{ result: T; completion: { usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string } }>;
}): Promise<{ result: T; blocked?: boolean; reason?: string }> {
  const limitCheck = await checkOrgLimits(opts.orgId);
  if (!limitCheck.allowed) {
    logWarn("AI action blocked by limits", { orgId: opts.orgId, actionType: opts.actionType, reason: limitCheck.reason });
    return { result: null as T, blocked: true, reason: limitCheck.reason };
  }

  const startTime = Date.now();
  const { result, completion } = await opts.fn();
  const durationMs = Date.now() - startTime;

  const tokensIn = completion.usage?.prompt_tokens || 0;
  const tokensOut = completion.usage?.completion_tokens || 0;
  const model = completion.model || "gpt-4o";
  const cost = estimateCost(model, tokensIn, tokensOut);

  try {
    await db.insert(aiActionAudit).values({
      organizationId: opts.orgId,
      actorUserId: opts.userId,
      actionType: opts.actionType,
      model,
      tokensIn,
      tokensOut,
      costEstimate: String(cost),
      inputRefs: opts.inputRefs || {},
      outputRefs: { tracked: true },
      rationale: null,
      approvalRequired: false,
      approvalStatus: null,
      durationMs,
    });
  } catch (err) {
    logError("Failed to record AI audit", { error: String(err) });
  }

  return { result };
}

export async function getAiAuditLog(orgId: string, limit: number = 50, offset: number = 0) {
  return db.select().from(aiActionAudit)
    .where(eq(aiActionAudit.organizationId, orgId))
    .orderBy(sql`${aiActionAudit.createdAt} DESC`)
    .limit(limit)
    .offset(offset);
}
