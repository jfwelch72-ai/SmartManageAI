import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, gte } from "drizzle-orm";
import * as fs from "fs/promises";
import * as path from "path";
import { db } from "./db";
import {
  organizationSubscriptions,
  supportTickets,
  insertSupportTicketSchema,
  type SupportTicket,
} from "@shared/schema";
import type { SQL } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logError, logInfo } from "./utils/logger";
import { sendEmail } from "./email";
import {
  SLA_TIERS,
  planTierToSupportTier,
  firstResponseDueAt,
  resolutionDueAt,
  type SupportTier,
  type SupportPriority,
} from "./support/slaPolicy";
import { runSlaSweep } from "./support/slaMonitor";

const router = Router();

const HELP_DIR = path.join(process.cwd(), "docs", "help");
const SUPPORT_INBOX = process.env.SUPPORT_INBOX_EMAIL || "support@smartmanageai.local";

// ──────────────────────────────────────────────────────────────────────────────
// Help center articles (Markdown-driven)
// ──────────────────────────────────────────────────────────────────────────────

interface HelpArticle {
  slug: string;
  title: string;
  module: string;
  tags: string[];
  routes: string[];
  body: string;
}

interface HelpSummary {
  slug: string;
  title: string;
  module: string;
  tags: string[];
  routes: string[];
  excerpt: string;
}

let cache: { loadedAt: number; articles: HelpArticle[] } | null = null;
const CACHE_TTL_MS = 60_000;

async function loadArticles(): Promise<HelpArticle[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.articles;

  let manifest: Array<Pick<HelpArticle, "slug" | "title" | "module" | "tags" | "routes">> = [];
  try {
    const raw = await fs.readFile(path.join(HELP_DIR, "manifest.json"), "utf8");
    manifest = JSON.parse(raw);
  } catch (err) {
    logError("Failed to load help center manifest", err);
    cache = { loadedAt: Date.now(), articles: [] };
    return [];
  }

  const articles = await Promise.all(
    manifest.map(async (entry) => {
      try {
        const body = await fs.readFile(path.join(HELP_DIR, `${entry.slug}.md`), "utf8");
        return { ...entry, body } satisfies HelpArticle;
      } catch (err) {
        logError(`Failed to load help article ${entry.slug}`, err);
        return null;
      }
    }),
  );

  cache = { loadedAt: Date.now(), articles: articles.filter((a): a is HelpArticle => a !== null) };
  return cache.articles;
}

function summarize(article: HelpArticle): HelpSummary {
  const stripped = article.body.replace(/^#+\s.*$/m, "").replace(/[#*_`>]/g, "").trim();
  return {
    slug: article.slug,
    title: article.title,
    module: article.module,
    tags: article.tags,
    routes: article.routes,
    excerpt: stripped.slice(0, 220),
  };
}

router.get("/api/support/help/articles", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const route = String(req.query.route || "").trim().toLowerCase();
    const articles = await loadArticles();

    let filtered = articles;
    if (q) {
      filtered = filtered.filter((a) => {
        const haystack = `${a.title}\n${a.tags.join(" ")}\n${a.module}\n${a.body}`.toLowerCase();
        return haystack.includes(q);
      });
    }
    if (route) {
      const matchedByRoute = articles.filter((a) =>
        a.routes.some((r) => route.startsWith(r.toLowerCase())),
      );
      const set = new Set(filtered.map((a) => a.slug));
      for (const a of matchedByRoute) if (!set.has(a.slug)) filtered.push(a);
    }

    res.json({ articles: filtered.map(summarize) });
  } catch (err) {
    next(err);
  }
});

router.get("/api/support/help/articles/:slug", async (req, res, next) => {
  try {
    const articles = await loadArticles();
    const article = articles.find((a) => a.slug === req.params.slug);
    if (!article) return res.status(404).json({ error: "Article not found" });
    res.json(article);
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Support tickets
// ──────────────────────────────────────────────────────────────────────────────

const ticketBodySchema = insertSupportTicketSchema.extend({
  subject: z.string().min(3).max(200),
  body: z.string().min(5).max(20_000),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
});

router.post("/api/support/tickets", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const parsed = ticketBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    }

    // Tier is derived server-side only — never trust a client-supplied value,
    // since SLA windows are tied to the billing plan. SUPER_ADMIN can override
    // for diagnostics; everyone else gets the org's billing plan tier mapped
    // through `planTierToSupportTier`. Orgs without a record fall back to
    // "starter".
    const adminOverride =
      req.user?.role === "SUPER_ADMIN" && typeof req.query.tier === "string"
        ? (req.query.tier as SupportTier)
        : undefined;

    let tier: SupportTier;
    if (adminOverride && (["starter", "pro", "enterprise"] as const).includes(adminOverride)) {
      tier = adminOverride;
    } else if (req.user?.organizationId) {
      const [sub] = await db
        .select({ planTier: organizationSubscriptions.planTier })
        .from(organizationSubscriptions)
        .where(eq(organizationSubscriptions.organizationId, req.user.organizationId));
      tier = planTierToSupportTier(sub?.planTier ?? null);
    } else {
      tier = "starter";
    }
    const submitterName =
      parsed.data.submitterName ||
      [req.user?.firstName, req.user?.lastName].filter(Boolean).join(" ") ||
      null;

    const now = new Date();
    const priority: SupportPriority = parsed.data.priority ?? "normal";
    const slaFirstResponseDueAt = firstResponseDueAt(now, tier, priority);
    const slaResolutionDueAt = resolutionDueAt(now, tier, priority);
    const frTarget = SLA_TIERS[tier].firstResponse[priority];
    const resTarget = SLA_TIERS[tier].resolution[priority];

    const insertRow = {
      organizationId: req.user?.organizationId || null,
      userId: req.user?.id || null,
      submitterEmail: parsed.data.submitterEmail || req.user?.email || "unknown@local",
      submitterName,
      subject: parsed.data.subject,
      body: parsed.data.body,
      route: parsed.data.route ?? null,
      userAgent: parsed.data.userAgent ?? req.headers["user-agent"] ?? null,
      metadata: parsed.data.metadata ?? {},
      tier,
      priority,
      slaFirstResponseDueAt,
      slaResolutionDueAt,
    } as typeof supportTickets.$inferInsert;

    const [row] = await db.insert(supportTickets).values(insertRow).returning();

    // Best-effort: notify the support inbox. Don't block the response on email.
    void sendEmail({
      to: SUPPORT_INBOX,
      subject: `[Support][${tier}/${row.priority}] ${row.subject}`,
      text: `From: ${row.submitterName || ""} <${row.submitterEmail}>
Org: ${row.organizationId || "—"}
Route: ${row.route || "—"}
Tier: ${tier}
Priority: ${priority}
First-response SLA: ${frTarget.amount} ${frTarget.unit} (${frTarget.clock}) — due ${slaFirstResponseDueAt.toISOString()}
Resolution SLA: ${resTarget.amount} ${resTarget.unit} (${resTarget.clock}) — due ${slaResolutionDueAt.toISOString()}
Ticket ID: ${row.id}

----
${row.body}`,
      replyTo: row.submitterEmail,
    }).catch((err) => logError("support ticket email failed", err));

    logInfo(`[support] ticket ${row.id} opened (tier=${tier}, priority=${row.priority})`);
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

const ADMIN_ROLES = ["ADMIN", "HUSTLER", "SUPER_ADMIN"] as const;

router.get(
  "/api/support/tickets",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const priority = typeof req.query.priority === "string" ? req.query.priority : undefined;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const orgId = req.user?.organizationId || null;
      const isSuperAdmin = req.user?.role === "SUPER_ADMIN";

      // Fail-closed tenant scoping: a non-SUPER_ADMIN admin without an
      // organizationId has no tenant to scope to and must NOT see the
      // global ticket pool. Return an empty set rather than risk leaking
      // cross-tenant support content (subjects, bodies, submitter PII).
      if (!isSuperAdmin && !orgId) {
        return res.json({ tickets: [] });
      }

      const conditions: SQL[] = [];
      if (!isSuperAdmin && orgId) {
        conditions.push(eq(supportTickets.organizationId, orgId));
      }
      if (status) {
        conditions.push(eq(supportTickets.status, status as SupportTicket["status"]));
      }
      if (priority) {
        conditions.push(eq(supportTickets.priority, priority as SupportTicket["priority"]));
      }

      const rows = await db
        .select()
        .from(supportTickets)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(supportTickets.createdAt))
        .limit(limit);

      res.json({ tickets: rows });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/api/support/tickets/:id",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const patch = z
        .object({
          status: z.enum(["open", "in_progress", "waiting_on_customer", "resolved", "closed"]).optional(),
          priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
          assignedTo: z.string().nullable().optional(),
          markFirstResponse: z.boolean().optional(),
        })
        .safeParse(req.body);
      if (!patch.success) return res.status(400).json({ error: "Invalid input" });

      // Tenant scoping: a non-SUPER_ADMIN may only mutate tickets that belong
      // to their own organization. We do this with a 404 (not 403) so callers
      // can't probe for ticket IDs outside their tenant.
      const [existing] = await db
        .select({ id: supportTickets.id, organizationId: supportTickets.organizationId })
        .from(supportTickets)
        .where(eq(supportTickets.id, req.params.id));
      if (!existing) return res.status(404).json({ error: "Ticket not found" });
      if (
        req.user?.role !== "SUPER_ADMIN" &&
        existing.organizationId !== (req.user?.organizationId ?? null)
      ) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      const updates: Partial<typeof supportTickets.$inferInsert> = { updatedAt: new Date() };
      if (patch.data.status) updates.status = patch.data.status;
      if (patch.data.priority) updates.priority = patch.data.priority;
      if (patch.data.assignedTo !== undefined) updates.assignedTo = patch.data.assignedTo;
      if (patch.data.markFirstResponse) updates.firstResponseAt = new Date();
      if (patch.data.status === "resolved" || patch.data.status === "closed") {
        updates.resolvedAt = new Date();
      }

      const [row] = await db
        .update(supportTickets)
        .set(updates)
        .where(eq(supportTickets.id, req.params.id))
        .returning();
      if (!row) return res.status(404).json({ error: "Ticket not found" });
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

// SLA breach sweep — flips the breach flags so the weekly report can pick
// them up. Locked to SUPER_ADMIN because the sweep mutates platform-wide
// support state across every tenant. The hourly background scheduler
// (see server/supportWeeklyReport.ts) handles the routine case; this
// endpoint is only for ops to force a manual run.
router.post(
  "/api/support/tickets/sla/sweep",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (_req: AuthRequest, res, next) => {
    try {
      const result = await runSlaSweep();
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// Recent KPI metrics, used by both the weekly report job and the admin dashboard.
router.get(
  "/api/support/tickets/metrics",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const since = new Date(Date.now() - 7 * 24 * 3_600_000);
      const orgId = req.user?.organizationId || null;
      const isSuperAdmin = req.user?.role === "SUPER_ADMIN";

      // Same fail-closed scoping as the list endpoint — never expose
      // cross-tenant aggregate metrics to a non-SUPER_ADMIN admin who
      // happens to have a null organizationId.
      if (!isSuperAdmin && !orgId) {
        return res.json({
          windowDays: 7,
          total: 0,
          open: 0,
          resolved: 0,
          firstResponseBreached: 0,
          resolutionBreached: 0,
        });
      }

      const conditions = [gte(supportTickets.createdAt, since)];
      if (!isSuperAdmin && orgId) {
        conditions.push(eq(supportTickets.organizationId, orgId));
      }
      const rows = await db
        .select()
        .from(supportTickets)
        .where(and(...conditions));

      const total = rows.length;
      const open = rows.filter((r) => r.status === "open" || r.status === "in_progress").length;
      const resolved = rows.filter((r) => r.status === "resolved" || r.status === "closed").length;
      const firstRespBreached = rows.filter((r) => r.slaFirstResponseBreached === 1).length;
      const resBreached = rows.filter((r) => r.slaResolutionBreached === 1).length;

      res.json({
        windowDays: 7,
        total,
        open,
        resolved,
        firstResponseBreached: firstRespBreached,
        resolutionBreached: resBreached,
        adherence: total === 0 ? 1 : 1 - (firstRespBreached + resBreached) / (total * 2),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
