// prompt-injection-guard: in-app estimator chat — message history is authenticated tenant authors; existing module flow extractDocumentContent → quarantineDocumentBlocks happens upstream in sheetIndex
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  aiEstimatorChatMessages,
  aiEstimatorChatSessions,
  bids,
  estimates,
  estimateLineItems,
  projects,
  takeoffMeasurements,
  takeoffSheets,
  type AiEstimatorChatMessage,
  type AiEstimatorChatSession,
} from "@shared/schema";
import { governedAiCall } from "../aiGovernance";
// Task #2410 — Estimator chat is part of the Takeoff family routing decision.
import { routedChatCompletion } from "../../ai/providers";
import {
  citationsFromRows,
  formatLessonsForPrompt,
  retrieveContext,
  retrieveLessons,
} from "./retrieval";
import { listLearnedRatesForOrgRanked, summarizeRate } from "./learnedRates";
import {
  assertBidInOrg,
  assertEstimateInOrg,
  assertProjectInOrg,
} from "./access";

export async function listSessions(
  organizationId: string,
  userId: string,
): Promise<AiEstimatorChatSession[]> {
  return db
    .select()
    .from(aiEstimatorChatSessions)
    .where(
      and(
        eq(aiEstimatorChatSessions.organizationId, organizationId),
        eq(aiEstimatorChatSessions.userId, userId),
      ),
    )
    .orderBy(desc(aiEstimatorChatSessions.updatedAt))
    .limit(50);
}

export async function getSessionForUser(
  organizationId: string,
  userId: string,
  sessionId: string,
): Promise<AiEstimatorChatSession | null> {
  const [row] = await db
    .select()
    .from(aiEstimatorChatSessions)
    .where(
      and(
        eq(aiEstimatorChatSessions.organizationId, organizationId),
        eq(aiEstimatorChatSessions.userId, userId),
        eq(aiEstimatorChatSessions.id, sessionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createSession(opts: {
  organizationId: string;
  userId: string;
  bidId?: string | null;
  estimateId?: string | null;
  projectId?: string | null;
  title?: string | null;
}): Promise<AiEstimatorChatSession> {
  // Verify any cross-resource ids belong to this org before binding the
  // session — otherwise a session row could be used to coerce retrieval
  // against another tenant's data.
  if (opts.bidId) await assertBidInOrg(opts.bidId, opts.organizationId);
  if (opts.estimateId) await assertEstimateInOrg(opts.estimateId, opts.organizationId);
  if (opts.projectId) await assertProjectInOrg(opts.projectId, opts.organizationId);

  const [row] = await db
    .insert(aiEstimatorChatSessions)
    .values({
      organizationId: opts.organizationId,
      userId: opts.userId,
      bidId: opts.bidId ?? null,
      estimateId: opts.estimateId ?? null,
      projectId: opts.projectId ?? null,
      title: opts.title ?? "New conversation",
    })
    .returning();
  return row;
}

export async function listMessages(
  sessionId: string,
): Promise<AiEstimatorChatMessage[]> {
  return db
    .select()
    .from(aiEstimatorChatMessages)
    .where(eq(aiEstimatorChatMessages.sessionId, sessionId))
    .orderBy(asc(aiEstimatorChatMessages.createdAt));
}

export interface ChatTurnResult {
  userMessage: AiEstimatorChatMessage;
  assistantMessage: AiEstimatorChatMessage;
  blocked?: boolean;
  reason?: string;
}

export async function sendChatTurn(opts: {
  organizationId: string;
  userId: string;
  session: AiEstimatorChatSession;
  prompt: string;
}): Promise<ChatTurnResult | { blocked: true; reason?: string }> {
  const trimmed = opts.prompt.trim();
  if (!trimmed) throw new Error("Empty prompt");

  const [userMsg] = await db
    .insert(aiEstimatorChatMessages)
    .values({
      sessionId: opts.session.id,
      role: "user",
      content: trimmed,
      citations: null,
    })
    .returning();

  // ── Live bid / project / estimate data ─────────────────────────────────────
  // All fetched in parallel; each guard is the session FK that was already
  // verified by assertBidInOrg / assertEstimateInOrg during session creation.

  const [bidRow, projectRow] = await Promise.all([
    opts.session.bidId
      ? db
          .select({
            name: bids.name,
            code: bids.code,
            clientName: bids.clientName,
            status: bids.status,
            description: bids.description,
            locationAddress: bids.locationAddress,
            city: bids.city,
            state: bids.state,
            bidAmount: bids.bidAmount,
            dueDate: bids.dueDate,
          })
          .from(bids)
          .where(eq(bids.id, opts.session.bidId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    opts.session.projectId
      ? db
          .select({
            name: projects.name,
            code: projects.code,
            status: projects.status,
            description: projects.description,
            locationAddress: projects.locationAddress,
            city: projects.city,
            state: projects.state,
            budget: projects.budget,
            contractAmount: projects.contractAmount,
          })
          .from(projects)
          .where(eq(projects.id, opts.session.projectId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  // Resolve estimateId: use session value or discover it from the bid.
  let resolvedEstimateId = opts.session.estimateId;
  if (!resolvedEstimateId && opts.session.bidId) {
    const estRow = await db
      .select({ id: estimates.id, baseBidAmount: estimates.baseBidAmount, status: estimates.status })
      .from(estimates)
      .where(eq(estimates.bidId, opts.session.bidId))
      .orderBy(desc(estimates.versionNumber))
      .limit(1)
      .then((r) => r[0] ?? null);
    resolvedEstimateId = estRow?.id ?? null;
  }

  // Fetch estimate header (totals summary)
  const estimateHeader = resolvedEstimateId
    ? await db
        .select({ baseBidAmount: estimates.baseBidAmount, status: estimates.status, versionNumber: estimates.versionNumber })
        .from(estimates)
        .where(eq(estimates.id, resolvedEstimateId))
        .limit(1)
        .then((r) => r[0] ?? null)
    : null;

  // Fetch live estimate lines so the AI knows what's already been estimated.
  // Also compute the true DB total to avoid in-memory sum inaccuracy when
  // there are more than 60 line items (the truncated list would under-count).
  const LINE_ITEM_CAP = 60;
  const [lineItems, [lineItemTotal, lineItemTotalCount], measurements] = await Promise.all([
    resolvedEstimateId
      ? db
          .select({
            description: estimateLineItems.description,
            quantity: estimateLineItems.quantity,
            unit: estimateLineItems.unit,
            category: estimateLineItems.category,
            workTypeCode: estimateLineItems.workTypeCode,
            materialCost: estimateLineItems.materialCost,
            laborCost: estimateLineItems.laborCost,
            equipmentCost: estimateLineItems.equipmentCost,
            subcontractCost: estimateLineItems.subcontractCost,
            totalCost: estimateLineItems.totalCost,
          })
          .from(estimateLineItems)
          .where(
            and(
              eq(estimateLineItems.estimateId, resolvedEstimateId),
              isNull(estimateLineItems.deletedAt),
            ),
          )
          .limit(LINE_ITEM_CAP)
      : Promise.resolve([]),

    // DB aggregates: true subtotal + full count (both in one query to save a round-trip).
    resolvedEstimateId
      ? db
          .select({
            total: sql<string>`COALESCE(SUM(total_cost),0)`,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(estimateLineItems)
          .where(
            and(
              eq(estimateLineItems.estimateId, resolvedEstimateId),
              isNull(estimateLineItems.deletedAt),
            ),
          )
          .then((r) => [Number(r[0]?.total ?? 0), r[0]?.count ?? 0] as const)
      : Promise.resolve([0, 0] as const),

    // Fetch live takeoff measurements (joined through sheets to get bid scope).
    opts.session.bidId
      ? db
          .select({
            label: takeoffMeasurements.label,
            type: takeoffMeasurements.type,
            computedLengthFt: takeoffMeasurements.computedLengthFt,
            computedAreaFt2: takeoffMeasurements.computedAreaFt2,
            computedVolumeCy: takeoffMeasurements.computedVolumeCy,
            count: takeoffMeasurements.count,
          })
          .from(takeoffMeasurements)
          .innerJoin(takeoffSheets, eq(takeoffMeasurements.sheetId, takeoffSheets.id))
          .where(eq(takeoffSheets.bidId, opts.session.bidId))
          .limit(40)
      : Promise.resolve([]),
  ]);

  const contextRows = await retrieveContext({
    organizationId: opts.organizationId,
    query: trimmed,
    bidId: opts.session.bidId ?? undefined,
    projectId: opts.session.projectId ?? undefined,
    limit: 8,
  });

  // Task #2415 — pull qualitative lessons (org-wide + chat-surface scoped).
  // Best-effort: failures must not break the chat turn.
  let lessonRows: Awaited<ReturnType<typeof retrieveLessons>> = [];
  try {
    lessonRows = await retrieveLessons({
      organizationId: opts.organizationId,
      surface: "chat_answer",
      limit: 8,
    });
  } catch {
    lessonRows = [];
  }

  // Rank learned rates so codes matching the current estimate's line items
  // surface first; fill remaining slots alphabetically.
  const activeCostCodes = lineItems
    .map((li) => li.workTypeCode)
    .filter((c): c is string => typeof c === "string" && c.length > 0);
  const rates = await listLearnedRatesForOrgRanked(opts.organizationId, activeCostCodes);
  const rateSummary = rates.slice(0, 30).map((r) => ({
    costCode: r.costCode,
    metric: r.metric,
    unit: r.unit,
    ...summarizeRate(r),
  }));

  const history = await listMessages(opts.session.id);
  const historyTurns = history
    .slice(-10)
    .map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content }));

  const sysPrompt = `You are "Ask the Estimator", an assistant with full visibility into this contractor's active bid and project data.
You are provided the LIVE state of the current bid, project, estimate line items, and takeoff measurements below — use them directly.
Answer using the provided live data, learned rates, and prior context. Never invent costs not in the rates table.
Cite source rows by id when relevant. Reply in plain prose with short bullet points.`;

  // ── Build the live-context block injected before every turn ──────────────
  const parts: string[] = [];

  if (bidRow) {
    const loc = [bidRow.locationAddress, bidRow.city, bidRow.state].filter(Boolean).join(", ");
    const due = bidRow.dueDate ? new Date(bidRow.dueDate).toLocaleDateString() : null;
    parts.push(
      `ACTIVE BID:\n` +
        `  Name: ${bidRow.name}\n` +
        `  Code: ${bidRow.code}\n` +
        `  Client: ${bidRow.clientName}\n` +
        `  Status: ${bidRow.status}\n` +
        (loc ? `  Location: ${loc}\n` : "") +
        (bidRow.bidAmount ? `  Bid amount: $${Number(bidRow.bidAmount).toLocaleString()}\n` : "") +
        (due ? `  Due: ${due}\n` : "") +
        (bidRow.description ? `  Scope: ${bidRow.description.slice(0, 400)}\n` : ""),
    );
  }

  if (projectRow) {
    const loc = [projectRow.locationAddress, projectRow.city, projectRow.state].filter(Boolean).join(", ");
    parts.push(
      `LINKED PROJECT:\n` +
        `  Name: ${projectRow.name}\n` +
        `  Code: ${projectRow.code}\n` +
        `  Status: ${projectRow.status}\n` +
        (loc ? `  Location: ${loc}\n` : "") +
        (projectRow.contractAmount ? `  Contract: $${Number(projectRow.contractAmount).toLocaleString()}\n` : "") +
        (projectRow.budget ? `  Budget: $${Number(projectRow.budget).toLocaleString()}\n` : "") +
        (projectRow.description ? `  Description: ${projectRow.description.slice(0, 300)}\n` : ""),
    );
  }

  if (estimateHeader) {
    parts.push(
      `ESTIMATE SUMMARY:\n` +
        `  Version: v${estimateHeader.versionNumber}  Status: ${estimateHeader.status}\n` +
        (estimateHeader.baseBidAmount
          ? `  Base bid amount: $${Number(estimateHeader.baseBidAmount).toLocaleString()}\n`
          : ""),
    );
  }

  if (lineItems.length > 0) {
    const truncated = lineItems.length === LINE_ITEM_CAP && lineItemTotalCount > LINE_ITEM_CAP;
    const header = truncated
      ? `ESTIMATE LINE ITEMS (showing ${LINE_ITEM_CAP} of ${lineItemTotalCount} items — list truncated, true subtotal $${lineItemTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} reflects all items in DB):`
      : `ESTIMATE LINE ITEMS (${lineItems.length} items, subtotal $${lineItemTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}):`;
    parts.push(
      `${header}\n` +
        lineItems
          .map(
            (li) =>
              `  - [${li.category}] ${li.description}: qty=${li.quantity} ${li.unit}` +
              ` | mat=$${Number(li.materialCost ?? 0).toFixed(2)}` +
              ` labor=$${Number(li.laborCost ?? 0).toFixed(2)}` +
              (Number(li.equipmentCost ?? 0) > 0 ? ` equip=$${Number(li.equipmentCost).toFixed(2)}` : "") +
              (Number(li.subcontractCost ?? 0) > 0 ? ` sub=$${Number(li.subcontractCost).toFixed(2)}` : "") +
              ` total=$${Number(li.totalCost).toFixed(2)}`,
          )
          .join("\n"),
    );
  } else {
    parts.push("ESTIMATE LINE ITEMS: None added yet.");
  }

  if (measurements.length > 0) {
    parts.push(
      `TAKEOFF MEASUREMENTS (${measurements.length} items):\n` +
        measurements
          .map((m) => {
            const qty =
              m.type === "LINEAR"
                ? `${(m.computedLengthFt ?? 0).toFixed(1)} LF`
                : m.type === "AREA"
                  ? `${(m.computedAreaFt2 ?? 0).toFixed(1)} SF`
                  : m.type === "VOLUME"
                    ? `${(m.computedVolumeCy ?? 0).toFixed(1)} CY`
                    : m.type === "COUNT"
                      ? `count=${m.count ?? "?"}`
                      : "";
            return `  - [${m.type}] ${m.label}: ${qty}`;
          })
          .join("\n"),
    );
  } else {
    parts.push("TAKEOFF MEASUREMENTS: None recorded yet.");
  }

  const liveEstimateBlock = parts.join("\n\n");

  const lessonsBlock = formatLessonsForPrompt(lessonRows);

  const contextSection = contextRows.length > 0
    ? contextRows
        .map(
          (r) =>
            // Task #2414 — surface the Claude-written narrative when the
            // enrichment pass produced one; fall back to the mechanical
            // snippet so orgs without AI_PROVIDER_TAKEOFF (or rows whose
            // enrichment hasn't run yet) keep the prior behaviour.
            `- [${r.sourceType}#${r.sourceId.slice(0, 8)}] ${r.title}\n  ${(r.enrichedSummary ?? r.contentSnippet).slice(0, 280)}`,
        )
        .join("\n")
    : "No prior bid history found in the knowledge index.";

  const rateSection = rateSummary.length > 0
    ? rateSummary
        .map(
          (r) =>
            `- ${r.costCode} (${r.metric}, ${r.unit}): point=${r.point ?? "?"} range=${r.range.low ?? "?"}-${r.range.high ?? "?"} n=${r.n}`,
        )
        .join("\n")
    : "No learned rates on file for this organization.";

  const contextBlock = `Context:\n${contextSection}\n\nLearned rates (most-relevant 30):\n${rateSection}`;

  const gov = await governedAiCall<string | null>({
    orgId: opts.organizationId,
    userId: opts.userId,
    actionType: "ai_estimator.chat",
    inputRefs: { sessionId: opts.session.id, contextRowCount: contextRows.length },
    fn: async () => {
      const completion = await routedChatCompletion({
        orgId: opts.organizationId,
        featureKey: "ai_estimator.chat",
        request: {
          messages: [
            { role: "system", content: sysPrompt },
            { role: "system", content: liveEstimateBlock },
            ...(lessonsBlock
              ? ([{ role: "system", content: lessonsBlock }] as const)
              : []),
            { role: "system", content: contextBlock },
            ...historyTurns,
            { role: "user", content: trimmed },
          ],
          max_completion_tokens: 1500,
        },
      });
      return { result: completion.choices[0]?.message?.content ?? null, completion };
    },
  });

  if (gov.blocked) {
    return { blocked: true, reason: gov.reason };
  }

  const answer = gov.result?.trim() || "I don't have enough information from your data to answer that yet.";
  const [assistantMsg] = await db
    .insert(aiEstimatorChatMessages)
    .values({
      sessionId: opts.session.id,
      role: "assistant",
      content: answer,
      citations: citationsFromRows(contextRows),
    })
    .returning();
  await db
    .update(aiEstimatorChatSessions)
    .set({ updatedAt: new Date() })
    .where(eq(aiEstimatorChatSessions.id, opts.session.id));
  return { userMessage: userMsg, assistantMessage: assistantMsg };
}

export async function setMessageFeedback(
  sessionId: string,
  messageId: string,
  outcome: "THUMBS_UP" | "THUMBS_DOWN" | null,
): Promise<void> {
  await db
    .update(aiEstimatorChatMessages)
    .set({ feedbackOutcome: outcome })
    .where(
      and(
        eq(aiEstimatorChatMessages.id, messageId),
        eq(aiEstimatorChatMessages.sessionId, sessionId),
      ),
    );
}
