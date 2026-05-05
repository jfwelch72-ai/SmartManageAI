import { db } from "../db";
import { aiActionAudit, organizationSubscriptions, users } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { logInfo, logWarn, logError } from "../utils/logger";
import { AI_MODEL_GPT5 } from "../ai/openaiClient";

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
  free: { actionsPerDay: 5, tokensPerDay: 25000, costPerDay: 0.5 },
  starter: { actionsPerDay: 10, tokensPerDay: 50000, costPerDay: 1 },
  professional: { actionsPerDay: 100, tokensPerDay: 500000, costPerDay: 10 },
  enterprise: { actionsPerDay: 500, tokensPerDay: 2000000, costPerDay: 50 },
};

export function getLimitsForTier(tier: string) {
  return DEFAULT_LIMITS[tier] || DEFAULT_LIMITS.starter;
}

const orgTierCache = new Map<string, { tier: string; cachedAt: number }>();
const TIER_CACHE_TTL = 5 * 60 * 1000;

async function getOrgPlanTier(orgId: string): Promise<string> {
  const cached = orgTierCache.get(orgId);
  if (cached && Date.now() - cached.cachedAt < TIER_CACHE_TTL) {
    return cached.tier;
  }
  try {
    const [sub] = await db
      .select({ planTier: organizationSubscriptions.planTier })
      .from(organizationSubscriptions)
      .where(and(
        eq(organizationSubscriptions.organizationId, orgId),
        eq(organizationSubscriptions.status, "active"),
      ))
      .orderBy(sql`${organizationSubscriptions.updatedAt} DESC`)
      .limit(1);
    const tier = sub?.planTier || "free";
    orgTierCache.set(orgId, { tier, cachedAt: Date.now() });
    return tier;
  } catch (err) {
    logError("Failed to look up org plan tier", { orgId, error: String(err) });
    return "free";
  }
}

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

  const tier = await getOrgPlanTier(params.orgId);
  const limitCheck = await checkOrgLimits(params.orgId, tier);
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
const DALLE3_STANDARD_1024_COST = 0.04;
const DALLE3_HD_1024_COST = 0.08;

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  if (model.includes("dall-e")) {
    return model.includes("hd") ? DALLE3_HD_1024_COST : DALLE3_STANDARD_1024_COST;
  }
  const isMini = model.includes("mini");
  const inputCost = tokensIn * (isMini ? GPT4O_MINI_INPUT_COST_PER_TOKEN : GPT4O_INPUT_COST_PER_TOKEN);
  const outputCost = tokensOut * (isMini ? GPT4O_MINI_OUTPUT_COST_PER_TOKEN : GPT4O_OUTPUT_COST_PER_TOKEN);
  return Math.round((inputCost + outputCost) * 1000000) / 1000000;
}

export async function getOrgLimitsWithUsage(orgId: string) {
  const tier = await getOrgPlanTier(orgId);
  const limits = getLimitsForTier(tier);
  const usage = await getOrgAiUsageToday(orgId);
  return { tier, limits, usage };
}

export async function governedAiCall<T>(opts: {
  orgId: string;
  userId: string | null;
  actionType: string;
  inputRefs?: Record<string, any>;
  // Task #2410: callers that route through `routedChatCompletion` populate
  // `provider`, `fallbackUsed` and `latencyMs` on the completion shape so we
  // can record per-call attribution. Legacy callers omit them; we record null
  // / false in that case (which is correct — those calls went straight to
  // OpenAI without going through the router).
  fn: () => Promise<{
    result: T;
    completion: {
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
      provider?: string;
      fallbackUsed?: boolean;
      latencyMs?: number;
    };
  }>;
}): Promise<{ result: T; blocked?: boolean; reason?: string }> {
  const tier = await getOrgPlanTier(opts.orgId);
  const limitCheck = await checkOrgLimits(opts.orgId, tier);
  if (!limitCheck.allowed) {
    logWarn("AI action blocked by limits", { orgId: opts.orgId, actionType: opts.actionType, reason: limitCheck.reason });
    return { result: null as T, blocked: true, reason: limitCheck.reason };
  }

  const startTime = Date.now();
  const { result, completion } = await opts.fn();
  const durationMs = Date.now() - startTime;

  const tokensIn = completion.usage?.prompt_tokens || 0;
  const tokensOut = completion.usage?.completion_tokens || 0;
  const model = completion.model || AI_MODEL_GPT5;
  const cost = estimateCost(model, tokensIn, tokensOut);
  const provider = completion.provider ?? null;
  const fallbackUsed = completion.fallbackUsed === true;

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
      provider,
      fallbackUsed,
    });
  } catch (err) {
    logError("Failed to record AI audit", { error: String(err) });
  }

  if (provider) {
    logInfo("AI action routed", {
      orgId: opts.orgId,
      actionType: opts.actionType,
      provider,
      model,
      tokensIn,
      tokensOut,
      latencyMs: completion.latencyMs ?? durationMs,
      fallbackUsed,
    });
  }

  return { result };
}

export async function getAiAuditLog(orgId: string, limit: number = 50, offset: number = 0, dateFrom?: Date, dateTo?: Date) {
  const conditions = [eq(aiActionAudit.organizationId, orgId)];
  if (dateFrom) conditions.push(gte(aiActionAudit.createdAt, dateFrom));
  if (dateTo) {
    const { lte } = await import("drizzle-orm");
    conditions.push(lte(aiActionAudit.createdAt, dateTo));
  }
  const where = and(...conditions);

  const rows = await db.select({
    id: aiActionAudit.id,
    organizationId: aiActionAudit.organizationId,
    actorUserId: aiActionAudit.actorUserId,
    actionType: aiActionAudit.actionType,
    model: aiActionAudit.model,
    tokensIn: aiActionAudit.tokensIn,
    tokensOut: aiActionAudit.tokensOut,
    costEstimate: aiActionAudit.costEstimate,
    inputRefs: aiActionAudit.inputRefs,
    outputRefs: aiActionAudit.outputRefs,
    rationale: aiActionAudit.rationale,
    approvalRequired: aiActionAudit.approvalRequired,
    approvalStatus: aiActionAudit.approvalStatus,
    durationMs: aiActionAudit.durationMs,
    createdAt: aiActionAudit.createdAt,
    actorFirstName: users.firstName,
    actorLastName: users.lastName,
  }).from(aiActionAudit)
    .leftJoin(users, eq(aiActionAudit.actorUserId, users.id))
    .where(where)
    .orderBy(sql`${aiActionAudit.createdAt} DESC`)
    .limit(limit)
    .offset(offset);

  const [countResult] = await db.select({
    total: sql<number>`count(*)`,
  }).from(aiActionAudit).where(where);

  return {
    rows: rows.map(r => ({
      ...r,
      actorName: r.actorFirstName && r.actorLastName
        ? `${r.actorFirstName} ${r.actorLastName}`
        : r.actorUserId || "System",
    })),
    total: Number(countResult?.total || 0),
  };
}

export async function getCostBreakdownByActionType(orgId: string, dateFrom?: Date, dateTo?: Date) {
  const conditions = [eq(aiActionAudit.organizationId, orgId)];
  if (dateFrom) conditions.push(gte(aiActionAudit.createdAt, dateFrom));
  if (dateTo) {
    const { lte } = await import("drizzle-orm");
    conditions.push(lte(aiActionAudit.createdAt, dateTo));
  }

  return db.select({
    actionType: aiActionAudit.actionType,
    count: sql<number>`count(*)`,
    totalCost: sql<number>`coalesce(sum(${aiActionAudit.costEstimate}::numeric), 0)`,
    totalTokensIn: sql<number>`coalesce(sum(${aiActionAudit.tokensIn}), 0)`,
    totalTokensOut: sql<number>`coalesce(sum(${aiActionAudit.tokensOut}), 0)`,
  }).from(aiActionAudit)
    .where(and(...conditions))
    .groupBy(aiActionAudit.actionType)
    .orderBy(sql`coalesce(sum(${aiActionAudit.costEstimate}::numeric), 0) DESC`);
}
