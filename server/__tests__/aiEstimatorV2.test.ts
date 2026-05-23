/**
 * Task #3036 / Task #3039 — Guard the V2.0 estimating engine output format.
 *
 * These tests verify that all three V2.0 call sites:
 *   • generateDraftEstimate   (draftEstimate.ts)
 *   • draftTakeoffFromPlans   (takeoffDraft.ts)
 *   • mapReduceDraftFromPlans (mapReduceDraft.ts → reduceDisciplineBatch)
 *
 * (a) inject the V2.0 system prompt into messages[0].content,
 * (b) pass temperature:0 to routedChatCompletion,
 * (c) include the web_search_20250305 tool in the tools array, and
 * (d) correctly forward Phase 6 fields (conflictLog, scopeGapLog, etc.)
 *     from the AI response to DraftEstimateResult — and correctly omit
 *     them (no undefined-key pollution) when the AI omits them.
 *
 * All external I/O (DB aside) is mocked. DB fixtures are shared across the
 * three describe blocks to keep setup minimal.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { sql, eq } from "drizzle-orm";

vi.mock("../ai/providers", () => ({
  routedChatCompletion: vi.fn(),
}));

vi.mock("../services/aiGovernance", () => ({
  governedAiCall: vi.fn(async (opts: { fn: () => Promise<{ result: unknown; completion?: unknown }> }) => {
    const out = await opts.fn();
    return { result: out.result };
  }),
}));

vi.mock("../ai/documentExtractor", () => ({
  extractDocumentContent: vi.fn(async () => [
    { type: "text", text: "Concrete slab 1200 SF at elevation 100.5" },
  ]),
  extractPageTextsFromUrl: vi.fn(async () => ({ pages: {} })),
}));

vi.mock("../services/aiEstimator/retrieval", () => ({
  retrieveContext: vi.fn(async () => []),
  retrieveLessons: vi.fn(async () => []),
  citationsFromRows: vi.fn(() => []),
  formatLessonsForPrompt: vi.fn(() => ""),
}));

vi.mock("../services/aiEstimator/learnedRates", () => ({
  listLearnedRatesForOrg: vi.fn(async () => []),
  summarizeRate: vi.fn(() => ({})),
}));

vi.mock("../services/aiEstimator/regionFactors", () => ({
  resolveRegionForBid: vi.fn(async () => ({ multiplier: 1, regionCode: null })),
}));

vi.mock("../services/aiEstimator/skills", () => ({
  retrieveSkillsForEstimate: vi.fn(async () => []),
  formatSkillsForPrompt: vi.fn(() => ""),
}));

vi.mock("../services/aiEstimator/fileResolver", () => ({
  resolveEstimatorFiles: vi.fn(async () => []),
  classifyFile: vi.fn(() => "pdf_plan"),
}));

vi.mock("../services/aiEstimator/extractSpreadsheet", () => ({
  extractSpreadsheetFromUrl: vi.fn(async () => null),
  extractSpreadsheetFromBuffer: vi.fn(async () => null),
}));

vi.mock("../services/aiEstimator/applyAssembliesToDraft", () => ({
  applyAssembliesToDraftLines: vi.fn(async (lines: unknown[]) => lines),
}));

vi.mock("../services/aiEstimator/orgFactors", () => ({
  getOrgFactors: vi.fn(async () => ({})),
}));

vi.mock("../objectStorage", () => ({
  objectStorageClient: { bucket: vi.fn(() => ({ file: vi.fn(() => ({ download: vi.fn(async () => [Buffer.from("")]) })) })) },
  ObjectStorageService: vi.fn(() => ({
    getObjectEntityFile: vi.fn(async () => ({ download: vi.fn(async () => [Buffer.from("")]) })),
  })),
}));

vi.mock("../ai/ocrProvider", () => ({
  getOcrProvider: vi.fn(() => null),
}));

import { routedChatCompletion } from "../ai/providers";
const routedChatCompletionMock = routedChatCompletion as unknown as ReturnType<typeof vi.fn>;

import { db } from "../db";
import {
  organizations,
  users,
  bids,
  projects,
  planDocuments,
  projectPlans,
  takeoffSheets,
} from "@shared/schema";
import { generateDraftEstimate } from "../services/aiEstimator/draftEstimate";
import { draftTakeoffFromPlans } from "../services/aiEstimator/takeoffDraft";
import { mapReduceDraftFromPlans } from "../services/aiEstimator/mapReduceDraft";
import { ESTIMATOR_SYSTEM_PROMPT_V2 } from "../services/aiEstimator/systemPromptV2";

const PREFIX = "__v2est__";

interface Ctx {
  orgId: string;
  userId: string;
  bidId: string;
  projectId: string;
  planDocId: string;
  projectPlanId: string;
  sheetWithTextId: string;
}
let ctx: Ctx;

async function cleanup(): Promise<void> {
  const like = `${PREFIX}%`;
  await db.execute(sql`DELETE FROM takeoff_sheets WHERE sheet_name LIKE ${like}`).catch(() => {});
  await db.execute(sql`DELETE FROM project_plans WHERE file_name LIKE ${like}`).catch(() => {});
  await db.execute(sql`DELETE FROM plan_documents WHERE file_name LIKE ${like}`).catch(() => {});
  await db.execute(sql`DELETE FROM bids WHERE code LIKE ${like}`).catch(() => {});
  await db.execute(sql`DELETE FROM projects WHERE code LIKE ${like}`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE email LIKE ${like}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${like}`).catch(() => {});
}

beforeAll(async () => {
  await cleanup();

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [org] = await db
    .insert(organizations)
    .values({
      name: "V2 Est Org",
      slug: `${PREFIX}${stamp}`,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      email: `${PREFIX}${stamp}@test.local`,
      passwordHash: "$2b$10$placeholder",
      firstName: "V2",
      lastName: "Tester",
      role: "ESTIMATOR",
      organizationId: org.id,
      isActive: true,
    })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({
      name: "V2 Project",
      code: `${PREFIX}P-${stamp}`,
      clientName: "Client",
      gcOrganizationId: org.id,
      status: "ACTIVE",
    })
    .returning();

  const [bid] = await db
    .insert(bids)
    .values({
      name: "V2 Bid",
      code: `${PREFIX}B-${stamp}`,
      clientName: "Client",
      gcOrganizationId: org.id,
    })
    .returning();

  const [planDoc] = await db
    .insert(planDocuments)
    .values({
      scope: "PROJECT",
      projectId: project.id,
      organizationId: org.id,
      type: "PLANS",
      title: "V2 Plans",
      fileName: `${PREFIX}plans-${stamp}.pdf`,
      fileUrl: "https://example.com/v2-plans.pdf",
      uploadedById: user.id,
    })
    .returning();

  const [projectPlan] = await db
    .insert(projectPlans)
    .values({
      projectId: project.id,
      documentId: planDoc.id,
      originalPdfUrl: "https://example.com/v2-plans.pdf",
      fileName: `${PREFIX}project-plan-${stamp}.pdf`,
    })
    .returning();

  const [sheetWithText] = await db
    .insert(takeoffSheets)
    .values({
      bidId: bid.id,
      projectId: project.id,
      planId: projectPlan.id,
      imageUrl: "https://example.com/sheet.png",
      sheetIndex: 0,
      sheetName: `${PREFIX}sheet-A101-${stamp}`,
      sheetNumber: "A-101",
      discipline: "A",
      extractedTextByPage: { "1": "Concrete slab on grade 1200 SF. Wall footing 8 in x 3 ft x 80 LF." },
    })
    .returning();

  ctx = {
    orgId: org.id,
    userId: user.id,
    bidId: bid.id,
    projectId: project.id,
    planDocId: planDoc.id,
    projectPlanId: projectPlan.id,
    sheetWithTextId: sheetWithText.id,
  };
}, 60_000);

afterAll(async () => {
  await cleanup();
});

function makeCompletion(content: string) {
  return {
    choices: [{ message: { content } }],
    model: "gpt-4o",
    provider: "openai",
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
  };
}

const PHASE6_FIELDS = [
  "conflictLog",
  "scopeGapLog",
  "clarificationList",
  "exclusionsList",
  "assumptionLog",
  "benchmarkSummary",
  "overallConfidence",
] as const;

describe("generateDraftEstimate — V2.0 prompt + call shape", () => {
  it("injects ESTIMATOR_SYSTEM_PROMPT_V2 as the first system message", async () => {
    routedChatCompletionMock.mockResolvedValueOnce(
      makeCompletion(JSON.stringify({ lines: [], notes: "", confidence: 50 })),
    );

    await generateDraftEstimate({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      bidId: ctx.bidId,
    });

    expect(routedChatCompletionMock).toHaveBeenCalledOnce();
    const [callArg] = routedChatCompletionMock.mock.calls[0] as [{ request: { messages: Array<{ role: string; content: string }> } }];
    const sysMsg = callArg.request.messages.find((m) => m.role === "system");
    expect(sysMsg).toBeDefined();
    expect(typeof sysMsg!.content).toBe("string");
    expect(sysMsg!.content).toContain("Version 2.0");
    expect(sysMsg!.content).toContain(ESTIMATOR_SYSTEM_PROMPT_V2.slice(0, 80));
  });

  it("passes temperature:0 to routedChatCompletion", async () => {
    routedChatCompletionMock.mockResolvedValueOnce(
      makeCompletion(JSON.stringify({ lines: [], notes: "", confidence: 50 })),
    );

    await generateDraftEstimate({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      bidId: ctx.bidId,
    });

    const [callArg] = routedChatCompletionMock.mock.calls[0] as [{ request: { temperature: number } }];
    expect(callArg.request.temperature).toBe(0);
  });

  it("includes the web_search_20250305 tool in the request", async () => {
    routedChatCompletionMock.mockResolvedValueOnce(
      makeCompletion(JSON.stringify({ lines: [], notes: "", confidence: 50 })),
    );

    await generateDraftEstimate({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      bidId: ctx.bidId,
    });

    const [callArg] = routedChatCompletionMock.mock.calls[0] as [{ request: { tools: Array<{ type: string }> } }];
    expect(Array.isArray(callArg.request.tools)).toBe(true);
    expect(callArg.request.tools).toContainEqual({ type: "web_search_20250305" });
  });

  it("forwards all Phase 6 fields when the AI response includes them", async () => {
    routedChatCompletionMock.mockResolvedValueOnce(
      makeCompletion(
        JSON.stringify({
          lines: [],
          notes: "Some notes",
          confidence: 65,
          conflictLog: "Drawings conflict on column spacing",
          scopeGapLog: "Electrical scope unclear",
          clarificationList: "Need footing depth from engineer",
          exclusionsList: "Landscaping excluded",
          assumptionLog: "Assumed 4000 psi concrete",
          benchmarkSummary: "RS Means 2024: $180/CY in region",
          overallConfidence: "MEDIUM",
        }),
      ),
    );

    const out = await generateDraftEstimate({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      bidId: ctx.bidId,
    });

    expect(out.result).not.toBeNull();
    const result = out.result!;
    expect(result.conflictLog).toBe("Drawings conflict on column spacing");
    expect(result.scopeGapLog).toBe("Electrical scope unclear");
    expect(result.clarificationList).toBe("Need footing depth from engineer");
    expect(result.exclusionsList).toBe("Landscaping excluded");
    expect(result.assumptionLog).toBe("Assumed 4000 psi concrete");
    expect(result.benchmarkSummary).toBe("RS Means 2024: $180/CY in region");
    expect(result.overallConfidence).toBe("MEDIUM");
  });

  it("omits Phase 6 keys (no undefined pollution) when the AI response excludes them", async () => {
    routedChatCompletionMock.mockResolvedValueOnce(
      makeCompletion(
        JSON.stringify({
          lines: [
            {
              description: "Slab on grade",
              costCode: "03 30 00",
              quantity: 100,
              unit: "CY",
              unitCost: 150,
              laborHours: null,
              totalCost: 15000,
              rationale: "Per learned rates",
              citationIds: [],
            },
          ],
          notes: "Minimal AI response",
          confidence: 55,
        }),
      ),
    );

    const out = await generateDraftEstimate({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      bidId: ctx.bidId,
    });

    expect(out.result).not.toBeNull();
    const result = out.result!;
    expect(result.lines).toHaveLength(1);
    for (const field of PHASE6_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(result, field)).toBe(false);
    }
  });

  it("returns blocked:true for a bid that belongs to a different org (IDOR guard)", async () => {
    const [otherOrg] = await db
      .insert(organizations)
      .values({ name: "Other", slug: `${PREFIX}other-${Date.now()}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true })
      .returning();
    const [otherBid] = await db
      .insert(bids)
      .values({ name: "Other Bid", code: `${PREFIX}OB-${Date.now()}`, clientName: "X", gcOrganizationId: otherOrg.id })
      .returning();

    routedChatCompletionMock.mockClear();
    const out = await generateDraftEstimate({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      bidId: otherBid.id,
    });

    expect(out.blocked).toBe(true);
    expect(out.result).toBeNull();
    expect(routedChatCompletionMock).not.toHaveBeenCalled();

    await db.delete(bids).where(eq(bids.id, otherBid.id)).catch(() => {});
    await db.delete(organizations).where(eq(organizations.id, otherOrg.id)).catch(() => {});
  });
});

describe("draftTakeoffFromPlans — V2.0 prompt + call shape", () => {
  it("injects ESTIMATOR_SYSTEM_PROMPT_V2 as the first system message", async () => {
    routedChatCompletionMock.mockResolvedValueOnce(
      makeCompletion(JSON.stringify({ measurements: [], notes: "", confidence: 50 })),
    );

    await draftTakeoffFromPlans({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      planDocumentIds: [ctx.planDocId],
    });

    expect(routedChatCompletionMock).toHaveBeenCalledOnce();
    const [callArg] = routedChatCompletionMock.mock.calls[0] as [{ request: { messages: Array<{ role: string; content: unknown }> } }];
    const sysMsg = callArg.request.messages.find((m) => m.role === "system");
    expect(sysMsg).toBeDefined();
    const content = typeof sysMsg!.content === "string" ? sysMsg!.content : JSON.stringify(sysMsg!.content);
    expect(content).toContain("Version 2.0");
    expect(content).toContain(ESTIMATOR_SYSTEM_PROMPT_V2.slice(0, 80));
  });

  it("passes temperature:0 to routedChatCompletion", async () => {
    routedChatCompletionMock.mockResolvedValueOnce(
      makeCompletion(JSON.stringify({ measurements: [], notes: "", confidence: 50 })),
    );

    await draftTakeoffFromPlans({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      planDocumentIds: [ctx.planDocId],
    });

    const [callArg] = routedChatCompletionMock.mock.calls[0] as [{ request: { temperature: number } }];
    expect(callArg.request.temperature).toBe(0);
  });

  it("includes the web_search_20250305 tool in the request", async () => {
    routedChatCompletionMock.mockResolvedValueOnce(
      makeCompletion(JSON.stringify({ measurements: [], notes: "", confidence: 50 })),
    );

    await draftTakeoffFromPlans({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      planDocumentIds: [ctx.planDocId],
    });

    const [callArg] = routedChatCompletionMock.mock.calls[0] as [{ request: { tools: Array<{ type: string }> } }];
    expect(Array.isArray(callArg.request.tools)).toBe(true);
    expect(callArg.request.tools).toContainEqual({ type: "web_search_20250305" });
  });

  it("parses a takeoff draft result with measurements when the AI emits valid JSON", async () => {
    routedChatCompletionMock.mockResolvedValueOnce(
      makeCompletion(
        JSON.stringify({
          measurements: [
            {
              label: "Foundation slab",
              type: "AREA",
              value: 1200,
              unit: "SF",
              costCode: "03 30 00",
              rationale: "Visible on sheet A-101",
            },
          ],
          notes: "Draft from A drawings",
          confidence: 70,
        }),
      ),
    );

    const out = await draftTakeoffFromPlans({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      planDocumentIds: [ctx.planDocId],
    });

    expect(out.result).not.toBeNull();
    expect(out.result!.measurements).toHaveLength(1);
    expect(out.result!.measurements[0].label).toBe("Foundation slab");
    expect(out.result!.confidence).toBe(70);
  });
});

describe("mapReduceDraftFromPlans — V2.0 prompt + call shape", () => {
  const EMPTY_COMPLETION = makeCompletion(
    JSON.stringify({ measurements: [], notes: "", confidence: 60 }),
  );

  beforeEach(() => {
    routedChatCompletionMock.mockClear();
    routedChatCompletionMock.mockResolvedValue(EMPTY_COMPLETION);
  });

  it("injects ESTIMATOR_SYSTEM_PROMPT_V2 in the reduce-phase system message", async () => {
    await mapReduceDraftFromPlans({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      bidId: ctx.bidId,
    });

    expect(routedChatCompletionMock).toHaveBeenCalledTimes(1);
    const [callArg] = routedChatCompletionMock.mock.calls[0] as [{ request: { messages: Array<{ role: string; content: unknown }> } }];
    const sysMsg = callArg.request.messages.find((m) => m.role === "system");
    expect(sysMsg).toBeDefined();
    const content = typeof sysMsg!.content === "string" ? sysMsg!.content : JSON.stringify(sysMsg!.content);
    expect(content).toContain("Version 2.0");
    expect(content).toContain(ESTIMATOR_SYSTEM_PROMPT_V2.slice(0, 80));
  });

  it("passes temperature:0 to routedChatCompletion", async () => {
    await mapReduceDraftFromPlans({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      bidId: ctx.bidId,
    });

    expect(routedChatCompletionMock).toHaveBeenCalledTimes(1);
    const [callArg] = routedChatCompletionMock.mock.calls[0] as [{ request: { temperature: number } }];
    expect(callArg.request.temperature).toBe(0);
  });

  it("includes the web_search_20250305 tool in the request", async () => {
    await mapReduceDraftFromPlans({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      bidId: ctx.bidId,
    });

    expect(routedChatCompletionMock).toHaveBeenCalledTimes(1);
    const [callArg] = routedChatCompletionMock.mock.calls[0] as [{ request: { tools: Array<{ type: string }> } }];
    expect(Array.isArray(callArg.request.tools)).toBe(true);
    expect(callArg.request.tools).toContainEqual({ type: "web_search_20250305" });
  });

  it("returns a partial:false result with measurements when the AI emits valid JSON", async () => {
    routedChatCompletionMock.mockResolvedValue(
      makeCompletion(
        JSON.stringify({
          measurements: [
            {
              label: "CMU block wall",
              type: "AREA",
              value: 800,
              unit: "SF",
              costCode: "04 20 00",
              rationale: "Visible on sheet A-101",
              sheetCitations: ["A-101"],
            },
          ],
          notes: "Structural",
          confidence: 75,
        }),
      ),
    );

    const out = await mapReduceDraftFromPlans({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      bidId: ctx.bidId,
    });

    expect(out.result).not.toBeNull();
    expect(out.result!.measurements.length).toBeGreaterThanOrEqual(1);
    expect(out.result!.partial).toBe(false);
  });

  it("returns reason when the bid belongs to a different org (IDOR guard)", async () => {
    const [otherOrg] = await db
      .insert(organizations)
      .values({ name: "MR Other", slug: `${PREFIX}mr-other-${Date.now()}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true })
      .returning();
    const [otherBid] = await db
      .insert(bids)
      .values({ name: "MR Other Bid", code: `${PREFIX}MROB-${Date.now()}`, clientName: "X", gcOrganizationId: otherOrg.id })
      .returning();

    routedChatCompletionMock.mockClear();
    const out = await mapReduceDraftFromPlans({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      bidId: otherBid.id,
    });

    expect(out.result).toBeNull();
    expect(out.reason).toBeDefined();
    expect(routedChatCompletionMock).not.toHaveBeenCalled();

    await db.delete(bids).where(eq(bids.id, otherBid.id)).catch(() => {});
    await db.delete(organizations).where(eq(organizations.id, otherOrg.id)).catch(() => {});
  });
});
