import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { notifications } from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { eq, desc, sql } from "drizzle-orm";

const router = Router();

router.get("/api/notifications", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userNotifications = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, req.user!.id))
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
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(sql`${notifications.userId} = ${req.user!.id} AND ${notifications.isRead} = false`);

    res.json({ count: result.count });
  } catch (error) {
    logError("Get unread count error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/notifications/:id/read", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [notification] = await db
      .update(notifications)
      .set({ isRead: true })
      .where(sql`${notifications.id} = ${req.params.id} AND ${notifications.userId} = ${req.user!.id}`)
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
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.userId, req.user!.id));

    res.json({ success: true });
  } catch (error: any) {
    logError("Mark all notifications read error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
