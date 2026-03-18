import { Router, Response } from "express";
import { db } from "./db";
import { pushSubscriptions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getVapidPublicKey } from "./services/pushService";
import { requireAuth, type AuthRequest } from "./auth";
import { logError } from "./utils/logger";
import { z } from "zod";

const router = Router();

router.get("/api/push/vapid-public-key", requireAuth, (_req: AuthRequest, res: Response) => {
  const key = getVapidPublicKey();
  if (!key) {
    return res.status(503).json({ error: "Push notifications not configured" });
  }
  res.json({ vapidPublicKey: key });
});

const subscribeBodySchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

router.post("/api/push/subscribe", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = subscribeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid subscription payload", details: parsed.error.format() });
    }

    const userId = req.user!.id;
    const { endpoint, p256dh, auth } = parsed.data;

    await db
      .insert(pushSubscriptions)
      .values({ userId, endpoint, p256dh, auth })
      .onConflictDoUpdate({
        target: [pushSubscriptions.userId, pushSubscriptions.endpoint],
        set: { p256dh, auth },
      });

    res.json({ success: true });
  } catch (err) {
    logError("pushSubscriptionRoutes: subscribe failed", { error: String(err) });
    res.status(500).json({ error: "Failed to save push subscription" });
  }
});

router.post("/api/push/unsubscribe", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { endpoint } = req.body as { endpoint?: string };
    const userId = req.user!.id;

    if (endpoint) {
      await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
    } else {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    }

    res.json({ success: true });
  } catch (err) {
    logError("pushSubscriptionRoutes: unsubscribe failed", { error: String(err) });
    res.status(500).json({ error: "Failed to remove push subscription" });
  }
});

export default router;
