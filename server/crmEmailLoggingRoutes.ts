/**
 * Task #886 — CRM Email Logging API
 *
 * - GET/PUT  /api/crm/email-logging/settings
 * - GET/POST /api/crm/email-logging/suppressions
 * - DELETE   /api/crm/email-logging/suppressions/:id
 * - GET      /api/crm/contacts/:id/emails
 * - GET      /api/crm/opportunities/:id/emails
 * - POST     /api/crm/email-logging/backfill (admin manual trigger)
 */

import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { db } from "./db";
import {
  crmEmailLoggingSettings,
  crmEmailLoggingSuppressions,
  crmEmailMessages,
  crmEmailThreads,
  emailAccounts,
} from "@shared/schema";
import { requireAuth, requireRole, requireRoleOrFeature, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { logError } from "./utils/logger";
import {
  backfillCrmEmailLogging,
  invalidateOrgCache,
} from "./services/crmEmailLoggerService";

const router = Router();

const settingsSchema = z.object({ mode: z.enum(["OFF", "MY_DOMAIN", "ALL"]) });
const suppressionSchema = z.object({ pattern: z.string().min(1).max(255) });

function resolveOrg(req: AuthRequest, res: any): string | null {
  const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
  if (mustDenyAccess) {
    res.status(403).json({ message: "Forbidden" });
    return null;
  }
  if (shouldFilter && orgId) return orgId;
  return req.user?.organizationId || null;
}

router.get(
  "/api/crm/email-logging/settings",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      const [row] = await db
        .select()
        .from(crmEmailLoggingSettings)
        .where(eq(crmEmailLoggingSettings.organizationId, orgId))
        .limit(1);
      res.json(row || { organizationId: orgId, mode: "OFF" });
    } catch (e) {
      next(e);
    }
  },
);

router.put(
  "/api/crm/email-logging/settings",
  requireAuth,
  requireRole("ADMIN", "SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      const parsed = settingsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: fromZodError(parsed.error).message });
      const existing = await db
        .select()
        .from(crmEmailLoggingSettings)
        .where(eq(crmEmailLoggingSettings.organizationId, orgId))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(crmEmailLoggingSettings).values({ organizationId: orgId, mode: parsed.data.mode });
      } else {
        await db
          .update(crmEmailLoggingSettings)
          .set({ mode: parsed.data.mode, updatedAt: new Date() })
          .where(eq(crmEmailLoggingSettings.organizationId, orgId));
      }
      invalidateOrgCache(orgId);
      res.json({ organizationId: orgId, mode: parsed.data.mode });
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  "/api/crm/email-logging/suppressions",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      const rows = await db
        .select()
        .from(crmEmailLoggingSuppressions)
        .where(eq(crmEmailLoggingSuppressions.organizationId, orgId))
        .orderBy(desc(crmEmailLoggingSuppressions.createdAt));
      res.json(rows);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  "/api/crm/email-logging/suppressions",
  requireAuth,
  requireRole("ADMIN", "SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      const parsed = suppressionSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: fromZodError(parsed.error).message });
      const pattern = parsed.data.pattern.trim().toLowerCase();
      try {
        const [row] = await db
          .insert(crmEmailLoggingSuppressions)
          .values({ organizationId: orgId, pattern })
          .returning();
        invalidateOrgCache(orgId);
        res.status(201).json(row);
      } catch (e: any) {
        if (String(e?.message || "").includes("duplicate")) {
          return res.status(409).json({ message: "Pattern already exists" });
        }
        throw e;
      }
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  "/api/crm/email-logging/suppressions/:id",
  requireAuth,
  requireRole("ADMIN", "SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      await db
        .delete(crmEmailLoggingSuppressions)
        .where(
          and(
            eq(crmEmailLoggingSuppressions.id, req.params.id),
            eq(crmEmailLoggingSuppressions.organizationId, orgId),
          ),
        );
      invalidateOrgCache(orgId);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  },
);

async function listEmailsByLink(orgId: string, key: "contactId" | "opportunityId", id: string) {
  const col = key === "contactId" ? crmEmailMessages.contactId : crmEmailMessages.opportunityId;
  return db
    .select()
    .from(crmEmailMessages)
    .where(and(eq(crmEmailMessages.organizationId, orgId), eq(col, id)))
    .orderBy(desc(crmEmailMessages.sentAt))
    .limit(200);
}

router.get(
  "/api/crm/contacts/:id/emails",
  requireAuth,
  requireRoleOrFeature(["ADMIN", "MANAGER"], "canViewCrmEmails"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      res.json(await listEmailsByLink(orgId, "contactId", req.params.id));
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  "/api/crm/opportunities/:id/emails",
  requireAuth,
  requireRoleOrFeature(["ADMIN", "MANAGER"], "canViewCrmEmails"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      res.json(await listEmailsByLink(orgId, "opportunityId", req.params.id));
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  "/api/crm/email-logging/backfill",
  requireAuth,
  requireRole("ADMIN", "SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = resolveOrg(req, res);
      if (!orgId) return;
      const days = Math.min(Math.max(Number(req.body?.days) || 90, 1), 365);
      const accountId: string | undefined = req.body?.accountId;
      let accounts: { id: string }[] = [];
      if (accountId) {
        accounts = await db
          .select({ id: emailAccounts.id })
          .from(emailAccounts)
          .where(and(eq(emailAccounts.id, accountId), eq(emailAccounts.organizationId, orgId)));
      } else {
        accounts = await db
          .select({ id: emailAccounts.id })
          .from(emailAccounts)
          .where(eq(emailAccounts.organizationId, orgId));
      }
      const results = await Promise.all(
        accounts.map((a) => backfillCrmEmailLogging(a.id, days).catch((err) => {
          logError("backfill failed", { accountId: a.id }, err instanceof Error ? err : new Error(String(err)));
          return { scanned: 0, logged: 0 };
        })),
      );
      const logged = results.reduce((s, r) => s + (r?.logged ?? 0), 0);
      const scanned = results.reduce((s, r) => s + (r?.scanned ?? 0), 0);
      res.json({ accounts: accounts.length, scanned, logged });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
