import { Router } from "express";
import { db } from "./db";
import { organizations, organizationSowItems, scopeItems, estimateLineItems, dailyScopeProgress } from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { eq, sql, and } from "drizzle-orm";
import { logAudit } from "./auditLogger";

const router = Router();

function requireSuperAdmin(req: AuthRequest, res: any, next: any) {
  if (!req.user || req.user.role !== "SUPER_ADMIN") {
    return res.status(403).json({ error: "Access denied. Platform admin access required." });
  }
  next();
}

router.get("/platform/audit-report", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const fs = await import("fs");
    const path = await import("path");
    
    const reportPath = path.join(process.cwd(), "audit/reports/audit-report.json");
    
    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({ error: "No audit report found. Run the audit first." });
    }
    
    const reportContent = fs.readFileSync(reportPath, "utf-8");
    const report = JSON.parse(reportContent);
    
    res.json(report);
  } catch (error: any) {
    console.error("Audit report fetch error:", error.message);
    res.status(500).json({ error: "Failed to fetch audit report" });
  }
});

let lastAuditRun = 0;
const AUDIT_COOLDOWN_MS = 60000;

router.post("/platform/run-audit", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const now = Date.now();
    if (now - lastAuditRun < AUDIT_COOLDOWN_MS) {
      const waitTime = Math.ceil((AUDIT_COOLDOWN_MS - (now - lastAuditRun)) / 1000);
      return res.status(429).json({ error: `Rate limited. Please wait ${waitTime} seconds before running another audit.` });
    }
    
    lastAuditRun = now;
    
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    
    await logAudit({
      action: "CREATE",
      entityType: "system_audit",
      entityId: "platform-audit",
      userId: req.user!.id,
      newValue: JSON.stringify({ actionType: "run_audit", triggeredAt: new Date().toISOString() }),
    }, req);
    
    res.json({ message: "Audit started. Refresh the page in a few seconds to see results." });
    
    execAsync("npm run audit", { timeout: 120000 }).catch((error) => {
      console.error("Audit execution error:", error.message);
    });
    
  } catch (error: any) {
    console.error("Audit run error:", error.message);
    res.status(500).json({ error: "Failed to run audit" });
  }
});

router.post("/platform/backfill-sow-links", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const results = {
      scopeItemsUpdated: 0,
      estimateLineItemsUpdated: 0,
      dailyProgressUpdated: 0,
      sovLineItemsUpdated: 0,
      errors: [] as string[],
    };

    const allOrgs = await db.select({ id: organizations.id }).from(organizations);

    for (const org of allOrgs) {
      const orgSowItems = await db
        .select()
        .from(organizationSowItems)
        .where(eq(organizationSowItems.organizationId, org.id));

      if (orgSowItems.length === 0) continue;

      const sowLookup = new Map<string, typeof orgSowItems[0]>();
      for (const sow of orgSowItems) {
        const normalizedName = sow.name.toLowerCase().trim();
        sowLookup.set(normalizedName, sow);
      }

      const unlinkedScopeItems = await db.execute(sql`
        SELECT si.* FROM scope_items si
        JOIN projects p ON si.project_id = p.id
        JOIN estimates e ON e.project_id = p.id
        JOIN bids b ON e.bid_id = b.id
        WHERE b.gc_organization_id = ${org.id}
        AND si.organization_sow_item_id IS NULL
      `);

      for (const item of unlinkedScopeItems.rows as any[]) {
        const normalizedDesc = (item.description || "").toLowerCase().trim();
        const matchedSow = sowLookup.get(normalizedDesc);
        
        if (matchedSow) {
          await db
            .update(scopeItems)
            .set({ organizationSowItemId: matchedSow.id, updatedAt: new Date() })
            .where(eq(scopeItems.id, item.id));
          results.scopeItemsUpdated++;

          const updatedProgress = await db
            .update(dailyScopeProgress)
            .set({ organizationSowItemId: matchedSow.id })
            .where(and(
              eq(dailyScopeProgress.scopeItemId, item.id),
              sql`${dailyScopeProgress.organizationSowItemId} IS NULL`
            ))
            .returning();
          results.dailyProgressUpdated += updatedProgress.length;
        }
      }

      const unlinkedLineItems = await db.execute(sql`
        SELECT eli.* FROM estimate_line_items eli
        JOIN estimates e ON eli.estimate_id = e.id
        JOIN bids b ON e.bid_id = b.id
        WHERE b.gc_organization_id = ${org.id}
        AND eli.organization_sow_item_id IS NULL
      `);

      for (const item of unlinkedLineItems.rows as any[]) {
        const normalizedDesc = (item.description || "").toLowerCase().trim();
        const matchedSow = sowLookup.get(normalizedDesc);
        
        if (matchedSow) {
          await db
            .update(estimateLineItems)
            .set({ organizationSowItemId: matchedSow.id, updatedAt: new Date() })
            .where(eq(estimateLineItems.id, item.id));
          results.estimateLineItemsUpdated++;
        }
      }

      const unlinkedSovLineItems = await db.execute(sql`
        SELECT sli.* FROM sov_line_items sli
        JOIN schedule_of_values sov ON sli.sov_id = sov.id
        WHERE sov.organization_id = ${org.id}
        AND sli.organization_sow_item_id IS NULL
      `);

      for (const item of unlinkedSovLineItems.rows as any[]) {
        const normalizedDesc = (item.description || "").toLowerCase().trim();
        const matchedSow = sowLookup.get(normalizedDesc);
        
        if (matchedSow) {
          await db.execute(sql`
            UPDATE sov_line_items 
            SET organization_sow_item_id = ${matchedSow.id}, updated_at = NOW()
            WHERE id = ${item.id}
          `);
          results.sovLineItemsUpdated++;
        }
      }
    }

    await logAudit({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "system",
      entityId: "sow_backfill",
      oldValue: null,
      newValue: JSON.stringify(results),
    }, req);

    console.log("SOW backfill completed:", results);
    res.json({
      message: "SOW link backfill completed",
      ...results,
    });
  } catch (error: any) {
    console.error("SOW backfill error:", error.message);
    res.status(500).json({ error: "Failed to backfill SOW links", details: error.message });
  }
});

router.get("/platform/sow-link-stats", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const stats = await db.execute(sql`
      SELECT 
        'scope_items_without_sow' as metric, COUNT(*) as count 
      FROM scope_items WHERE organization_sow_item_id IS NULL
      UNION ALL
      SELECT 'estimate_line_items_without_sow' as metric, COUNT(*) as count 
      FROM estimate_line_items WHERE organization_sow_item_id IS NULL
      UNION ALL
      SELECT 'daily_progress_without_sow' as metric, COUNT(*) as count 
      FROM daily_scope_progress WHERE organization_sow_item_id IS NULL
      UNION ALL
      SELECT 'sov_line_items_without_sow' as metric, COUNT(*) as count 
      FROM sov_line_items WHERE organization_sow_item_id IS NULL
      UNION ALL
      SELECT 'total_scope_items' as metric, COUNT(*) as count FROM scope_items
      UNION ALL
      SELECT 'total_estimate_line_items' as metric, COUNT(*) as count FROM estimate_line_items
      UNION ALL
      SELECT 'total_daily_progress' as metric, COUNT(*) as count FROM daily_scope_progress
      UNION ALL
      SELECT 'total_sov_line_items' as metric, COUNT(*) as count FROM sov_line_items
    `);

    res.json(stats.rows);
  } catch (error: any) {
    console.error("SOW stats error:", error.message);
    res.status(500).json({ error: "Failed to get SOW link stats" });
  }
});

export default router;
