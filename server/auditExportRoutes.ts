import { Router, Response } from "express";
import { AuthRequest, requireAuth, requireRole } from "./auth";
import { requireFeature } from "./middleware/requireFeature";
import { parsePagination } from "./utils/routeHelpers";
import { db } from "./db";
import { auditLog, users } from "@shared/schema";
import { eq, and, gte, lte, desc, sql, type SQL } from "drizzle-orm";

const router = Router();

router.get("/search", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("AUDIT_EXPORT"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error searching audit logs:", error);
    res.status(500).json({ error: "Failed to search audit logs" });
  }
});

router.get("/stats", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("AUDIT_EXPORT"), async (req: AuthRequest, res: Response) => {
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
    console.error("Error fetching audit stats:", error);
    res.status(500).json({ error: "Failed to fetch audit statistics" });
  }
});

router.get("/export", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("AUDIT_EXPORT"), async (req: AuthRequest, res: Response) => {
  try {
    const { format = "csv", dateFrom, dateTo, entityType, action } = req.query as Record<string, string>;

    const conditions: SQL[] = [];
    if (entityType) conditions.push(eq(auditLog.entityType, entityType));
    if (action) conditions.push(eq(auditLog.action, action as any));
    if (dateFrom) conditions.push(gte(auditLog.createdAt, new Date(dateFrom)));
    if (dateTo) conditions.push(lte(auditLog.createdAt, new Date(dateTo)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const logs = await db.select({
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
    })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.userId, users.id))
      .where(whereClause)
      .orderBy(desc(auditLog.createdAt))
      .limit(10000);

    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="audit-log-${new Date().toISOString().split("T")[0]}.json"`);
      return res.json(logs);
    }

    const headers = ["ID", "User Email", "Entity Type", "Entity ID", "Action", "Old Value", "New Value", "IP Address", "User Agent", "Timestamp"];
    const csvRows = [headers.join(",")];

    for (const log of logs) {
      const row = [
        log.id,
        log.userEmail || "",
        log.entityType || "",
        log.entityId || "",
        log.action,
        `"${(log.oldValue || "").replace(/"/g, '""')}"`,
        `"${(log.newValue || "").replace(/"/g, '""')}"`,
        log.ipAddress || "",
        `"${(log.userAgent || "").replace(/"/g, '""')}"`,
        log.createdAt?.toISOString() || "",
      ];
      csvRows.push(row.join(","));
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="audit-log-${new Date().toISOString().split("T")[0]}.csv"`);
    res.send(csvRows.join("\n"));
  } catch (error) {
    console.error("Error exporting audit logs:", error);
    res.status(500).json({ error: "Failed to export audit logs" });
  }
});

export default router;
