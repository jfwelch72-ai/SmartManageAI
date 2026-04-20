import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import {
  crmSequences,
  crmSequenceSteps,
  crmSequenceEnrollments,
  crmSequenceStepExecutions,
  crmSequenceEmailEvents,
  crmContacts,
  crmOpportunities,
  crmTasks,
  emailMessages,
  users,
  insertCrmSequenceSchema,
  insertCrmSequenceStepSchema,
} from "@shared/schema";
import { and, eq, desc, asc, sql, gte, lte, inArray, count, isNull, ne, or } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import {
  buildMergeContext,
  renderMergeTokens,
  scheduleNextStep,
  recordEmailEvent,
  exitEnrollment,
  processDueExecutions,
} from "./services/sequenceService";
import { logError } from "./utils/logger";

const router = Router();
const ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"] as const;

// ---------- PUBLIC TRACKING ENDPOINTS (no auth) ----------
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

router.get("/api/crm/sequences/track/open/:execId.png", async (req, res) => {
  try {
    await recordEmailEvent(req.params.execId, "OPEN", { ua: req.headers["user-agent"] || null });
  } catch {}
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.send(PIXEL);
});

router.get("/api/crm/sequences/track/click/:execId", async (req, res) => {
  const target = String(req.query.u || "");
  try {
    await recordEmailEvent(req.params.execId, "CLICK", { url: target, ua: req.headers["user-agent"] || null });
  } catch {}
  if (target && /^https?:\/\//i.test(target)) {
    res.redirect(target);
  } else {
    res.status(400).send("Invalid target");
  }
});

// ---------- TEMPLATES ----------
router.get("/api/crm/sequences", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });
    const conds = [];
    if (!isSuperAdmin && orgId) conds.push(eq(crmSequences.organizationId, orgId));
    const rows = await db
      .select({
        sequence: crmSequences,
        ownerFirst: users.firstName,
        ownerLast: users.lastName,
        stepCount: sql<number>`(SELECT COUNT(*)::int FROM ${crmSequenceSteps} WHERE ${crmSequenceSteps.sequenceId} = ${crmSequences.id})`,
        activeEnrollments: sql<number>`(SELECT COUNT(*)::int FROM ${crmSequenceEnrollments} WHERE ${crmSequenceEnrollments.sequenceId} = ${crmSequences.id} AND ${crmSequenceEnrollments.status} = 'ACTIVE')`,
        totalEnrollments: sql<number>`(SELECT COUNT(*)::int FROM ${crmSequenceEnrollments} WHERE ${crmSequenceEnrollments.sequenceId} = ${crmSequences.id})`,
        repliedCount: sql<number>`(SELECT COUNT(*)::int FROM ${crmSequenceEnrollments} WHERE ${crmSequenceEnrollments.sequenceId} = ${crmSequences.id} AND ${crmSequenceEnrollments.status} = 'REPLIED')`,
      })
      .from(crmSequences)
      .leftJoin(users, eq(crmSequences.ownerId, users.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(crmSequences.updatedAt));
    res.json(rows.map(r => ({
      ...r.sequence,
      ownerName: r.ownerFirst ? `${r.ownerFirst} ${r.ownerLast || ""}`.trim() : null,
      stepCount: r.stepCount,
      activeEnrollments: r.activeEnrollments,
      totalEnrollments: r.totalEnrollments,
      repliedCount: r.repliedCount,
    })));
  } catch (e) { next(e); }
});

const sequenceBodySchema = insertCrmSequenceSchema.omit({ organizationId: true, ownerId: true });

router.post("/api/crm/sequences", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = sequenceBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [created] = await db.insert(crmSequences).values({
      ...parsed.data,
      organizationId: orgId,
      ownerId: req.user!.id,
    }).returning();
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.get("/api/crm/sequences/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });
    const [seq] = await db.select().from(crmSequences).where(eq(crmSequences.id, req.params.id)).limit(1);
    if (!seq) return res.status(404).json({ error: "Not found" });
    if (!isSuperAdmin && orgId && seq.organizationId !== orgId) return res.status(403).json({ error: "Access denied" });
    const steps = await db.select().from(crmSequenceSteps).where(eq(crmSequenceSteps.sequenceId, seq.id)).orderBy(asc(crmSequenceSteps.stepOrder));
    res.json({ ...seq, steps });
  } catch (e) { next(e); }
});

router.patch("/api/crm/sequences/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });
    const [seq] = await db.select().from(crmSequences).where(eq(crmSequences.id, req.params.id)).limit(1);
    if (!seq) return res.status(404).json({ error: "Not found" });
    if (!isSuperAdmin && orgId && seq.organizationId !== orgId) return res.status(403).json({ error: "Access denied" });
    if (!isSuperAdmin && req.user!.role !== "ADMIN" && seq.ownerId !== req.user!.id) {
      return res.status(403).json({ error: "Only owner or admin can edit" });
    }
    const parsed = sequenceBodySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [updated] = await db.update(crmSequences).set({ ...parsed.data, updatedAt: new Date() }).where(eq(crmSequences.id, seq.id)).returning();
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete("/api/crm/sequences/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });
    const [seq] = await db.select().from(crmSequences).where(eq(crmSequences.id, req.params.id)).limit(1);
    if (!seq) return res.status(404).json({ error: "Not found" });
    if (!isSuperAdmin && orgId && seq.organizationId !== orgId) return res.status(403).json({ error: "Access denied" });
    if (!isSuperAdmin && req.user!.role !== "ADMIN" && seq.ownerId !== req.user!.id) {
      return res.status(403).json({ error: "Only owner or admin can delete" });
    }
    await db.delete(crmSequences).where(eq(crmSequences.id, seq.id));
    res.status(204).end();
  } catch (e) { next(e); }
});

router.post("/api/crm/sequences/:id/clone", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const [seq] = await db.select().from(crmSequences).where(and(eq(crmSequences.id, req.params.id), eq(crmSequences.organizationId, orgId))).limit(1);
    if (!seq) return res.status(404).json({ error: "Not found" });
    const [newSeq] = await db.insert(crmSequences).values({
      organizationId: orgId,
      name: `${seq.name} (Copy)`,
      description: seq.description,
      status: "DRAFT",
      ownerId: req.user!.id,
      businessHoursOnly: seq.businessHoursOnly,
      weekdaysOnly: seq.weekdaysOnly,
      dailySendCap: seq.dailySendCap,
    }).returning();
    const steps = await db.select().from(crmSequenceSteps).where(eq(crmSequenceSteps.sequenceId, seq.id));
    if (steps.length > 0) {
      await db.insert(crmSequenceSteps).values(steps.map(s => ({
        sequenceId: newSeq.id,
        stepOrder: s.stepOrder,
        stepType: s.stepType,
        delayDays: s.delayDays,
        sendHourLocal: s.sendHourLocal,
        subject: s.subject,
        body: s.body,
        instructions: s.instructions,
      })));
    }
    res.status(201).json(newSeq);
  } catch (e) { next(e); }
});

// ---------- STEPS ----------
const stepBodySchema = insertCrmSequenceStepSchema.omit({ sequenceId: true });

// Owner-or-admin gate for step CRUD: a CRM-role user in the org may not edit
// another user's sequence template steps.
async function loadSequenceForStepEdit(req: AuthRequest, sequenceId: string) {
  const { orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
  if (mustDenyAccess) return { error: "Access denied", code: 403 as const };
  const [seq] = await db.select().from(crmSequences).where(eq(crmSequences.id, sequenceId)).limit(1);
  if (!seq) return { error: "Not found", code: 404 as const };
  if (!isSuperAdmin && orgId && seq.organizationId !== orgId) return { error: "Access denied", code: 403 as const };
  if (!isSuperAdmin && req.user!.role !== "ADMIN" && seq.ownerId !== req.user!.id) {
    return { error: "Only owner or admin can edit sequence steps", code: 403 as const };
  }
  return { seq };
}

router.post("/api/crm/sequences/:id/steps", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const r = await loadSequenceForStepEdit(req, req.params.id);
    if (r.error) return res.status(r.code).json({ error: r.error });
    const seq = r.seq!;
    const parsed = stepBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [created] = await db.insert(crmSequenceSteps).values({ ...parsed.data, sequenceId: seq.id }).returning();
    await db.update(crmSequences).set({ updatedAt: new Date() }).where(eq(crmSequences.id, seq.id));
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch("/api/crm/sequences/:id/steps/:stepId", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const r = await loadSequenceForStepEdit(req, req.params.id);
    if (r.error) return res.status(r.code).json({ error: r.error });
    const seq = r.seq!;
    const parsed = stepBodySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [updated] = await db.update(crmSequenceSteps).set(parsed.data).where(and(eq(crmSequenceSteps.id, req.params.stepId), eq(crmSequenceSteps.sequenceId, seq.id))).returning();
    if (!updated) return res.status(404).json({ error: "Step not found" });
    await db.update(crmSequences).set({ updatedAt: new Date() }).where(eq(crmSequences.id, seq.id));
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete("/api/crm/sequences/:id/steps/:stepId", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const r = await loadSequenceForStepEdit(req, req.params.id);
    if (r.error) return res.status(r.code).json({ error: r.error });
    const seq = r.seq!;
    await db.delete(crmSequenceSteps).where(and(eq(crmSequenceSteps.id, req.params.stepId), eq(crmSequenceSteps.sequenceId, seq.id)));
    res.status(204).end();
  } catch (e) { next(e); }
});

// ---------- ENROLLMENTS ----------
// Accepts either a single contactId, a bulk contactIds array, or an opportunityId
// (which auto-resolves to that opportunity's primary contact).
const enrollSchema = z.object({
  contactId: z.string().optional(),
  contactIds: z.array(z.string()).optional(),
  opportunityId: z.string().nullable().optional(),
  senderId: z.string().optional(),
  startAt: z.coerce.date().optional(),
}).refine(
  (v) => Boolean(v.contactId || (v.contactIds && v.contactIds.length > 0) || v.opportunityId),
  { message: "Must provide contactId, contactIds, or opportunityId" },
);

router.post("/api/crm/sequences/:id/enroll", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const [seq] = await db.select().from(crmSequences).where(and(eq(crmSequences.id, req.params.id), eq(crmSequences.organizationId, orgId))).limit(1);
    if (!seq) return res.status(404).json({ error: "Not found" });
    if (seq.status !== "ACTIVE") return res.status(400).json({ error: "Sequence is not active" });
    const parsed = enrollSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const body = parsed.data;
    // Only ADMIN/SUPER_ADMIN may enroll on behalf of a different sender
    if (body.senderId && body.senderId !== req.user!.id && req.user!.role !== "ADMIN" && req.user!.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Only admins can enroll on behalf of another sender" });
    }
    const senderId = body.senderId || req.user!.id;
    const startAt = body.startAt || new Date();
    let opportunityId: string | null = body.opportunityId || null;

    // Resolve target contact list
    const contactIds: string[] = [];
    if (body.contactIds && body.contactIds.length > 0) contactIds.push(...body.contactIds);
    if (body.contactId) contactIds.push(body.contactId);
    // Always validate the opportunity belongs to this org if provided, regardless
    // of whether the caller also supplied contact ids — prevents cross-org refs.
    if (opportunityId) {
      const [opp] = await db.select().from(crmOpportunities)
        .where(and(eq(crmOpportunities.id, opportunityId), eq(crmOpportunities.organizationId, orgId)))
        .limit(1);
      if (!opp) return res.status(404).json({ error: "Opportunity not found in this organization" });
      if (contactIds.length === 0) {
        if (!opp.primaryContactId) return res.status(400).json({ error: "Opportunity has no primary contact to enroll" });
        contactIds.push(opp.primaryContactId);
      }
    }
    // Validate every contact belongs to this org
    const contactRows = await db.select().from(crmContacts).where(and(
      inArray(crmContacts.id, contactIds),
      eq(crmContacts.organizationId, orgId),
    ));
    if (contactRows.length !== contactIds.length) {
      return res.status(400).json({ error: "One or more contacts not found in this organization" });
    }

    // de-dupe: skip contacts already enrolled (any status that's not REMOVED/FINISHED)
    const existing = await db.select().from(crmSequenceEnrollments).where(and(
      eq(crmSequenceEnrollments.sequenceId, seq.id),
      inArray(crmSequenceEnrollments.contactId, contactIds),
    ));
    const skipSet = new Set(existing.filter(e => e.status === "ACTIVE" || e.status === "PAUSED").map(e => e.contactId!));

    const created: typeof crmSequenceEnrollments.$inferSelect[] = [];
    const skipped: string[] = [];
    for (const contactId of contactIds) {
      if (skipSet.has(contactId)) { skipped.push(contactId); continue; }
      try {
        const [enrollment] = await db.insert(crmSequenceEnrollments).values({
          organizationId: orgId,
          sequenceId: seq.id,
          contactId,
          opportunityId,
          senderId,
          status: "ACTIVE",
          currentStepIndex: 0,
          startAt,
        }).returning();
        await scheduleNextStep(enrollment.id);
        created.push(enrollment);
      } catch (err: any) {
        // unique constraint violation
        skipped.push(contactId);
      }
    }
    res.status(201).json({ enrolled: created.length, skipped: skipped.length, enrollments: created });
  } catch (e) { next(e); }
});

router.get("/api/crm/sequences/:id/enrollments", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });
    const [seq] = await db.select().from(crmSequences).where(eq(crmSequences.id, req.params.id)).limit(1);
    if (!seq) return res.status(404).json({ error: "Not found" });
    if (!isSuperAdmin && orgId && seq.organizationId !== orgId) return res.status(403).json({ error: "Access denied" });

    const EXIT_REASON_VALUES = ["REPLIED", "OPPORTUNITY_WON", "OPPORTUNITY_LOST", "MANUAL_REMOVE", "BOUNCED", "COMPLETED"] as const;
    type ExitReasonValue = typeof EXIT_REASON_VALUES[number];
    const rawExitReason = typeof req.query.exitReason === "string" ? req.query.exitReason : null;
    let exitReasonFilter: "NONE" | ExitReasonValue | null = null;
    if (rawExitReason === "NONE") {
      exitReasonFilter = "NONE";
    } else if (rawExitReason && (EXIT_REASON_VALUES as readonly string[]).includes(rawExitReason)) {
      exitReasonFilter = rawExitReason as ExitReasonValue;
    }

    const SORT_FIELDS = { createdAt: crmSequenceEnrollments.createdAt, exitedAt: crmSequenceEnrollments.exitedAt, exitReason: crmSequenceEnrollments.exitReason, status: crmSequenceEnrollments.status } as const;
    const sortParam = typeof req.query.sort === "string" ? req.query.sort : "createdAt:desc";
    const [sortField, sortDir] = sortParam.split(":");
    const dir = sortDir === "asc" ? asc : desc;
    const orderCol = (SORT_FIELDS as Record<string, typeof crmSequenceEnrollments.createdAt>)[sortField] || crmSequenceEnrollments.createdAt;

    const conds = [eq(crmSequenceEnrollments.sequenceId, seq.id)];
    if (exitReasonFilter === "NONE") {
      conds.push(isNull(crmSequenceEnrollments.exitReason));
    } else if (exitReasonFilter) {
      conds.push(eq(crmSequenceEnrollments.exitReason, exitReasonFilter));
    }

    const rows = await db.select({
      enrollment: crmSequenceEnrollments,
      contactFirst: crmContacts.firstName,
      contactLast: crmContacts.lastName,
      contactEmail: crmContacts.email,
      senderFirst: users.firstName,
      senderLast: users.lastName,
      bounceEmailThreadId: emailMessages.threadId,
      bounceEmailSubject: emailMessages.subject,
    }).from(crmSequenceEnrollments)
      .leftJoin(crmContacts, eq(crmSequenceEnrollments.contactId, crmContacts.id))
      .leftJoin(users, eq(crmSequenceEnrollments.senderId, users.id))
      .leftJoin(emailMessages, eq(crmSequenceEnrollments.bounceEmailMessageId, emailMessages.id))
      .where(and(...conds))
      .orderBy(dir(orderCol));

    // Per-step metrics
    const steps = await db.select().from(crmSequenceSteps).where(eq(crmSequenceSteps.sequenceId, seq.id)).orderBy(asc(crmSequenceSteps.stepOrder));
    const metrics: any[] = [];
    for (const step of steps) {
      const execs = await db.select().from(crmSequenceStepExecutions).where(eq(crmSequenceStepExecutions.stepId, step.id));
      metrics.push({
        stepId: step.id,
        stepOrder: step.stepOrder,
        stepType: step.stepType,
        sent: execs.filter(e => e.status === "SENT" || e.status === "COMPLETED").length,
        opened: execs.filter(e => e.openCount > 0).length,
        clicked: execs.filter(e => e.clickCount > 0).length,
        replied: execs.filter(e => e.repliedAt).length,
        bounced: execs.filter(e => e.bouncedAt || e.status === "BOUNCED").length,
        completed: execs.filter(e => e.completedAt).length,
        pending: execs.filter(e => e.status === "PENDING").length,
        failed: execs.filter(e => e.status === "FAILED").length,
      });
    }

    res.json({
      enrollments: rows.map(r => ({
        ...r.enrollment,
        contactName: r.contactFirst ? `${r.contactFirst} ${r.contactLast || ""}`.trim() : null,
        contactEmail: r.contactEmail,
        senderName: r.senderFirst ? `${r.senderFirst} ${r.senderLast || ""}`.trim() : null,
        bounceEmailThreadId: r.bounceEmailThreadId,
        bounceEmailSubject: r.bounceEmailSubject,
      })),
      metrics,
      steps,
    });
  } catch (e) { next(e); }
});

router.get("/api/crm/sequences/enrollments/by-contact/:contactId", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const rows = await db.select({
      enrollment: crmSequenceEnrollments,
      sequenceName: crmSequences.name,
      bounceEmailThreadId: emailMessages.threadId,
      bounceEmailSubject: emailMessages.subject,
    })
      .from(crmSequenceEnrollments)
      .leftJoin(crmSequences, eq(crmSequenceEnrollments.sequenceId, crmSequences.id))
      .leftJoin(emailMessages, eq(crmSequenceEnrollments.bounceEmailMessageId, emailMessages.id))
      .where(and(
        eq(crmSequenceEnrollments.contactId, req.params.contactId),
        eq(crmSequenceEnrollments.organizationId, orgId),
      )).orderBy(desc(crmSequenceEnrollments.createdAt));
    res.json(rows.map(r => ({
      ...r.enrollment,
      sequenceName: r.sequenceName,
      bounceEmailThreadId: r.bounceEmailThreadId,
      bounceEmailSubject: r.bounceEmailSubject,
    })));
  } catch (e) { next(e); }
});

router.get("/api/crm/sequences/enrollments/by-opportunity/:oppId", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const rows = await db.select({
      enrollment: crmSequenceEnrollments,
      sequenceName: crmSequences.name,
      bounceEmailThreadId: emailMessages.threadId,
      bounceEmailSubject: emailMessages.subject,
    })
      .from(crmSequenceEnrollments)
      .leftJoin(crmSequences, eq(crmSequenceEnrollments.sequenceId, crmSequences.id))
      .leftJoin(emailMessages, eq(crmSequenceEnrollments.bounceEmailMessageId, emailMessages.id))
      .where(and(
        eq(crmSequenceEnrollments.opportunityId, req.params.oppId),
        eq(crmSequenceEnrollments.organizationId, orgId),
      )).orderBy(desc(crmSequenceEnrollments.createdAt));
    res.json(rows.map(r => ({
      ...r.enrollment,
      sequenceName: r.sequenceName,
      bounceEmailThreadId: r.bounceEmailThreadId,
      bounceEmailSubject: r.bounceEmailSubject,
    })));
  } catch (e) { next(e); }
});

// Pause / resume / remove
async function checkEnrollmentEditable(req: AuthRequest, enrollmentId: string) {
  const { orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
  if (mustDenyAccess) return { error: "Access denied", code: 403 };
  const [e] = await db.select().from(crmSequenceEnrollments).where(eq(crmSequenceEnrollments.id, enrollmentId)).limit(1);
  if (!e) return { error: "Not found", code: 404 };
  if (!isSuperAdmin && orgId && e.organizationId !== orgId) return { error: "Access denied", code: 403 };
  if (!isSuperAdmin && req.user!.role !== "ADMIN" && e.senderId !== req.user!.id) return { error: "Only sender or admin can modify", code: 403 };
  return { enrollment: e };
}

router.post("/api/crm/sequences/enrollments/:id/pause", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const r = await checkEnrollmentEditable(req, req.params.id);
    if (r.error) return res.status(r.code!).json({ error: r.error });
    await db.update(crmSequenceEnrollments).set({ status: "PAUSED", updatedAt: new Date() }).where(eq(crmSequenceEnrollments.id, req.params.id));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post("/api/crm/sequences/enrollments/:id/resume", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const r = await checkEnrollmentEditable(req, req.params.id);
    if (r.error) return res.status(r.code!).json({ error: r.error });
    await db.update(crmSequenceEnrollments).set({ status: "ACTIVE", exitReason: null, exitedAt: null, updatedAt: new Date() }).where(eq(crmSequenceEnrollments.id, req.params.id));
    await scheduleNextStep(req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post("/api/crm/sequences/enrollments/:id/remove", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const r = await checkEnrollmentEditable(req, req.params.id);
    if (r.error) return res.status(r.code!).json({ error: r.error });
    await exitEnrollment(req.params.id, "MANUAL_REMOVE", "REMOVED");
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Test simulate reply for QA
router.post("/api/crm/sequences/executions/:execId/simulate-reply", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), async (req: AuthRequest, res, next) => {
  try {
    await recordEmailEvent(req.params.execId, "REPLY", { simulated: true, by: req.user!.id });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- PREVIEW ----------
router.post("/api/crm/sequences/:id/preview", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const [seq] = await db.select().from(crmSequences).where(and(eq(crmSequences.id, req.params.id), eq(crmSequences.organizationId, orgId))).limit(1);
    if (!seq) return res.status(404).json({ error: "Not found" });
    const { contactId, stepIndex } = req.body as { contactId?: string; stepIndex?: number };
    const steps = await db.select().from(crmSequenceSteps).where(eq(crmSequenceSteps.sequenceId, seq.id)).orderBy(asc(crmSequenceSteps.stepOrder));
    const idx = Math.min(Math.max(stepIndex || 0, 0), Math.max(steps.length - 1, 0));
    const step = steps[idx];
    if (!step) return res.json({ subject: "", body: "" });
    const ctx = await buildMergeContext(contactId || null, req.user!.id, null, orgId);
    res.json({
      subject: renderMergeTokens(step.subject || "", ctx),
      body: renderMergeTokens(step.body || "", ctx),
      instructions: renderMergeTokens(step.instructions || "", ctx),
      stepType: step.stepType,
    });
  } catch (e) { next(e); }
});

// ---------- INBOX (My Sequences) ----------
router.get("/api/crm/sequences/inbox/me", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const userId = req.user!.id;
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

    // Due-today manual tasks: crm_tasks created by sequences that are PENDING and due today
    const dueTasks = await db.select({
      task: crmTasks,
      execution: crmSequenceStepExecutions,
      sequenceName: crmSequences.name,
      contactFirst: crmContacts.firstName,
      contactLast: crmContacts.lastName,
    })
      .from(crmSequenceStepExecutions)
      .innerJoin(crmTasks, eq(crmSequenceStepExecutions.taskId, crmTasks.id))
      .innerJoin(crmSequenceEnrollments, eq(crmSequenceStepExecutions.enrollmentId, crmSequenceEnrollments.id))
      .innerJoin(crmSequences, eq(crmSequenceEnrollments.sequenceId, crmSequences.id))
      .leftJoin(crmContacts, eq(crmSequenceEnrollments.contactId, crmContacts.id))
      .where(and(
        eq(crmSequenceStepExecutions.organizationId, orgId),
        eq(crmSequenceEnrollments.senderId, userId),
        eq(crmTasks.status, "PENDING"),
        lte(crmTasks.dueDate, todayEnd),
      ))
      .orderBy(asc(crmTasks.dueDate));

    // Replied (paused) enrollments where I am the sender
    const replied = await db.select({
      enrollment: crmSequenceEnrollments,
      sequenceName: crmSequences.name,
      contactFirst: crmContacts.firstName,
      contactLast: crmContacts.lastName,
    })
      .from(crmSequenceEnrollments)
      .leftJoin(crmSequences, eq(crmSequenceEnrollments.sequenceId, crmSequences.id))
      .leftJoin(crmContacts, eq(crmSequenceEnrollments.contactId, crmContacts.id))
      .where(and(
        eq(crmSequenceEnrollments.organizationId, orgId),
        eq(crmSequenceEnrollments.senderId, userId),
        eq(crmSequenceEnrollments.status, "REPLIED"),
      ))
      .orderBy(desc(crmSequenceEnrollments.exitedAt));

    res.json({
      dueToday: dueTasks.map(r => ({
        ...r.task,
        executionId: r.execution.id,
        sequenceName: r.sequenceName,
        contactName: r.contactFirst ? `${r.contactFirst} ${r.contactLast || ""}`.trim() : null,
      })),
      replied: replied.map(r => ({
        ...r.enrollment,
        sequenceName: r.sequenceName,
        contactName: r.contactFirst ? `${r.contactFirst} ${r.contactLast || ""}`.trim() : null,
      })),
    });
  } catch (e) { next(e); }
});

// Run cadence processor on demand (admin / dev)
router.post("/api/crm/sequences/admin/run-now", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), async (_req, res, next) => {
  try {
    const r = await processDueExecutions(new Date());
    res.json(r);
  } catch (e) { next(e); }
});

export default router;
