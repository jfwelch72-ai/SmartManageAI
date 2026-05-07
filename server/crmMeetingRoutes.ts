import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import {
  crmMeetingLinks, insertCrmMeetingLinkSchema,
  crmMeetingBookings,
  crmContacts, crmOrganisations, crmOpportunityActivities, crmOpportunities,
  notifications, users,
} from "@shared/schema";
import { and, eq, gte, lte, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { sendEmail } from "./email";

const router = Router();
const READ_ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"] as const;
const EDIT_ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"] as const;

const linkBody = insertCrmMeetingLinkSchema.omit({ organizationId: true, slug: true, ownerUserId: true }).extend({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/i).optional(),
  ownerUserId: z.string().optional(),
});

router.get("/api/crm/meeting-links", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const rows = await db.select().from(crmMeetingLinks).where(eq(crmMeetingLinks.organizationId, orgId)).orderBy(desc(crmMeetingLinks.createdAt));
    res.json(rows);
  } catch (e) { next(e); }
});

router.post("/api/crm/meeting-links", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = linkBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const slug = parsed.data.slug || `${parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}-${Math.random().toString(36).slice(2, 8)}`;
    const [created] = await db.insert(crmMeetingLinks).values({
      ...parsed.data,
      slug,
      organizationId: orgId,
      ownerUserId: parsed.data.ownerUserId || req.user!.id,
    } as any).returning();
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch("/api/crm/meeting-links/:id", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = linkBody.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [updated] = await db.update(crmMeetingLinks)
      .set({ ...(parsed.data as any), updatedAt: new Date() })
      .where(and(eq(crmMeetingLinks.id, req.params.id), eq(crmMeetingLinks.organizationId, orgId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete("/api/crm/meeting-links/:id", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    await db.delete(crmMeetingLinks).where(and(eq(crmMeetingLinks.id, req.params.id), eq(crmMeetingLinks.organizationId, orgId)));
    res.status(204).end();
  } catch (e) { next(e); }
});

router.get("/api/crm/meeting-bookings", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const rows = await db.select().from(crmMeetingBookings).where(eq(crmMeetingBookings.organizationId, orgId)).orderBy(desc(crmMeetingBookings.startAt)).limit(200);
    res.json(rows);
  } catch (e) { next(e); }
});

// PUBLIC: get link metadata + computed availability slots for a date range
router.get("/api/public/meeting-links/:slug", async (req, res, next) => {
  try {
    const [link] = await db.select().from(crmMeetingLinks).where(and(eq(crmMeetingLinks.slug, req.params.slug), eq(crmMeetingLinks.isActive, true))).limit(1);
    if (!link) return res.status(404).json({ error: "Booking link not found" });
    res.json({
      id: link.id,
      slug: link.slug,
      name: link.name,
      description: link.description,
      durationMinutes: link.durationMinutes,
      bufferMinutes: link.bufferMinutes,
      timezone: link.timezone,
      availability: link.availability,
    });
  } catch (e) { next(e); }
});

router.get("/api/public/meeting-links/:slug/slots", async (req, res, next) => {
  try {
    const [link] = await db.select().from(crmMeetingLinks).where(and(eq(crmMeetingLinks.slug, req.params.slug), eq(crmMeetingLinks.isActive, true))).limit(1);
    if (!link) return res.status(404).json({ error: "Not found" });
    const fromStr = String(req.query.from || "");
    const toStr = String(req.query.to || "");
    const from = fromStr ? new Date(fromStr) : new Date();
    const to = toStr ? new Date(toStr) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return res.status(400).json({ error: "Invalid date range" });

    const existing = await db.select().from(crmMeetingBookings)
      .where(and(
        eq(crmMeetingBookings.ownerUserId, link.ownerUserId),
        gte(crmMeetingBookings.startAt, from),
        lte(crmMeetingBookings.startAt, to),
        eq(crmMeetingBookings.status, "SCHEDULED"),
      ));

    const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const avail = (link.availability as Record<string, { start: string; end: string }[]>) || {};
    const slots: string[] = [];
    const slotMs = link.durationMinutes * 60 * 1000;
    const bufMs = link.bufferMinutes * 60 * 1000;
    const cur = new Date(from);
    cur.setMinutes(0, 0, 0);
    while (cur < to) {
      const key = dayKeys[cur.getUTCDay()];
      const ranges = avail[key] || [];
      for (const r of ranges) {
        const [sh, sm] = (r.start || "09:00").split(":").map((x) => parseInt(x, 10));
        const [eh, em] = (r.end || "17:00").split(":").map((x) => parseInt(x, 10));
        const dayStart = new Date(cur); dayStart.setUTCHours(sh, sm, 0, 0);
        const dayEnd = new Date(cur); dayEnd.setUTCHours(eh, em, 0, 0);
        let t = dayStart.getTime();
        while (t + slotMs <= dayEnd.getTime()) {
          const slotDate = new Date(t);
          if (slotDate >= from && slotDate <= to) {
            const conflicts = existing.some((b) => Math.abs(new Date(b.startAt).getTime() - t) < slotMs + bufMs);
            if (!conflicts) slots.push(slotDate.toISOString());
          }
          t += slotMs + bufMs;
        }
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    res.json({ slots: slots.slice(0, 200) });
  } catch (e) { next(e); }
});

const bookingBody = z.object({
  startAt: z.string().datetime(),
  inviteeName: z.string().min(1),
  inviteeEmail: z.string().email(),
  inviteePhone: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/api/public/meeting-links/:slug/book", async (req, res, next) => {
  try {
    const [link] = await db.select().from(crmMeetingLinks).where(and(eq(crmMeetingLinks.slug, req.params.slug), eq(crmMeetingLinks.isActive, true))).limit(1);
    if (!link) return res.status(404).json({ error: "Not found" });
    const parsed = bookingBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

    const startAt = new Date(parsed.data.startAt);
    const endAt = new Date(startAt.getTime() + link.durationMinutes * 60 * 1000);

    // Server-side enforcement: min 1h notice
    const MIN_NOTICE_MS = 60 * 60 * 1000;
    if (startAt.getTime() - Date.now() < MIN_NOTICE_MS) {
      return res.status(400).json({ error: "Booking must be at least 1 hour in the future" });
    }
    // Server-side enforcement: startAt must fall inside an availability window
    const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const avail = (link.availability as Record<string, { start: string; end: string }[]>) || {};
    const dayKey = dayKeys[startAt.getUTCDay()];
    const ranges = avail[dayKey] || [];
    const inWindow = ranges.some((r) => {
      const [sh, sm] = (r.start || "09:00").split(":").map((x) => parseInt(x, 10));
      const [eh, em] = (r.end || "17:00").split(":").map((x) => parseInt(x, 10));
      const dayStart = new Date(startAt); dayStart.setUTCHours(sh, sm, 0, 0);
      const dayEnd = new Date(startAt); dayEnd.setUTCHours(eh, em, 0, 0);
      return startAt.getTime() >= dayStart.getTime() && endAt.getTime() <= dayEnd.getTime();
    });
    if (!inWindow) {
      return res.status(400).json({ error: "Selected time is outside available booking hours" });
    }

    const [conflict] = await db.select().from(crmMeetingBookings).where(and(
      eq(crmMeetingBookings.ownerUserId, link.ownerUserId),
      eq(crmMeetingBookings.startAt, startAt),
      eq(crmMeetingBookings.status, "SCHEDULED"),
    )).limit(1);
    if (conflict) return res.status(409).json({ error: "Slot no longer available" });

    let contactId: string | null = null;
    const [existing] = await db.select().from(crmContacts).where(and(eq(crmContacts.organizationId, link.organizationId), eq(crmContacts.email, parsed.data.inviteeEmail))).limit(1);
    if (existing) contactId = existing.id;
    else {
      const orgName = "Web Meetings";
      let [orgRow] = await db.select().from(crmOrganisations)
        .where(and(eq(crmOrganisations.organizationId, link.organizationId), eq(crmOrganisations.name, orgName)))
        .limit(1);
      if (!orgRow) {
        [orgRow] = await db.insert(crmOrganisations).values({
          organizationId: link.organizationId,
          name: orgName,
          type: "CONTRACTOR",
        } as any).returning();
      }
      const parts = parsed.data.inviteeName.split(/\s+/);
      const firstName = parts[0] || "Guest";
      const lastName = parts.slice(1).join(" ") || "Meeting";
      const [c] = await db.insert(crmContacts).values({
        organizationId: link.organizationId,
        organisationId: orgRow.id,
        firstName,
        lastName,
        email: parsed.data.inviteeEmail,
        phone: parsed.data.inviteePhone ?? null,
      } as any).returning();
      contactId = c.id;
    }

    const [booking] = await db.insert(crmMeetingBookings).values({
      organizationId: link.organizationId,
      linkId: link.id,
      ownerUserId: link.ownerUserId,
      inviteeName: parsed.data.inviteeName,
      inviteeEmail: parsed.data.inviteeEmail,
      inviteePhone: parsed.data.inviteePhone ?? null,
      notes: parsed.data.notes ?? null,
      startAt,
      endAt,
      contactId,
      status: "SCHEDULED",
    } as any).returning();

    if (link.notifyOnBooking) {
      try {
        await db.insert(notifications).values({
          userId: link.ownerUserId,
          organizationId: link.organizationId,
          type: "CRM_MEETING_BOOKED",
          title: "New meeting booked",
          message: `${parsed.data.inviteeName} booked ${link.name} for ${startAt.toLocaleString()}`,
          relatedEntityId: booking.id,
          relatedEntityType: "CRM_MEETING_BOOKING",
        } as any);
      } catch { /* non-fatal */ }

      try {
        const [owner] = await db.select().from(users).where(eq(users.id, link.ownerUserId)).limit(1);
        if (owner?.email) {
          await sendEmail({
            to: owner.email,
            subject: `New meeting booked: ${link.name}`,
            html: `<p><strong>${parsed.data.inviteeName}</strong> (${parsed.data.inviteeEmail}) booked <strong>${link.name}</strong>.</p><p>Time: ${startAt.toLocaleString()}</p>${parsed.data.notes ? `<p>Notes: ${parsed.data.notes}</p>` : ""}`,
            text: `${parsed.data.inviteeName} (${parsed.data.inviteeEmail}) booked ${link.name} at ${startAt.toLocaleString()}.`,
          });
          await sendEmail({
            to: parsed.data.inviteeEmail,
            subject: `Meeting confirmed: ${link.name}`,
            html: `<p>Your meeting <strong>${link.name}</strong> with ${[owner.firstName, owner.lastName].filter(Boolean).join(" ") || owner.email} is confirmed for ${startAt.toLocaleString()}.</p>`,
            text: `Your meeting ${link.name} is confirmed for ${startAt.toLocaleString()}.`,
          });
        }
      } catch { /* non-fatal */ }
    }

    if (contactId) {
      try {
        const [linkedOpp] = await db.select().from(crmOpportunities).where(and(
          eq(crmOpportunities.organizationId, link.organizationId),
          eq(crmOpportunities.contactId, contactId),
        )).orderBy(desc(crmOpportunities.createdAt)).limit(1);
        if (linkedOpp) {
          await db.insert(crmOpportunityActivities).values({
            opportunityId: linkedOpp.id,
            activityType: "MEETING",
            description: `[Auto] Meeting booked via "${link.name}" by ${parsed.data.inviteeName} for ${startAt.toLocaleString()}`,
          } as any);
        }
      } catch { /* non-fatal */ }
    }

    res.status(201).json({ ok: true, bookingId: booking.id, startAt: startAt.toISOString() });
  } catch (e) { next(e); }
});

export default router;
