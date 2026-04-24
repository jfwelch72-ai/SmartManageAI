/**
 * @openapi
 * /api/notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: List user notifications
 *     description: Returns up to 50 most recent notifications for the authenticated user.
 *     responses:
 *       200:
 *         description: List of notifications
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Notification'
 * /api/notifications/unread-count:
 *   get:
 *     tags: [Notifications]
 *     summary: Get unread notification count
 *     responses:
 *       200:
 *         description: Count of unread notifications
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count: { type: integer }
 * /api/notifications/{id}/read:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark a notification as read
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Notification marked as read }
 *       404: { description: Notification not found }
 * /api/notifications/read-all:
 *   post:
 *     tags: [Notifications]
 *     summary: Mark all notifications as read
 *     responses:
 *       200: { description: All notifications marked as read }
 */
import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { notifications, notificationTypePrefs } from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { eq, and, desc, sql, notInArray } from "drizzle-orm";

type NotificationType = NonNullable<typeof notifications.$inferSelect.type>;

const router = Router();

/**
 * Task #1260 — Returns the set of notification types whose in-app feed
 * delivery the user has explicitly muted (`inAppEnabled = false`). The
 * notification is still inserted (so email/push/sms/Teams/Slack can be
 * routed independently by `deliverNotification`), but it is hidden
 * from the in-app feed and the unread badge.
 *
 * NULL `inAppEnabled` is treated as "not configured", which preserves
 * the historical always-show-in-feed behavior.
 *
 * Task #1747 — Rows whose snooze (`mutedUntil`) has elapsed are
 * skipped, so an "auto-clear in 7 days" mute starts surfacing
 * notifications again on its own without the user having to revisit
 * the dashboard to flip the switch back. NULL `mutedUntil` keeps the
 * historical "indefinite" semantics.
 */
async function loadInAppMutedTypes(userId: string): Promise<NotificationType[]> {
  const rows = await db
    .select({
      notificationType: notificationTypePrefs.notificationType,
      inAppEnabled: notificationTypePrefs.inAppEnabled,
      mutedUntil: notificationTypePrefs.mutedUntil,
    })
    .from(notificationTypePrefs)
    .where(eq(notificationTypePrefs.userId, userId));
  const nowMs = Date.now();
  return rows
    .filter((r) => r.inAppEnabled === false)
    .filter((r) => !r.mutedUntil || new Date(r.mutedUntil).getTime() > nowMs)
    .map((r) => r.notificationType as NotificationType);
}

router.get("/api/notifications", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const baseConditions = orgId
      ? and(eq(notifications.userId, req.user!.id), eq(notifications.organizationId, orgId))
      : and(eq(notifications.userId, req.user!.id), sql`${notifications.organizationId} IS NULL`);

    const mutedTypes = await loadInAppMutedTypes(req.user!.id);
    // Task #1260 — strip in-app-muted types from the feed without
    // affecting any other delivery channel for those notifications.
    const conditions = mutedTypes.length > 0
      ? and(
          baseConditions,
          sql`(${notifications.type} IS NULL OR ${notInArray(notifications.type, mutedTypes)})`,
        )
      : baseConditions;

    const userNotifications = await db
      .select()
      .from(notifications)
      .where(conditions)
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    res.json(userNotifications);
  } catch (error) {
    next(error);
  }
});

router.get("/api/notifications/unread-count", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const orgFilter = orgId ? sql` AND ${notifications.organizationId} = ${orgId}` : sql` AND ${notifications.organizationId} IS NULL`;

    // Task #1260 — exclude in-app-muted types from the unread badge so
    // the count matches what the user actually sees in their feed.
    const mutedTypes = await loadInAppMutedTypes(req.user!.id);
    const muteFilter = mutedTypes.length > 0
      ? sql` AND (${notifications.type} IS NULL OR ${notInArray(notifications.type, mutedTypes)})`
      : sql``;

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(sql`${notifications.userId} = ${req.user!.id} AND ${notifications.isRead} = false${orgFilter}${muteFilter}`);

    res.json({ count: result.count });
  } catch (error) {
    next(error);
  }
});

router.patch("/api/notifications/:id/read", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const orgFilter = orgId ? sql` AND ${notifications.organizationId} = ${orgId}` : sql` AND ${notifications.organizationId} IS NULL`;

    const [notification] = await db
      .update(notifications)
      .set({ isRead: true })
      .where(sql`${notifications.id} = ${req.params.id} AND ${notifications.userId} = ${req.user!.id}${orgFilter}`)
      .returning();

    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    res.json(notification);
  } catch (error: any) {
    next(error);
  }
});

router.post("/api/notifications/read-all", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const conditions = orgId
      ? and(eq(notifications.userId, req.user!.id), eq(notifications.organizationId, orgId))
      : and(eq(notifications.userId, req.user!.id), sql`${notifications.organizationId} IS NULL`);

    await db
      .update(notifications)
      .set({ isRead: true })
      .where(conditions);

    res.json({ success: true });
  } catch (error: any) {
    next(error);
  }
});

export default router;
