import { db } from "../db";
import { crmOpportunities, crmOpportunityActivities, bids, type CrmOpportunity } from "@shared/schema";
import { eq, and, sql, count } from "drizzle-orm";
import { openai, AI_MODEL_GPT4O } from "./openaiClient";

interface WinProbabilityResult {
  score: number;
  rationale: string;
}

export async function scoreWinProbability(opportunityId: string): Promise<WinProbabilityResult> {
  const [opp] = await db
    .select()
    .from(crmOpportunities)
    .where(eq(crmOpportunities.id, opportunityId))
    .limit(1);

  if (!opp) {
    throw new Error(`Opportunity ${opportunityId} not found`);
  }

  const activities = await db
    .select({
      id: crmOpportunityActivities.id,
      activityType: crmOpportunityActivities.activityType,
      createdAt: crmOpportunityActivities.createdAt,
    })
    .from(crmOpportunityActivities)
    .where(eq(crmOpportunityActivities.opportunityId, opportunityId));

  const activityCount = activities.length;
  const latestActivity = activities.length > 0
    ? activities.reduce((latest, act) =>
        new Date(act.createdAt) > new Date(latest.createdAt) ? act : latest
      )
    : null;
  const daysSinceLastActivity = latestActivity
    ? Math.floor((Date.now() - new Date(latestActivity.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const daysInPipeline = Math.floor(
    (Date.now() - new Date(opp.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  const orgId = opp.organizationId;
  const [wonStats] = await db
    .select({ cnt: count() })
    .from(crmOpportunities)
    .where(and(
      eq(crmOpportunities.organizationId, orgId),
      eq(crmOpportunities.stage, "WON")
    ));
  const [lostStats] = await db
    .select({ cnt: count() })
    .from(crmOpportunities)
    .where(and(
      eq(crmOpportunities.organizationId, orgId),
      eq(crmOpportunities.stage, "LOST")
    ));

  const historicalWins = Number(wonStats?.cnt ?? 0);
  const historicalLosses = Number(lostStats?.cnt ?? 0);
  const totalClosed = historicalWins + historicalLosses;
  const historicalWinRate = totalClosed > 0 ? Math.round((historicalWins / totalClosed) * 100) : 50;

  const dealAttributes = {
    name: opp.name,
    stage: opp.stage,
    dealValue: opp.dealValue,
    projectType: opp.projectType,
    source: opp.source,
    daysInPipeline,
    activityCount,
    daysSinceLastActivity,
    hasAssignedRep: !!opp.assignedToId,
    hasContact: !!opp.contactId,
    hasOrganization: !!opp.crmOrganisationId,
    expectedCloseDate: opp.expectedCloseDate,
    historicalWinRate,
    historicalWins,
    historicalLosses,
  };

  try {
    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT4O,
      messages: [
        {
          role: "system",
          content: `You are a CRM deal scoring assistant for a construction company. Analyze the deal attributes and return a JSON object with:
- "score": integer 0-100 representing win probability percentage
- "rationale": a short phrase (max 80 chars) explaining the score, e.g. "Strong: active engagement, similar past wins" or "At risk: no activity in 30+ days, early stage"

Scoring factors to consider:
- Pipeline stage (later stages = higher probability)
- Activity level and recency (more recent engagement = higher)
- Deal value relative to typical deals
- Days in pipeline (too long can indicate stalled deals)
- Historical win rate for this organization
- Whether key fields are populated (contact, org, assigned rep)
- Project type and source quality

Stage base probabilities: LEAD=10, QUALIFIED=25, ESTIMATING=40, BID_SUBMITTED=60, NEGOTIATION=75, WON=100, LOST=0
Adjust up/down from the base based on other factors.

Respond ONLY with valid JSON: {"score": <number>, "rationale": "<string>"}`
        },
        {
          role: "user",
          content: `Score this deal:\n${JSON.stringify(dealAttributes, null, 2)}`
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 200,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("No response from OpenAI");

    const parsed = JSON.parse(content);
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
    const rationale = String(parsed.rationale || "AI-scored").substring(0, 200);

    await db
      .update(crmOpportunities)
      .set({
        aiWinProbability: score,
        aiWinProbabilityRationale: rationale,
        updatedAt: new Date(),
      })
      .where(eq(crmOpportunities.id, opportunityId));

    await syncBidWinProbability(opportunityId, score);

    return { score, rationale };
  } catch (error) {
    console.error("[Win Probability] AI scoring failed, using heuristic fallback:", error);
    return heuristicScore(opp, activityCount, daysSinceLastActivity, daysInPipeline, historicalWinRate);
  }
}

async function heuristicScore(
  opp: CrmOpportunity,
  activityCount: number,
  daysSinceLastActivity: number | null,
  daysInPipeline: number,
  historicalWinRate: number,
): Promise<WinProbabilityResult> {
  const stageBase: Record<string, number> = {
    LEAD: 10, QUALIFIED: 25, ESTIMATING: 40,
    BID_SUBMITTED: 60, NEGOTIATION: 75, WON: 100, LOST: 0,
  };

  let score = stageBase[opp.stage] ?? 10;

  if (activityCount > 5) score += 5;
  if (activityCount > 10) score += 5;
  if (daysSinceLastActivity !== null && daysSinceLastActivity > 30) score -= 10;
  if (daysSinceLastActivity !== null && daysSinceLastActivity < 7) score += 5;
  if (daysInPipeline > 90) score -= 5;
  if (historicalWinRate > 60) score += 5;
  if (historicalWinRate < 30) score -= 5;

  score = Math.max(0, Math.min(100, score));

  const reasons: string[] = [];
  if (activityCount > 5) reasons.push("active engagement");
  if (daysSinceLastActivity !== null && daysSinceLastActivity > 30) reasons.push("stale - no recent activity");
  if (daysSinceLastActivity !== null && daysSinceLastActivity < 7) reasons.push("recent activity");
  if (daysInPipeline > 90) reasons.push("long time in pipeline");
  if (historicalWinRate > 60) reasons.push("strong historical win rate");
  const rationale = reasons.length > 0 ? reasons.join(", ") : "Based on pipeline stage";

  try {
    await db.update(crmOpportunities)
      .set({
        aiWinProbability: score,
        aiWinProbabilityRationale: `Heuristic: ${rationale}`,
        updatedAt: new Date(),
      })
      .where(eq(crmOpportunities.id, opp.id));
  } catch (err) {
    console.error("[Win Probability] Failed to save heuristic score:", err);
  }

  await syncBidWinProbability(opp.id, score);

  return { score, rationale: `Heuristic: ${rationale}` };
}

async function syncBidWinProbability(opportunityId: string, score: number): Promise<void> {
  try {
    await db
      .update(bids)
      .set({ aiWinProbability: score })
      .where(eq(bids.crmOpportunityId, opportunityId));
  } catch (err) {
    console.error("[Win Probability] Failed to sync score to linked bids:", err);
  }
}
