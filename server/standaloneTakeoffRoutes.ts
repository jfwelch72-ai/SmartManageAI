/**
 * Task #2403 + #2404 — Standalone Takeoff Tool routes.
 *
 * Phase 1: CRUD for standalone takeoffs + their files & sheets.
 * Phase 2: tag a standalone takeoff to bids/projects, suggestion ranker
 * for "Suggested takeoffs" cards on bid/project home, per-user dismissals.
 */
import { Router } from "express";
import { db } from "./db";
import {
  standaloneTakeoffs,
  takeoffTags,
  standaloneTakeoffFiles,
  takeoffSuggestionDismissals,
  takeoffSheets,
  takeoffMeasurements,
  bids,
  projects,
} from "@shared/schema";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, type AuthRequest, type SanitizedUser } from "./auth";
import { logError } from "./utils/logger";
import { sanitizeShortText, sanitizeText } from "./sanitization";
import { logAudit } from "./auditLogger";
import {
  indexStandaloneTakeoffSafe,
  emitLibraryAssignmentSamplesSafe,
} from "./services/aiEstimator/standaloneIngestion";
// Task #2551 — Per-sheet discipline indexing for standalone takeoffs.
import { indexPlanSheetsForStandaloneTakeoffSafe } from "./services/aiEstimator/sheetIndex";

const router = Router();

const createSchema = z.object({
  title: z.string().min(1).max(200),
  tradeType: z.string().nullable().optional(),
  clientName: z.string().max(200).nullable().optional(),
  locationAddress: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

async function loadAccessibleTakeoff(
  takeoffId: string,
  user: SanitizedUser,
) {
  const [row] = await db
    .select()
    .from(standaloneTakeoffs)
    .where(eq(standaloneTakeoffs.id, takeoffId))
    .limit(1);
  if (!row) return null;
  if (user.role === "SUPER_ADMIN") return row;
  if (row.organizationId !== user.organizationId) return null;
  return row;
}

// ---------- CRUD ----------

router.get("/api/takeoff/standalone", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!;
    const scope = (req.query.scope as string) || "mine"; // mine | org
    const includeArchived = req.query.includeArchived === "true";

    const conds: SQL[] = [];
    if (user.role !== "SUPER_ADMIN") {
      conds.push(eq(standaloneTakeoffs.organizationId, user.organizationId!));
    }
    if (scope === "mine") {
      conds.push(eq(standaloneTakeoffs.ownerUserId, user.id));
    }
    if (!includeArchived) {
      conds.push(isNull(standaloneTakeoffs.archivedAt));
    }

    const rows = await db
      .select()
      .from(standaloneTakeoffs)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(standaloneTakeoffs.updatedAt))
      .limit(200);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/api/takeoff/standalone", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.errors });
    const user = req.user!;
    if (!user.organizationId) return res.status(400).json({ error: "User has no organization" });

    type TradeType = NonNullable<typeof standaloneTakeoffs.$inferInsert["tradeType"]>;
    const insertValues: typeof standaloneTakeoffs.$inferInsert = {
      organizationId: user.organizationId,
      ownerUserId: user.id,
      title: sanitizeShortText(parsed.data.title) ?? parsed.data.title,
      tradeType: (parsed.data.tradeType ?? null) as TradeType | null,
      clientName: parsed.data.clientName ? sanitizeShortText(parsed.data.clientName) ?? null : null,
      locationAddress: parsed.data.locationAddress ? sanitizeShortText(parsed.data.locationAddress) ?? null : null,
      notes: parsed.data.notes ? sanitizeText(parsed.data.notes) : null,
    };
    const [row] = await db.insert(standaloneTakeoffs).values(insertValues).returning();
    await logAudit(
      { userId: user.id, action: "CREATE", entityType: "standalone_takeoff", entityId: row.id, newValue: row.title },
      req,
    );
    indexStandaloneTakeoffSafe(row.id);
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

router.get("/api/takeoff/standalone/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const row = await loadAccessibleTakeoff(req.params.id, req.user!);
    if (!row) return res.status(404).json({ error: "Takeoff not found" });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

const patchSchema = createSchema.partial().extend({
  archived: z.boolean().optional(),
});

router.patch("/api/takeoff/standalone/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const row = await loadAccessibleTakeoff(req.params.id, req.user!);
    if (!row) return res.status(404).json({ error: "Takeoff not found" });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.errors });

    type TradeType = NonNullable<typeof standaloneTakeoffs.$inferInsert["tradeType"]>;
    const updates: Partial<typeof standaloneTakeoffs.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.title !== undefined) updates.title = sanitizeShortText(parsed.data.title) ?? parsed.data.title;
    if (parsed.data.tradeType !== undefined) updates.tradeType = (parsed.data.tradeType ?? null) as TradeType | null;
    if (parsed.data.clientName !== undefined) updates.clientName = parsed.data.clientName ? sanitizeShortText(parsed.data.clientName) ?? null : null;
    if (parsed.data.locationAddress !== undefined) updates.locationAddress = parsed.data.locationAddress ? sanitizeShortText(parsed.data.locationAddress) ?? null : null;
    if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes ? sanitizeText(parsed.data.notes) : null;
    if (parsed.data.archived !== undefined) updates.archivedAt = parsed.data.archived ? new Date() : null;

    const [updated] = await db
      .update(standaloneTakeoffs)
      .set(updates)
      .where(eq(standaloneTakeoffs.id, row.id))
      .returning();
    indexStandaloneTakeoffSafe(updated.id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/api/takeoff/standalone/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const row = await loadAccessibleTakeoff(req.params.id, req.user!);
    if (!row) return res.status(404).json({ error: "Takeoff not found" });
    if (row.ownerUserId !== req.user!.id && req.user!.role !== "ADMIN" && req.user!.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Only the owner or an admin can delete a standalone takeoff" });
    }
    await db.delete(standaloneTakeoffs).where(eq(standaloneTakeoffs.id, row.id));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Sheets (mirror of bid/project takeoff sheet GET) ----------

router.get("/api/takeoff/standalone/:id/sheets", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const row = await loadAccessibleTakeoff(req.params.id, req.user!);
    if (!row) return res.status(404).json({ error: "Takeoff not found" });
    const sheets = await db
      .select()
      .from(takeoffSheets)
      .where(eq(takeoffSheets.standaloneTakeoffId, row.id))
      .orderBy(takeoffSheets.sheetIndex);
    res.json(sheets);
  } catch (err) {
    next(err);
  }
});

const createSheetSchema = z.object({
  imageUrl: z.string().min(1),
  sheetName: z.string().max(200).optional(),
  objectKey: z.string().max(500).optional(),
});

router.post("/api/takeoff/standalone/:id/sheets", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const row = await loadAccessibleTakeoff(req.params.id, req.user!);
    if (!row) return res.status(404).json({ error: "Takeoff not found" });
    const parsed = createSheetSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.errors });

    const existing = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.standaloneTakeoffId, row.id));
    const nextIdx = (existing[0]?.count as number | undefined) ?? 0;

    const [sheet] = await db
      .insert(takeoffSheets)
      .values({
        standaloneTakeoffId: row.id,
        imageUrl: parsed.data.imageUrl,
        sheetIndex: nextIdx,
        sheetName: parsed.data.sheetName ?? `Sheet ${nextIdx + 1}`,
      })
      .returning();
    // Task #2551 — Best-effort discipline indexing for the new sheet.
    indexPlanSheetsForStandaloneTakeoffSafe({
      organizationId: row.organizationId,
      userId: req.user!.id,
      standaloneTakeoffId: row.id,
    });
    res.status(201).json(sheet);
  } catch (err) {
    next(err);
  }
});

// ---------- Categories + Measurements (workspace parity) ----------
//
// Task #2550 — The shared TakeoffWorkspace component fetches a per-context
// quantity-categories list and a flattened all-measurements list to power
// per-sheet count chips. Standalone takeoffs do not currently support
// categories, so we serve an empty list (the workspace handles `[]` by
// hiding the "uncategorized" rollup). All-measurements aggregates every
// measurement attached to any sheet under this standalone takeoff.

router.get("/api/takeoff/standalone/:id/categories", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const row = await loadAccessibleTakeoff(req.params.id, req.user!);
    if (!row) return res.status(404).json({ error: "Takeoff not found" });
    res.json([]);
  } catch (err) {
    next(err);
  }
});

router.get("/api/takeoff/standalone/:id/all-measurements", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const row = await loadAccessibleTakeoff(req.params.id, req.user!);
    if (!row) return res.status(404).json({ error: "Takeoff not found" });
    const sheetRows = await db
      .select({ id: takeoffSheets.id })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.standaloneTakeoffId, row.id));
    if (sheetRows.length === 0) return res.json([]);
    const ms = await db
      .select()
      .from(takeoffMeasurements)
      .where(inArray(takeoffMeasurements.sheetId, sheetRows.map((s) => s.id)));
    res.json(ms);
  } catch (err) {
    next(err);
  }
});

// ---------- Files ----------

router.get("/api/takeoff/standalone/:id/files", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const row = await loadAccessibleTakeoff(req.params.id, req.user!);
    if (!row) return res.status(404).json({ error: "Takeoff not found" });
    const files = await db
      .select()
      .from(standaloneTakeoffFiles)
      .where(eq(standaloneTakeoffFiles.standaloneTakeoffId, row.id))
      .orderBy(desc(standaloneTakeoffFiles.createdAt));
    res.json(files);
  } catch (err) {
    next(err);
  }
});

const createFileSchema = z.object({
  fileName: z.string().min(1).max(300),
  fileUrl: z.string().min(1),
  objectKey: z.string().max(500).optional(),
  mimeType: z.string().max(120).optional(),
  fileSize: z.number().int().min(0).optional(),
});

router.post("/api/takeoff/standalone/:id/files", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const row = await loadAccessibleTakeoff(req.params.id, req.user!);
    if (!row) return res.status(404).json({ error: "Takeoff not found" });
    const parsed = createFileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.errors });
    const [file] = await db
      .insert(standaloneTakeoffFiles)
      .values({
        standaloneTakeoffId: row.id,
        organizationId: row.organizationId,
        uploadedById: req.user!.id,
        fileName: parsed.data.fileName,
        fileUrl: parsed.data.fileUrl,
        objectKey: parsed.data.objectKey ?? null,
        mimeType: parsed.data.mimeType ?? null,
        fileSize: parsed.data.fileSize ?? null,
      })
      .returning();
    // Task #2551 — Newly added plan files give the indexer fresh AI input.
    indexPlanSheetsForStandaloneTakeoffSafe({
      organizationId: row.organizationId,
      userId: req.user!.id,
      standaloneTakeoffId: row.id,
    });
    res.status(201).json(file);
  } catch (err) {
    next(err);
  }
});

// ---------- Tags (link takeoff ↔ bid/project) ----------

const tagSchema = z
  .object({
    bidId: z.string().nullable().optional(),
    projectId: z.string().nullable().optional(),
  })
  .refine(
    (v) => (!!v.bidId && !v.projectId) || (!v.bidId && !!v.projectId),
    { message: "Provide exactly one of bidId or projectId" },
  );

router.get("/api/takeoff/standalone/:id/tags", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const row = await loadAccessibleTakeoff(req.params.id, req.user!);
    if (!row) return res.status(404).json({ error: "Takeoff not found" });
    const rows = await db
      .select()
      .from(takeoffTags)
      .where(eq(takeoffTags.standaloneTakeoffId, row.id))
      .orderBy(desc(takeoffTags.createdAt));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/api/takeoff/standalone/:id/tags", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const row = await loadAccessibleTakeoff(req.params.id, req.user!);
    if (!row) return res.status(404).json({ error: "Takeoff not found" });
    const parsed = tagSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    // Verify destination exists & belongs to org.
    if (parsed.data.bidId) {
      const [b] = await db.select({ id: bids.id, org: bids.gcOrganizationId }).from(bids).where(eq(bids.id, parsed.data.bidId)).limit(1);
      if (!b) return res.status(404).json({ error: "Bid not found" });
      if (req.user!.role !== "SUPER_ADMIN" && b.org !== req.user!.organizationId) return res.status(403).json({ error: "Forbidden" });
    } else if (parsed.data.projectId) {
      const [p] = await db.select({ id: projects.id, org: projects.gcOrganizationId }).from(projects).where(eq(projects.id, parsed.data.projectId)).limit(1);
      if (!p) return res.status(404).json({ error: "Project not found" });
      if (req.user!.role !== "SUPER_ADMIN" && p.org !== req.user!.organizationId) return res.status(403).json({ error: "Forbidden" });
    }

    try {
      const [tag] = await db
        .insert(takeoffTags)
        .values({
          organizationId: row.organizationId,
          standaloneTakeoffId: row.id,
          bidId: parsed.data.bidId ?? null,
          projectId: parsed.data.projectId ?? null,
          taggedById: req.user!.id,
        })
        .returning();
      // Mark as ACCEPTED in dismissal table so it doesn't show up as a
      // suggestion again, and so the ranker has a positive training signal.
      const destKind = parsed.data.bidId ? "bid" : "project";
      const destId = (parsed.data.bidId ?? parsed.data.projectId)!;
      await db
        .insert(takeoffSuggestionDismissals)
        .values({
          userId: req.user!.id,
          organizationId: row.organizationId,
          standaloneTakeoffId: row.id,
          destinationKind: destKind,
          destinationId: destId,
          outcome: "ACCEPTED",
        })
        .onConflictDoNothing();
      // Task #2443 — emit library_assignment rate samples + ensure the
      // takeoff (and its measurements) are indexed so the AI Estimator
      // can surface them for similar trades.
      indexStandaloneTakeoffSafe(row.id);
      emitLibraryAssignmentSamplesSafe(row.id, {
        bidId: parsed.data.bidId ?? null,
        projectId: parsed.data.projectId ?? null,
      });
      res.status(201).json(tag);
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505") {
        // Unique violation (already tagged) — return existing tag.
        const [existing] = await db
          .select()
          .from(takeoffTags)
          .where(
            and(
              eq(takeoffTags.standaloneTakeoffId, row.id),
              parsed.data.bidId ? eq(takeoffTags.bidId, parsed.data.bidId) : eq(takeoffTags.projectId, parsed.data.projectId!),
            ),
          )
          .limit(1);
        return res.status(200).json(existing);
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

router.delete("/api/takeoff/standalone/:id/tags/:tagId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const row = await loadAccessibleTakeoff(req.params.id, req.user!);
    if (!row) return res.status(404).json({ error: "Takeoff not found" });
    await db
      .delete(takeoffTags)
      .where(and(eq(takeoffTags.id, req.params.tagId), eq(takeoffTags.standaloneTakeoffId, row.id)));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// List standalone takeoffs already tagged to a bid/project (for surfacing
// in the bid/project detail page alongside its native takeoff data).
router.get("/api/bids/:bidId/takeoff/tagged-standalone", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [b] = await db.select({ org: bids.gcOrganizationId }).from(bids).where(eq(bids.id, req.params.bidId)).limit(1);
    if (!b) return res.status(404).json({ error: "Bid not found" });
    if (req.user!.role !== "SUPER_ADMIN" && b.org !== req.user!.organizationId) return res.status(403).json({ error: "Forbidden" });

    const rows = await db
      .select({
        tag: takeoffTags,
        takeoff: standaloneTakeoffs,
      })
      .from(takeoffTags)
      .innerJoin(standaloneTakeoffs, eq(takeoffTags.standaloneTakeoffId, standaloneTakeoffs.id))
      .where(eq(takeoffTags.bidId, req.params.bidId))
      .orderBy(desc(takeoffTags.createdAt));
    res.json(rows.map((r) => ({ ...r.takeoff, tagId: r.tag.id })));
  } catch (err) {
    next(err);
  }
});

router.get("/api/projects/:projectId/takeoff/tagged-standalone", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [p] = await db.select({ org: projects.gcOrganizationId }).from(projects).where(eq(projects.id, req.params.projectId)).limit(1);
    if (!p) return res.status(404).json({ error: "Project not found" });
    if (req.user!.role !== "SUPER_ADMIN" && p.org !== req.user!.organizationId) return res.status(403).json({ error: "Forbidden" });

    const rows = await db
      .select({ tag: takeoffTags, takeoff: standaloneTakeoffs })
      .from(takeoffTags)
      .innerJoin(standaloneTakeoffs, eq(takeoffTags.standaloneTakeoffId, standaloneTakeoffs.id))
      .where(eq(takeoffTags.projectId, req.params.projectId))
      .orderBy(desc(takeoffTags.createdAt));
    res.json(rows.map((r) => ({ ...r.takeoff, tagId: r.tag.id })));
  } catch (err) {
    next(err);
  }
});

// ---------- Suggestions ranker ----------

interface RankedSuggestion {
  id: string;
  title: string;
  tradeType: string | null;
  clientName: string | null;
  locationAddress: string | null;
  ownerUserId: string;
  updatedAt: Date;
  score: number;
  reasons: string[];
  sheetCount: number;
}

function tokenize(s: string | null | undefined): Set<string> {
  if (!s) return new Set();
  return new Set(
    String(s)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  Array.from(a).forEach((t) => { if (b.has(t)) inter++; });
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function rankAgainst(
  takeoffs: Array<typeof standaloneTakeoffs.$inferSelect>,
  destination: { tradeType?: string | null; title?: string | null; clientName?: string | null; address?: string | null },
  sheetCountById: Map<string, number>,
): RankedSuggestion[] {
  const destTokens = new Set<string>([
    ...Array.from(tokenize(destination.title)),
    ...Array.from(tokenize(destination.clientName)),
    ...Array.from(tokenize(destination.address)),
  ]);

  const out: RankedSuggestion[] = [];
  for (const t of takeoffs) {
    const reasons: string[] = [];
    let score = 0;

    if (destination.tradeType && t.tradeType && t.tradeType === destination.tradeType) {
      score += 0.4;
      reasons.push("Same trade");
    }

    const tTokens = new Set<string>([
      ...Array.from(tokenize(t.title)),
      ...Array.from(tokenize(t.clientName)),
      ...Array.from(tokenize(t.locationAddress)),
      ...Array.from(tokenize(t.notes)),
    ]);
    const sim = jaccard(destTokens, tTokens);
    if (sim > 0) {
      score += 0.5 * sim;
      reasons.push(`${Math.round(sim * 100)}% keyword match`);
    }

    // Recency boost — favor takeoffs touched in the last 30 days.
    const ageDays = (Date.now() - new Date(t.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < 30) {
      const recency = 0.1 * (1 - ageDays / 30);
      score += recency;
      reasons.push("Recently updated");
    }

    if (score > 0) {
      out.push({
        id: t.id,
        title: t.title,
        tradeType: t.tradeType,
        clientName: t.clientName,
        locationAddress: t.locationAddress,
        ownerUserId: t.ownerUserId,
        updatedAt: t.updatedAt,
        score: Math.round(score * 1000) / 1000,
        reasons,
        sheetCount: sheetCountById.get(t.id) ?? 0,
      });
    }
  }
  out.sort((a, b) => b.score - a.score);
  // Cap to 6 per Task #2404 spec — keep the suggestions card focused.
  return out.slice(0, 6);
}

async function fetchSheetCounts(takeoffIds: string[]): Promise<Map<string, number>> {
  if (takeoffIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: takeoffSheets.standaloneTakeoffId,
      count: sql<number>`count(*)::int`,
    })
    .from(takeoffSheets)
    .where(inArray(takeoffSheets.standaloneTakeoffId, takeoffIds))
    .groupBy(takeoffSheets.standaloneTakeoffId);
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.id) m.set(r.id, Number(r.count));
  }
  return m;
}

router.get("/api/bids/:bidId/takeoff/suggestions", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const start = Date.now();
    const [b] = await db.select().from(bids).where(eq(bids.id, req.params.bidId)).limit(1);
    if (!b) return res.status(404).json({ error: "Bid not found" });
    if (req.user!.role !== "SUPER_ADMIN" && b.gcOrganizationId !== req.user!.organizationId) return res.status(403).json({ error: "Forbidden" });

    // Suggestions are ALWAYS scoped to the destination's owning org —
    // even for SUPER_ADMIN — so cross-tenant takeoffs cannot leak in.
    if (!b.gcOrganizationId) return res.json([]);
    const candidates = await db
      .select()
      .from(standaloneTakeoffs)
      .where(and(eq(standaloneTakeoffs.organizationId, b.gcOrganizationId), isNull(standaloneTakeoffs.archivedAt)))
      .limit(500);

    // Exclude takeoffs already tagged to this bid.
    const tagged = await db
      .select({ id: takeoffTags.standaloneTakeoffId })
      .from(takeoffTags)
      .where(eq(takeoffTags.bidId, b.id));
    const taggedSet = new Set(tagged.map((r) => r.id));

    // Exclude per-user dismissals.
    const dismissed = await db
      .select({ id: takeoffSuggestionDismissals.standaloneTakeoffId })
      .from(takeoffSuggestionDismissals)
      .where(
        and(
          eq(takeoffSuggestionDismissals.userId, req.user!.id),
          eq(takeoffSuggestionDismissals.destinationKind, "bid"),
          eq(takeoffSuggestionDismissals.destinationId, b.id),
          eq(takeoffSuggestionDismissals.outcome, "DISMISSED"),
        ),
      );
    const dismissedSet = new Set(dismissed.map((r) => r.id));

    const eligible = candidates.filter((t) => !taggedSet.has(t.id) && !dismissedSet.has(t.id));
    const sheetCounts = await fetchSheetCounts(eligible.map((t) => t.id));
    const ranked = rankAgainst(
      eligible,
      {
        tradeType: (b as { tradeType?: string | null }).tradeType ?? null,
        title: b.name,
        clientName: null,
        address: null,
      },
      sheetCounts,
    );
    res.setHeader("X-Suggestion-Latency-Ms", String(Date.now() - start));
    res.json(ranked);
  } catch (err) {
    next(err);
  }
});

router.get("/api/projects/:projectId/takeoff/suggestions", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const start = Date.now();
    const [p] = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).limit(1);
    if (!p) return res.status(404).json({ error: "Project not found" });
    if (req.user!.role !== "SUPER_ADMIN" && p.gcOrganizationId !== req.user!.organizationId) return res.status(403).json({ error: "Forbidden" });

    // Suggestions are ALWAYS scoped to the destination's owning org —
    // even for SUPER_ADMIN — so cross-tenant takeoffs cannot leak in.
    if (!p.gcOrganizationId) return res.json([]);
    const candidates = await db
      .select()
      .from(standaloneTakeoffs)
      .where(and(eq(standaloneTakeoffs.organizationId, p.gcOrganizationId), isNull(standaloneTakeoffs.archivedAt)))
      .limit(500);

    const tagged = await db
      .select({ id: takeoffTags.standaloneTakeoffId })
      .from(takeoffTags)
      .where(eq(takeoffTags.projectId, p.id));
    const taggedSet = new Set(tagged.map((r) => r.id));

    const dismissed = await db
      .select({ id: takeoffSuggestionDismissals.standaloneTakeoffId })
      .from(takeoffSuggestionDismissals)
      .where(
        and(
          eq(takeoffSuggestionDismissals.userId, req.user!.id),
          eq(takeoffSuggestionDismissals.destinationKind, "project"),
          eq(takeoffSuggestionDismissals.destinationId, p.id),
          eq(takeoffSuggestionDismissals.outcome, "DISMISSED"),
        ),
      );
    const dismissedSet = new Set(dismissed.map((r) => r.id));

    const eligible = candidates.filter((t) => !taggedSet.has(t.id) && !dismissedSet.has(t.id));
    const sheetCounts = await fetchSheetCounts(eligible.map((t) => t.id));
    const ranked = rankAgainst(
      eligible,
      {
        tradeType: (p as { tradeType?: string | null }).tradeType ?? null,
        title: p.name,
        clientName: null,
        address: (p as { address?: string | null }).address ?? null,
      },
      sheetCounts,
    );
    res.setHeader("X-Suggestion-Latency-Ms", String(Date.now() - start));
    res.json(ranked);
  } catch (err) {
    next(err);
  }
});

const dismissSchema = z.object({
  destinationKind: z.enum(["bid", "project"]),
  destinationId: z.string().min(1),
});

router.post("/api/takeoff/standalone/:id/dismissals", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const row = await loadAccessibleTakeoff(req.params.id, req.user!);
    if (!row) return res.status(404).json({ error: "Takeoff not found" });
    const parsed = dismissSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
    await db
      .insert(takeoffSuggestionDismissals)
      .values({
        userId: req.user!.id,
        organizationId: row.organizationId,
        standaloneTakeoffId: row.id,
        destinationKind: parsed.data.destinationKind,
        destinationId: parsed.data.destinationId,
        outcome: "DISMISSED",
      })
      .onConflictDoNothing();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
