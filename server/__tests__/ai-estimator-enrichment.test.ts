// Task #2419 — Automated coverage for the post-ingestion Claude
// enrichment pass introduced in Task #2414.
//
// Pins the four behavioural contracts:
//   1. Only changed knowledge-index rows are enriched.
//   2. A re-run with no data changes calls the enrichment provider zero
//      times (idempotency via contentHash).
//   3. When the enrichment provider throws, the ingest still completes
//      SUCCEEDED, the row's enrichedSummary stays null, and the in-memory
//      failure counter is incremented (surfaced via the success log).
//   4. `knowledgeRowBody` (the retrieval prompt body) prefers the
//      enriched summary when present and falls back to the snippet.
//
// `routedChatCompletion` is mocked at the module boundary so this file
// never hits Anthropic. `governedAiCall` is bypassed so the assertions
// don't depend on per-org governance fixtures, and `isFeatureEnabled`
// is forced on so the gate doesn't short-circuit the pass.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { sql, eq, and } from "drizzle-orm";
import bcrypt from "bcrypt";

vi.mock("../ai/providers", () => ({
  routedChatCompletion: vi.fn(),
}));

vi.mock("../services/aiGovernance", () => ({
  governedAiCall: vi.fn(async (opts: { fn: () => Promise<{ result: unknown }> }) => {
    const { result } = await opts.fn();
    return { result };
  }),
}));

vi.mock("../services/featureFlagService", () => ({
  isFeatureEnabled: vi.fn(async () => true),
}));

import * as logger from "../utils/logger";
import { db } from "../db";
import {
  organizations,
  users,
  bids,
  estimates,
  estimateLineItems,
  aiEstimatorKnowledgeIndex,
  type AiEstimatorKnowledgeIndex,
} from "@shared/schema";
import { routedChatCompletion } from "../ai/providers";
import { isFeatureEnabled } from "../services/featureFlagService";
import { runIngestion } from "../services/aiEstimator/ingestion";
import { knowledgeRowBody } from "../services/aiEstimator/retrieval";

const PREFIX = "__ai_est_enrich__";

const mockedRouted = routedChatCompletion as unknown as ReturnType<typeof vi.fn>;
const mockedFlag = isFeatureEnabled as unknown as ReturnType<typeof vi.fn>;

function fakeCompletion(text: string) {
  return {
    provider: "anthropic" as const,
    model: "claude-test",
    latencyMs: 1,
    choices: [{ message: { role: "assistant", content: text } }],
  };
}

interface Ctx {
  orgId: string;
  userId: string;
  bidId: string;
  estimateId: string;
  lineItemIds: string[];
}
let ctx: Ctx;

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM ai_estimator_knowledge_index WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_ingest_runs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_learned_rates WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM estimate_line_items WHERE estimate_id IN (SELECT id FROM estimates WHERE bid_id IN (SELECT id FROM bids WHERE code LIKE ${PREFIX + "%"}))`).catch(() => {});
  await db.execute(sql`DELETE FROM estimates WHERE bid_id IN (SELECT id FROM bids WHERE code LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM bids WHERE code LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}`).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [org] = await db
    .insert(organizations)
    .values({
      name: "Enrichment Org",
      slug: `${PREFIX}${stamp}`,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();

  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const [user] = await db
    .insert(users)
    .values({
      email: `${PREFIX}u-${stamp}@test.local`,
      passwordHash,
      firstName: "AI",
      lastName: "User",
      role: "ESTIMATOR",
      organizationId: org.id,
      isActive: true,
    })
    .returning();

  const [bid] = await db
    .insert(bids)
    .values({
      name: "Enrichment Bid",
      code: `${PREFIX}B-${stamp}`,
      clientName: "Client",
      gcOrganizationId: org.id,
    })
    .returning();

  const [est] = await db
    .insert(estimates)
    .values({
      bidId: bid.id,
      baseBidAmount: "10000",
      createdById: user.id,
    })
    .returning();

  const items = await db
    .insert(estimateLineItems)
    .values([
      {
        estimateId: est.id,
        category: "CONCRETE",
        description: "Slab on grade",
        workTypeCode: "03 30 00",
        quantity: "100",
        unit: "CY",
        totalCost: "15000",
        laborHours: "8",
      },
      {
        estimateId: est.id,
        category: "CONCRETE",
        description: "Footings",
        workTypeCode: "03 31 00",
        quantity: "50",
        unit: "CY",
        totalCost: "10000",
        laborHours: "4",
      },
    ])
    .returning();

  ctx = {
    orgId: org.id,
    userId: user.id,
    bidId: bid.id,
    estimateId: est.id,
    lineItemIds: items.map((i) => i.id),
  };
}, 60_000);

beforeEach(() => {
  mockedRouted.mockReset();
  mockedFlag.mockReset();
  mockedFlag.mockResolvedValue(true);
});

afterAll(async () => {
  await cleanup();
  vi.restoreAllMocks();
});

async function countEnriched(): Promise<number> {
  const rows = await db
    .select({ id: aiEstimatorKnowledgeIndex.id })
    .from(aiEstimatorKnowledgeIndex)
    .where(
      and(
        eq(aiEstimatorKnowledgeIndex.organizationId, ctx.orgId),
        sql`${aiEstimatorKnowledgeIndex.enrichedSummary} IS NOT NULL`,
      ),
    );
  return rows.length;
}

describe("enrichment pass — only changed rows are enriched", () => {
  it("calls Claude once per changed row and persists the narrative", async () => {
    mockedRouted.mockImplementation(async () => fakeCompletion("Narrative for this row."));

    const run = await runIngestion(ctx.orgId, null, "MANUAL");
    expect(run.status).toBe("SUCCEEDED");
    // Every indexed row that just got created/changed should be enriched.
    const enrichedDbCount = await countEnriched();
    expect(run.rowsEnriched).toBe(enrichedDbCount);
    expect(run.rowsEnriched).toBeGreaterThan(0);
    expect(mockedRouted).toHaveBeenCalledTimes(run.rowsEnriched);

    // Each persisted row's enrichedSummary matches the canned text.
    const rows = await db
      .select()
      .from(aiEstimatorKnowledgeIndex)
      .where(eq(aiEstimatorKnowledgeIndex.organizationId, ctx.orgId));
    for (const r of rows) {
      expect(r.enrichedSummary).toBe("Narrative for this row.");
      expect(r.enrichedAt).not.toBeNull();
    }
  });

  it("skips the enrichment provider when nothing changed (idempotency via contentHash)", async () => {
    // Clear the index so the first run definitely sees changed rows
    // regardless of what previous tests in this file already enriched.
    await db.execute(sql`DELETE FROM ai_estimator_knowledge_index WHERE organization_id = ${ctx.orgId}`);

    // First run primes everything.
    mockedRouted.mockImplementation(async () => fakeCompletion("First-pass narrative."));
    const first = await runIngestion(ctx.orgId, null, "MANUAL");
    expect(first.status).toBe("SUCCEEDED");
    expect(first.rowsEnriched).toBeGreaterThan(0);

    // Second run with no data changes must NOT touch the provider.
    mockedRouted.mockReset();
    mockedRouted.mockImplementation(async () => fakeCompletion("Should not be called."));
    const second = await runIngestion(ctx.orgId, null, "MANUAL");
    expect(second.status).toBe("SUCCEEDED");
    expect(second.rowsEnriched).toBe(0);
    expect(mockedRouted).not.toHaveBeenCalled();

    // And the prior summaries are preserved (not overwritten with null).
    const rows = await db
      .select()
      .from(aiEstimatorKnowledgeIndex)
      .where(eq(aiEstimatorKnowledgeIndex.organizationId, ctx.orgId));
    for (const r of rows) {
      expect(r.enrichedSummary).toBe("First-pass narrative.");
    }
  });
});

describe("enrichment pass — provider failures are non-fatal", () => {
  it("when the provider throws, the ingest still SUCCEEDS, summaries stay null, and the failure counter is incremented", async () => {
    // Force every row to be "changed" again by clearing the index.
    await db.execute(sql`DELETE FROM ai_estimator_knowledge_index WHERE organization_id = ${ctx.orgId}`);

    // Spy on logInfo so we can read the in-memory rowsEnrichmentFailed
    // counter (it's intentionally not persisted to the runs table).
    const infoSpy = vi.spyOn(logger, "logInfo").mockImplementation(() => {});

    mockedRouted.mockImplementation(async () => {
      throw new Error("simulated provider outage");
    });

    const run = await runIngestion(ctx.orgId, null, "MANUAL");
    expect(run.status).toBe("SUCCEEDED");
    expect(run.rowsEnriched).toBe(0);

    // Provider was reached for each changed row — but every call threw,
    // so no row got an enrichedSummary.
    const enrichedDbCount = await countEnriched();
    expect(enrichedDbCount).toBe(0);

    // Find the success log entry that carries the in-memory counters.
    const completionCall = infoSpy.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("ingestion completed"),
    );
    expect(completionCall).toBeDefined();
    const counters = completionCall![1] as Record<string, unknown>;
    expect(counters.rowsEnriched).toBe(0);
    expect(counters.rowsEnrichmentFailed).toBeGreaterThan(0);
    expect(counters.rowsEnrichmentFailed).toBe(counters.changedRowCount);

    infoSpy.mockRestore();
  });

  it("honours the AI_ESTIMATOR_ENRICHMENT_MAX_PER_RUN cap and skips the rest", async () => {
    await db.execute(sql`DELETE FROM ai_estimator_knowledge_index WHERE organization_id = ${ctx.orgId}`);
    const prev = process.env.AI_ESTIMATOR_ENRICHMENT_MAX_PER_RUN;
    process.env.AI_ESTIMATOR_ENRICHMENT_MAX_PER_RUN = "1";
    const infoSpy = vi.spyOn(logger, "logInfo").mockImplementation(() => {});
    try {
      mockedRouted.mockImplementation(async () => fakeCompletion("Capped narrative."));
      const run = await runIngestion(ctx.orgId, null, "MANUAL");
      expect(run.status).toBe("SUCCEEDED");
      // Cap of 1 means at most one provider call regardless of how many rows changed.
      expect(mockedRouted).toHaveBeenCalledTimes(1);
      expect(run.rowsEnriched).toBe(1);

      const completionCall = infoSpy.mock.calls.find(
        (c) => typeof c[0] === "string" && (c[0] as string).includes("ingestion completed"),
      );
      const counters = completionCall![1] as Record<string, unknown>;
      // Everything beyond the cap is reported as skipped, not failed.
      expect(counters.rowsEnrichmentSkipped).toBe(
        (counters.changedRowCount as number) - 1,
      );
      expect(counters.rowsEnrichmentFailed).toBe(0);
    } finally {
      infoSpy.mockRestore();
      if (prev === undefined) delete process.env.AI_ESTIMATOR_ENRICHMENT_MAX_PER_RUN;
      else process.env.AI_ESTIMATOR_ENRICHMENT_MAX_PER_RUN = prev;
    }
  });

  it("when the AI_PROVIDER_TAKEOFF flag is off, the provider is never called and rows are skipped", async () => {
    await db.execute(sql`DELETE FROM ai_estimator_knowledge_index WHERE organization_id = ${ctx.orgId}`);
    mockedFlag.mockResolvedValue(false);
    mockedRouted.mockImplementation(async () => fakeCompletion("Should not be called."));

    const run = await runIngestion(ctx.orgId, null, "MANUAL");
    expect(run.status).toBe("SUCCEEDED");
    expect(run.rowsEnriched).toBe(0);
    expect(mockedRouted).not.toHaveBeenCalled();
  });
});

function makeKnowledgeRow(
  overrides: Partial<AiEstimatorKnowledgeIndex>,
): AiEstimatorKnowledgeIndex {
  const now = new Date();
  return {
    id: "row-id",
    organizationId: "org-id",
    sourceType: "estimate_line_item",
    sourceId: "src-id",
    bidId: null,
    projectId: null,
    costCode: null,
    tradeType: null,
    title: "Test row",
    contentSnippet: "Mechanical snippet.",
    tags: null,
    numericFacets: null,
    indexedAt: now,
    contentHash: null,
    enrichedSummary: null,
    enrichedAt: null,
    lessonScope: null,
    lessonStatus: null,
    lessonSurface: null,
    supersedesRowId: null,
    derivedFromFeedbackIds: null,
    ...overrides,
  };
}

describe("retrieval — knowledgeRowBody prefers enriched summary", () => {
  it("returns the enrichedSummary when set", () => {
    const row = makeKnowledgeRow({ enrichedSummary: "Claude-written narrative." });
    expect(knowledgeRowBody(row)).toBe("Claude-written narrative.");
  });

  it("falls back to the contentSnippet when enrichedSummary is null", () => {
    const row = makeKnowledgeRow({ enrichedSummary: null });
    expect(knowledgeRowBody(row)).toBe("Mechanical snippet.");
  });

  it("falls back when enrichedSummary is empty/whitespace", () => {
    const row = makeKnowledgeRow({ enrichedSummary: "   " });
    expect(knowledgeRowBody(row)).toBe("Mechanical snippet.");
  });
});
