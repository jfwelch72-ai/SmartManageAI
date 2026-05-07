import { logError } from "./utils/logger";
import { Router, Response, NextFunction } from "express";
import { AuthRequest, requireAuth, requireRole } from "./auth";
import { requireFeature } from "./middleware/requireFeature";
import { parsePagination } from "./utils/routeHelpers";
import { db } from "./db";
import { auditLog, users } from "@shared/schema";
import { eq, and, gte, lte, desc, sql, type SQL } from "drizzle-orm";

const router = Router();

router.get("/search", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("AUDIT_EXPORT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const {
      entityType,
      action,
      userId: filterUserId,
      dateFrom,
      dateTo,
    } = req.query as Record<string, string>;

    const { page: pageNum, limit: limitNum, offset } = parsePagination(req, { maxLimit: 100 });

    const conditions: SQL[] = [];

    if (entityType) {
      conditions.push(eq(auditLog.entityType, entityType));
    }
    if (action) {
      conditions.push(eq(auditLog.action, action as any));
    }
    if (filterUserId) {
      conditions.push(eq(auditLog.userId, filterUserId));
    }
    if (dateFrom) {
      conditions.push(gte(auditLog.createdAt, new Date(dateFrom)));
    }
    if (dateTo) {
      conditions.push(lte(auditLog.createdAt, new Date(dateTo)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [logs, countResult] = await Promise.all([
      db.select({
        id: auditLog.id,
        userId: auditLog.userId,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        action: auditLog.action,
        oldValue: auditLog.oldValue,
        newValue: auditLog.newValue,
        ipAddress: auditLog.ipAddress,
        userAgent: auditLog.userAgent,
        createdAt: auditLog.createdAt,
        userEmail: users.email,
        userName: sql<string>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, ${users.email})`,
      })
        .from(auditLog)
        .leftJoin(users, eq(auditLog.userId, users.id))
        .where(whereClause)
        .orderBy(desc(auditLog.createdAt))
        .limit(limitNum)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(whereClause),
    ]);

    res.json({
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countResult[0]?.count || 0,
        totalPages: Math.ceil((countResult[0]?.count || 0) / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/stats", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("AUDIT_EXPORT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [actionStats, entityStats, recentCount] = await Promise.all([
      db.select({
        action: auditLog.action,
        count: sql<number>`count(*)::int`,
      })
        .from(auditLog)
        .groupBy(auditLog.action)
        .orderBy(desc(sql`count(*)`)),
      db.select({
        entityType: auditLog.entityType,
        count: sql<number>`count(*)::int`,
      })
        .from(auditLog)
        .groupBy(auditLog.entityType)
        .orderBy(desc(sql`count(*)`))
        .limit(10),
      db.select({ count: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(gte(auditLog.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))),
    ]);

    res.json({
      actionStats,
      entityStats,
      last24Hours: recentCount[0]?.count || 0,
    });
  } catch (error) {
    next(error);
  }
});

// Task #2517 — Audit-log export migrated to the pg-boss queue
// (`bulk_export` / `audit_log`). The route enqueues the job and
// returns a job id; the client polls `/api/jobs/:id` and downloads
// the result via the signed URL in `output.url`.
router.get("/export", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("AUDIT_EXPORT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    if (!user.organizationId) {
      return res.status(403).json({ error: "Organization context required" });
    }
    const rawFormat = (req.query.format as string | undefined) || "csv";
    const format = rawFormat === "json" ? "json" : "csv";
    const params = {
      organizationId: user.organizationId,
      format,
      entityType: (req.query.entityType as string | undefined) || undefined,
      action: (req.query.action as string | undefined) || undefined,
      dateFrom: (req.query.dateFrom as string | undefined) || undefined,
      dateTo: (req.query.dateTo as string | undefined) || undefined,
    };
    const { enqueueJob } = await import("./jobQueue");
    const { AUDIT_LOG_EXPORT_TYPE } = await import("./jobQueue/exports/auditExport");
    const enq = await enqueueJob(
      "bulk_export",
      { exportType: AUDIT_LOG_EXPORT_TYPE, params },
      {
        organizationId: user.organizationId,
        userId: user.id,
        idempotencyKey: `audit_log_export:${user.organizationId}:${format}:${params.entityType ?? ""}:${params.action ?? ""}:${params.dateFrom ?? ""}:${params.dateTo ?? ""}:${Date.now()}`,
      },
    );
    res.status(202).json({
      jobId: enq.jobId,
      idempotencyKey: enq.idempotencyKey,
      deduplicated: enq.deduplicated,
      status: "QUEUED",
    });
  } catch (error) {
    next(error);
  }
});

export default router;
