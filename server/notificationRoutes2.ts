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
import { notifications } from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { eq, and, desc, sql } from "drizzle-orm";

const router = Router();

router.get("/api/notifications", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const conditions = orgId
      ? and(eq(notifications.userId, req.user!.id), eq(notifications.organizationId, orgId))
      : and(eq(notifications.userId, req.user!.id), sql`${notifications.organizationId} IS NULL`);

    const userNotifications = await db
      .select()
      .from(notifications)
      .where(conditions)
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    res.json(userNotifications);
  } catch (error) {
    logError("Get notifications error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/notifications/unread-count", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const orgFilter = orgId ? sql` AND ${notifications.organizationId} = ${orgId}` : sql` AND ${notifications.organizationId} IS NULL`;

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(sql`${notifications.userId} = ${req.user!.id} AND ${notifications.isRead} = false${orgFilter}`);

    res.json({ count: result.count });
  } catch (error) {
    logError("Get unread count error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/notifications/:id/read", requireAuth, async (req: AuthRequest, res) => {
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
    logError("Mark notification read error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/notifications/read-all", requireAuth, async (req: AuthRequest, res) => {
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
    logError("Mark all notifications read error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
