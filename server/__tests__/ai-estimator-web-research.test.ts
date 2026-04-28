// Task #2340 — Unit coverage for `server/services/aiEstimator/webResearch.ts`.
//
// Locks in:
//   • The allow-list helper (`isAllowedDomain`) accepts known hosts and
//     rejects unknown ones, including non-HTTP schemes that should never
//     reach `fetch`.
//   • `fetchAllowed` throws `WebResearchDomainBlockedError` for any host
//     that is not on the allow-list — and crucially, `fetch` is NEVER
//     called in that branch.
//   • Cache MISS: `fetchAllowed` calls `fetch` exactly once, persists the
//     result, and returns `cached: false`.
//   • Cache HIT: a fresh row in `ai_estimator_web_research_cache` short-
//     circuits the network entirely and returns `cached: true`.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { sql } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  aiEstimatorWebResearchCache,
} from "@shared/schema";
import {
  WEB_RESEARCH_ALLOWLIST,
  WebResearchDomainBlockedError,
  fetchAllowed,
  isAllowedDomain,
} from "../services/aiEstimator/webResearch";

const PREFIX = "__ai_est_web__";

let orgId: string;

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM ai_estimator_web_research_cache WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}`).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({
      name: "Web Research Org",
      slug: `${PREFIX}o-${stamp}`,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();
  orgId = org.id;
}, 30_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await cleanup();
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("isAllowedDomain", () => {
  it("accepts every host in the published allow-list", () => {
    for (const host of WEB_RESEARCH_ALLOWLIST) {
      expect(isAllowedDomain(host)).toBe(true);
    }
  });

  it("is case-insensitive on the input host", () => {
    expect(isAllowedDomain("BLS.GOV")).toBe(true);
    expect(isAllowedDomain("Www.Census.Gov")).toBe(true);
  });

  it("rejects unrelated hosts and naive prefix/suffix attacks", () => {
    expect(isAllowedDomain("evil.com")).toBe(false);
    expect(isAllowedDomain("internal-api.local")).toBe(false);
    // A subdomain not explicitly listed must NOT be auto-allowed.
    expect(isAllowedDomain("foo.bls.gov")).toBe(false);
    // Trailing dot or extra segments must not bypass.
    expect(isAllowedDomain("bls.gov.evil.com")).toBe(false);
    expect(isAllowedDomain("evil.com.bls.gov")).toBe(false);
  });
});

describe("fetchAllowed — allow-list enforcement", () => {
  it("throws WebResearchDomainBlockedError for off-list URLs and never calls fetch", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("fetch must not be called for blocked domains");
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      fetchAllowed({
        organizationId: orgId,
        userId: null,
        url: "https://evil.example.com/path",
      }),
    ).rejects.toBeInstanceOf(WebResearchDomainBlockedError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects non-HTTP schemes (e.g. file://) without invoking fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      fetchAllowed({
        organizationId: orgId,
        userId: null,
        url: "file:///etc/passwd",
      }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("fetchAllowed — cache miss vs hit", () => {
  function stubFetchOnce(body: string) {
    const encoded = new TextEncoder().encode(body);
    let yielded = false;
    const reader = {
      read: async () => {
        if (yielded) return { value: undefined, done: true };
        yielded = true;
        return { value: encoded, done: false };
      },
      cancel: async () => undefined,
    };
    const resp = {
      ok: true,
      status: 200,
      body: { getReader: () => reader },
    };
    const fetchSpy = vi.fn(async () => resp as unknown as Response);
    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy;
  }

  it("cache MISS: fetches the URL once, persists a snippet, returns cached:false", async () => {
    const url = "https://www.bls.gov/oes/cache-miss-test";
    const fetchSpy = stubFetchOnce(
      "<html><head><title>Hello BLS</title></head><body><script>x()</script><p>Body text</p></body></html>",
    );

    const result = await fetchAllowed({
      organizationId: orgId,
      userId: null,
      url,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.cached).toBe(false);
    expect(result.domain).toBe("www.bls.gov");
    expect(result.title).toBe("Hello BLS");
    // <script> body must have been stripped before persistence.
    expect(result.contentSnippet).toContain("Body text");
    expect(result.contentSnippet).not.toContain("<script");

    const persisted = await db
      .select()
      .from(aiEstimatorWebResearchCache);
    const row = persisted.find((r) => r.url === url && r.organizationId === orgId);
    expect(row).toBeDefined();
    expect(row!.title).toBe("Hello BLS");
  });

  it("cache HIT: a fresh cache row short-circuits and fetch is never called", async () => {
    const url = "https://www.osha.gov/cache-hit-test";
    const fetchSpy = vi.fn(async () => {
      throw new Error("fetch must not be called when the cache is fresh");
    });
    vi.stubGlobal("fetch", fetchSpy);

    // Pre-seed a fresh cache row (fetched 1 minute ago).
    const fetchedAt = new Date(Date.now() - 60_000);
    await db.insert(aiEstimatorWebResearchCache).values({
      organizationId: orgId,
      url,
      domain: "www.osha.gov",
      query: null,
      title: "Cached title",
      contentSnippet: "Cached snippet body",
      contentHash: "deadbeef",
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + 24 * 60 * 60 * 1000),
      fetchedByUserId: null,
    });

    const result = await fetchAllowed({
      organizationId: orgId,
      userId: null,
      url,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.cached).toBe(true);
    expect(result.title).toBe("Cached title");
    expect(result.contentSnippet).toBe("Cached snippet body");
    expect(result.domain).toBe("www.osha.gov");
  });

  it("cache MISS when the existing row is stale (>24h old) — re-fetches", async () => {
    const url = "https://www.epa.gov/stale-cache-test";
    // Pre-seed a stale row (fetched 2 days ago).
    const fetchedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await db.insert(aiEstimatorWebResearchCache).values({
      organizationId: orgId,
      url,
      domain: "www.epa.gov",
      query: null,
      title: "Stale title",
      contentSnippet: "Stale snippet",
      contentHash: "deadbeef",
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + 24 * 60 * 60 * 1000),
      fetchedByUserId: null,
    });

    const fetchSpy = stubFetchOnce(
      "<html><head><title>Fresh EPA</title></head><body>Fresh body</body></html>",
    );

    const result = await fetchAllowed({
      organizationId: orgId,
      userId: null,
      url,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.cached).toBe(false);
    expect(result.title).toBe("Fresh EPA");
  });
});
