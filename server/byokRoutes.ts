/**
 * Task #2948 — BYOK (Bring-Your-Own-Key) API routes for per-org AI provider keys.
 *
 * All routes are gated by ADMIN role + BYOK_AI_KEYS feature flag.
 * Keys are stored AES-256-GCM encrypted and only the last 4 chars (hint) are
 * ever returned to the client — the plaintext key is never exposed after save.
 *
 * Endpoints:
 *   GET    /api/org/ai-keys              — list all stored keys (hint only)
 *   PUT    /api/org/ai-keys/:provider    — save/update a key
 *   DELETE /api/org/ai-keys/:provider    — remove a key (reverts to platform default)
 */

import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import { orgAiKeys } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { isByokEntitled } from "./ai/providers/orgKeyResolver";
import { encryptKey, isKeyVaultConfigured } from "./services/keyVault";
import { logAudit } from "./auditLogger";
import { logWarn } from "./utils/logger";

const router = Router();

const VALID_PROVIDERS = ["openai", "anthropic"] as const;
type Provider = typeof VALID_PROVIDERS[number];

const putKeySchema = z.object({
  apiKey: z.string().min(10, "API key must be at least 10 characters"),
});

async function assertByokEnabled(orgId: string, res: any): Promise<boolean> {
  if (!isKeyVaultConfigured()) {
    res.status(503).json({
      error: "BYOK is not available: KEY_VAULT_SECRET is not configured on this server.",
    });
    return false;
  }
  // Task #2948: check plan-tier entitlement (Growth/Scale/Enterprise) OR
  // explicit BYOK_AI_KEYS feature-flag override — whichever is true wins.
  const entitled = await isByokEntitled(orgId);
  if (!entitled) {
    res.status(403).json({
      error: "BYOK AI Keys is not enabled for your organization. Upgrade to Growth, Scale, or Enterprise.",
    });
    return false;
  }
  return true;
}

/**
 * Lightweight check used by GET to report feature availability without
 * issuing a 403, so the UI can decide whether to render the BYOK card.
 */
async function checkByokEnabled(orgId: string): Promise<boolean> {
  if (!isKeyVaultConfigured()) return false;
  try {
    return await isByokEntitled(orgId);
  } catch {
    return false;
  }
}

function assertValidProvider(provider: string, res: any): provider is Provider {
  if (!VALID_PROVIDERS.includes(provider as Provider)) {
    res.status(400).json({
      error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(", ")}`,
    });
    return false;
  }
  return true;
}

router.get(
  "/api/org/ai-keys",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(400).json({ error: "Organization context required" });

      const byokEnabled = await checkByokEnabled(orgId);
      if (!byokEnabled) {
        return res.json({ keys: [], byokEnabled: false });
      }

      const rows = await db
        .select({
          id: orgAiKeys.id,
          provider: orgAiKeys.provider,
          keyHint: orgAiKeys.keyHint,
          createdAt: orgAiKeys.createdAt,
          updatedAt: orgAiKeys.updatedAt,
        })
        .from(orgAiKeys)
        .where(eq(orgAiKeys.organizationId, orgId));

      res.json({ keys: rows, byokEnabled: true });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/api/org/ai-keys/:provider",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(400).json({ error: "Organization context required" });
      if (!(await assertByokEnabled(orgId, res))) return;

      const { provider } = req.params;
      if (!assertValidProvider(provider, res)) return;

      const parsed = putKeySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
      }

      const { apiKey } = parsed.data;
      const keyHint = apiKey.slice(-4);
      const encryptedKey = encryptKey(apiKey);
      const now = new Date();

      const existing = await db
        .select({ id: orgAiKeys.id })
        .from(orgAiKeys)
        .where(and(eq(orgAiKeys.organizationId, orgId), eq(orgAiKeys.provider, provider)));

      if (existing.length > 0) {
        await db
          .update(orgAiKeys)
          .set({ encryptedKey, keyHint, updatedAt: now })
          .where(and(eq(orgAiKeys.organizationId, orgId), eq(orgAiKeys.provider, provider)));
      } else {
        await db.insert(orgAiKeys).values({
          organizationId: orgId,
          provider,
          encryptedKey,
          keyHint,
          createdByUserId: req.user!.id,
        });
      }

      await logAudit(
        {
          userId: req.user!.id,
          action: "UPDATE",
          entityType: "orgAiKey",
          entityId: `${orgId}:${provider}`,
          newValue: JSON.stringify({ provider, keyHint }),
        },
        req,
      );

      res.json({ provider, keyHint, message: "API key saved successfully" });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/api/org/ai-keys/:provider",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(400).json({ error: "Organization context required" });
      if (!(await assertByokEnabled(orgId, res))) return;

      const { provider } = req.params;
      if (!assertValidProvider(provider, res)) return;

      const deleted = await db
        .delete(orgAiKeys)
        .where(and(eq(orgAiKeys.organizationId, orgId), eq(orgAiKeys.provider, provider)))
        .returning({ id: orgAiKeys.id });

      if (deleted.length === 0) {
        return res.status(404).json({ error: "No key found for this provider" });
      }

      await logAudit(
        {
          userId: req.user!.id,
          action: "DELETE",
          entityType: "orgAiKey",
          entityId: `${orgId}:${provider}`,
          newValue: JSON.stringify({ provider }),
        },
        req,
      );

      res.json({ provider, message: "API key removed. Platform default will be used." });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
