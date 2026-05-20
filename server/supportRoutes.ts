import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, gte, isNotNull, isNull, like, lte, ne, sql } from "drizzle-orm";
import * as fs from "fs/promises";
import * as path from "path";
import multer from "multer";
import { randomUUID } from "crypto";
import { db } from "./db";
import {
  organizations,
  organizationSubscriptions,
  supportTickets,
  supportTicketReplies,
  supportCannedResponses,
  users,
  supportSettings,
  supportHolidays,
  insertSupportTicketSchema,
  insertSupportCannedResponseSchema,
  type SupportTicket,
  type SupportTicketReply,
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
  getHolidaySet,
  invalidateHolidayCache,
  type SupportTier,
  type SupportPriority,
} from "./support/slaPolicy";
import { runSlaSweep } from "./support/slaMonitor";
import { supportEventBus, getRecentActivity, type SupportActivityEvent } from "./supportEventBus";
import { inboundEmailLimiter } from "./rateLimiter";
import { logCreate, logSystemAudit } from "./auditLogger";
import { objectStorageClient, parseObjectPath } from "./objectStorage";

const router = Router();

const HELP_DIR = path.join(process.cwd(), "docs", "help");
const SUPPORT_INBOX = process.env.SUPPORT_INBOX_EMAIL || "support@smartmanageai.local";

// ──────────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────────

/** Strip HTML tags to produce safe plain text for storage. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Extract the Message-ID value from a raw headers string as provided by
 * SendGrid Inbound Parse (e.g. "Message-ID: <abc@mail.example.com>\n...").
 * Returns the angle-bracket-wrapped value including the brackets, which is
 * the canonical form expected by In-Reply-To / References.
 */
function parseMessageId(rawHeaders: string): string | null {
  const match = /^message-id:\s*(\S+)/im.exec(rawHeaders);
  return match ? match[1].trim() : null;
}

/** Parse the From header into { name, email }. */
function parseFrom(from: string): { name: string | null; email: string } {
  const match = /^(?:"?(.+?)"?\s+)?<([^>]+)>$/.exec(from.trim());
  if (match) return { name: match[1]?.trim() || null, email: match[2].toLowerCase() };
  return { name: null, email: from.trim().toLowerCase() };
}

/**
 * Multer instance — 25 MB hard ceiling per file (DoS guard; above our 10 MB
 * soft skip threshold so email-sized files are always accepted).  The route
 * wraps this middleware and handles MulterError so one oversized file doesn't
 * reject the whole multipart payload.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 20, fieldSize: 2 * 1024 * 1024 },
});

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
  category: z.enum(["bids", "payroll", "ai_estimator", "change_orders", "documents", "general"]).optional(),
});

router.post("/api/support/tickets", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const parsed = ticketBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    }

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

    // Resolve the org's support timezone + holiday calendar for SLA computation.
    const orgId = req.user?.organizationId || null;
    let slaTimezone = "UTC";
    if (orgId) {
      const [orgSettings] = await db
        .select({ supportTimezone: supportSettings.supportTimezone })
        .from(supportSettings)
        .where(eq(supportSettings.organizationId, orgId));
      if (orgSettings?.supportTimezone) slaTimezone = orgSettings.supportTimezone;
    }
    const holidays = await getHolidaySet("US");
    const slaOpts = { timezone: slaTimezone, holidays };

    const slaFirstResponseDueAt = firstResponseDueAt(now, tier, priority, slaOpts);
    const slaResolutionDueAt = resolutionDueAt(now, tier, priority, slaOpts);
    const frTarget = SLA_TIERS[tier].firstResponse[priority];
    const resTarget = SLA_TIERS[tier].resolution[priority];

    const insertRow = {
      organizationId: req.user?.organizationId || null,
      userId: req.user?.id || null,
      submitterEmail: parsed.data.submitterEmail || req.user?.email || "unknown@local",
      submitterName,
      subject: parsed.data.subject,
      body: parsed.data.body,
      category: parsed.data.category ?? null,
      route: parsed.data.route ?? null,
      userAgent: parsed.data.userAgent ?? req.headers["user-agent"] ?? null,
      metadata: parsed.data.metadata ?? {},
      tier,
      priority,
      slaFirstResponseDueAt,
      slaResolutionDueAt,
    } as typeof supportTickets.$inferInsert;

    const [row] = await db.insert(supportTickets).values(insertRow).returning();

    // Emit activity event for the global feed
    {
      const [orgRow] = row.organizationId
        ? await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, row.organizationId))
        : [];
      supportEventBus.emitActivity({
        id: randomUUID(),
        type: "created",
        ticketId: row.id,
        subject: row.subject,
        orgName: orgRow?.name ?? null,
        timestamp: row.createdAt.toISOString(),
      });
    }

    void sendEmail({
      to: SUPPORT_INBOX,
      subject: `[Support][${tier}/${row.priority}] ${row.subject}`,
      text: `From: ${row.submitterName || ""} <${row.submitterEmail}>
Org: ${row.organizationId || "—"}
Route: ${row.route || "—"}
Tier: ${tier}
Priority: ${priority}
Category: ${row.category || "—"}
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
      const category = typeof req.query.category === "string" ? req.query.category : undefined;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const orgId = req.user?.organizationId || null;
      const isSuperAdmin = req.user?.role === "SUPER_ADMIN";

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
      if (category) {
        type CategoryValue = "bids" | "payroll" | "ai_estimator" | "change_orders" | "documents" | "general";
        conditions.push(eq(supportTickets.category, category as CategoryValue));
      }

      const csat = typeof req.query.csat === "string" ? req.query.csat : undefined;
      if (csat === "rated") {
        conditions.push(isNotNull(supportTickets.csatScore));
      } else if (csat === "unrated") {
        conditions.push(sql`(${supportTickets.csatScore} IS NULL OR ${supportTickets.csatToken} IS NULL)`);
      } else if (csat === "high") {
        conditions.push(isNotNull(supportTickets.csatScore));
        conditions.push(gte(supportTickets.csatScore, 4));
      } else if (csat === "low") {
        conditions.push(isNotNull(supportTickets.csatScore));
        conditions.push(lte(supportTickets.csatScore, 3));
      }

      const rows = await db
        .select({
          ticket: supportTickets,
          replyCount: sql<number>`(select count(*) from support_ticket_replies where ticket_id = ${supportTickets.id})::int`.as("reply_count"),
        })
        .from(supportTickets)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(supportTickets.createdAt))
        .limit(limit);

      res.json({ tickets: rows.map((r) => ({ ...r.ticket, replyCount: Number(r.replyCount) })) });
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

      const [existing] = await db
        .select({ id: supportTickets.id, organizationId: supportTickets.organizationId, status: supportTickets.status, submitterEmail: supportTickets.submitterEmail, submitterName: supportTickets.submitterName, subject: supportTickets.subject })
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
        // Generate CSAT token if moving to resolved/closed for first time
        const wasNotResolved = existing.status !== "resolved" && existing.status !== "closed";
        if (wasNotResolved) {
          const csatToken = randomUUID();
          const csatTokenExpiresAt = new Date(Date.now() + 7 * 24 * 3_600_000);
          updates.csatToken = csatToken;
          updates.csatTokenExpiresAt = csatTokenExpiresAt;

          // Send CSAT email best-effort
          const ratingUrl = `${process.env.APP_URL || "https://smartmanageai.com"}/support/rate/${csatToken}`;
          void sendEmail({
            to: existing.submitterEmail,
            subject: `How did we do? Rate your support experience — Ticket #${existing.id.slice(0, 8)}`,
            text: `Hello ${existing.submitterName || ""},

Your support ticket "${existing.subject}" has been resolved.

We'd love to hear how we did! Please take a moment to rate your experience (1–5 stars):

${ratingUrl}

This link expires in 7 days.

Thank you,
SmartManageAI Support`,
            replyTo: SUPPORT_INBOX,
          }).catch((err) => logError("CSAT email failed", err));
        }
      }

      const [row] = await db
        .update(supportTickets)
        .set(updates)
        .where(eq(supportTickets.id, req.params.id))
        .returning();
      if (!row) return res.status(404).json({ error: "Ticket not found" });

      // Emit activity event for status changes.
      // Always use type "status_changed" here — sla_breach events are emitted
      // exclusively by the SLA sweep at the moment breach flags flip.
      if (patch.data.status) {
        const [orgRow] = row.organizationId
          ? await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, row.organizationId))
          : [];
        supportEventBus.emitActivity({
          id: randomUUID(),
          type: "status_changed",
          ticketId: row.id,
          subject: row.subject,
          orgName: orgRow?.name ?? null,
          timestamp: new Date().toISOString(),
          meta: { status: patch.data.status },
        });
      }

      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

// ──────────────────────────────────────────────────────────────────────────────
// Ticket replies (SUPER_ADMIN only)
// ──────────────────────────────────────────────────────────────────────────────

const replyBodySchema = z.object({
  body: z.string().min(1).max(20_000),
});

router.get(
  "/api/support/tickets/:id/replies",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const rows = await db
        .select()
        .from(supportTicketReplies)
        .where(eq(supportTicketReplies.ticketId, req.params.id))
        .orderBy(supportTicketReplies.createdAt);
      res.json({ replies: rows });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/api/support/tickets/:id/replies",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const parsed = replyBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
      }

      const [ticket] = await db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.id, req.params.id));
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });

      const authorName =
        [req.user?.firstName, req.user?.lastName].filter(Boolean).join(" ") || "Support Team";

      const ticketUpdates: Partial<typeof supportTickets.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (!ticket.firstResponseAt) {
        ticketUpdates.firstResponseAt = new Date();
      }
      if (ticket.status === "open") {
        ticketUpdates.status = "in_progress";
      }

      // Generate a stable Message-ID for this outbound agent reply so the
      // customer's email client can thread it, and so the inbound-email handler
      // can reference it when notifying SUPPORT_INBOX of a subsequent customer reply.
      const outboundMessageId = `<${randomUUID()}@support.smartmanageai.com>`;

      const { reply, updatedTicket } = await db.transaction(async (tx) => {
        const [reply] = await tx
          .insert(supportTicketReplies)
          .values({
            ticketId: ticket.id,
            authorId: req.user?.id ?? null,
            authorName,
            body: parsed.data.body,
            emailMessageId: outboundMessageId,
          } as typeof supportTicketReplies.$inferInsert)
          .returning();

        const [updatedTicket] = await tx
          .update(supportTickets)
          .set(ticketUpdates)
          .where(eq(supportTickets.id, ticket.id))
          .returning();

        return { reply, updatedTicket };
      });

      // Build email threading headers so the customer's email client shows the
      // reply as part of the original conversation thread.
      // In-Reply-To = most recent inbound Message-ID; References = full chain.
      // Message-ID is set to the locally-generated outboundMessageId so future
      // inbound replies from the customer can reference it.
      const inboundMessageIds: string[] = [];
      if (ticket.emailMessageId) inboundMessageIds.push(ticket.emailMessageId);
      const inboundReplies = await db
        .select({ emailMessageId: supportTicketReplies.emailMessageId })
        .from(supportTicketReplies)
        .where(
          and(
            eq(supportTicketReplies.ticketId, ticket.id),
            isNotNull(supportTicketReplies.emailMessageId),
            ne(supportTicketReplies.id, reply.id),
          ),
        )
        .orderBy(supportTicketReplies.createdAt);
      for (const r of inboundReplies) {
        if (r.emailMessageId) inboundMessageIds.push(r.emailMessageId);
      }
      const threadingHeaders: Record<string, string> = {};
      threadingHeaders["Message-ID"] = outboundMessageId;
      if (inboundMessageIds.length > 0) {
        threadingHeaders["In-Reply-To"] = inboundMessageIds[inboundMessageIds.length - 1];
        threadingHeaders["References"] = inboundMessageIds.join(" ");
      }

      // Send email to submitter — best effort
      let emailedAt: Date | null = null;
      const emailPromise = sendEmail({
        to: ticket.submitterEmail,
        subject: `Re: [Ticket #${ticket.id.slice(0, 8)}] ${ticket.subject}`,
        text: `Hello ${ticket.submitterName || ""},

A member of our support team has replied to your ticket:

----
${parsed.data.body}
----

You can reply by responding to this email or by opening a new support ticket.

Best regards,
${authorName}
SmartManageAI Support`,
        replyTo: SUPPORT_INBOX,
        headers: Object.keys(threadingHeaders).length > 0 ? threadingHeaders : undefined,
      })
        .then(async () => {
          emailedAt = new Date();
          await db
            .update(supportTicketReplies)
            .set({ emailedAt })
            .where(eq(supportTicketReplies.id, reply.id));
        })
        .catch((err) => logError("support reply email failed", err));

      void emailPromise;

      // Notify any open SSE connections for this ticket.
      supportEventBus.emitReplyCreated({ ticketId: ticket.id, reply });

      logInfo(`[support] reply ${reply.id} added to ticket ${ticket.id} by ${req.user?.id}`);
      res.status(201).json({ reply, ticket: updatedTicket });
    } catch (err) {
      next(err);
    }
  },
);

// ──────────────────────────────────────────────────────────────────────────────
// My-tickets endpoints
// ──────────────────────────────────────────────────────────────────────────────

router.get("/api/support/my-tickets", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.userId, userId))
      .orderBy(desc(supportTickets.createdAt))
      .limit(limit);

    res.json({ tickets: rows });
  } catch (err) {
    next(err);
  }
});

router.get("/api/support/my-tickets/:id/replies", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const [ticket] = await db
      .select({ id: supportTickets.id, userId: supportTickets.userId })
      .from(supportTickets)
      .where(eq(supportTickets.id, req.params.id));

    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    if (ticket.userId !== userId) return res.status(404).json({ error: "Ticket not found" });

    const replies = await db
      .select()
      .from(supportTicketReplies)
      .where(eq(supportTicketReplies.ticketId, ticket.id))
      .orderBy(supportTicketReplies.createdAt);

    res.json({ replies });
  } catch (err) {
    next(err);
  }
});

router.post("/api/support/my-tickets/:id/replies", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = replyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    }

    const [ticket] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, req.params.id));

    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    if (ticket.userId !== userId) return res.status(404).json({ error: "Ticket not found" });

    const authorName =
      [req.user?.firstName, req.user?.lastName].filter(Boolean).join(" ") ||
      ticket.submitterName ||
      "Customer";

    const ticketUpdates: Partial<typeof supportTickets.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (ticket.status === "waiting_on_customer") {
      ticketUpdates.status = "in_progress";
    }

    const { reply, updatedTicket } = await db.transaction(async (tx) => {
      const [reply] = await tx
        .insert(supportTicketReplies)
        .values({
          ticketId: ticket.id,
          authorId: userId,
          authorName,
          body: parsed.data.body,
        } as typeof supportTicketReplies.$inferInsert)
        .returning();

      const [updatedTicket] = await tx
        .update(supportTickets)
        .set(ticketUpdates)
        .where(eq(supportTickets.id, ticket.id))
        .returning();

      return { reply, updatedTicket };
    });

    void sendEmail({
      to: SUPPORT_INBOX,
      subject: `Re: [Ticket #${ticket.id.slice(0, 8)}] ${ticket.subject}`,
      text: `Customer reply from ${authorName} <${ticket.submitterEmail}>:

----
${parsed.data.body}
----

Ticket ID: ${ticket.id}`,
      replyTo: ticket.submitterEmail,
    }).catch((err) => logError("customer reply email failed", err));

    // Notify any open SSE connections for this ticket.
    supportEventBus.emitReplyCreated({ ticketId: ticket.id, reply });

    logInfo(`[support] customer reply ${reply.id} added to ticket ${ticket.id} by user ${userId}`);
    res.status(201).json({ reply, ticket: updatedTicket });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// SSE — real-time reply streaming
// GET /api/support/tickets/:id/stream
// Accessible to: SUPER_ADMIN, ADMIN (any ticket) or the ticket's own userId.
// ──────────────────────────────────────────────────────────────────────────────

router.get("/api/support/tickets/:id/stream", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const ticketId = req.params.id;
    const userId = req.user?.id;
    const role = req.user?.role;

    // Load the ticket so we can check access.
    const [ticket] = await db
      .select({ id: supportTickets.id, userId: supportTickets.userId, organizationId: supportTickets.organizationId })
      .from(supportTickets)
      .where(eq(supportTickets.id, ticketId));

    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    // Auth parity with the REST reply endpoints:
    //   Admin path  GET /api/support/tickets/:id/replies   → requireRole("SUPER_ADMIN")
    //   User path   GET /api/support/my-tickets/:id/replies → requireAuth + owner check
    // SSE mirrors exactly the same rules:
    //   - SUPER_ADMIN: any ticket
    //   - All other roles: only their own ticket (userId match)
    // ADMIN / HUSTLER are intentionally excluded from the admin-side reply path
    // to match the least-privilege policy of the REST layer.
    const isSuperAdmin = role === "SUPER_ADMIN";
    const isOwner = userId != null && ticket.userId === userId;

    if (!isSuperAdmin && !isOwner) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Open SSE connection.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        // Connection already closed
      }
    };

    // Send an initial confirmation that the stream is open.
    send("connected", { ticketId });

    // Register domain event listener.
    const unsubscribe = supportEventBus.onReplyCreated(ticketId, (payload) => {
      send("reply", payload.reply);
    });

    // 60-second keepalive ping so proxies don't time out the connection.
    const keepalive = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(keepalive);
      }
    }, 60_000);

    req.on("close", () => {
      clearInterval(keepalive);
      unsubscribe();
    });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// SendGrid Inbound Parse webhook
// POST /api/support/inbound-email
// Public — no session required. Protected by X-Support-Inbound-Token header.
// ──────────────────────────────────────────────────────────────────────────────

const TICKET_REF_RE = /\[Ticket #([a-f0-9-]{8,})\]/i;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Wrap multer middleware so a single oversized-file MulterError (LIMIT_FILE_SIZE)
 * is logged and swallowed rather than aborting the entire multipart parse. Other
 * multer errors (e.g. LIMIT_UNEXPECTED_FILE) still propagate to Express.
 */
function multerAny(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  upload.any()(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      logInfo(`[support/inbound] multer LIMIT_FILE_SIZE — oversized attachment skipped, continuing with partial payload`);
      return next();
    }
    next(err as Error | undefined);
  });
}

/**
 * Lightweight auth guard — runs BEFORE multer so unauthenticated requests are
 * rejected without parsing the (potentially large) multipart body.
 * Fail-closed: if SUPPORT_INBOUND_SECRET is not configured, every request is
 * rejected so the endpoint is never accidentally left public.
 */
function inboundSecretGuard(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  const expectedSecret = process.env.SUPPORT_INBOUND_SECRET;
  if (!expectedSecret || req.headers["x-support-inbound-token"] !== expectedSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

router.post(
  "/api/support/inbound-email",
  inboundEmailLimiter,
  inboundSecretGuard,
  multerAny,
  async (req, res, next) => {
    try {
      const correlationId = (req.headers["x-request-id"] as string | undefined) ?? "";
      const rawFrom = String(req.body?.from || "");
      const subject = String(req.body?.subject || "(no subject)").slice(0, 500);
      const textBody = String(req.body?.text || "").slice(0, 20_000);
      const htmlBody = String(req.body?.html || "");

      // Capture the Message-ID from the raw headers field SendGrid provides.
      // We persist this so outbound admin replies can reference it in
      // In-Reply-To / References and keep the thread intact in email clients.
      const rawEmailHeaders = String(req.body?.headers || "");
      const inboundMessageId = parseMessageId(rawEmailHeaders);

      const { name: senderName, email: senderEmail } = parseFrom(rawFrom);

      // Prefer plain-text; fall back to HTML-stripped version.
      const body = (textBody.trim() || stripHtml(htmlBody)).slice(0, 20_000) || "(no body)";

      // Match sender email to an existing user.
      const [matchedUser] = senderEmail
        ? await db
            .select({ id: users.id, organizationId: users.organizationId })
            .from(users)
            .where(eq(users.email, senderEmail))
            .limit(1)
        : [];

      // Check for a ticket reference in the subject line.
      const refMatch = TICKET_REF_RE.exec(subject);
      const referencedId = refMatch ? refMatch[1] : null;

      // Save attachments to object storage (best-effort; skip files > 10 MB).
      const files = (req.files as Express.Multer.File[]) ?? [];
      const attachmentKeys: string[] = [];
      const privateDir = process.env.PRIVATE_OBJECT_DIR;
      if (privateDir) {
        for (const file of files) {
          if (file.size > MAX_ATTACHMENT_BYTES) {
            logInfo(`[support/inbound] skipping oversized attachment ${file.originalname} (${file.size} bytes)`);
            continue;
          }
          try {
            const { randomUUID } = await import("crypto");
            const objectKey = `${privateDir}/support/email-attachments/${randomUUID()}`;
            const { bucketName, objectName } = parseObjectPath(objectKey);
            const bucket = objectStorageClient.bucket(bucketName);
            await bucket.file(objectName).save(file.buffer, {
              metadata: { contentType: file.mimetype },
            });
            attachmentKeys.push(objectKey);
          } catch (err) {
            logError(`[support/inbound] attachment upload failed for ${file.originalname}`, err);
          }
        }
      }

      let ticketId: string;
      let eventAction: string;

      if (referencedId) {
        // Try to append a reply to the existing ticket.  Outbound notification
        // emails embed only the first 8 hex chars of the ticket UUID in the
        // subject (e.g. [Ticket #a1b2c3d4]).  Use a LIKE prefix match so both
        // short refs (from customer reply-to-email) and full UUIDs (deep links)
        // resolve correctly.  The trailing '%' is safe because UUIDs are
        // canonical and the 8-char prefix has 16^8 ≈ 4 billion combinations.
        const refPattern = referencedId.endsWith("%") ? referencedId : `${referencedId}%`;
        const [existingTicket] = await db
          .select()
          .from(supportTickets)
          .where(like(supportTickets.id, refPattern))
          .limit(1);

        if (existingTicket) {
          const authorName = senderName ?? senderEmail;

          // Build reply body — append attachment info when present.
          const replyBody = attachmentKeys.length
            ? `${body}\n\n[${attachmentKeys.length} attachment(s) saved: ${attachmentKeys.join(", ")}]`
            : body;

          const [reply] = await db
            .insert(supportTicketReplies)
            .values({
              ticketId: existingTicket.id,
              authorId: matchedUser?.id ?? null,
              authorName,
              body: replyBody,
              emailMessageId: inboundMessageId ?? null,
            } as typeof supportTicketReplies.$inferInsert)
            .returning();

          // Move ticket back to in_progress if it was waiting on customer.
          // Also persist attachment keys on the ticket metadata.
          const ticketMeta = {
            ...(existingTicket.metadata ?? {}),
            ...(attachmentKeys.length ? { emailAttachments: [
              ...((existingTicket.metadata as Record<string, unknown> & { emailAttachments?: string[] })?.emailAttachments ?? []),
              ...attachmentKeys,
            ]} : {}),
          };
          const ticketUpdate: Partial<typeof supportTickets.$inferInsert> = { updatedAt: new Date(), metadata: ticketMeta };
          if (existingTicket.status === "waiting_on_customer") {
            ticketUpdate.status = "in_progress";
          }
          await db.update(supportTickets).set(ticketUpdate).where(eq(supportTickets.id, existingTicket.id));

          // Emit real-time event.
          supportEventBus.emitReplyCreated({ ticketId: existingTicket.id, reply });

          // Notify SUPPORT_INBOX that a customer email reply was received, threaded
          // under the most recent agent reply so the conversation stays intact in
          // the support team's email client (bidirectional threading).
          void (async () => {
            try {
              // Find the most recent agent reply that has a stored outbound Message-ID.
              // Join to users and filter role = SUPER_ADMIN to reliably distinguish
              // agent-sent replies from inbound customer replies (which can also have
              // authorId set when the sender is a registered user). Exclude the
              // just-inserted customer reply row to avoid self-reference.
              const [lastAgentReply] = await db
                .select({ emailMessageId: supportTicketReplies.emailMessageId })
                .from(supportTicketReplies)
                .innerJoin(users, eq(supportTicketReplies.authorId, users.id))
                .where(
                  and(
                    eq(supportTicketReplies.ticketId, existingTicket.id),
                    isNotNull(supportTicketReplies.emailMessageId),
                    eq(users.role, "SUPER_ADMIN"),
                    ne(supportTicketReplies.id, reply.id),
                  ),
                )
                .orderBy(desc(supportTicketReplies.createdAt))
                .limit(1);

              // Collect all Message-IDs in the thread (ticket root + all replies) for
              // the References header, which lets email clients reconstruct the full chain.
              const threadMessageIds: string[] = [];
              if (existingTicket.emailMessageId) threadMessageIds.push(existingTicket.emailMessageId);
              const allReplyMsgIds = await db
                .select({ emailMessageId: supportTicketReplies.emailMessageId })
                .from(supportTicketReplies)
                .where(
                  and(
                    eq(supportTicketReplies.ticketId, existingTicket.id),
                    isNotNull(supportTicketReplies.emailMessageId),
                    ne(supportTicketReplies.id, reply.id),
                  ),
                )
                .orderBy(supportTicketReplies.createdAt);
              for (const r of allReplyMsgIds) {
                if (r.emailMessageId) threadMessageIds.push(r.emailMessageId);
              }

              const inboxThreadingHeaders: Record<string, string> = {};
              if (lastAgentReply?.emailMessageId) {
                inboxThreadingHeaders["In-Reply-To"] = lastAgentReply.emailMessageId;
              }
              if (threadMessageIds.length > 0) {
                inboxThreadingHeaders["References"] = threadMessageIds.join(" ");
              }

              await sendEmail({
                to: SUPPORT_INBOX,
                subject: `Re: [Ticket #${existingTicket.id.slice(0, 8)}] ${existingTicket.subject}`,
                text: `Customer reply received from ${authorName} <${senderEmail}>:\n\n----\n${replyBody}\n----\n\nTicket #${existingTicket.id.slice(0, 8)}`,
                headers: Object.keys(inboxThreadingHeaders).length > 0 ? inboxThreadingHeaders : undefined,
              });
            } catch (err) {
              logError("[support/inbound] SUPPORT_INBOX threading notification failed", err);
            }
          })();

          ticketId = existingTicket.id;
          eventAction = "email_reply";
        } else {
          // Referenced ticket not found — create a new ticket instead.
          eventAction = "email_new_ticket";
          const [newTicket] = await db
            .insert(supportTickets)
            .values({
              organizationId: matchedUser?.organizationId ?? null,
              userId: matchedUser?.id ?? null,
              submitterEmail: senderEmail,
              submitterName: senderName,
              subject,
              body,
              metadata: attachmentKeys.length ? { emailAttachments: attachmentKeys } : {},
              tier: "starter",
              priority: "normal",
              slaFirstResponseDueAt: new Date(Date.now() + 48 * 3_600_000),
              slaResolutionDueAt: new Date(Date.now() + 5 * 24 * 3_600_000),
              emailMessageId: inboundMessageId ?? null,
            } as typeof supportTickets.$inferInsert)
            .returning();
          ticketId = newTicket.id;
        }
      } else {
        // No reference — create a new ticket.
        eventAction = "email_new_ticket";
        const [newTicket] = await db
          .insert(supportTickets)
          .values({
            organizationId: matchedUser?.organizationId ?? null,
            userId: matchedUser?.id ?? null,
            submitterEmail: senderEmail,
            submitterName: senderName,
            subject,
            body,
            metadata: attachmentKeys.length ? { emailAttachments: attachmentKeys } : {},
            tier: "starter",
            priority: "normal",
            slaFirstResponseDueAt: new Date(Date.now() + 48 * 3_600_000),
            slaResolutionDueAt: new Date(Date.now() + 5 * 24 * 3_600_000),
            emailMessageId: inboundMessageId ?? null,
          } as typeof supportTickets.$inferInsert)
          .returning();
        ticketId = newTicket.id;
      }

      // Structured audit log — audit_log.user_id is nullable (Task #2962) so we
      // can use logCreate for matched users and logSystemAudit for anonymous
      // senders. No SUPER_ADMIN fallback required.
      const auditPayload = {
        senderEmail,
        senderName,
        action: eventAction,
        attachmentCount: attachmentKeys.length,
        correlationId,
        ticketId,
        isAnonymousSender: !matchedUser,
      };
      logInfo(`[support/inbound] ${eventAction} ticket=${ticketId} from=${senderEmail} attachments=${attachmentKeys.length} correlationId=${correlationId}`);

      if (matchedUser?.id) {
        void logCreate(
          matchedUser.id,
          "support_inbound_email",
          ticketId,
          auditPayload,
        ).catch((err) => logError("[support/inbound] audit log failed", err));
      } else {
        void logSystemAudit({
          entityType: "support_inbound_email",
          entityId: ticketId,
          action: "CREATE",
          oldValue: null,
          newValue: JSON.stringify(auditPayload),
        }).catch((err) => logError("[support/inbound] audit log failed", err));
      }

      res.status(200).json({ ok: true, ticketId });
    } catch (err) {
      next(err);
    }
  },
);

// ──────────────────────────────────────────────────────────────────────────────
// Canned responses
// ──────────────────────────────────────────────────────────────────────────────

router.get(
  "/api/support/canned-responses",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const isSuperAdmin = req.user?.role === "SUPER_ADMIN";
      const orgId = req.user?.organizationId ?? null;

      // SUPER_ADMIN sees all; admins see global (organizationId IS NULL) + their own org
      const rows = isSuperAdmin
        ? await db.select().from(supportCannedResponses).orderBy(supportCannedResponses.title)
        : await db
            .select()
            .from(supportCannedResponses)
            .where(
              orgId
                ? sql`(${supportCannedResponses.organizationId} IS NULL OR ${supportCannedResponses.organizationId} = ${orgId})`
                : isNull(supportCannedResponses.organizationId),
            )
            .orderBy(supportCannedResponses.title);

      res.json({ cannedResponses: rows });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/api/support/canned-responses",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const parsed = insertSupportCannedResponseSchema
        .extend({
          title: z.string().min(1).max(200),
          body: z.string().min(1).max(20_000),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
      }
      const [row] = await db
        .insert(supportCannedResponses)
        .values({
          organizationId: parsed.data.organizationId ?? null,
          title: parsed.data.title,
          body: parsed.data.body,
        })
        .returning();
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/api/support/canned-responses/:id",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const patch = z
        .object({
          title: z.string().min(1).max(200).optional(),
          body: z.string().min(1).max(20_000).optional(),
        })
        .safeParse(req.body);
      if (!patch.success) return res.status(400).json({ error: "Invalid input" });

      const [existing] = await db
        .select({ id: supportCannedResponses.id })
        .from(supportCannedResponses)
        .where(eq(supportCannedResponses.id, req.params.id));
      if (!existing) return res.status(404).json({ error: "Not found" });

      const updates: Partial<typeof supportCannedResponses.$inferInsert> = { updatedAt: new Date() };
      if (patch.data.title) updates.title = patch.data.title;
      if (patch.data.body) updates.body = patch.data.body;

      const [row] = await db
        .update(supportCannedResponses)
        .set(updates)
        .where(eq(supportCannedResponses.id, req.params.id))
        .returning();
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/api/support/canned-responses/:id",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const [existing] = await db
        .select({ id: supportCannedResponses.id })
        .from(supportCannedResponses)
        .where(eq(supportCannedResponses.id, req.params.id));
      if (!existing) return res.status(404).json({ error: "Not found" });

      await db.delete(supportCannedResponses).where(eq(supportCannedResponses.id, req.params.id));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// ──────────────────────────────────────────────────────────────────────────────
// CSAT rating (token-authenticated, no session required)
// ──────────────────────────────────────────────────────────────────────────────

// GET /api/support/csat/:token — validate token and return ticket info (for the rating page)
router.get("/api/support/csat/:token", async (req, res, next) => {
  try {
    const [ticket] = await db
      .select({
        id: supportTickets.id,
        subject: supportTickets.subject,
        csatToken: supportTickets.csatToken,
        csatTokenExpiresAt: supportTickets.csatTokenExpiresAt,
        csatScore: supportTickets.csatScore,
        csatSubmittedAt: supportTickets.csatSubmittedAt,
        status: supportTickets.status,
      })
      .from(supportTickets)
      .where(eq(supportTickets.csatToken, req.params.token));

    if (!ticket) return res.status(404).json({ error: "Invalid or expired rating link" });
    if (ticket.csatTokenExpiresAt && new Date() > new Date(ticket.csatTokenExpiresAt)) {
      return res.status(410).json({ error: "Rating link has expired" });
    }
    if (ticket.csatSubmittedAt) {
      return res.json({ ticket, alreadyRated: true });
    }
    res.json({ ticket, alreadyRated: false });
  } catch (err) {
    next(err);
  }
});

// POST /api/support/csat/:token — submit a rating
const csatSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

router.post("/api/support/csat/:token", async (req, res, next) => {
  try {
    const parsed = csatSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    }

    const [ticket] = await db
      .select({
        id: supportTickets.id,
        csatToken: supportTickets.csatToken,
        csatTokenExpiresAt: supportTickets.csatTokenExpiresAt,
        csatSubmittedAt: supportTickets.csatSubmittedAt,
      })
      .from(supportTickets)
      .where(eq(supportTickets.csatToken, req.params.token));

    if (!ticket) return res.status(404).json({ error: "Invalid or expired rating link" });
    if (ticket.csatTokenExpiresAt && new Date() > new Date(ticket.csatTokenExpiresAt)) {
      return res.status(410).json({ error: "Rating link has expired" });
    }
    if (ticket.csatSubmittedAt) {
      return res.status(409).json({ error: "Rating already submitted" });
    }

    const [row] = await db
      .update(supportTickets)
      .set({
        csatScore: parsed.data.score,
        csatComment: parsed.data.comment ?? null,
        csatSubmittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(supportTickets.id, ticket.id))
      .returning({ id: supportTickets.id, csatScore: supportTickets.csatScore, subject: supportTickets.subject, organizationId: supportTickets.organizationId });

    logInfo(`[support] CSAT rating submitted for ticket ${ticket.id}: score=${parsed.data.score}`);

    // Emit activity event for CSAT rating
    {
      const [orgRow] = row.organizationId
        ? await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, row.organizationId))
        : [];
      supportEventBus.emitActivity({
        id: randomUUID(),
        type: "csat_rated",
        ticketId: row.id,
        subject: row.subject,
        orgName: orgRow?.name ?? null,
        timestamp: new Date().toISOString(),
        meta: { score: parsed.data.score },
      });
    }

    res.json({ success: true, ticket: row });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Support settings (per-org routing & escalation config) — Task #2962
// ──────────────────────────────────────────────────────────────────────────────

const IANA_TIMEZONE_RE = /^[A-Za-z_]+(?:\/[A-Za-z_+\-]+)+$|^UTC$|^GMT$|^EST$|^CST$|^MST$|^PST$/;

const supportSettingsPatchSchema = z.object({
  supportTimezone: z
    .string()
    .regex(IANA_TIMEZONE_RE, "Must be a valid IANA timezone string (e.g. America/New_York)")
    .optional(),
  escalationEmails: z
    .array(z.string().email("Each value must be a valid email address"))
    .max(20)
    .optional(),
  escalationThresholdPct: z.number().int().min(1).max(100).optional(),
  autoAssignGraceMinutes: z.number().int().min(0).max(1440).optional(),
  enterpriseAgentIds: z.array(z.string()).max(50).optional(),
});

// Defaults returned when no support_settings row exists for the org yet.
const DEFAULT_SUPPORT_SETTINGS = {
  supportTimezone: "UTC",
  escalationEmails: [] as string[],
  escalationThresholdPct: 75,
  autoAssignGraceMinutes: 60,
  enterpriseAgentIds: [] as string[],
};

/**
 * GET /api/support/settings
 * Returns the org's support routing & escalation settings.
 * Returns defaults if no row exists yet.
 */
router.get(
  "/api/support/settings",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user?.organizationId ?? null;
      if (!orgId && req.user?.role !== "SUPER_ADMIN") {
        return res.json({ settings: DEFAULT_SUPPORT_SETTINGS });
      }

      if (orgId) {
        const [row] = await db
          .select()
          .from(supportSettings)
          .where(eq(supportSettings.organizationId, orgId));
        if (row) {
          return res.json({
            settings: {
              supportTimezone: row.supportTimezone,
              escalationEmails: row.escalationEmails ?? [],
              escalationThresholdPct: row.escalationThresholdPct,
              autoAssignGraceMinutes: row.autoAssignGraceMinutes,
              enterpriseAgentIds: row.enterpriseAgentIds ?? [],
            },
          });
        }
      }
      res.json({ settings: DEFAULT_SUPPORT_SETTINGS });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PATCH /api/support/settings
 * Upserts the org's support routing & escalation settings.
 * SUPER_ADMIN: may pass ?orgId=... to configure a specific org.
 */
router.patch(
  "/api/support/settings",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const parsed = supportSettingsPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
      }

      const orgId =
        req.user?.role === "SUPER_ADMIN" && typeof req.query.orgId === "string"
          ? req.query.orgId
          : req.user?.organizationId ?? null;

      if (!orgId) {
        return res.status(400).json({ error: "No organization context" });
      }

      const updates: Partial<typeof supportSettings.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (parsed.data.supportTimezone !== undefined) updates.supportTimezone = parsed.data.supportTimezone;
      if (parsed.data.escalationEmails !== undefined) updates.escalationEmails = parsed.data.escalationEmails;
      if (parsed.data.escalationThresholdPct !== undefined)
        updates.escalationThresholdPct = parsed.data.escalationThresholdPct;
      if (parsed.data.autoAssignGraceMinutes !== undefined)
        updates.autoAssignGraceMinutes = parsed.data.autoAssignGraceMinutes;
      if (parsed.data.enterpriseAgentIds !== undefined)
        updates.enterpriseAgentIds = parsed.data.enterpriseAgentIds;

      // Upsert: insert a defaults row if none exists, then apply the patch.
      const [existing] = await db
        .select({ id: supportSettings.id })
        .from(supportSettings)
        .where(eq(supportSettings.organizationId, orgId));

      let row;
      if (existing) {
        [row] = await db
          .update(supportSettings)
          .set(updates)
          .where(eq(supportSettings.organizationId, orgId))
          .returning();
      } else {
        [row] = await db
          .insert(supportSettings)
          .values({
            organizationId: orgId,
            ...DEFAULT_SUPPORT_SETTINGS,
            ...updates,
          })
          .returning();
      }

      logInfo(`[support] settings updated for org ${orgId} by ${req.user?.id}`);
      res.json({
        settings: {
          supportTimezone: row?.supportTimezone ?? "UTC",
          escalationEmails: row?.escalationEmails ?? [],
          escalationThresholdPct: row?.escalationThresholdPct ?? 75,
          autoAssignGraceMinutes: row?.autoAssignGraceMinutes ?? 60,
          enterpriseAgentIds: row?.enterpriseAgentIds ?? [],
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ──────────────────────────────────────────────────────────────────────────────
// Holiday calendar CRUD (SUPER_ADMIN only for writes; ADMIN_ROLES for reads)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/support/holidays
 * Returns all holidays, optionally filtered by ?year=2026 and/or ?country=US.
 */
router.get(
  "/api/support/holidays",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const year = typeof req.query.year === "string" ? req.query.year : null;
      const country = typeof req.query.country === "string" ? req.query.country : null;

      const conditions: SQL[] = [];
      if (year) conditions.push(like(supportHolidays.date, `${year}-%`));
      if (country) conditions.push(eq(supportHolidays.country, country));

      const rows = await db
        .select()
        .from(supportHolidays)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(supportHolidays.date);

      res.json({ holidays: rows });
    } catch (err) {
      next(err);
    }
  },
);

const holidayBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be ISO 8601 (YYYY-MM-DD)"),
  name: z.string().min(1).max(120),
  country: z.string().length(2).toUpperCase().default("US"),
});

/**
 * POST /api/support/holidays
 * Adds a custom holiday. Body: { date, name, country? }.
 * ADMIN_ROLES and above (org admins can manage the global holiday calendar).
 */
router.post(
  "/api/support/holidays",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const parsed = holidayBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
      }

      const [row] = await db
        .insert(supportHolidays)
        .values(parsed.data)
        .onConflictDoNothing()
        .returning();

      if (!row) {
        return res.status(409).json({ error: "A holiday already exists for that date and country" });
      }

      invalidateHolidayCache();
      logInfo(`[support] holiday added: ${parsed.data.date} "${parsed.data.name}" by ${req.user?.id}`);
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /api/support/holidays/:id
 * Removes a holiday by ID.
 * ADMIN_ROLES and above.
 */
router.delete(
  "/api/support/holidays/:id",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const [deleted] = await db
        .delete(supportHolidays)
        .where(eq(supportHolidays.id, req.params.id))
        .returning();

      if (!deleted) {
        return res.status(404).json({ error: "Holiday not found" });
      }

      invalidateHolidayCache();
      logInfo(`[support] holiday deleted: ${deleted.date} "${deleted.name}" by ${req.user?.id}`);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ──────────────────────────────────────────────────────────────────────────────
// SLA sweep
// ──────────────────────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────────────────
// CSAT trend analytics
// ──────────────────────────────────────────────────────────────────────────────

router.get(
  "/api/support/csat-trend",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
      const since = new Date(Date.now() - days * 24 * 3_600_000);
      const orgId = req.user?.organizationId || null;
      const isSuperAdmin = req.user?.role === "SUPER_ADMIN";

      if (!isSuperAdmin && !orgId) {
        return res.json({ weeklyTrend: [], distribution: [], byCategory: [], lowestScored: [] });
      }

      const orgConditions: SQL[] = isSuperAdmin
        ? [isNotNull(supportTickets.csatScore), gte(supportTickets.csatSubmittedAt, since)]
        : [
            isNotNull(supportTickets.csatScore),
            gte(supportTickets.csatSubmittedAt, since),
            eq(supportTickets.organizationId, orgId!),
          ];

      const ratedTickets = await db
        .select({
          id: supportTickets.id,
          subject: supportTickets.subject,
          submitterName: supportTickets.submitterName,
          submitterEmail: supportTickets.submitterEmail,
          csatScore: supportTickets.csatScore,
          csatComment: supportTickets.csatComment,
          csatSubmittedAt: supportTickets.csatSubmittedAt,
          category: supportTickets.category,
          resolvedAt: supportTickets.resolvedAt,
        })
        .from(supportTickets)
        .where(and(...orgConditions))
        .orderBy(desc(supportTickets.csatSubmittedAt));

      // Weekly trend — group by Monday of ISO week
      const weekMap = new Map<string, { sum: number; count: number }>();
      for (const t of ratedTickets) {
        if (!t.csatSubmittedAt || t.csatScore == null) continue;
        const d = new Date(t.csatSubmittedAt);
        const day = d.getUTCDay(); // 0=Sun
        const diff = (day === 0 ? -6 : 1 - day); // offset to Monday
        const mon = new Date(d);
        mon.setUTCDate(d.getUTCDate() + diff);
        const weekKey = mon.toISOString().slice(0, 10);
        const entry = weekMap.get(weekKey) ?? { sum: 0, count: 0 };
        entry.sum += t.csatScore;
        entry.count += 1;
        weekMap.set(weekKey, entry);
      }
      const weeklyTrend = Array.from(weekMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([week, { sum, count }]) => ({
          week,
          avgScore: Math.round((sum / count) * 10) / 10,
          count,
        }));

      // Score distribution (1-5)
      const distMap: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const t of ratedTickets) {
        if (t.csatScore != null) distMap[t.csatScore] = (distMap[t.csatScore] ?? 0) + 1;
      }
      const distribution = [1, 2, 3, 4, 5].map((score) => ({ score, count: distMap[score] ?? 0 }));

      // By category
      const catMap = new Map<string, { sum: number; count: number }>();
      for (const t of ratedTickets) {
        if (t.csatScore == null) continue;
        const cat = t.category ?? "general";
        const entry = catMap.get(cat) ?? { sum: 0, count: 0 };
        entry.sum += t.csatScore;
        entry.count += 1;
        catMap.set(cat, entry);
      }
      const byCategory = Array.from(catMap.entries())
        .map(([category, { sum, count }]) => ({
          category,
          avgScore: Math.round((sum / count) * 10) / 10,
          count,
        }))
        .sort((a, b) => a.avgScore - b.avgScore);

      // Lowest-scoring recent tickets (score <= 3, up to 10)
      const lowestScored = ratedTickets
        .filter((t) => t.csatScore != null && t.csatScore <= 3)
        .slice(0, 10)
        .map((t) => ({
          id: t.id,
          subject: t.subject,
          submitterName: t.submitterName,
          submitterEmail: t.submitterEmail,
          csatScore: t.csatScore,
          csatComment: t.csatComment,
          csatSubmittedAt: t.csatSubmittedAt,
          category: t.category,
        }));

      res.json({ weeklyTrend, distribution, byCategory, lowestScored });
    } catch (err) {
      next(err);
    }
  },
);

// ──────────────────────────────────────────────────────────────────────────────
// Analytics  GET /api/support/analytics  (SUPER_ADMIN only)
// ──────────────────────────────────────────────────────────────────────────────

const analyticsQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  granularity: z.enum(["day", "week"]).optional().default("day"),
});

router.get(
  "/api/support/analytics",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const parsed = analyticsQuerySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: "Invalid query params" });

      const { granularity } = parsed.data;
      const toDate = parsed.data.to ? new Date(parsed.data.to) : new Date();
      const fromDate = parsed.data.from
        ? new Date(parsed.data.from)
        : new Date(toDate.getTime() - 29 * 24 * 3_600_000);

      // Clamp to sane range (max 365 days)
      const maxRange = 365 * 24 * 3_600_000;
      const clampedFrom = new Date(Math.max(fromDate.getTime(), toDate.getTime() - maxRange));

      const truncUnit = granularity === "week" ? "week" : "day";

      // ── 1. Volume trend ──────────────────────────────────────────────────────
      const volumeRows = await db.execute(sql`
        SELECT
          date_trunc(${truncUnit}, created_at)::date AS day,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status IN ('resolved','closed'))::int AS resolved,
          COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed'))::int AS open
        FROM support_tickets
        WHERE created_at >= ${clampedFrom} AND created_at <= ${toDate}
        GROUP BY 1
        ORDER BY 1
      `);

      // ── 2. SLA adherence trend ───────────────────────────────────────────────
      const slaRows = await db.execute(sql`
        SELECT
          date_trunc(${truncUnit}, created_at)::date AS day,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE sla_first_response_breached = 0 AND sla_resolution_breached = 0
          )::int AS on_track
        FROM support_tickets
        WHERE created_at >= ${clampedFrom} AND created_at <= ${toDate}
        GROUP BY 1
        ORDER BY 1
      `);

      // ── 3. Median response / resolution times (overall + by tier) ───────────
      const medianRows = await db.execute(sql`
        SELECT
          tier::text AS tier,
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60
          ) AS median_first_response_min,
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60
          ) AS median_resolution_min
        FROM support_tickets
        WHERE created_at >= ${clampedFrom} AND created_at <= ${toDate}
          AND first_response_at IS NOT NULL
        GROUP BY tier

        UNION ALL

        SELECT
          'overall'::text AS tier,
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60
          ) AS median_first_response_min,
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60
          ) AS median_resolution_min
        FROM support_tickets
        WHERE created_at >= ${clampedFrom} AND created_at <= ${toDate}
          AND first_response_at IS NOT NULL
      `);

      // ── 4. Category breakdown ────────────────────────────────────────────────
      const categoryRows = await db.execute(sql`
        SELECT
          COALESCE(category::text, 'general') AS category,
          COUNT(*)::int AS count
        FROM support_tickets
        WHERE created_at >= ${clampedFrom} AND created_at <= ${toDate}
        GROUP BY 1
        ORDER BY 2 DESC
      `);

      // ── 5. Agent performance ─────────────────────────────────────────────────
      const agentRows = await db.execute(sql`
        WITH first_replies AS (
          SELECT DISTINCT ON (r.ticket_id)
            r.ticket_id,
            r.author_id,
            r.created_at AS reply_at
          FROM support_ticket_replies r
          WHERE r.author_id IS NOT NULL
          ORDER BY r.ticket_id, r.created_at ASC
        ),
        ticket_stats AS (
          SELECT
            t.assigned_to,
            t.id AS ticket_id,
            t.first_response_at,
            t.resolved_at,
            t.created_at,
            t.csat_score,
            EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)) / 60 AS fr_min,
            EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 60 AS res_min
          FROM support_tickets t
          WHERE t.created_at >= ${clampedFrom} AND t.created_at <= ${toDate}
            AND t.assigned_to IS NOT NULL
        )
        SELECT
          ts.assigned_to AS agent_id,
          u.first_name,
          u.last_name,
          u.email,
          COUNT(ts.ticket_id)::int AS tickets_assigned,
          COUNT(ts.resolved_at)::int AS tickets_resolved,
          ROUND(AVG(ts.fr_min)::numeric, 1) AS avg_first_response_min,
          ROUND(AVG(ts.res_min)::numeric, 1) AS avg_resolution_min,
          ROUND(AVG(ts.csat_score)::numeric, 2) AS avg_csat
        FROM ticket_stats ts
        LEFT JOIN users u ON u.id = ts.assigned_to
        GROUP BY ts.assigned_to, u.first_name, u.last_name, u.email
        ORDER BY tickets_assigned DESC
      `);

      // ── 6. Ticket age distribution (open tickets only) ───────────────────────
      const ageRows = await db.execute(sql`
        SELECT
          CASE
            WHEN age_hours < 24 THEN '< 1 day'
            WHEN age_hours < 72 THEN '1-3 days'
            WHEN age_hours < 168 THEN '3-7 days'
            WHEN age_hours < 720 THEN '1-4 weeks'
            ELSE '> 4 weeks'
          END AS bucket,
          COUNT(*)::int AS count
        FROM (
          SELECT
            EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS age_hours
          FROM support_tickets
          WHERE status NOT IN ('resolved','closed')
            AND created_at >= ${clampedFrom} AND created_at <= ${toDate}
        ) sub
        GROUP BY 1
        ORDER BY MIN(age_hours)
      `);

      // Normalise output
      type Row = Record<string, unknown>;
      const volumeSeries = (volumeRows.rows as Row[]).map((r) => ({
        day: r.day,
        total: Number(r.total),
        resolved: Number(r.resolved),
        open: Number(r.open),
      }));
      const slaSeries = (slaRows.rows as Row[]).map((r) => ({
        day: r.day,
        adherence: r.total === 0 ? 100 : Math.round((Number(r.on_track) / Number(r.total)) * 100),
      }));
      const medianByTier: Record<string, { medianFirstResponseMin: number | null; medianResolutionMin: number | null }> = {};
      for (const r of medianRows.rows as Row[]) {
        medianByTier[r.tier as string] = {
          medianFirstResponseMin: r.median_first_response_min != null ? Math.round(Number(r.median_first_response_min)) : null,
          medianResolutionMin: r.median_resolution_min != null ? Math.round(Number(r.median_resolution_min)) : null,
        };
      }
      const categoryBreakdown = (categoryRows.rows as Row[]).map((r) => ({
        category: r.category as string,
        count: Number(r.count),
      }));
      const agentPerformance = (agentRows.rows as Row[]).map((r) => ({
        agentId: r.agent_id as string,
        name: [r.first_name, r.last_name].filter(Boolean).join(" ") || (r.email as string) || "Unknown",
        email: r.email as string,
        ticketsAssigned: Number(r.tickets_assigned),
        ticketsResolved: Number(r.tickets_resolved),
        avgFirstResponseMin: r.avg_first_response_min != null ? Number(r.avg_first_response_min) : null,
        avgResolutionMin: r.avg_resolution_min != null ? Number(r.avg_resolution_min) : null,
        avgCsat: r.avg_csat != null ? Number(r.avg_csat) : null,
      }));
      const ageBuckets = (ageRows.rows as Row[]).map((r) => ({
        bucket: r.bucket as string,
        count: Number(r.count),
      }));

      res.json({
        from: clampedFrom.toISOString(),
        to: toDate.toISOString(),
        granularity,
        volumeSeries,
        slaSeries,
        medianByTier,
        categoryBreakdown,
        agentPerformance,
        ageBuckets,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ──────────────────────────────────────────────────────────────────────────────
// Analytics CSV export  GET /api/support/analytics/export  (SUPER_ADMIN only)
// ──────────────────────────────────────────────────────────────────────────────

router.get(
  "/api/support/analytics/export",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      const parsed = analyticsQuerySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: "Invalid query params" });

      const toDate = parsed.data.to ? new Date(parsed.data.to) : new Date();
      const fromDate = parsed.data.from
        ? new Date(parsed.data.from)
        : new Date(toDate.getTime() - 29 * 24 * 3_600_000);
      const maxRange = 365 * 24 * 3_600_000;
      const clampedFrom = new Date(Math.max(fromDate.getTime(), toDate.getTime() - maxRange));

      const rows = await db
        .select({
          id: supportTickets.id,
          subject: supportTickets.subject,
          category: supportTickets.category,
          priority: supportTickets.priority,
          tier: supportTickets.tier,
          status: supportTickets.status,
          submitterEmail: supportTickets.submitterEmail,
          submitterName: supportTickets.submitterName,
          assignedTo: supportTickets.assignedTo,
          firstResponseAt: supportTickets.firstResponseAt,
          resolvedAt: supportTickets.resolvedAt,
          csatScore: supportTickets.csatScore,
          createdAt: supportTickets.createdAt,
        })
        .from(supportTickets)
        .where(and(gte(supportTickets.createdAt, clampedFrom), lte(supportTickets.createdAt, toDate)))
        .orderBy(desc(supportTickets.createdAt));

      const header = [
        "id","subject","category","priority","tier","status",
        "submitter_email","submitter_name","assigned_to",
        "created_at","first_response_at","resolved_at",
        "first_response_min","resolution_min","csat_score",
      ].join(",");

      const escape = (v: unknown): string => {
        if (v == null) return "";
        const s = String(v);
        if (s.includes(",") || s.includes('"') || s.includes("\n")) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };

      const lines = rows.map((r) => {
        const frMin = r.firstResponseAt
          ? Math.round((new Date(r.firstResponseAt).getTime() - new Date(r.createdAt).getTime()) / 60_000)
          : "";
        const resMin = r.resolvedAt
          ? Math.round((new Date(r.resolvedAt).getTime() - new Date(r.createdAt).getTime()) / 60_000)
          : "";
        return [
          r.id, r.subject, r.category ?? "", r.priority, r.tier, r.status,
          r.submitterEmail, r.submitterName ?? "", r.assignedTo ?? "",
          r.createdAt, r.firstResponseAt ?? "", r.resolvedAt ?? "",
          frMin, resMin, r.csatScore ?? "",
        ].map(escape).join(",");
      });

      const csv = [header, ...lines].join("\n");
      const filename = `support-analytics-${clampedFrom.toISOString().slice(0, 10)}-to-${toDate.toISOString().slice(0, 10)}.csv`;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (err) {
      next(err);
    }
  },
);

// ──────────────────────────────────────────────────────────────────────────────
// Metrics
// ──────────────────────────────────────────────────────────────────────────────

router.get(
  "/api/support/tickets/metrics",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req: AuthRequest, res, next) => {
    try {
      const since = new Date(Date.now() - 7 * 24 * 3_600_000);
      const orgId = req.user?.organizationId || null;
      const isSuperAdmin = req.user?.role === "SUPER_ADMIN";

      if (!isSuperAdmin && !orgId) {
        return res.json({
          windowDays: 7,
          total: 0,
          open: 0,
          resolved: 0,
          firstResponseBreached: 0,
          resolutionBreached: 0,
          avgCsatScore: null,
          csatResponseRate: 0,
          categoryCounts: {},
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

      // CSAT metrics (all time, not just 7d window)
      const csatConditions = isSuperAdmin ? [] : orgId ? [eq(supportTickets.organizationId, orgId)] : [];
      const csatEligibleConditions = [
        ...csatConditions,
        isNotNull(supportTickets.csatToken),
      ];
      const csatRows = await db
        .select({ score: supportTickets.csatScore, submittedAt: supportTickets.csatSubmittedAt })
        .from(supportTickets)
        .where(csatEligibleConditions.length ? and(...csatEligibleConditions) : undefined);

      const ratedRows = csatRows.filter((r) => r.score != null);
      const avgCsatScore =
        ratedRows.length > 0
          ? ratedRows.reduce((sum, r) => sum + (r.score ?? 0), 0) / ratedRows.length
          : null;
      const csatResponseRate =
        csatRows.length > 0 ? ratedRows.length / csatRows.length : 0;

      // Category counts for the window
      const categoryCounts: Record<string, number> = {};
      for (const row of rows) {
        const cat = row.category ?? "general";
        categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
      }

      res.json({
        windowDays: 7,
        total,
        open,
        resolved,
        firstResponseBreached: firstRespBreached,
        resolutionBreached: resBreached,
        adherence: total === 0 ? 1 : 1 - (firstRespBreached + resBreached) / (total * 2),
        avgCsatScore: avgCsatScore !== null ? Math.round(avgCsatScore * 10) / 10 : null,
        csatResponseRate: Math.round(csatResponseRate * 100),
        categoryCounts,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ──────────────────────────────────────────────────────────────────────────────
// Activity feed  GET /api/support/activity-feed  (SUPER_ADMIN only)
// Returns last 10 ticket events across all event types (polling endpoint).
// ──────────────────────────────────────────────────────────────────────────────

router.get(
  "/api/support/activity-feed",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (_req: AuthRequest, res, _next) => {
    // Serve directly from the in-memory ring buffer so timestamps and event
    // types reflect actual occurrences rather than synthesised ticket snapshots.
    const events = getRecentActivity(10);
    res.json({ events });
  },
);

// ──────────────────────────────────────────────────────────────────────────────
// Activity feed SSE stream  GET /api/support/activity-feed/stream  (SUPER_ADMIN)
// Pushes real-time activity events to connected admin dashboards.
// ──────────────────────────────────────────────────────────────────────────────

router.get(
  "/api/support/activity-feed/stream",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const send = (event: string, data: unknown) => {
        try {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        } catch {
          // Connection already closed
        }
      };

      send("connected", { ok: true });

      const unsubscribe = supportEventBus.onActivity((payload) => {
        send("activity", payload);
      });

      const keepalive = setInterval(() => {
        try {
          res.write(": ping\n\n");
        } catch {
          clearInterval(keepalive);
        }
      }, 60_000);

      req.on("close", () => {
        clearInterval(keepalive);
        unsubscribe();
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
