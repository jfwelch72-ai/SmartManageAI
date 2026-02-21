import { Router } from "express";
import { requireAuth } from "./auth";
import { db } from "./db";
import {
  organizations,
  organizationSubscriptions,
  organizationAddOns,
  integrationConnections,
  aiActionAudit,
  approvalRequests,
  documentRevisions,
  projectHealthSnapshots,
  projects,
  users,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { logInfo } from "./utils/logger";

const router = Router();

router.post("/seed-enterprise", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    if (!orgId) {
      return res.status(400).json({ error: "Organization required" });
    }

    const results: Record<string, any> = {};

    const [existingSub] = await db.select().from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, orgId)).limit(1);

    if (existingSub) {
      if (existingSub.planTier !== "enterprise") {
        await db.update(organizationSubscriptions)
          .set({ planTier: "enterprise", status: "active", updatedAt: new Date() })
          .where(eq(organizationSubscriptions.id, existingSub.id));
        results.subscription = "Upgraded to enterprise (Scale) plan";
      } else {
        results.subscription = "Already on enterprise (Scale) plan";
      }
    } else {
      await db.insert(organizationSubscriptions).values({
        organizationId: orgId,
        planTier: "enterprise",
        status: "active",
        billingProvider: "manual",
      });
      results.subscription = "Created enterprise (Scale) subscription";
    }

    const addonKeys = ["integration_qbo", "integration_esign", "ai_governance_pack"] as const;
    const addonResults: string[] = [];

    for (const addonKey of addonKeys) {
      const [existing] = await db.select().from(organizationAddOns)
        .where(and(
          eq(organizationAddOns.organizationId, orgId),
          eq(organizationAddOns.addonKey, addonKey)
        )).limit(1);

      if (existing) {
        if (existing.status !== "active") {
          await db.update(organizationAddOns)
            .set({ status: "active", updatedAt: new Date() })
            .where(eq(organizationAddOns.id, existing.id));
          addonResults.push(`${addonKey}: activated`);
        } else {
          addonResults.push(`${addonKey}: already active`);
        }
      } else {
        await db.insert(organizationAddOns).values({
          organizationId: orgId,
          addonKey: addonKey as any,
          status: "active",
        });
        addonResults.push(`${addonKey}: created & activated`);
      }
    }
    results.addons = addonResults;

    const providerConfigs = [
      { provider: "qbo", displayName: "QuickBooks Online (Dev)" },
      { provider: "google", displayName: "Google Workspace (Dev)" },
      { provider: "microsoft", displayName: "Microsoft 365 (Dev)" },
      { provider: "docusign", displayName: "DocuSign (Dev)" },
    ];

    const connectionResults: string[] = [];
    for (const cfg of providerConfigs) {
      const [existing] = await db.select().from(integrationConnections)
        .where(and(
          eq(integrationConnections.organizationId, orgId),
          eq(integrationConnections.provider, cfg.provider as any)
        )).limit(1);

      if (existing) {
        if (existing.status !== "active") {
          await db.update(integrationConnections)
            .set({
              status: "active",
              displayName: cfg.displayName,
              metadata: { devMode: true, simulatedAt: new Date().toISOString() },
              lastSyncAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(integrationConnections.id, existing.id));
          connectionResults.push(`${cfg.provider}: activated (dev mode)`);
        } else {
          connectionResults.push(`${cfg.provider}: already active`);
        }
      } else {
        await db.insert(integrationConnections).values({
          organizationId: orgId,
          provider: cfg.provider as any,
          displayName: cfg.displayName,
          status: "active",
          createdByUserId: user.id,
          metadata: { devMode: true, simulatedAt: new Date().toISOString() },
          lastSyncAt: new Date(),
        });
        connectionResults.push(`${cfg.provider}: created (dev mode)`);
      }
    }
    results.connections = connectionResults;

    const aiActionTypes = [
      { actionType: "estimate_generation", model: "gpt-4o", tokensIn: 1250, tokensOut: 3400, cost: "0.0245" },
      { actionType: "bid_analysis", model: "gpt-4o", tokensIn: 2100, tokensOut: 4800, cost: "0.0410" },
      { actionType: "schedule_optimization", model: "gpt-4o-mini", tokensIn: 800, tokensOut: 1200, cost: "0.0085" },
      { actionType: "change_order_draft", model: "gpt-4o", tokensIn: 1500, tokensOut: 2200, cost: "0.0195" },
      { actionType: "safety_report_analysis", model: "gpt-4o", tokensIn: 3000, tokensOut: 5000, cost: "0.0520" },
      { actionType: "email_classification", model: "gpt-4o-mini", tokensIn: 500, tokensOut: 200, cost: "0.0035" },
      { actionType: "document_extraction", model: "gpt-4o", tokensIn: 4000, tokensOut: 6000, cost: "0.0680" },
      { actionType: "project_summary", model: "gpt-4o-mini", tokensIn: 600, tokensOut: 1800, cost: "0.0065" },
    ];

    let aiCount = 0;
    for (const action of aiActionTypes) {
      await db.insert(aiActionAudit).values({
        organizationId: orgId,
        actorUserId: user.id,
        actionType: action.actionType,
        model: action.model,
        tokensIn: action.tokensIn,
        tokensOut: action.tokensOut,
        costEstimate: action.cost,
        inputRefs: { source: "dev_seed", description: `Sample ${action.actionType} action` },
        outputRefs: { summary: `Generated ${action.actionType} result successfully` },
        rationale: null,
        approvalRequired: action.actionType === "change_order_draft",
        approvalStatus: action.actionType === "change_order_draft" ? "pending" : null,
        durationMs: Math.floor(Math.random() * 5000) + 1000,
      });
      aiCount++;
    }
    results.aiAuditEntries = `Created ${aiCount} sample entries`;

    const entityTypes = ["CHANGE_ORDER", "SOV_PAY_APP", "TIME_APPROVAL", "VENDOR_BILL", "ESIGN_SEND", "QBO_EXPORT"];
    const statuses = ["pending", "pending", "pending", "approved", "rejected", "approved"];
    let approvalCount = 0;

    for (let i = 0; i < entityTypes.length; i++) {
      await db.insert(approvalRequests).values({
        organizationId: orgId,
        entityType: entityTypes[i] as any,
        entityId: `DEV-${String(i + 1).padStart(4, "0")}`,
        requestedByUserId: user.id,
        status: statuses[i] as any,
        notes: `Sample ${entityTypes[i].toLowerCase().replace(/_/g, " ")} approval request`,
        approverUserId: statuses[i] !== "pending" ? user.id : null,
        approverRole: statuses[i] !== "pending" ? user.role : null,
        decidedAt: statuses[i] !== "pending" ? new Date() : null,
      });
      approvalCount++;
    }
    results.approvalRequests = `Created ${approvalCount} sample requests (3 pending, 2 approved, 1 rejected)`;

    const docTypes = [
      { entityType: "contract", entityId: "CONTRACT-001", fileName: "General_Contract_v1.pdf" },
      { entityType: "contract", entityId: "CONTRACT-001", fileName: "General_Contract_v2.pdf" },
      { entityType: "change_order", entityId: "CO-001", fileName: "Change_Order_001.pdf" },
      { entityType: "submittal", entityId: "SUB-001", fileName: "Submittal_Materials.pdf" },
    ];

    let docCount = 0;
    let revisionNumber = 1;
    for (const doc of docTypes) {
      const isSecondRevision = doc.entityType === "contract" && revisionNumber === 2;
      await db.insert(documentRevisions).values({
        organizationId: orgId,
        entityType: doc.entityType,
        entityId: doc.entityId,
        revisionNumber: doc.entityType === "contract" ? revisionNumber++ : 1,
        status: isSecondRevision ? "active" : (doc.entityType === "contract" && revisionNumber > 2 ? "superseded" : "active"),
        fileName: doc.fileName,
        fileUrl: `/dev/files/${doc.fileName}`,
        fileSize: Math.floor(Math.random() * 500000) + 50000,
        mimeType: "application/pdf",
        source: "upload",
        uploadedByUserId: user.id,
        notes: `Dev seed: ${doc.fileName}`,
      });
      docCount++;
    }
    results.documentRevisions = `Created ${docCount} sample revisions`;

    const orgProjects = await db.select({ id: projects.id, projectCode: projects.projectCode })
      .from(projects)
      .where(eq(projects.organizationId, orgId))
      .limit(5);

    let healthCount = 0;
    for (const project of orgProjects) {
      const score = Math.floor(Math.random() * 40) + 55;
      await db.insert(projectHealthSnapshots).values({
        organizationId: orgId,
        projectId: project.id,
        overallScore: score,
        scheduleScore: Math.floor(Math.random() * 30) + 60,
        budgetScore: Math.floor(Math.random() * 30) + 65,
        rfiSubmittalScore: Math.floor(Math.random() * 40) + 50,
        changeOrderScore: Math.floor(Math.random() * 30) + 70,
        safetyScore: Math.floor(Math.random() * 20) + 75,
        details: {
          scheduleWeight: 0.25,
          budgetWeight: 0.25,
          rfiSubmittalWeight: 0.20,
          changeOrderWeight: 0.15,
          safetyWeight: 0.15,
          source: "dev_seed",
        },
      });
      healthCount++;
    }
    results.projectHealthSnapshots = `Created ${healthCount} snapshots for ${orgProjects.length} projects`;

    logInfo("Enterprise dev seed completed", { orgId, results });

    res.json({
      success: true,
      message: "Enterprise features seeded successfully for development testing",
      results,
    });
  } catch (err) {
    res.status(500).json({ error: "Seed failed", details: String(err) });
  }
});

router.post("/clear-enterprise", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    await db.delete(aiActionAudit).where(eq(aiActionAudit.organizationId, orgId));
    await db.delete(approvalRequests).where(eq(approvalRequests.organizationId, orgId));
    await db.delete(documentRevisions).where(eq(documentRevisions.organizationId, orgId));
    await db.delete(projectHealthSnapshots).where(eq(projectHealthSnapshots.organizationId, orgId));
    await db.delete(integrationConnections).where(eq(integrationConnections.organizationId, orgId));

    res.json({ success: true, message: "Enterprise seed data cleared" });
  } catch (err) {
    res.status(500).json({ error: "Clear failed", details: String(err) });
  }
});

export default router;
