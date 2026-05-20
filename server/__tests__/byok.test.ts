/**
 * Task #2952 — Automated tests for the BYOK key save/remove flow.
 *
 * Coverage:
 *   1. Unit tests for server/services/keyVault.ts
 *   2. Integration tests for server/byokRoutes.ts (supertest + real test DB)
 *   3. resolveOrgKey — real-DB round-trip (server/ai/providers/orgKeyResolver.ts)
 *   4. applyByokKeys substitution via routedChatCompletion (providers/index.ts)
 *   5. Provider factory shape tests (real factories via vi.importActual)
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import type { Express } from "express";
import type { Server } from "http";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql, eq } from "drizzle-orm";
import type { AiChatResponse } from "../ai/providers/types";

// ─────────────────────────────────────────────────────────────────────────────
// Top-level mock variables — must be declared before vi.mock() calls so they
// are available after hoisting.
// ─────────────────────────────────────────────────────────────────────────────

// orgKeyResolver mocks
const isByokEntitledMock = vi.fn(async (_orgId: string): Promise<boolean> => false);
const resolveOrgKeyMock = vi.fn(
  async (_orgId: string, _provider: string): Promise<string | null> => null,
);

// Provider chatCompletion mocks (used by singleton mocks AND by BYOK factories)
const mockOpenAIChatCompletion = vi.fn(
  async (..._args: unknown[]): Promise<AiChatResponse> => ({
    provider: "openai",
    model: "gpt-5",
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    latencyMs: 50,
    fallbackUsed: false,
  }),
);
const mockAnthropicChatCompletion = vi.fn(
  async (..._args: unknown[]): Promise<AiChatResponse> => ({
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    latencyMs: 50,
    fallbackUsed: false,
  }),
);

// Provider isConfigured mocks — typed explicitly so mockReturnValue(true/false) type-checks
const mockOpenAIIsConfigured = vi.fn((): boolean => true);
const mockAnthropicIsConfigured = vi.fn((): boolean => true);

// Factory mocks — what createXxxProviderWithKey returns
const createOpenAIProviderWithKeyMock = vi.fn((_key: string) => ({
  name: "openai" as const,
  defaultModel: "gpt-5",
  isConfigured: (): boolean => true,
  chatCompletion: mockOpenAIChatCompletion,
}));
const createAnthropicProviderWithKeyMock = vi.fn((_key: string) => ({
  name: "anthropic" as const,
  defaultModel: "claude-sonnet-4-5",
  isConfigured: (): boolean => true,
  chatCompletion: mockAnthropicChatCompletion,
}));

// Billing mocks
const mockCheckBillingQuota = vi.fn(
  async (_orgId: string, _key: string, _amount: number) =>
    ({
      allowed: true,
      used: 0,
      limit: 10_000,
      overage: 0,
      billedToStripe: false,
    }) as const,
);
const mockConsumeBillingUsage = vi.fn(
  async (_orgId: string, _key: string, _amount: number) =>
    ({
      allowed: true,
      used: 1,
      limit: 10_000,
      overage: 0,
      billedToStripe: false,
    }) as const,
);

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks (hoisted by vitest)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../ai/providers/orgKeyResolver", async () => {
  const actual = await vi.importActual<typeof import("../ai/providers/orgKeyResolver")>(
    "../ai/providers/orgKeyResolver",
  );
  return { ...actual, isByokEntitled: isByokEntitledMock, resolveOrgKey: resolveOrgKeyMock };
});

vi.mock("../auditLogger", () => ({
  logAudit: vi.fn(async () => undefined),
  logCreate: vi.fn(async () => undefined),
}));

// Provider singletons — mocked so routedChatCompletion never hits real APIs.
// Section 5 tests use vi.importActual to exercise the real factory code.
vi.mock("../ai/providers/openaiProvider", () => ({
  openaiProvider: {
    name: "openai" as const,
    defaultModel: "gpt-5",
    isConfigured: mockOpenAIIsConfigured,
    chatCompletion: mockOpenAIChatCompletion,
  },
  createOpenAIProviderWithKey: createOpenAIProviderWithKeyMock,
  OPENAI_EMBEDDING_MODEL_DEFAULT: "text-embedding-3-small",
}));

vi.mock("../ai/providers/anthropicProvider", () => ({
  anthropicProvider: {
    name: "anthropic" as const,
    defaultModel: "claude-sonnet-4-5",
    isConfigured: mockAnthropicIsConfigured,
    chatCompletion: mockAnthropicChatCompletion,
  },
  createAnthropicProviderWithKey: createAnthropicProviderWithKeyMock,
  ANTHROPIC_MODEL_SONNET_4_5: "claude-sonnet-4-5",
}));

vi.mock("../services/billing/usageMetering", () => ({
  checkQuota: mockCheckBillingQuota,
  consume: mockConsumeBillingUsage,
  QuotaExceededError: class QuotaExceededError extends Error {
    constructor(
      public readonly meter: object,
      public readonly key: string,
    ) {
      super("Quota exceeded");
    }
  },
}));

// Stub prior-context bridge so routing tests don't accumulate cross-test state.
vi.mock("../ai/priorContextBridge", () => ({
  buildPriorContextSystemMessage: () => null,
  capturePriorContext: () => undefined,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const SLUG_PREFIX = "__byok_test__";
const VAULT_SECRET = "byok-unit-test-master-secret-32ok";

// ─────────────────────────────────────────────────────────────────────────────
// 1. keyVault unit tests
// ─────────────────────────────────────────────────────────────────────────────
describe("keyVault — encryptKey / decryptKey", () => {
  const origSecret = process.env.KEY_VAULT_SECRET;

  beforeEach(() => {
    process.env.KEY_VAULT_SECRET = VAULT_SECRET;
  });

  afterEach(() => {
    if (origSecret === undefined) {
      delete process.env.KEY_VAULT_SECRET;
    } else {
      process.env.KEY_VAULT_SECRET = origSecret;
    }
  });

  it("round-trips a plaintext key correctly", async () => {
    const { encryptKey, decryptKey } = await import("../services/keyVault");
    const plaintext = "sk-org-abc123secretkey9876";
    const ciphertext = encryptKey(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    // Format: <ivHex>:<tagHex>:<encHex>
    expect(ciphertext.split(":")).toHaveLength(3);
    expect(decryptKey(ciphertext)).toBe(plaintext);
  });

  it("produces a unique ciphertext on each call (random IV)", async () => {
    const { encryptKey } = await import("../services/keyVault");
    const c1 = encryptKey("same-plaintext");
    const c2 = encryptKey("same-plaintext");
    expect(c1).not.toBe(c2);
  });

  it("throws when ciphertext has wrong number of colon-separated parts", async () => {
    const { decryptKey } = await import("../services/keyVault");
    expect(() => decryptKey("onlyone")).toThrow("Invalid encrypted key format");
    expect(() => decryptKey("two:parts")).toThrow("Invalid encrypted key format");
    expect(() => decryptKey("a:b:c:d")).toThrow("Invalid encrypted key format");
  });

  it("throws when the GCM auth tag is tampered (integrity check fails)", async () => {
    const { encryptKey, decryptKey } = await import("../services/keyVault");
    const ciphertext = encryptKey("original-secret");
    const [ivHex, , encHex] = ciphertext.split(":");
    // Replace auth tag with all-zeros — GCM verification will fail.
    const tampered = [ivHex, "00".repeat(16), encHex].join(":");
    expect(() => decryptKey(tampered)).toThrow();
  });

  it("encryptKey throws when KEY_VAULT_SECRET is missing", async () => {
    delete process.env.KEY_VAULT_SECRET;
    const { encryptKey } = await import("../services/keyVault");
    expect(() => encryptKey("any-key")).toThrow(/KEY_VAULT_SECRET/);
  });

  it("decryptKey throws when KEY_VAULT_SECRET is missing", async () => {
    const { encryptKey } = await import("../services/keyVault");
    const ciphertext = encryptKey("my-secret");
    delete process.env.KEY_VAULT_SECRET;
    const { decryptKey } = await import("../services/keyVault");
    expect(() => decryptKey(ciphertext)).toThrow(/KEY_VAULT_SECRET/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. byokRoutes HTTP integration (supertest + real test DB)
// ─────────────────────────────────────────────────────────────────────────────
describe("byokRoutes — HTTP integration", () => {
  let app: Express;
  let server: Server;
  let adminToken: string;

  const origSecret = process.env.KEY_VAULT_SECRET;

  async function cleanup() {
    const { db } = await import("../db");
    const rows = await db.execute<{ id: string }>(
      sql`SELECT id FROM organizations WHERE slug LIKE ${SLUG_PREFIX + "%"}`,
    );
    for (const { id } of rows.rows) {
      await db.execute(sql`DELETE FROM org_ai_keys WHERE organization_id = ${id}`).catch(() => {});
      await db.execute(sql`DELETE FROM users WHERE organization_id = ${id}`).catch(() => {});
      await db.execute(sql`DELETE FROM organizations WHERE id = ${id}`).catch(() => {});
    }
  }

  beforeAll(async () => {
    process.env.KEY_VAULT_SECRET = VAULT_SECRET;
    isByokEntitledMock.mockResolvedValue(true);

    const { db } = await import("../db");
    const { organizations, users } = await import("@shared/schema");
    const { generateToken } = await import("../auth");

    const slug = `${SLUG_PREFIX}${Date.now()}`;

    const [org] = await db
      .insert(organizations)
      .values({
        name: "BYOK Route Test Org",
        slug,
        tradeType: "GENERAL_CONTRACTOR",
        onboardingStatus: "COMPLETED",
        isActive: true,
      })
      .returning();

    const [admin] = await db
      .insert(users)
      .values({
        email: `${slug}@byok.test.local`,
        passwordHash: await bcrypt.hash("TestPass123!", 10),
        firstName: "BYOK",
        lastName: "Admin",
        role: "ADMIN",
        organizationId: org.id,
        tokenVersion: 1,
      })
      .returning();

    adminToken = generateToken(admin.id, admin.tokenVersion);

    const express = (await import("express")).default;
    const cookieParser = (await import("cookie-parser")).default;
    const { registerRoutes } = await import("../routes");

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    server = await registerRoutes(app);
  }, 60_000);

  afterAll(async () => {
    server?.close();
    await cleanup();
    if (origSecret === undefined) {
      delete process.env.KEY_VAULT_SECRET;
    } else {
      process.env.KEY_VAULT_SECRET = origSecret;
    }
  });

  beforeEach(() => {
    process.env.KEY_VAULT_SECRET = VAULT_SECRET;
    isByokEntitledMock.mockResolvedValue(true);
  });

  function put(provider: string, apiKey: string) {
    return request(app)
      .put(`/api/org/ai-keys/${provider}`)
      .set("Cookie", `auth_token=${adminToken}`)
      .set("Content-Type", "application/json")
      .send({ apiKey });
  }
  function get() {
    return request(app)
      .get("/api/org/ai-keys")
      .set("Cookie", `auth_token=${adminToken}`);
  }
  function del(provider: string) {
    return request(app)
      .delete(`/api/org/ai-keys/${provider}`)
      .set("Cookie", `auth_token=${adminToken}`);
  }

  // ── PUT saves ────────────────────────────────────────────────────────────
  it("PUT saves key and returns the last-4 hint", async () => {
    const apiKey = "sk-org-openai-test-save-1234";
    const res = await put("openai", apiKey);
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("openai");
    expect(res.body.keyHint).toBe(apiKey.slice(-4));
    expect(res.body.message).toMatch(/saved/i);
  });

  it("PUT upserts when the provider already has a stored key", async () => {
    await put("openai", "sk-org-openai-first-version-0001");
    const second = "sk-org-openai-second-version-002";
    const res = await put("openai", second);
    expect(res.status).toBe(200);
    expect(res.body.keyHint).toBe(second.slice(-4));
  });

  // ── GET returns hint only ────────────────────────────────────────────────
  it("GET returns rows with hint only — plaintext never exposed", async () => {
    const apiKey = "sk-org-anthropic-hint-check-5678";
    await put("anthropic", apiKey);

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.byokEnabled).toBe(true);
    expect(Array.isArray(res.body.keys)).toBe(true);

    const row = res.body.keys.find((k: { provider: string }) => k.provider === "anthropic");
    expect(row).toBeDefined();
    expect(row.keyHint).toBe(apiKey.slice(-4));
    expect(row.encryptedKey).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(apiKey);
  });

  it("GET returns byokEnabled:false and empty array when not entitled", async () => {
    isByokEntitledMock.mockResolvedValue(false);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.byokEnabled).toBe(false);
    expect(res.body.keys).toHaveLength(0);
  });

  it("GET returns byokEnabled:false when KEY_VAULT_SECRET is absent", async () => {
    delete process.env.KEY_VAULT_SECRET;
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.byokEnabled).toBe(false);
  });

  // ── DELETE reverts to platform ───────────────────────────────────────────
  it("DELETE removes the key and reports platform-default revert", async () => {
    await put("openai", "sk-org-openai-to-delete-9999");
    const delRes = await del("openai");
    expect(delRes.status).toBe(200);
    expect(delRes.body.message).toMatch(/platform default/i);

    const getRes = await get();
    const row = getRes.body.keys?.find((k: { provider: string }) => k.provider === "openai");
    expect(row).toBeUndefined();
  });

  it("DELETE returns 404 when no key is stored for the provider", async () => {
    await del("openai").catch(() => {});
    const res = await del("openai");
    expect(res.status).toBe(404);
  });

  // ── 503 when vault secret missing ───────────────────────────────────────
  it("PUT returns 503 when KEY_VAULT_SECRET is not configured", async () => {
    delete process.env.KEY_VAULT_SECRET;
    const res = await put("openai", "sk-any-key-long-enough-to-pass-zod");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/KEY_VAULT_SECRET/i);
  });

  it("DELETE returns 503 when KEY_VAULT_SECRET is not configured", async () => {
    delete process.env.KEY_VAULT_SECRET;
    const res = await del("openai");
    expect(res.status).toBe(503);
  });

  // ── 403 when entitlement is off ──────────────────────────────────────────
  it("PUT returns 403 when BYOK is not entitled", async () => {
    isByokEntitledMock.mockResolvedValue(false);
    const res = await put("anthropic", "sk-any-key-long-enough-to-pass-zod");
    expect(res.status).toBe(403);
  });

  it("DELETE returns 403 when BYOK is not entitled", async () => {
    isByokEntitledMock.mockResolvedValue(false);
    const res = await del("anthropic");
    expect(res.status).toBe(403);
  });

  // ── 400 for bad inputs ───────────────────────────────────────────────────
  it("PUT returns 400 for an unrecognised provider", async () => {
    const res = await put("cohere", "sk-any-key-long-enough-to-pass-zod");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid provider/i);
  });

  it("PUT returns 400 when apiKey is shorter than 10 characters", async () => {
    const res = await put("openai", "short");
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. resolveOrgKey — real-DB round-trip
//
//    Uses vi.importActual so the REAL resolveOrgKey closure is exercised.
//    The module-level mock replaces only the exported binding; importActual
//    bypasses that and returns the true implementation (which calls the real
//    isByokEntitled via its local module binding).
// ─────────────────────────────────────────────────────────────────────────────
describe("resolveOrgKey — real-DB round-trip", () => {
  let resolverOrgId: string;

  const origSecret = process.env.KEY_VAULT_SECRET;

  async function cleanupResolverOrg() {
    if (!resolverOrgId) return;
    const { db } = await import("../db");
    await db
      .execute(sql`DELETE FROM org_ai_keys WHERE organization_id = ${resolverOrgId}`)
      .catch(() => {});
    await db
      .execute(sql`DELETE FROM users WHERE organization_id = ${resolverOrgId}`)
      .catch(() => {});
    await db
      .execute(sql`DELETE FROM organizations WHERE id = ${resolverOrgId}`)
      .catch(() => {});
  }

  beforeAll(async () => {
    process.env.KEY_VAULT_SECRET = VAULT_SECRET;

    const { db } = await import("../db");
    const { organizations } = await import("@shared/schema");

    const slug = `${SLUG_PREFIX}resolver_${Date.now()}`;
    const [org] = await db
      .insert(organizations)
      .values({
        name: "BYOK Resolver Test Org",
        slug,
        tradeType: "GENERAL_CONTRACTOR",
        onboardingStatus: "COMPLETED",
        isActive: true,
        // Enable BYOK_AI_KEYS so the real isByokEntitled returns true.
        // (BYOK_AI_KEYS is in DISABLED_BY_DEFAULT_FLAGS — defaults to false.)
        featureFlags: JSON.stringify({ BYOK_AI_KEYS: true }),
      })
      .returning();
    resolverOrgId = org.id;
  }, 15_000);

  afterAll(async () => {
    await cleanupResolverOrg();
    if (origSecret === undefined) {
      delete process.env.KEY_VAULT_SECRET;
    } else {
      process.env.KEY_VAULT_SECRET = origSecret;
    }
  });

  beforeEach(() => {
    process.env.KEY_VAULT_SECRET = VAULT_SECRET;
  });

  afterEach(async () => {
    const { db } = await import("../db");
    await db
      .execute(sql`DELETE FROM org_ai_keys WHERE organization_id = ${resolverOrgId}`)
      .catch(() => {});
  });

  it("returns null when KEY_VAULT_SECRET is not configured", async () => {
    delete process.env.KEY_VAULT_SECRET;
    const { resolveOrgKey } = await vi.importActual<
      typeof import("../ai/providers/orgKeyResolver")
    >("../ai/providers/orgKeyResolver");
    expect(await resolveOrgKey(resolverOrgId, "openai")).toBeNull();
  });

  it("returns null when org is not entitled even if a key row exists", async () => {
    // Insert a valid encrypted key row FIRST so the only reason resolveOrgKey
    // returns null is the entitlement check — not an absent row.
    const { encryptKey } = await import("../services/keyVault");
    const { db } = await import("../db");
    const { orgAiKeys, organizations } = await import("@shared/schema");

    const plaintext = "sk-entitled-regression-guard-key";
    await db.insert(orgAiKeys).values({
      organizationId: resolverOrgId,
      provider: "openai",
      encryptedKey: encryptKey(plaintext),
      keyHint: plaintext.slice(-4),
      createdByUserId: null,
    });

    // Disable BYOK_AI_KEYS entitlement flag on the test org.
    await db
      .update(organizations)
      .set({ featureFlags: JSON.stringify({ BYOK_AI_KEYS: false }) })
      .where(eq(organizations.id, resolverOrgId));

    const { resolveOrgKey } = await vi.importActual<
      typeof import("../ai/providers/orgKeyResolver")
    >("../ai/providers/orgKeyResolver");

    const result = await resolveOrgKey(resolverOrgId, "openai");
    expect(result).toBeNull();

    // Restore entitlement for subsequent tests.
    await db
      .update(organizations)
      .set({ featureFlags: JSON.stringify({ BYOK_AI_KEYS: true }) })
      .where(eq(organizations.id, resolverOrgId));
  });

  it("returns null when no key row exists for the provider", async () => {
    const { resolveOrgKey } = await vi.importActual<
      typeof import("../ai/providers/orgKeyResolver")
    >("../ai/providers/orgKeyResolver");
    expect(await resolveOrgKey(resolverOrgId, "openai")).toBeNull();
  });

  it("decrypts and returns the stored plaintext key when entitled", async () => {
    const { encryptKey } = await import("../services/keyVault");
    const { db } = await import("../db");
    const { orgAiKeys } = await import("@shared/schema");

    const plaintext = "sk-real-key-resolve-round-trip-abc";
    await db.insert(orgAiKeys).values({
      organizationId: resolverOrgId,
      provider: "openai",
      encryptedKey: encryptKey(plaintext),
      keyHint: plaintext.slice(-4),
      createdByUserId: null,
    });

    const { resolveOrgKey } = await vi.importActual<
      typeof import("../ai/providers/orgKeyResolver")
    >("../ai/providers/orgKeyResolver");
    expect(await resolveOrgKey(resolverOrgId, "openai")).toBe(plaintext);
  });

  it("returns null (logs warning) when the stored ciphertext is malformed", async () => {
    const { db } = await import("../db");
    const { orgAiKeys } = await import("@shared/schema");

    await db.insert(orgAiKeys).values({
      organizationId: resolverOrgId,
      provider: "anthropic",
      encryptedKey: "bad:ciphertext:notvalid",
      keyHint: "xxxx",
      createdByUserId: null,
    });

    const { resolveOrgKey } = await vi.importActual<
      typeof import("../ai/providers/orgKeyResolver")
    >("../ai/providers/orgKeyResolver");
    // Must swallow decryption error and return null (fallback to platform key).
    expect(await resolveOrgKey(resolverOrgId, "anthropic")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. applyByokKeys substitution via routedChatCompletion (providers/index.ts)
//
//    applyByokKeys is private; its effects are observable through:
//      - result.keySource ("org_byok" vs "platform")
//      - whether the BYOK factory was called with the correct key
// ─────────────────────────────────────────────────────────────────────────────
describe("providers/index.ts — applyByokKeys substitution via routedChatCompletion", () => {
  const VALID_REQUEST = {
    messages: [{ role: "user" as const, content: "hello" }],
    max_completion_tokens: 256,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resolveOrgKeyMock.mockResolvedValue(null);
    mockOpenAIIsConfigured.mockReturnValue(true);
    mockAnthropicIsConfigured.mockReturnValue(true);
    mockCheckBillingQuota.mockResolvedValue({
      allowed: true,
      used: 0,
      limit: 10_000,
      overage: 0,
      billedToStripe: false,
    });
    mockConsumeBillingUsage.mockResolvedValue({
      allowed: true,
      used: 1,
      limit: 10_000,
      overage: 0,
      billedToStripe: false,
    });
    mockAnthropicChatCompletion.mockResolvedValue({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      latencyMs: 50,
      fallbackUsed: false,
    } satisfies AiChatResponse);
    mockOpenAIChatCompletion.mockResolvedValue({
      provider: "openai",
      model: "gpt-5",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      latencyMs: 50,
      fallbackUsed: false,
    } satisfies AiChatResponse);
  });

  it("keySource is 'platform' when resolveOrgKey returns null for both providers", async () => {
    resolveOrgKeyMock.mockResolvedValue(null);

    const { routedChatCompletion } = await import("../ai/providers");
    const result = await routedChatCompletion({
      orgId: "test-org",
      featureKey: "takeoff.analyze",
      request: VALID_REQUEST,
    });

    expect(result.keySource).toBe("platform");
    expect(createAnthropicProviderWithKeyMock).not.toHaveBeenCalled();
    expect(createOpenAIProviderWithKeyMock).not.toHaveBeenCalled();
  });

  it("keySource is 'org_byok' when Anthropic BYOK key is supplied and Anthropic answers", async () => {
    // Anthropic is the default primary (AI_PROVIDER_TAKEOFF defaults to true).
    resolveOrgKeyMock.mockImplementation(
      async (_orgId: string, provider: string): Promise<string | null> =>
        provider === "anthropic" ? "sk-ant-byok-key-org" : null,
    );

    const { routedChatCompletion } = await import("../ai/providers");
    const result = await routedChatCompletion({
      orgId: "test-org",
      featureKey: "takeoff.analyze",
      request: VALID_REQUEST,
    });

    expect(result.keySource).toBe("org_byok");
    expect(createAnthropicProviderWithKeyMock).toHaveBeenCalledWith("sk-ant-byok-key-org");
  });

  it("keySource is 'org_byok' when OpenAI BYOK key is patched into the fallback provider", async () => {
    // Anthropic is primary but fails → OpenAI (secondary) answers with its BYOK key.
    resolveOrgKeyMock.mockImplementation(
      async (_orgId: string, provider: string): Promise<string | null> =>
        provider === "openai" ? "sk-byok-openai-fallback" : null,
    );
    mockAnthropicChatCompletion.mockRejectedValue(
      Object.assign(new Error("Anthropic error"), { status: 500 }),
    );
    mockOpenAIChatCompletion.mockResolvedValue({
      provider: "openai",
      model: "gpt-5",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      latencyMs: 50,
      fallbackUsed: true,
    } satisfies AiChatResponse);

    const { routedChatCompletion } = await import("../ai/providers");
    const result = await routedChatCompletion({
      orgId: "test-org",
      featureKey: "takeoff.analyze",
      request: VALID_REQUEST,
    });

    expect(result.keySource).toBe("org_byok");
    expect(createOpenAIProviderWithKeyMock).toHaveBeenCalledWith("sk-byok-openai-fallback");
    expect(result.fallbackUsed).toBe(true);
  });

  it("recovers 'anthropic-not-configured' routing when org supplies a BYOK Anthropic key", async () => {
    // Platform Anthropic is not configured (no ANTHROPIC_API_KEY).
    // Org has its own key → applyByokKeys must recover the routing and
    // inject the BYOK Anthropic instance so keySource is "org_byok".
    mockAnthropicIsConfigured.mockReturnValue(false);
    resolveOrgKeyMock.mockImplementation(
      async (_orgId: string, provider: string): Promise<string | null> =>
        provider === "anthropic" ? "sk-ant-byok-recovery-key" : null,
    );

    const { routedChatCompletion } = await import("../ai/providers");
    const result = await routedChatCompletion({
      orgId: "test-org",
      featureKey: "takeoff.analyze",
      request: VALID_REQUEST,
    });

    expect(result.keySource).toBe("org_byok");
    expect(createAnthropicProviderWithKeyMock).toHaveBeenCalledWith("sk-ant-byok-recovery-key");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Provider factory shape tests
//    vi.importActual bypasses the module mock to exercise the real factory code.
// ─────────────────────────────────────────────────────────────────────────────
describe("Provider factories — real implementation via importActual", () => {
  it("createOpenAIProviderWithKey returns a configured AiProvider with the org key", async () => {
    const { createOpenAIProviderWithKey } = await vi.importActual<
      typeof import("../ai/providers/openaiProvider")
    >("../ai/providers/openaiProvider");
    const provider = createOpenAIProviderWithKey("sk-byok-openai-test-key-xxxxx");
    expect(provider.name).toBe("openai");
    expect(provider.isConfigured()).toBe(true);
    expect(typeof provider.chatCompletion).toBe("function");
  });

  it("createAnthropicProviderWithKey returns a configured AiProvider with the org key", async () => {
    const { createAnthropicProviderWithKey } = await vi.importActual<
      typeof import("../ai/providers/anthropicProvider")
    >("../ai/providers/anthropicProvider");
    const provider = createAnthropicProviderWithKey("sk-ant-byok-test-key-yyyyy");
    expect(provider.name).toBe("anthropic");
    expect(provider.isConfigured()).toBe(true);
    expect(typeof provider.chatCompletion).toBe("function");
  });

  it("two calls with different keys produce distinct, independent provider instances", async () => {
    const { createOpenAIProviderWithKey } = await vi.importActual<
      typeof import("../ai/providers/openaiProvider")
    >("../ai/providers/openaiProvider");
    const p1 = createOpenAIProviderWithKey("sk-byok-key-aaaa");
    const p2 = createOpenAIProviderWithKey("sk-byok-key-bbbb");
    expect(p1).not.toBe(p2);
    expect(p1.isConfigured()).toBe(true);
    expect(p2.isConfigured()).toBe(true);
  });
});
