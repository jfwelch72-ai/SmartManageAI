// prompt-injection-guard: in-app estimator chat — message history is authenticated tenant authors; existing module flow extractDocumentContent → quarantineDocumentBlocks happens upstream in sheetIndex
// ai-router-bypass: ai-estimator-chat-claude-only-tool-use — chat uses callAnthropicWithTools directly; no OpenAI fallback by design (Task #2729)
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
import type { AiChatResponse } from "../../ai/providers";
import { callAnthropicWithTools } from "../../ai/providers/anthropicWithTools";
import {
  citationsFromRows,
  formatLessonsForPrompt,
  retrieveContext,
  retrieveLessons,
} from "./retrieval";
import { listLearnedRatesForOrgRanked, summarizeRate } from "./learnedRates";
import { processChatAttachments, type ChatAttachmentInput } from "./chatAttachments";
import {
  assertBidInOrg,
  assertEstimateInOrg,
  assertProjectInOrg,
} from "./access";
import { z } from "zod";
import { logWarn } from "../../utils/logger";

// ── Tool schemas for line-item mutations ─────────────────────────────────────
// Zod schemas used to validate Claude's tool inputs before packaging as
// proposed actions. Claude sees the corresponding JSON Schema in the tool
// definitions array passed on every chat turn.

export const addLineItemPayloadSchema = z.object({
  description: z.string().min(1),
  category: z.string().min(1),
  unit: z.string().min(1),
  quantity: z.number().positive(),
  materialCost: z.number().min(0).optional().default(0),
  laborCost: z.number().min(0).optional().default(0),
  equipmentCost: z.number().min(0).optional().default(0),
  subcontractCost: z.number().min(0).optional().default(0),
  notes: z.string().optional(),
});

export const editLineItemPayloadSchema = z.object({
  lineItemId: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().optional(),
  quantity: z.number().positive().optional(),
  materialCost: z.number().min(0).optional(),
  laborCost: z.number().min(0).optional(),
  equipmentCost: z.number().min(0).optional(),
  subcontractCost: z.number().min(0).optional(),
  notes: z.string().optional(),
});

export const deleteLineItemPayloadSchema = z.object({
  lineItemId: z.string().min(1),
  description: z.string().optional(),
  reason: z.string().optional(),
});

export type AddLineItemPayload = z.infer<typeof addLineItemPayloadSchema>;
export type EditLineItemPayload = z.infer<typeof editLineItemPayloadSchema>;
export type DeleteLineItemPayload = z.infer<typeof deleteLineItemPayloadSchema>;

export interface ProposedAction {
  toolCallId: string;
  action: "add" | "edit" | "delete";
  payload: AddLineItemPayload | EditLineItemPayload | DeleteLineItemPayload;
  validationError?: string;
  // Persisted server-side so cards survive a page refresh without re-applying.
  decision?: "applied" | "rejected";
  decisionAt?: string;
  // Snapshot stored at apply time so the undo endpoint can reverse the change.
  // Shape is action-dependent:
  //   add    → { lineItemId: string }
  //   edit   → { lineItemId: string; previousValues: Record<string, unknown> }
  //   delete → { previousData: Record<string, unknown> }
  undoSnapshot?: Record<string, unknown>;
}

// ── Anthropic tool definitions ───────────────────────────────────────────────

// Must match the `estimateItemCategoryEnum` in shared/schema/enums.ts exactly.
// normalizeLineItemData() in estimateRoutes.ts maps any unrecognised value to "GENERAL".
const ESTIMATE_ITEM_CATEGORIES = [
  "CONCRETE", "EXCAVATION", "PAVERS", "BOLLARDS", "GC", "OVERHEAD", "PROFIT", "GENERAL",
  "PLUMBING", "HVAC", "ROOFING", "STRUCTURAL_STEEL", "MASONRY", "DRYWALL", "PAINTING",
  "FLOORING", "FIRE_PROTECTION", "DEMOLITION", "CARPENTRY", "INSULATION", "WINDOWS_DOORS",
  "ELEVATOR", "GRADING", "PAVING", "SITEWORK", "WATERPROOFING", "MECHANICAL", "FRAMING",
  "STRIPING", "SIGNAGE", "LANDSCAPING", "ELECTRICAL", "OTHER", "METALS", "FINISHES",
];

const LINE_ITEM_TOOLS = [
  {
    name: "add_line_item",
    description:
      "Propose adding a new line item to the estimate. Use ONLY when the user clearly wants to add a new cost item. " +
      "Always accompany tool calls with a plain-text explanation of your reasoning.",
    input_schema: {
      type: "object" as const,
      properties: {
        description: { type: "string", description: "Brief description of the work item (e.g. 'Concrete footing 18\" deep')" },
        category: { type: "string", enum: ESTIMATE_ITEM_CATEGORIES, description: "Work category" },
        unit: { type: "string", description: "Unit of measure (SF, LF, CY, EA, LS, HR, etc.)" },
        quantity: { type: "number", description: "Quantity in the stated unit (must be positive)" },
        materialCost: { type: "number", description: "Total material cost in dollars (default 0)" },
        laborCost: { type: "number", description: "Total labor cost in dollars (default 0)" },
        equipmentCost: { type: "number", description: "Total equipment cost in dollars (default 0)" },
        subcontractCost: { type: "number", description: "Total subcontract cost in dollars (default 0)" },
        notes: { type: "string", description: "Optional notes explaining the cost breakdown" },
      },
      required: ["description", "category", "unit", "quantity"],
    },
  },
  {
    name: "edit_line_item",
    description:
      "Propose editing an existing line item. Use ONLY when the user wants to change an existing item " +
      "AND you can see its id in the ESTIMATE LINE ITEMS list. Only include fields you want to change.",
    input_schema: {
      type: "object" as const,
      properties: {
        lineItemId: { type: "string", description: "The id of the existing line item (from the [id:...] shown in ESTIMATE LINE ITEMS)" },
        description: { type: "string", description: "New description (omit to keep current)" },
        category: { type: "string", enum: ESTIMATE_ITEM_CATEGORIES, description: "New category (omit to keep current)" },
        unit: { type: "string", description: "New unit of measure (omit to keep current)" },
        quantity: { type: "number", description: "New quantity (omit to keep current)" },
        materialCost: { type: "number", description: "New material cost in dollars (omit to keep current)" },
        laborCost: { type: "number", description: "New labor cost in dollars (omit to keep current)" },
        equipmentCost: { type: "number", description: "New equipment cost in dollars (omit to keep current)" },
        subcontractCost: { type: "number", description: "New subcontract cost in dollars (omit to keep current)" },
        notes: { type: "string", description: "Notes explaining the change" },
      },
      required: ["lineItemId"],
    },
  },
  {
    name: "delete_line_item",
    description:
      "Propose deleting an existing line item. Use ONLY when the user clearly wants to remove an item " +
      "AND you can see its id in the ESTIMATE LINE ITEMS list.",
    input_schema: {
      type: "object" as const,
      properties: {
        lineItemId: { type: "string", description: "The id of the line item to delete (from the [id:...] shown in ESTIMATE LINE ITEMS)" },
        description: { type: "string", description: "Description of the item being deleted (for display)" },
        reason: { type: "string", description: "Reason for deletion" },
      },
      required: ["lineItemId"],
    },
  },
] as const;

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

export async function deleteSession(
  organizationId: string,
  sessionId: string,
): Promise<void> {
  // Delete messages explicitly first so callers don't depend on the DB-level
  // CASCADE being active in all migration states.
  await db
    .delete(aiEstimatorChatMessages)
    .where(eq(aiEstimatorChatMessages.sessionId, sessionId));
  // Delete the session. Org filter is the security boundary (RLS also enforces
  // this). We don't filter by userId so a user can clear any session that
  // belongs to their org — consistent with how listSessions works.
  await db
    .delete(aiEstimatorChatSessions)
    .where(
      and(
        eq(aiEstimatorChatSessions.organizationId, organizationId),
        eq(aiEstimatorChatSessions.id, sessionId),
      ),
    );
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
  proposedActions: ProposedAction[];
  blocked?: boolean;
  reason?: string;
}

export async function sendChatTurn(opts: {
  organizationId: string;
  userId: string;
  session: AiEstimatorChatSession;
  prompt: string;
  attachments?: ChatAttachmentInput[];
}): Promise<ChatTurnResult | { blocked: true; reason?: string }> {
  const trimmed = opts.prompt.trim();
  const incomingAttachments = opts.attachments ?? [];
  if (!trimmed && incomingAttachments.length === 0) throw new Error("Empty prompt");

  // Process attachments up-front (Whisper for audio, document extractor for
  // images/PDFs). Each objectPath is ACL-checked against the caller's
  // userId+organizationId before any download/extract/transcribe runs, so a
  // crafted /objects/<id> for another tenant's file is dropped at the gate.
  // All extracted text is wrapped in quarantineUserText so a hostile
  // filename/body can't escape the user envelope.
  const { stored: storedAttachments, promptBlock: attachmentPromptBlock } =
    await processChatAttachments(incomingAttachments, {
      userId: opts.userId,
      organizationId: opts.organizationId,
    });

  // If the user only attached files (no typed text), give the assistant a
  // sensible default prompt so it has something to react to.
  const effectivePrompt = trimmed
    ? trimmed
    : storedAttachments.length > 0
      ? "Please review the attached file(s) in the context of this estimate and tell me what's relevant, what's missing, or what I should do next."
      : trimmed;

  const [userMsg] = await db
    .insert(aiEstimatorChatMessages)
    .values({
      sessionId: opts.session.id,
      role: "user",
      content: effectivePrompt,
      citations: null,
      attachments: storedAttachments.length > 0 ? storedAttachments : null,
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
  // Include the id so Claude can reference it in edit/delete tool calls.
  const LINE_ITEM_CAP = 60;
  const [lineItems, [lineItemTotal, lineItemTotalCount], measurements] = await Promise.all([
    resolvedEstimateId
      ? db
          .select({
            id: estimateLineItems.id,
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
  // Drop the just-inserted user row from the history slice — we splice it back
  // in below as the final `user` turn (with the attachment block appended).
  const historyTurns = history
    .filter((m) => m.id !== userMsg.id)
    .slice(-10)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // Compose the final user turn: the typed prompt + a labeled block per
  // attachment (already quarantined in chatAttachments.ts).
  const finalUserContent = attachmentPromptBlock
    ? `${effectivePrompt}\n\n${attachmentPromptBlock}`
    : effectivePrompt;

  const sysPrompt = `You are "Ask the Estimator", an assistant with full visibility into this contractor's active bid and project data.
You are provided the LIVE state of the current bid, project, estimate line items, and takeoff measurements below — use them directly.
Answer using the provided live data, learned rates, and prior context. Never invent costs not in the rates table.
Cite source rows by id when relevant. Reply in plain prose with short bullet points.

LINE ITEM MUTATION TOOLS:
You have three tools: add_line_item, edit_line_item, and delete_line_item.
Use them ONLY when the user's intent is clearly to add, change, or remove an estimate line item.
Always write a plain-text explanation of your reasoning alongside any tool calls.
For edit and delete, use the [id:...] values shown in the ESTIMATE LINE ITEMS list.
If you're unsure what the user wants, ask a clarifying question instead of using a tool.
Do NOT use tools for general questions, analysis, or advice.`;

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
              `  - [id:${li.id}] [${li.category}] ${li.description}: qty=${li.quantity} ${li.unit}` +
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

  // Combine system content sections into a single system prompt string.
  const combinedSystemPrompt = [
    sysPrompt,
    liveEstimateBlock,
    ...(lessonsBlock ? [lessonsBlock] : []),
    contextBlock,
  ].join("\n\n---\n\n");

  // Build the Anthropic messages array (user/assistant turns only; system
  // content goes in the top-level system field).
  const anthropicMessages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...historyTurns,
    { role: "user", content: finalUserContent },
  ];

  // Ensure we start with a user turn (Anthropic requirement).
  if (anthropicMessages.length === 0 || anthropicMessages[0].role !== "user") {
    anthropicMessages.unshift({ role: "user", content: "Proceed." });
  }

  // ── Governance wrapper (quota check + audit) ────────────────────────────
  interface GovResult {
    textContent: string;
    proposedActionsRaw: Array<{ toolCallId: string; name: string; input: Record<string, unknown> }>;
    usage: { inputTokens: number; outputTokens: number };
    model: string;
  }

  const gov = await governedAiCall<GovResult | null>({
    orgId: opts.organizationId,
    userId: opts.userId,
    actionType: "ai_estimator.chat",
    inputRefs: { sessionId: opts.session.id, contextRowCount: contextRows.length },
    fn: async () => {
      const anthropicResult = await callAnthropicWithTools({
        systemPrompt: combinedSystemPrompt,
        messages: anthropicMessages,
        tools: LINE_ITEM_TOOLS as unknown as import("@anthropic-ai/sdk").Anthropic.Tool[],
        maxTokens: 2048,
      });

      // Build a synthetic AiChatResponse for the governance layer's metering.
      const syntheticCompletion: AiChatResponse = {
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: anthropicResult.textContent || null },
            finish_reason: null,
          },
        ],
        usage: {
          prompt_tokens: anthropicResult.usage.inputTokens,
          completion_tokens: anthropicResult.usage.outputTokens,
        },
        model: anthropicResult.model,
        provider: "anthropic",
        fallbackUsed: false,
        latencyMs: anthropicResult.latencyMs,
      };

      return {
        result: {
          textContent: anthropicResult.textContent,
          proposedActionsRaw: anthropicResult.toolUseBlocks.map((b) => ({
            toolCallId: b.id,
            name: b.name,
            input: b.input,
          })),
          usage: anthropicResult.usage,
          model: anthropicResult.model,
        },
        completion: syntheticCompletion,
      };
    },
  });

  if (gov.blocked) {
    return { blocked: true, reason: gov.reason };
  }

  const govResult = gov.result;
  const textContent = govResult?.textContent?.trim() || "I don't have enough information from your data to answer that yet.";

  // ── Parse and validate proposed actions from tool-use blocks ──────────────
  const proposedActions: ProposedAction[] = [];
  for (const raw of govResult?.proposedActionsRaw ?? []) {
    if (raw.name === "add_line_item") {
      const parsed = addLineItemPayloadSchema.safeParse(raw.input);
      if (parsed.success) {
        proposedActions.push({ toolCallId: raw.toolCallId, action: "add", payload: parsed.data });
      } else {
        logWarn("AI Estimator chat: add_line_item tool input failed validation", {
          toolCallId: raw.toolCallId,
          issues: parsed.error.issues,
        });
        proposedActions.push({
          toolCallId: raw.toolCallId,
          action: "add",
          payload: raw.input as AddLineItemPayload,
          validationError: parsed.error.issues.map((i) => i.message).join("; "),
        });
      }
    } else if (raw.name === "edit_line_item") {
      const parsed = editLineItemPayloadSchema.safeParse(raw.input);
      if (parsed.success) {
        proposedActions.push({ toolCallId: raw.toolCallId, action: "edit", payload: parsed.data });
      } else {
        logWarn("AI Estimator chat: edit_line_item tool input failed validation", {
          toolCallId: raw.toolCallId,
          issues: parsed.error.issues,
        });
        proposedActions.push({
          toolCallId: raw.toolCallId,
          action: "edit",
          payload: raw.input as EditLineItemPayload,
          validationError: parsed.error.issues.map((i) => i.message).join("; "),
        });
      }
    } else if (raw.name === "delete_line_item") {
      const parsed = deleteLineItemPayloadSchema.safeParse(raw.input);
      if (parsed.success) {
        proposedActions.push({ toolCallId: raw.toolCallId, action: "delete", payload: parsed.data });
      } else {
        logWarn("AI Estimator chat: delete_line_item tool input failed validation", {
          toolCallId: raw.toolCallId,
          issues: parsed.error.issues,
        });
        proposedActions.push({
          toolCallId: raw.toolCallId,
          action: "delete",
          payload: raw.input as DeleteLineItemPayload,
          validationError: parsed.error.issues.map((i) => i.message).join("; "),
        });
      }
    }
  }

  const [assistantMsg] = await db
    .insert(aiEstimatorChatMessages)
    .values({
      sessionId: opts.session.id,
      role: "assistant",
      content: textContent,
      citations: citationsFromRows(contextRows),
      proposedActions: proposedActions.length > 0 ? proposedActions : null,
    })
    .returning();
  await db
    .update(aiEstimatorChatSessions)
    .set({ updatedAt: new Date() })
    .where(eq(aiEstimatorChatSessions.id, opts.session.id));
  return { userMessage: userMsg, assistantMessage: assistantMsg, proposedActions };
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
