/**
 * Task #2761 — Automated test coverage for the PDF tile pre-render job gate.
 *
 * Coverage:
 *   1. Gated renderer (tileRendererStub) always throws rather than silently
 *      succeeding — so legacy queue items surface in the DLQ rather than
 *      masking the missing implementation.
 *   2. `maybeEnqueueTilePrerender` does NOT call `enqueueJob` when the
 *      `TILE_RENDERING_ENABLED` feature flag is OFF (the default).
 *   3. `maybeEnqueueTilePrerender` DOES call `enqueueJob` when the flag is ON,
 *      passing the correct job name and idempotency key.
 *   4. `tryEnqueueTilePrerender` swallows errors so callers are never blocked.
 *   5. Bid-conversion scenario: multiple plan document IDs → each gets its
 *      own `enqueueJob` call when ON; none when OFF.
 *
 * The `db` module is mocked for the gated-renderer unit test so it can run
 * without a live database connection.  The `featureFlagService` and `jobQueue`
 * modules are mocked throughout so no pg-boss instance is needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted — Vitest runs these before any imports)
// ---------------------------------------------------------------------------

// Mock the DB used inside tileRendererStub so the gated-renderer unit test
// does not need a live Postgres connection.  The gated renderer does a single
// `.select().from().where().limit(1)` call; returning an empty array is
// sufficient because gatedRenderer uses `doc?.title ?? "(not found)"` and
// throws unconditionally regardless of the query result.
vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
  },
}));

// Mock the feature-flag service so tests can control `isFeatureEnabled`
// without hitting the database.
vi.mock("../services/featureFlagService", () => ({
  isFeatureEnabled: vi.fn(),
}));

// Mock the job queue so `enqueueJob` is a spy — no pg-boss instance required.
vi.mock("../jobQueue", () => ({
  enqueueJob: vi.fn().mockResolvedValue({
    jobId: "mock-job-uuid",
    idempotencyKey: "mock-key",
    deduplicated: false,
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------

import {
  maybeEnqueueTilePrerender,
  tryEnqueueTilePrerender,
} from "../services/pdfTileDispatch";
import { __testHooks as stubHooks } from "../jobQueue/handlers/tileRendererStub";
import { isFeatureEnabled } from "../services/featureFlagService";
import { enqueueJob } from "../jobQueue";

// Typed spy references for convenience.
const mockIsFeatureEnabled = vi.mocked(isFeatureEnabled);
const mockEnqueueJob = vi.mocked(enqueueJob);

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const ORG_ID = "org-test-uuid-1111";
const USER_ID = "user-test-uuid-2222";
const DOC_ID = "doc-test-uuid-3333";

const mockCtx = {
  jobId: "job-ctx-uuid",
  progress: vi.fn().mockResolvedValue(undefined),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
} as any;

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: flag is OFF (mirrors production default).
  mockIsFeatureEnabled.mockResolvedValue(false);
});

// ---------------------------------------------------------------------------
// 1. Gated renderer unit test
// ---------------------------------------------------------------------------

describe("gatedRenderer (tileRendererStub.__testHooks)", () => {
  it("throws with a descriptive error rather than returning a silent success", async () => {
    await expect(
      stubHooks.gatedRenderer({ planDocumentId: DOC_ID }, mockCtx),
    ).rejects.toThrow(/server-side tile rendering is not implemented/);
  });

  it("includes the planDocumentId in the thrown error message", async () => {
    await expect(
      stubHooks.gatedRenderer({ planDocumentId: DOC_ID }, mockCtx),
    ).rejects.toThrow(DOC_ID);
  });

  it("never resolves — the return type is Promise<never>", async () => {
    let resolved = false;
    await stubHooks.gatedRenderer({ planDocumentId: DOC_ID }, mockCtx).then(
      () => { resolved = true; },
      () => { /* expected rejection */ },
    );
    expect(resolved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2 & 3. Flag gate: maybeEnqueueTilePrerender
// ---------------------------------------------------------------------------

describe("maybeEnqueueTilePrerender — TILE_RENDERING_ENABLED OFF (default)", () => {
  it("does not call enqueueJob for the upload site", async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);

    const result = await maybeEnqueueTilePrerender({
      planDocumentId: DOC_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      site: "upload",
    });

    expect(mockEnqueueJob).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(false);
    expect(result.jobId).toBeUndefined();
  });

  it("does not call enqueueJob for the from-url site", async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);

    const result = await maybeEnqueueTilePrerender({
      planDocumentId: DOC_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      site: "from-url",
    });

    expect(mockEnqueueJob).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(false);
  });

  it("does not call enqueueJob for the bid-conversion site", async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);

    const result = await maybeEnqueueTilePrerender({
      planDocumentId: DOC_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      site: "bid-conversion",
    });

    expect(mockEnqueueJob).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(false);
  });

  it("checks the flag against the correct orgId and flag key", async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);

    await maybeEnqueueTilePrerender({
      planDocumentId: DOC_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      site: "upload",
    });

    expect(mockIsFeatureEnabled).toHaveBeenCalledWith(ORG_ID, "TILE_RENDERING_ENABLED");
  });
});

describe("maybeEnqueueTilePrerender — TILE_RENDERING_ENABLED ON", () => {
  it("calls enqueueJob with pdf_tile_prerender for the upload site", async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);

    const result = await maybeEnqueueTilePrerender({
      planDocumentId: DOC_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      site: "upload",
    });

    expect(mockEnqueueJob).toHaveBeenCalledOnce();
    expect(mockEnqueueJob).toHaveBeenCalledWith(
      "pdf_tile_prerender",
      { planDocumentId: DOC_ID },
      expect.objectContaining({
        organizationId: ORG_ID,
        userId: USER_ID,
        idempotencyKey: `pdf_tile_prerender:${DOC_ID}`,
      }),
    );
    expect(result.dispatched).toBe(true);
    expect(result.jobId).toBe("mock-job-uuid");
  });

  it("calls enqueueJob for the from-url site", async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);

    const result = await maybeEnqueueTilePrerender({
      planDocumentId: DOC_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      site: "from-url",
    });

    expect(mockEnqueueJob).toHaveBeenCalledOnce();
    expect(result.dispatched).toBe(true);
  });

  it("calls enqueueJob for the bid-conversion site", async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);

    const result = await maybeEnqueueTilePrerender({
      planDocumentId: DOC_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      site: "bid-conversion",
    });

    expect(mockEnqueueJob).toHaveBeenCalledOnce();
    expect(result.dispatched).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. tryEnqueueTilePrerender — error-swallowing wrapper
// ---------------------------------------------------------------------------

describe("tryEnqueueTilePrerender", () => {
  it("resolves without throwing even when enqueueJob rejects", async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockEnqueueJob.mockRejectedValueOnce(new Error("pg-boss unavailable"));

    await expect(
      tryEnqueueTilePrerender({
        planDocumentId: DOC_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        site: "upload",
      }),
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing even when isFeatureEnabled rejects", async () => {
    mockIsFeatureEnabled.mockRejectedValueOnce(new Error("DB connection lost"));

    await expect(
      tryEnqueueTilePrerender({
        planDocumentId: DOC_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        site: "from-url",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not call enqueueJob when the flag is OFF", async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);

    await tryEnqueueTilePrerender({
      planDocumentId: DOC_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      site: "upload",
    });

    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. Bid-conversion scenario: multiple plan document IDs
// ---------------------------------------------------------------------------

describe("bid-conversion scenario — multiple plan documents", () => {
  const DOC_IDS = ["doc-aaa", "doc-bbb", "doc-ccc"];

  it("does not call enqueueJob for any document when flag is OFF", async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);

    for (const planDocumentId of DOC_IDS) {
      await maybeEnqueueTilePrerender({
        planDocumentId,
        organizationId: ORG_ID,
        userId: USER_ID,
        site: "bid-conversion",
      });
    }

    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("calls enqueueJob once per document with the correct idempotency key when flag is ON", async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);

    for (const planDocumentId of DOC_IDS) {
      await maybeEnqueueTilePrerender({
        planDocumentId,
        organizationId: ORG_ID,
        userId: USER_ID,
        site: "bid-conversion",
      });
    }

    expect(mockEnqueueJob).toHaveBeenCalledTimes(DOC_IDS.length);

    for (const planDocumentId of DOC_IDS) {
      expect(mockEnqueueJob).toHaveBeenCalledWith(
        "pdf_tile_prerender",
        { planDocumentId },
        expect.objectContaining({
          idempotencyKey: `pdf_tile_prerender:${planDocumentId}`,
        }),
      );
    }
  });
});
