import { Router, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { withOrgContext } from "./dbContext";
import { portalNotifications, portalNotificationPrefs, clientPortalAccess } from "@shared/schema";
import { eq, and, desc, count } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";
import { requirePortalAuth, type PortalRequest } from "./portalAuth";
import { registerPortalSseClient } from "./portalChatEvents";
import { logError } from "./utils/logger";
import { z } from "zod";

const router = Router();

const PAGE_SIZE = 30;

// ───────────────────────────────────────────────────────────────────────────
// Client portal auth middleware (mirrors requireClientPortalAuth in
// clientChatRoutes.ts — wraps non-SSE handlers in withOrgContext for RLS).
// ───────────────────────────────────────────────────────────────────────────

interface ClientPortalNotificationRequest extends Request {
  clientAccess?: {
    id: string;
    organizationId: string;
    projectId: string;
    email: string;
  };
}

async function requireClientPortalNotificationAuth(
  req: ClientPortalNotificationRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const email = req.headers["x-client-email"] as string;
  const projectId = req.headers["x-client-project-id"] as string;

  if (!email || !projectId) {
    res.status(401).json({ error: "Client portal authentication required" });
    return;
  }

  try {
    const [access] = await db
      .select()
      .from(clientPortalAccess)
      .where(
        and(
          eq(clientPortalAccess.email, email),
          eq(clientPortalAccess.projectId, projectId),
          eq(clientPortalAccess.isActive, true),
        ),
      )
      .limit(1);

    if (!access) {
      res.status(401).json({ error: "Invalid client portal access" });
      return;
    }

    req.clientAccess = {
      id: access.id,
      organizationId: access.organizationId,
      projectId: access.projectId,
      email: access.email,
    };

    await withOrgContext(
      {
        organizationId: access.organizationId,
        isSuperadmin: false,
        source: `client-portal-notifications:${req.method} ${req.path}`,
      },
      () =>
        new Promise<void>((resolve) => {
          let settled = false;
          const settle = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          res.on("finish", settle);
          res.on("close", settle);
          next();
        }),
    );
  } catch {
    res.status(500).json({ error: "Authentication error" });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Sub-portal notification endpoints (token-authenticated via requirePortalAuth)
// ───────────────────────────────────────────────────────────────────────────

router.get(
  "/portal/notifications",
  requirePortalAuth,
  async (req: PortalRequest, res: Response, next: NextFunction) => {
    try {
      const portalTokenId = req.portalToken?.id;
      if (!portalTokenId) {
        return res.status(401).json({ error: "Portal authentication required" });
      }

      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
      const offset = (page - 1) * PAGE_SIZE;

      const rows = await db
        .select()
        .from(portalNotifications)
        .where(eq(portalNotifications.portalTokenId, portalTokenId))
        .orderBy(desc(portalNotifications.createdAt))
        .limit(PAGE_SIZE)
        .offset(offset);

      const [countRow] = await db
        .select({ total: count() })
        .from(portalNotifications)
        .where(eq(portalNotifications.portalTokenId, portalTokenId));

      const total = countRow?.total ?? 0;
      res.json({
        data: rows,
        pagination: {
          page,
          pageSize: PAGE_SIZE,
          total,
          hasMore: offset + rows.length < total,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/portal/notifications/unread-count",
  requirePortalAuth,
  async (req: PortalRequest, res: Response, next: NextFunction) => {
    try {
      const portalTokenId = req.portalToken?.id;
      if (!portalTokenId) {
        return res.status(401).json({ error: "Portal authentication required" });
      }

      const [row] = await db
        .select({ total: count() })
        .from(portalNotifications)
        .where(
          and(
            eq(portalNotifications.portalTokenId, portalTokenId),
            eq(portalNotifications.isRead, false),
          ),
        );

      res.json({ count: row?.total ?? 0 });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/portal/notifications/:id/read",
  requirePortalAuth,
  async (req: PortalRequest, res: Response, next: NextFunction) => {
    try {
      const portalTokenId = req.portalToken?.id;
      if (!portalTokenId) {
        return res.status(401).json({ error: "Portal authentication required" });
      }

      await db
        .update(portalNotifications)
        .set({ isRead: true })
        .where(
          and(
            eq(portalNotifications.id, req.params.id),
            eq(portalNotifications.portalTokenId, portalTokenId),
          ),
        );

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/portal/notifications/read-all",
  requirePortalAuth,
  async (req: PortalRequest, res: Response, next: NextFunction) => {
    try {
      const portalTokenId = req.portalToken?.id;
      if (!portalTokenId) {
        return res.status(401).json({ error: "Portal authentication required" });
      }

      await db
        .update(portalNotifications)
        .set({ isRead: true })
        .where(eq(portalNotifications.portalTokenId, portalTokenId));

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

const prefsBodySchema = z.object({
  emailEnabled: z.boolean(),
  inAppEnabled: z.boolean(),
});

router.get(
  "/portal/notifications/preferences",
  requirePortalAuth,
  async (req: PortalRequest, res: Response, next: NextFunction) => {
    try {
      const portalTokenId = req.portalToken?.id;
      if (!portalTokenId) return res.status(401).json({ error: "Portal authentication required" });

      const [row] = await db
        .select()
        .from(portalNotificationPrefs)
        .where(eq(portalNotificationPrefs.portalTokenId, portalTokenId))
        .limit(1);

      res.json({
        emailEnabled: row?.emailEnabled ?? true,
        inAppEnabled: row?.inAppEnabled ?? true,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/portal/notifications/preferences",
  requirePortalAuth,
  async (req: PortalRequest, res: Response, next: NextFunction) => {
    try {
      const portalToken = req.portalToken;
      if (!portalToken) return res.status(401).json({ error: "Portal authentication required" });

      const parsed = prefsBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid preferences data" });
      }

      const { emailEnabled, inAppEnabled } = parsed.data;
      const now = new Date();

      const [existing] = await db
        .select({ id: portalNotificationPrefs.id })
        .from(portalNotificationPrefs)
        .where(eq(portalNotificationPrefs.portalTokenId, portalToken.id))
        .limit(1);

      if (existing) {
        await db
          .update(portalNotificationPrefs)
          .set({ emailEnabled, inAppEnabled, updatedAt: now })
          .where(eq(portalNotificationPrefs.id, existing.id));
      } else {
        await db
          .insert(portalNotificationPrefs)
          .values({
            organizationId: portalToken.organizationId,
            recipientType: "subcontractor",
            portalTokenId: portalToken.id,
            emailEnabled,
            inAppEnabled,
            updatedAt: now,
          });
      }

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// ───────────────────────────────────────────────────────────────────────────
// Client portal notification endpoints (email+projectId authenticated)
// Uses requireClientPortalNotificationAuth which wraps in withOrgContext.
// ───────────────────────────────────────────────────────────────────────────

router.get(
  "/client-portal/notifications",
  requireClientPortalNotificationAuth as (req: Request, res: Response, next: NextFunction) => void,
  async (req: ClientPortalNotificationRequest, res: Response, next: NextFunction) => {
    try {
      const accessId = req.clientAccess!.id;
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
      const offset = (page - 1) * PAGE_SIZE;

      const rows = await db
        .select()
        .from(portalNotifications)
        .where(eq(portalNotifications.clientPortalAccessId, accessId))
        .orderBy(desc(portalNotifications.createdAt))
        .limit(PAGE_SIZE)
        .offset(offset);

      const [countRow] = await db
        .select({ total: count() })
        .from(portalNotifications)
        .where(eq(portalNotifications.clientPortalAccessId, accessId));

      const total = countRow?.total ?? 0;
      res.json({
        data: rows,
        pagination: {
          page,
          pageSize: PAGE_SIZE,
          total,
          hasMore: offset + rows.length < total,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/client-portal/notifications/unread-count",
  requireClientPortalNotificationAuth as (req: Request, res: Response, next: NextFunction) => void,
  async (req: ClientPortalNotificationRequest, res: Response, next: NextFunction) => {
    try {
      const accessId = req.clientAccess!.id;

      const [row] = await db
        .select({ total: count() })
        .from(portalNotifications)
        .where(
          and(
            eq(portalNotifications.clientPortalAccessId, accessId),
            eq(portalNotifications.isRead, false),
          ),
        );

      res.json({ count: row?.total ?? 0 });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/client-portal/notifications/:id/read",
  requireClientPortalNotificationAuth as (req: Request, res: Response, next: NextFunction) => void,
  async (req: ClientPortalNotificationRequest, res: Response, next: NextFunction) => {
    try {
      const accessId = req.clientAccess!.id;

      await db
        .update(portalNotifications)
        .set({ isRead: true })
        .where(
          and(
            eq(portalNotifications.id, req.params.id),
            eq(portalNotifications.clientPortalAccessId, accessId),
          ),
        );

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/client-portal/notifications/read-all",
  requireClientPortalNotificationAuth as (req: Request, res: Response, next: NextFunction) => void,
  async (req: ClientPortalNotificationRequest, res: Response, next: NextFunction) => {
    try {
      const accessId = req.clientAccess!.id;

      await db
        .update(portalNotifications)
        .set({ isRead: true })
        .where(eq(portalNotifications.clientPortalAccessId, accessId));

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/client-portal/notifications/preferences",
  requireClientPortalNotificationAuth as (req: Request, res: Response, next: NextFunction) => void,
  async (req: ClientPortalNotificationRequest, res: Response, next: NextFunction) => {
    try {
      const accessId = req.clientAccess!.id;

      const [row] = await db
        .select()
        .from(portalNotificationPrefs)
        .where(eq(portalNotificationPrefs.clientPortalAccessId, accessId))
        .limit(1);

      res.json({ emailEnabled: row?.emailEnabled ?? true, inAppEnabled: row?.inAppEnabled ?? true });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/client-portal/notifications/preferences",
  requireClientPortalNotificationAuth as (req: Request, res: Response, next: NextFunction) => void,
  async (req: ClientPortalNotificationRequest, res: Response, next: NextFunction) => {
    try {
      const { id: accessId, organizationId } = req.clientAccess!;

      const parsed = prefsBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid preferences data" });

      const { emailEnabled, inAppEnabled } = parsed.data;
      const now = new Date();

      const [existing] = await db
        .select({ id: portalNotificationPrefs.id })
        .from(portalNotificationPrefs)
        .where(eq(portalNotificationPrefs.clientPortalAccessId, accessId))
        .limit(1);

      if (existing) {
        await db
          .update(portalNotificationPrefs)
          .set({ emailEnabled, inAppEnabled, updatedAt: now })
          .where(eq(portalNotificationPrefs.id, existing.id));
      } else {
        await db
          .insert(portalNotificationPrefs)
          .values({
            organizationId,
            recipientType: "client",
            clientPortalAccessId: accessId,
            emailEnabled,
            inAppEnabled,
            updatedAt: now,
          });
      }

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// ───────────────────────────────────────────────────────────────────────────
// Vendor portal notification endpoints (standard JWT auth, VENDOR role)
// ───────────────────────────────────────────────────────────────────────────

router.get(
  "/vendor/notifications",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
      const offset = (page - 1) * PAGE_SIZE;

      const rows = await db
        .select()
        .from(portalNotifications)
        .where(eq(portalNotifications.userId, userId))
        .orderBy(desc(portalNotifications.createdAt))
        .limit(PAGE_SIZE)
        .offset(offset);

      const [countRow] = await db
        .select({ total: count() })
        .from(portalNotifications)
        .where(eq(portalNotifications.userId, userId));

      const total = countRow?.total ?? 0;
      res.json({
        data: rows,
        pagination: {
          page,
          pageSize: PAGE_SIZE,
          total,
          hasMore: offset + rows.length < total,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/vendor/notifications/unread-count",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const [row] = await db
        .select({ total: count() })
        .from(portalNotifications)
        .where(
          and(
            eq(portalNotifications.userId, userId),
            eq(portalNotifications.isRead, false),
          ),
        );
      res.json({ count: row?.total ?? 0 });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/vendor/notifications/:id/read",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      await db
        .update(portalNotifications)
        .set({ isRead: true })
        .where(
          and(
            eq(portalNotifications.id, req.params.id),
            eq(portalNotifications.userId, userId),
          ),
        );
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/vendor/notifications/read-all",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      await db
        .update(portalNotifications)
        .set({ isRead: true })
        .where(eq(portalNotifications.userId, userId));
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/vendor/notifications/preferences",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const [row] = await db
        .select()
        .from(portalNotificationPrefs)
        .where(eq(portalNotificationPrefs.userId, userId))
        .limit(1);
      res.json({ emailEnabled: row?.emailEnabled ?? true, inAppEnabled: row?.inAppEnabled ?? true });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/vendor/notifications/preferences",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const parsed = prefsBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid preferences data" });

      const { emailEnabled, inAppEnabled } = parsed.data;
      const now = new Date();
      const orgId = req.user!.organizationId ?? "";

      const [existing] = await db
        .select({ id: portalNotificationPrefs.id })
        .from(portalNotificationPrefs)
        .where(eq(portalNotificationPrefs.userId, userId))
        .limit(1);

      if (existing) {
        await db
          .update(portalNotificationPrefs)
          .set({ emailEnabled, inAppEnabled, updatedAt: now })
          .where(eq(portalNotificationPrefs.id, existing.id));
      } else {
        await db
          .insert(portalNotificationPrefs)
          .values({
            organizationId: orgId,
            recipientType: "vendor",
            userId,
            emailEnabled,
            inAppEnabled,
            updatedAt: now,
          });
      }

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// ───────────────────────────────────────────────────────────────────────────
// Vendor portal real-time SSE stream
// Vendors authenticate via standard JWT cookie (same-origin fetch/EventSource
// sends cookies automatically). Emits "notification:new" when a new portal
// notification is created for this vendor user.
// ───────────────────────────────────────────────────────────────────────────

router.get(
  "/vendor/notifications/stream",
  requireAuth,
  (req: AuthRequest, res: Response) => {
    const userId = req.user!.id;

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();

    const unsubscribe = registerPortalSseClient("vendor", userId, res);

    const keepAlive = setInterval(() => {
      try {
        res.write(": keep-alive\n\n");
      } catch {
        // client disconnected
      }
    }, 30_000);

    req.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  },
);

export default router;
