import { Router, type Response } from "express";
import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, requireRole, requireRoleOrFeature, type AuthRequest } from "./auth";
import { getOrgIdForFilter, verifyOrgAccess } from "./orgFilter";
import { contracts, contractVersions, contractRedlines, contractApprovals, signatureRequests, type InsertContract, type Contract } from "@shared/schema";
import { projects, domainEvents, changeOrders, users } from "@shared/schema";
import { inArray } from "drizzle-orm";
import { insertNotification } from "./services/notificationService";

const router = Router();

interface ContractAttachment {
  id: string;
  fileName: string;
  objectKey: string;
  fileType: string;
  fileSize: number;
  uploadedById: string;
  uploadedAt: string;
  stage: string;
  version: number | null;
}

const CONTRACT_MANAGE_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"];
const CONTRACT_VIEW_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"];

function canManageContracts(role?: string) {
  return CONTRACT_MANAGE_ROLES.includes(role || "");
}

function canViewContracts(role?: string) {
  return CONTRACT_VIEW_ROLES.includes(role || "");
}

async function recordVersionSnapshot(contractId: string, contract: Partial<Contract> & { currentVersion?: number | null }, changedById: string, changeNote: string) {
  const newVersion = (contract.currentVersion || 0) + 1;
  await db.update(contracts)
    .set({ currentVersion: newVersion, updatedAt: new Date() })
    .where(eq(contracts.id, contractId));
  await db.insert(contractVersions).values({
    contractId,
    versionNumber: newVersion,
    snapshotJson: JSON.stringify({ ...contract, currentVersion: newVersion }),
    changedById,
    changeNote,
  });
  return newVersion;
}

router.get("/api/contracts", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canViewContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const { status, projectId, contractType } = req.query;

    let query = db.select().from(contracts).where(eq(contracts.organizationId, orgId)).orderBy(desc(contracts.createdAt));

    const allContracts = await query;

    let filtered = allContracts;
    if (status && typeof status === "string") {
      filtered = filtered.filter(c => c.status === status);
    }
    if (projectId && typeof projectId === "string") {
      filtered = filtered.filter(c => c.projectId === projectId);
    }
    if (contractType && typeof contractType === "string") {
      filtered = filtered.filter(c => c.contractType === contractType);
    }

    res.json(filtered);
  } catch (err) {
    console.error("[Contracts] List error:", err);
    res.status(500).json({ error: "Failed to list contracts" });
  }
});

router.get("/api/contracts/by-project/:projectId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canViewContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const result = await db.select().from(contracts)
      .where(and(eq(contracts.projectId, req.params.projectId), eq(contracts.organizationId, orgId)))
      .orderBy(desc(contracts.createdAt));

    res.json(result);
  } catch (err) {
    console.error("[Contracts] By project error:", err);
    res.status(500).json({ error: "Failed to list contracts" });
  }
});

router.get("/api/contracts/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canViewContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));

    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const versions = await db.select().from(contractVersions)
      .where(eq(contractVersions.contractId, contract.id))
      .orderBy(desc(contractVersions.versionNumber));

    const redlines = await db.select().from(contractRedlines)
      .where(eq(contractRedlines.contractId, contract.id))
      .orderBy(desc(contractRedlines.createdAt));

    const approvals = await db.select().from(contractApprovals)
      .where(eq(contractApprovals.contractId, contract.id))
      .orderBy(desc(contractApprovals.createdAt));

    res.json({ ...contract, versions, redlines, approvals });
  } catch (err) {
    console.error("[Contracts] Get error:", err);
    res.status(500).json({ error: "Failed to get contract" });
  }
});

router.post("/api/contracts", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const { projectId, contractNumber, contractType, parties, contractValue, effectiveDate, expirationDate, paymentTerms, retentionPercent, insuranceRequirements, scopeSummary, keyDates, bidId } = req.body;

    if (!projectId || !contractNumber) {
      res.status(400).json({ error: "projectId and contractNumber are required" });
      return;
    }

    const [project] = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)));
    if (!project) {
      res.status(400).json({ error: "Project not found in your organization" });
      return;
    }

    const [newContract] = await db.insert(contracts).values({
      organizationId: orgId,
      projectId,
      bidId: bidId || null,
      contractNumber,
      contractType: contractType || "PRIME",
      status: "DRAFT",
      parties: parties || null,
      contractValue: contractValue || null,
      effectiveDate: effectiveDate ? new Date(effectiveDate) : null,
      expirationDate: expirationDate ? new Date(expirationDate) : null,
      paymentTerms: paymentTerms || null,
      retentionPercent: retentionPercent || null,
      insuranceRequirements: insuranceRequirements || null,
      scopeSummary: scopeSummary || null,
      keyDates: keyDates || null,
      currentVersion: 1,
      createdById: req.user!.id,
    }).returning();

    await db.insert(contractVersions).values({
      contractId: newContract.id,
      versionNumber: 1,
      snapshotJson: JSON.stringify(newContract),
      changedById: req.user!.id,
      changeNote: "Initial draft created",
    });

    await db.insert(domainEvents).values({
      type: "contract.created",
      version: 1,
      orgId,
      actorId: req.user!.id,
      payload: { contractId: newContract.id, projectId, contractNumber },
      status: "PENDING",
    });

    res.status(201).json(newContract);
  } catch (err) {
    console.error("[Contracts] Create error:", err);
    res.status(500).json({ error: "Failed to create contract" });
  }
});

router.patch("/api/contracts/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [existing] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));

    if (!existing) { res.status(404).json({ error: "Contract not found" }); return; }

    const { contractNumber, contractType, parties, contractValue, effectiveDate, expirationDate, paymentTerms, retentionPercent, insuranceRequirements, scopeSummary, keyDates } = req.body;

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (contractNumber !== undefined) updates.contractNumber = contractNumber;
    if (contractType !== undefined) updates.contractType = contractType;
    if (parties !== undefined) updates.parties = parties;
    if (contractValue !== undefined) updates.contractValue = contractValue;
    if (effectiveDate !== undefined) updates.effectiveDate = effectiveDate ? new Date(effectiveDate) : null;
    if (expirationDate !== undefined) updates.expirationDate = expirationDate ? new Date(expirationDate) : null;
    if (paymentTerms !== undefined) updates.paymentTerms = paymentTerms;
    if (retentionPercent !== undefined) updates.retentionPercent = retentionPercent;
    if (insuranceRequirements !== undefined) updates.insuranceRequirements = insuranceRequirements;
    if (scopeSummary !== undefined) updates.scopeSummary = scopeSummary;
    if (keyDates !== undefined) updates.keyDates = keyDates;

    const newVersion = existing.currentVersion + 1;
    updates.currentVersion = newVersion;

    const [updated] = await db.update(contracts)
      .set(updates)
      .where(eq(contracts.id, req.params.id))
      .returning();

    await db.insert(contractVersions).values({
      contractId: updated.id,
      versionNumber: newVersion,
      snapshotJson: JSON.stringify(updated),
      changedById: req.user!.id,
      changeNote: req.body.changeNote || "Contract updated",
    });

    res.json(updated);
  } catch (err) {
    console.error("[Contracts] Update error:", err);
    res.status(500).json({ error: "Failed to update contract" });
  }
});

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["IN_REVIEW"],
  IN_REVIEW: ["REDLINED", "PENDING_APPROVAL", "DRAFT"],
  REDLINED: ["IN_REVIEW"],
  PENDING_APPROVAL: ["APPROVED", "REDLINED", "IN_REVIEW"],
  APPROVED: ["EXECUTED", "PENDING_APPROVAL"],
  EXECUTED: ["AMENDED"],
  AMENDED: ["IN_REVIEW"],
};

router.post("/api/contracts/:id/transition", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const { newStatus } = req.body;
    if (!newStatus) { res.status(400).json({ error: "newStatus is required" }); return; }

    const [existing] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));

    if (!existing) { res.status(404).json({ error: "Contract not found" }); return; }

    if (newStatus === "PENDING_APPROVAL") {
      res.status(400).json({ error: "Use the request-approval endpoint to transition to PENDING_APPROVAL with assigned reviewers." });
      return;
    }

    const allowed = VALID_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(newStatus)) {
      res.status(400).json({ error: `Cannot transition from ${existing.status} to ${newStatus}. Allowed: ${allowed.join(", ")}` });
      return;
    }

    const updates: Record<string, any> = { status: newStatus, updatedAt: new Date() };

    if (newStatus === "APPROVED" && existing.status === "PENDING_APPROVAL") {
      const pendingApprovals = await db.select().from(contractApprovals)
        .where(and(eq(contractApprovals.contractId, req.params.id), eq(contractApprovals.decision, "PENDING")));
      if (pendingApprovals.length > 0) {
        res.status(400).json({ error: `Cannot approve: ${pendingApprovals.length} approval(s) still pending. Use the approval workflow instead.` });
        return;
      }
    }

    if (newStatus === "EXECUTED") {
      updates.signatureDate = req.body.signatureDate ? new Date(req.body.signatureDate) : new Date();
      updates.signatoryNames = req.body.signatoryNames || null;
      updates.executedDocumentUrl = req.body.executedDocumentUrl || null;

      if (existing.contractValue) {
        await db.update(projects)
          .set({ contractAmount: existing.contractValue, updatedAt: new Date() })
          .where(and(eq(projects.id, existing.projectId), eq(projects.organizationId, orgId)));
      }
    }

    const newVersion = existing.currentVersion + 1;
    updates.currentVersion = newVersion;

    const [updated] = await db.update(contracts)
      .set(updates)
      .where(eq(contracts.id, req.params.id))
      .returning();

    await db.insert(contractVersions).values({
      contractId: updated.id,
      versionNumber: newVersion,
      snapshotJson: JSON.stringify(updated),
      changedById: req.user!.id,
      changeNote: `Status changed to ${newStatus}`,
    });

    let eventType = `contract.status_changed`;
    if (newStatus === "APPROVED") eventType = "contract.approved";
    if (newStatus === "EXECUTED") eventType = "contract.executed";
    if (newStatus === "AMENDED") eventType = "contract.amended";

    await db.insert(domainEvents).values({
      type: eventType,
      version: 1,
      orgId,
      actorId: req.user!.id,
      payload: { contractId: updated.id, previousStatus: existing.status, newStatus },
      status: "PENDING",
    });

    res.json(updated);
  } catch (err) {
    console.error("[Contracts] Transition error:", err);
    res.status(500).json({ error: "Failed to transition contract" });
  }
});

router.post("/api/contracts/:id/redlines", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [existing] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Contract not found" }); return; }

    const { description, section } = req.body;
    if (!description) { res.status(400).json({ error: "description is required" }); return; }

    const [redline] = await db.insert(contractRedlines).values({
      contractId: req.params.id,
      requestedById: req.user!.id,
      description,
      section: section || null,
      status: "OPEN",
    }).returning();

    await recordVersionSnapshot(req.params.id, existing, req.user!.id, `Redline added: ${section ? `[${section}] ` : ""}${description.slice(0, 80)}`);

    res.status(201).json(redline);
  } catch (err) {
    console.error("[Contracts] Redline create error:", err);
    res.status(500).json({ error: "Failed to create redline" });
  }
});

router.patch("/api/contracts/:id/redlines/:redlineId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const { status, resolution } = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (status) updates.status = status;
    if (resolution !== undefined) updates.resolution = resolution;
    if (status === "RESOLVED" || status === "REJECTED") {
      updates.resolvedById = req.user!.id;
      updates.resolvedAt = new Date();
    }

    const [updated] = await db.update(contractRedlines)
      .set(updates)
      .where(and(eq(contractRedlines.id, req.params.redlineId), eq(contractRedlines.contractId, req.params.id)))
      .returning();

    if (!updated) { res.status(404).json({ error: "Redline not found" }); return; }

    const changeNote = status === "RESOLVED" ? `Redline resolved: ${resolution || ""}`.trim() : status === "REJECTED" ? "Redline rejected" : "Redline updated";
    await recordVersionSnapshot(req.params.id, contract, req.user!.id, changeNote);

    res.json(updated);
  } catch (err) {
    console.error("[Contracts] Redline update error:", err);
    res.status(500).json({ error: "Failed to update redline" });
  }
});

router.post("/api/contracts/:id/request-approval", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [existing] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Contract not found" }); return; }

    const APPROVAL_ELIGIBLE_STATUSES = ["IN_REVIEW", "REDLINED"];
    if (!APPROVAL_ELIGIBLE_STATUSES.includes(existing.status)) {
      res.status(400).json({ error: `Cannot request approval from status ${existing.status}. Contract must be IN_REVIEW or REDLINED.` });
      return;
    }

    const { reviewerIds } = req.body;
    if (!reviewerIds || !Array.isArray(reviewerIds) || reviewerIds.length === 0) {
      res.status(400).json({ error: "reviewerIds array is required" });
      return;
    }

    const uniqueReviewerIds = [...new Set(reviewerIds as string[])];

    const selfAssigned = uniqueReviewerIds.includes(req.user!.id);
    if (selfAssigned) {
      res.status(400).json({ error: "You cannot assign yourself as a reviewer." });
      return;
    }

    const ELIGIBLE_REVIEWER_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"];
    const reviewerUsers = await db.select({ id: users.id, organizationId: users.organizationId, role: users.role })
      .from(users)
      .where(and(inArray(users.id, uniqueReviewerIds), eq(users.organizationId, orgId)));

    if (reviewerUsers.length !== uniqueReviewerIds.length) {
      res.status(400).json({ error: "One or more reviewers not found in your organization." });
      return;
    }

    const ineligible = reviewerUsers.filter(u => !ELIGIBLE_REVIEWER_ROLES.includes(u.role));
    if (ineligible.length > 0) {
      res.status(400).json({ error: "One or more reviewers do not have an eligible role for contract approval." });
      return;
    }

    await db.delete(contractApprovals)
      .where(and(eq(contractApprovals.contractId, req.params.id), eq(contractApprovals.decision, "PENDING")));

    const approvalRecords = [];
    for (const reviewerId of uniqueReviewerIds) {
      const [approval] = await db.insert(contractApprovals).values({
        contractId: req.params.id,
        reviewerId,
        decision: "PENDING",
      }).returning();
      approvalRecords.push(approval);

      await insertNotification({
        userId: reviewerId,
        type: "APPROVAL_REQUEST_NEW",
        title: "Contract Review Requested",
        message: `Contract ${existing.contractNumber} requires your review and approval.`,
        relatedEntityId: existing.id,
        relatedEntityType: "contract",
      });
    }

    await db.update(contracts)
      .set({ status: "PENDING_APPROVAL", updatedAt: new Date() })
      .where(eq(contracts.id, req.params.id));
    await recordVersionSnapshot(req.params.id, { ...existing, status: "PENDING_APPROVAL" }, req.user!.id, `Status changed to PENDING_APPROVAL, ${uniqueReviewerIds.length} reviewer(s) assigned`);

    res.status(201).json(approvalRecords);
  } catch (err) {
    console.error("[Contracts] Request approval error:", err);
    res.status(500).json({ error: "Failed to request approval" });
  }
});

router.post("/api/contracts/:id/approve", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [existing] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Contract not found" }); return; }

    const [approval] = await db.select().from(contractApprovals)
      .where(and(eq(contractApprovals.contractId, req.params.id), eq(contractApprovals.reviewerId, req.user!.id), eq(contractApprovals.decision, "PENDING")));

    if (!approval) {
      res.status(403).json({ error: "No pending approval found for your user. You must be an assigned reviewer." });
      return;
    } else {
      await db.update(contractApprovals)
        .set({ decision: "APPROVED", comments: req.body.comments || null, decidedAt: new Date() })
        .where(eq(contractApprovals.id, approval.id));
    }

    const pendingApprovals = await db.select().from(contractApprovals)
      .where(and(eq(contractApprovals.contractId, req.params.id), eq(contractApprovals.decision, "PENDING")));

    if (pendingApprovals.length === 0 && existing.status === "PENDING_APPROVAL") {
      await db.update(contracts)
        .set({ status: "APPROVED", updatedAt: new Date() })
        .where(eq(contracts.id, req.params.id));

      await recordVersionSnapshot(req.params.id, { ...existing, status: "APPROVED" }, req.user!.id, "All approvals received, contract approved");

      await db.insert(domainEvents).values({
        type: "contract.approved",
        version: 1,
        orgId,
        actorId: req.user!.id,
        payload: { contractId: existing.id },
        status: "PENDING",
      });
    }

    res.json({ message: "Contract approved" });
  } catch (err) {
    console.error("[Contracts] Approve error:", err);
    res.status(500).json({ error: "Failed to approve contract" });
  }
});

router.post("/api/contracts/:id/reject", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [existing] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Contract not found" }); return; }

    const [approval] = await db.select().from(contractApprovals)
      .where(and(eq(contractApprovals.contractId, req.params.id), eq(contractApprovals.reviewerId, req.user!.id), eq(contractApprovals.decision, "PENDING")));

    if (approval) {
      await db.update(contractApprovals)
        .set({ decision: "REJECTED", comments: req.body.comments || null, decidedAt: new Date() })
        .where(eq(contractApprovals.id, approval.id));
    } else {
      res.status(403).json({ error: "No pending approval found for your user. You must be an assigned reviewer." });
      return;
    }

    if (existing.status === "PENDING_APPROVAL") {
      await db.update(contracts)
        .set({ status: "REDLINED", updatedAt: new Date() })
        .where(eq(contracts.id, req.params.id));
      await recordVersionSnapshot(req.params.id, { ...existing, status: "REDLINED" }, req.user!.id, `Approval rejected: ${req.body.comments || "No comment"}`);
    }

    res.json({ message: "Contract rejected" });
  } catch (err) {
    console.error("[Contracts] Reject error:", err);
    res.status(500).json({ error: "Failed to reject contract" });
  }
});

router.get("/api/contracts/:id/versions", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canViewContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const versions = await db.select().from(contractVersions)
      .where(eq(contractVersions.contractId, req.params.id))
      .orderBy(desc(contractVersions.versionNumber));

    res.json(versions);
  } catch (err) {
    console.error("[Contracts] Versions error:", err);
    res.status(500).json({ error: "Failed to list versions" });
  }
});

router.get("/api/contracts/:id/versions/compare", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canViewContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const v1 = parseInt(req.query.v1 as string);
    const v2 = parseInt(req.query.v2 as string);
    if (!v1 || !v2) { res.status(400).json({ error: "v1 and v2 query params required" }); return; }

    const versions = await db.select().from(contractVersions)
      .where(and(
        eq(contractVersions.contractId, req.params.id),
        sql`${contractVersions.versionNumber} IN (${v1}, ${v2})`
      ));

    const ver1 = versions.find(v => v.versionNumber === v1);
    const ver2 = versions.find(v => v.versionNumber === v2);
    if (!ver1 || !ver2) { res.status(404).json({ error: "One or both versions not found" }); return; }

    const snap1 = JSON.parse(ver1.snapshotJson || "{}");
    const snap2 = JSON.parse(ver2.snapshotJson || "{}");
    const allKeys = new Set([...Object.keys(snap1), ...Object.keys(snap2)]);
    const changes: { field: string; from: string; to: string }[] = [];
    for (const key of allKeys) {
      if (key === "updatedAt" || key === "createdAt" || key === "currentVersion") continue;
      const val1 = snap1[key];
      const val2 = snap2[key];
      if (JSON.stringify(val1) !== JSON.stringify(val2)) {
        changes.push({ field: key, from: String(val1 ?? ""), to: String(val2 ?? "") });
      }
    }

    res.json({ v1: v1, v2: v2, changes, version1: ver1, version2: ver2 });
  } catch (err) {
    console.error("[Contracts] Version compare error:", err);
    res.status(500).json({ error: "Failed to compare versions" });
  }
});

router.post("/api/contracts/:id/attachments/upload-url", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const { ObjectStorageService } = await import("./objectStorage");
    const objectStorageService = new ObjectStorageService();
    const { uploadURL, objectKey } = await objectStorageService.getObjectEntityUploadURL(orgId);

    res.json({ uploadURL, objectKey });
  } catch (err) {
    console.error("[Contracts] Upload URL error:", err);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.post("/api/contracts/:id/attachments", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const { fileName, objectKey, fileType, fileSize } = req.body;
    if (!fileName || !objectKey) {
      res.status(400).json({ error: "fileName and objectKey are required" });
      return;
    }

    const existingAttachments: ContractAttachment[] = JSON.parse(contract.attachmentsJson || "[]");
    const newAttachment: ContractAttachment = {
      id: crypto.randomUUID(),
      fileName,
      objectKey,
      fileType: fileType || "application/octet-stream",
      fileSize: fileSize || 0,
      uploadedById: req.user!.id,
      uploadedAt: new Date().toISOString(),
      stage: contract.status,
      version: contract.currentVersion,
    };
    existingAttachments.push(newAttachment);

    const updatedAttachmentsJson = JSON.stringify(existingAttachments);
    await db.update(contracts)
      .set({ attachmentsJson: updatedAttachmentsJson, updatedAt: new Date() })
      .where(eq(contracts.id, req.params.id));

    await recordVersionSnapshot(req.params.id, { ...contract, attachmentsJson: updatedAttachmentsJson }, req.user!.id, `Document attached: ${fileName}`);

    res.status(201).json(newAttachment);
  } catch (err) {
    console.error("[Contracts] Attachment add error:", err);
    res.status(500).json({ error: "Failed to add attachment" });
  }
});

router.get("/api/contracts/:id/attachments", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canViewContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const attachments = JSON.parse(contract.attachmentsJson || "[]");
    res.json(attachments);
  } catch (err) {
    console.error("[Contracts] Attachments list error:", err);
    res.status(500).json({ error: "Failed to list attachments" });
  }
});

router.delete("/api/contracts/:id/attachments/:attachmentId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const existingAttachments: ContractAttachment[] = JSON.parse(contract.attachmentsJson || "[]");
    const filtered = existingAttachments.filter((a) => a.id !== req.params.attachmentId);
    if (filtered.length === existingAttachments.length) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }

    const updatedAttachmentsJson = JSON.stringify(filtered);
    await db.update(contracts)
      .set({ attachmentsJson: updatedAttachmentsJson, updatedAt: new Date() })
      .where(eq(contracts.id, req.params.id));

    const removed = existingAttachments.find((a) => a.id === req.params.attachmentId);
    await recordVersionSnapshot(req.params.id, { ...contract, attachmentsJson: updatedAttachmentsJson }, req.user!.id, `Document removed: ${removed?.fileName}`);

    res.json({ message: "Attachment removed" });
  } catch (err) {
    console.error("[Contracts] Attachment delete error:", err);
    res.status(500).json({ error: "Failed to remove attachment" });
  }
});

router.delete("/api/contracts/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [existing] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Contract not found" }); return; }

    if (existing.status === "EXECUTED") {
      res.status(400).json({ error: "Cannot delete an executed contract" });
      return;
    }

    await db.delete(contracts).where(eq(contracts.id, req.params.id));
    res.json({ message: "Contract deleted" });
  } catch (err) {
    console.error("[Contracts] Delete error:", err);
    res.status(500).json({ error: "Failed to delete contract" });
  }
});

router.post("/api/contracts/:id/link-change-order", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const { changeOrderId } = req.body;
    if (!changeOrderId) { res.status(400).json({ error: "changeOrderId is required" }); return; }

    const [existingCO] = await db.select().from(changeOrders)
      .where(and(eq(changeOrders.id, changeOrderId), eq(changeOrders.projectId, contract.projectId)));
    if (!existingCO) { res.status(404).json({ error: "Change order not found in this project" }); return; }

    const [co] = await db.update(changeOrders)
      .set({ contractId: req.params.id })
      .where(eq(changeOrders.id, changeOrderId))
      .returning();

    if (!co) { res.status(404).json({ error: "Change order not found" }); return; }
    res.json(co);
  } catch (err) {
    console.error("[Contracts] Link CO error:", err);
    res.status(500).json({ error: "Failed to link change order" });
  }
});

router.get("/api/contracts/:id/change-orders", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canViewContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const linkedCOs = await db.select().from(changeOrders)
      .where(eq(changeOrders.contractId, req.params.id));

    res.json(linkedCOs);
  } catch (err) {
    console.error("[Contracts] Get COs error:", err);
    res.status(500).json({ error: "Failed to get linked change orders" });
  }
});

interface Signer {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "PENDING" | "SIGNED" | "DECLINED";
  signedAt?: string;
  declinedAt?: string;
  declineReason?: string;
}

router.post("/api/contracts/:id/signature-request", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canManageContracts(req.user?.role)) { res.status(403).json({ error: "Access denied" }); return; }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    if (contract.status !== "APPROVED") {
      res.status(400).json({ error: "Signature requests can only be created for APPROVED contracts" });
      return;
    }

    const { signers, message, expiresInDays } = req.body;
    if (!signers || !Array.isArray(signers) || signers.length === 0) {
      res.status(400).json({ error: "At least one signer is required" });
      return;
    }

    for (const signer of signers) {
      if (!signer.name || !signer.email || !signer.role) {
        res.status(400).json({ error: "Each signer needs name, email, and role" });
        return;
      }
    }

    const signersWithStatus: Signer[] = signers.map((s: { name: string; email: string; role: string }) => ({
      id: crypto.randomUUID(),
      name: s.name,
      email: s.email,
      role: s.role,
      status: "PENDING" as const,
    }));

    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;

    const [sigReq] = await db.insert(signatureRequests).values({
      contractId: req.params.id,
      organizationId: orgId,
      status: "SENT",
      signersJson: JSON.stringify(signersWithStatus),
      message: message || null,
      expiresAt,
      createdById: req.user!.id,
    }).returning();

    await db.insert(domainEvents).values({
      type: "contract.signature_requested",
      version: 1,
      orgId,
      actorId: req.user!.id,
      payload: { contractId: req.params.id, signatureRequestId: sigReq.id, signerCount: signersWithStatus.length },
      status: "PENDING",
    });

    for (const signer of signersWithStatus) {
      const orgUsers = await db.select().from(users)
        .where(and(eq(users.organizationId, orgId), eq(users.email, signer.email)));
      if (orgUsers.length > 0) {
        await insertNotification({
          userId: orgUsers[0].id,
          organizationId: orgId,
          title: `Signature requested: ${contract.contractNumber}`,
          message: `You have been requested to sign contract ${contract.contractNumber} as ${signer.role}. ${message || ""}`,
          type: "action_required",
          relatedEntityType: "contract",
          relatedEntityId: req.params.id,
        });
      }
    }

    res.status(201).json(sigReq);
  } catch (err) {
    console.error("[Contracts] Signature request error:", err);
    res.status(500).json({ error: "Failed to create signature request" });
  }
});

router.get("/api/contracts/:id/signature-requests", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canViewContracts(req.user?.role)) { res.status(403).json({ error: "Access denied" }); return; }
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const reqs = await db.select().from(signatureRequests)
      .where(and(eq(signatureRequests.contractId, req.params.id), eq(signatureRequests.organizationId, orgId)))
      .orderBy(desc(signatureRequests.createdAt));

    const enriched = reqs.map(r => ({
      ...r,
      signers: JSON.parse(r.signersJson || "[]") as Signer[],
    }));

    res.json(enriched);
  } catch (err) {
    console.error("[Contracts] List signature requests error:", err);
    res.status(500).json({ error: "Failed to list signature requests" });
  }
});

router.post("/api/contracts/:contractId/signature-requests/:reqId/sign", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = getOrgIdForFilter(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [sigReq] = await db.select().from(signatureRequests)
      .where(and(eq(signatureRequests.id, req.params.reqId), eq(signatureRequests.organizationId, orgId)));
    if (!sigReq) { res.status(404).json({ error: "Signature request not found" }); return; }

    if (sigReq.contractId !== req.params.contractId) {
      res.status(400).json({ error: "Signature request does not belong to this contract" });
      return;
    }

    if (sigReq.status === "COMPLETED" || sigReq.status === "EXPIRED") {
      res.status(400).json({ error: `Signature request is already ${sigReq.status.toLowerCase()}` });
      return;
    }

    if (sigReq.expiresAt && new Date(sigReq.expiresAt) < new Date()) {
      await db.update(signatureRequests)
        .set({ status: "EXPIRED", updatedAt: new Date() })
        .where(eq(signatureRequests.id, req.params.reqId));
      res.status(400).json({ error: "Signature request has expired" });
      return;
    }

    const { signerId, action, declineReason } = req.body;
    if (!signerId || !action) {
      res.status(400).json({ error: "signerId and action (sign/decline) are required" });
      return;
    }

    const signers: Signer[] = JSON.parse(sigReq.signersJson || "[]");
    const signerIndex = signers.findIndex(s => s.id === signerId);
    if (signerIndex === -1) {
      res.status(404).json({ error: "Signer not found in this request" });
      return;
    }

    if (signers[signerIndex].status !== "PENDING") {
      res.status(400).json({ error: `This signer has already ${signers[signerIndex].status.toLowerCase()}` });
      return;
    }

    const userEmail = req.user?.email;
    if (userEmail && signers[signerIndex].email !== userEmail) {
      res.status(403).json({ error: "You can only sign for your own email address" });
      return;
    }

    if (action === "sign") {
      signers[signerIndex].status = "SIGNED";
      signers[signerIndex].signedAt = new Date().toISOString();
    } else if (action === "decline") {
      signers[signerIndex].status = "DECLINED";
      signers[signerIndex].declinedAt = new Date().toISOString();
      signers[signerIndex].declineReason = declineReason || undefined;
    } else {
      res.status(400).json({ error: "action must be 'sign' or 'decline'" });
      return;
    }

    const allSigned = signers.every(s => s.status === "SIGNED");
    const anyDeclined = signers.some(s => s.status === "DECLINED");
    let newStatus: "PARTIALLY_SIGNED" | "COMPLETED" | "DECLINED" = "PARTIALLY_SIGNED";
    if (allSigned) newStatus = "COMPLETED";
    else if (anyDeclined) newStatus = "DECLINED";

    const updateData: Record<string, unknown> = {
      signersJson: JSON.stringify(signers),
      status: newStatus,
      updatedAt: new Date(),
    };
    if (allSigned) updateData.completedAt = new Date();

    await db.update(signatureRequests)
      .set(updateData)
      .where(eq(signatureRequests.id, req.params.reqId));

    if (allSigned) {
      const [contract] = await db.select().from(contracts)
        .where(eq(contracts.id, sigReq.contractId));
      if (contract) {
        const signatoryNames = signers.map(s => `${s.name} (${s.role})`).join(", ");
        const [updatedContract] = await db.update(contracts)
          .set({
            status: "EXECUTED",
            signatureDate: new Date(),
            signatoryNames,
            updatedAt: new Date(),
          })
          .where(eq(contracts.id, sigReq.contractId))
          .returning();

        if (contract.contractValue && contract.projectId) {
          await db.update(projects)
            .set({ contractAmount: contract.contractValue, updatedAt: new Date() })
            .where(eq(projects.id, contract.projectId));
        }

        await recordVersionSnapshot(sigReq.contractId, updatedContract, req.user!.id, `Contract executed via e-signature - all ${signers.length} signer(s) completed`);

        await db.insert(domainEvents).values({
          type: "contract.executed",
          version: 1,
          orgId,
          actorId: req.user!.id,
          payload: { contractId: sigReq.contractId, method: "e-signature", signers: signers.map(s => ({ name: s.name, role: s.role })) },
          status: "PENDING",
        });
      }
    }

    res.json({ signers, status: newStatus });
  } catch (err) {
    console.error("[Contracts] Sign error:", err);
    res.status(500).json({ error: "Failed to process signature" });
  }
});

export { CONTRACT_MANAGE_ROLES, CONTRACT_VIEW_ROLES };
export default router;
