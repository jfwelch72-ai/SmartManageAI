import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  aiEstimatorChatMessages,
  aiEstimatorChatSessions,
  type AiEstimatorChatMessage,
  type AiEstimatorChatSession,
} from "@shared/schema";
import { openai, AI_MODEL_GPT5 } from "../../ai/openaiClient";
import { governedAiCall } from "../aiGovernance";
import { citationsFromRows, retrieveContext } from "./retrieval";
import { listLearnedRatesForOrg, summarizeRate } from "./learnedRates";
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

  const contextRows = await retrieveContext({
    organizationId: opts.organizationId,
    query: trimmed,
    bidId: opts.session.bidId ?? undefined,
    projectId: opts.session.projectId ?? undefined,
    limit: 8,
  });

  const rates = await listLearnedRatesForOrg(opts.organizationId);
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

  const sysPrompt = `You are "Ask the Estimator", an assistant scoped strictly to this contractor's own AI Estimator workspace.
Answer using ONLY the provided context (org's bids, estimates, takeoffs, learned rates) and prior chat turns.
If the answer is not in the context, say so plainly. Never invent costs that aren't in the rates table.
Cite the source rows you used by their id when relevant. Reply in plain prose with short bullet points.`;
  const contextBlock = `Context:\n` +
    contextRows
      .map(
        (r) =>
          `- [${r.sourceType}#${r.sourceId.slice(0, 8)}] ${r.title}\n  ${r.contentSnippet.slice(0, 280)}`,
      )
      .join("\n") +
    `\n\nLearned rates (most-relevant 30):\n` +
    rateSummary
      .map(
        (r) =>
          `- ${r.costCode} (${r.metric}, ${r.unit}): point=${r.point ?? "?"} range=${r.range.low ?? "?"}-${r.range.high ?? "?"} n=${r.n}`,
      )
      .join("\n");

  const gov = await governedAiCall<string | null>({
    orgId: opts.organizationId,
    userId: opts.userId,
    actionType: "ai_estimator.chat",
    inputRefs: { sessionId: opts.session.id, contextRowCount: contextRows.length },
    fn: async () => {
      const completion = await openai.chat.completions.create({
        model: AI_MODEL_GPT5,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "system", content: contextBlock },
          ...historyTurns,
          { role: "user", content: trimmed },
        ],
        max_completion_tokens: 1500,
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
