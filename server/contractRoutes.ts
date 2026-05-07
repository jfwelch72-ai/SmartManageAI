import { logError } from "./utils/logger";
import { Router, type Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, desc, sql, type Column } from "drizzle-orm";
import { requireAuth, requireRole, requireRoleOrFeature, requireFeaturePermission, type AuthRequest } from "./auth";
import { getOrgIdForFilter, verifyOrgAccess } from "./orgFilter";
import { contracts, contractVersions, contractRedlines, contractApprovals, signatureRequests, type InsertContract, type Contract } from "@shared/schema";
import { projects, domainEvents, changeOrders, users } from "@shared/schema";
import { inArray } from "drizzle-orm";
import { insertNotification } from "./services/notificationService";
import { parsePagination } from "./utils/pagination";
import { z } from "zod";

const createContractSchema = z.object({
  projectId: z.string().min(1),
  contractNumber: z.string().min(1),
  contractType: z.enum(["PRIME", "SUBCONTRACT", "PURCHASE_ORDER", "SERVICE_AGREEMENT", "LEASE", "OTHER"]).optional().default("PRIME"),
  parties: z.string().nullable().optional(),
  contractValue: z.union([z.string(), z.number()]).nullable().optional(),
  effectiveDate: z.string().nullable().optional(),
  expirationDate: z.string().nullable().optional(),
  paymentTerms: z.union([z.string(), z.number()]).nullable().optional(),
  retentionPercent: z.union([z.string(), z.number()]).nullable().optional(),
  insuranceRequirements: z.string().nullable().optional(),
  scopeSummary: z.string().nullable().optional(),
  keyDates: z.string().nullable().optional(),
  bidId: z.string().nullable().optional(),
});

const updateContractSchema = z.object({
  contractNumber: z.string().min(1).optional(),
  contractType: z.enum(["PRIME", "SUBCONTRACT", "PURCHASE_ORDER", "SERVICE_AGREEMENT", "LEASE", "OTHER"]).optional(),
  parties: z.string().nullable().optional(),
  contractValue: z.union([z.string(), z.number()]).nullable().optional(),
  effectiveDate: z.string().nullable().optional(),
  expirationDate: z.string().nullable().optional(),
  paymentTerms: z.union([z.string(), z.number()]).nullable().optional(),
  retentionPercent: z.union([z.string(), z.number()]).nullable().optional(),
  insuranceRequirements: z.string().nullable().optional(),
  scopeSummary: z.string().nullable().optional(),
  keyDates: z.string().nullable().optional(),
  changeNote: z.string().optional(),
});

const transitionSchema = z.object({
  newStatus: z.string().min(1),
  signatureDate: z.string().optional(),
  signatoryNames: z.string().nullable().optional(),
  executedDocumentUrl: z.string().nullable().optional(),
});

const createRedlineSchema = z.object({
  description: z.string().min(1),
  section: z.string().nullable().optional(),
});

const updateRedlineSchema = z.object({
  status: z.enum(["OPEN", "RESOLVED", "REJECTED"]).optional(),
  resolution: z.string().nullable().optional(),
});

const requestApprovalSchema = z.object({
  reviewerIds: z.array(z.string().min(1)).min(1),
});

const approveRejectSchema = z.object({
  comments: z.string().nullable().optional(),
});

const addAttachmentSchema = z.object({
  fileName: z.string().min(1),
  objectKey: z.string().min(1),
  fileType: z.string().optional(),
  fileSize: z.number().optional(),
});

const linkChangeOrderSchema = z.object({
  changeOrderId: z.string().min(1),
});

const signatureRequestSchema = z.object({
  signers: z.array(z.object({
    name: z.string().min(1),
    email: z.string().email(),
    role: z.string().min(1),
  })).min(1),
  message: z.string().nullable().optional(),
  expiresInDays: z.number().positive().optional(),
});

const signActionSchema = z.object({
  signerId: z.string().min(1),
  action: z.enum(["sign", "decline"]),
  declineReason: z.string().optional(),
});

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

router.use("/api/contracts", requireAuth, requireFeaturePermission('canManageContracts'));

const CONTRACT_MANAGE_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"] as const;
const CONTRACT_VIEW_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"] as const;

function canManageContracts(role?: string) {
  return (CONTRACT_MANAGE_ROLES as readonly string[]).includes(role || "");
}

function canViewContracts(role?: string) {
  return (CONTRACT_VIEW_ROLES as readonly string[]).includes(role || "");
}

function resolveOrgFilter(req: AuthRequest, res: Response): { orgId: string | null; shouldFilter: boolean } | null {
  const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
  if (mustDenyAccess) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }
  if (shouldFilter && !orgId) {
    res.status(400).json({ error: "Organization required" });
    return null;
  }
  return { orgId, shouldFilter };
}

function orgCondition(column: Column, orgId: string | null, shouldFilter: boolean) {
  return shouldFilter && orgId ? eq(column, orgId) : undefined;
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

router.get("/api/contracts", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canViewContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const { status, projectId, contractType } = req.query;

    const conditions = orgCondition(contracts.organizationId, orgId, shouldFilter);
    let query = db.select().from(contracts).where(conditions).orderBy(desc(contracts.createdAt));

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

    if (req.query.page) {
      const { page, pageSize } = parsePagination(req.query as Record<string, unknown>);
      const offset = (page - 1) * pageSize;
      const total = filtered.length;
      const paginated = filtered.slice(offset, offset + pageSize);
      res.json({ data: paginated, total, page, limit: pageSize });
    } else {
      res.json(filtered);
    }
  } catch (err) {
    next(err);
  }
});

router.get("/api/contracts/by-project/:projectId", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canViewContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const result = await db.select().from(contracts)
      .where(and(eq(contracts.projectId, req.params.projectId), orgCondition(contracts.organizationId, orgId, shouldFilter)))
      .orderBy(desc(contracts.createdAt));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/api/contracts/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canViewContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));

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
    next(err);
  }
});

router.post("/api/contracts", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const parsed = createContractSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { projectId, contractNumber, contractType, parties, contractValue, effectiveDate, expirationDate, paymentTerms, retentionPercent, insuranceRequirements, scopeSummary, keyDates, bidId } = parsed.data;

    const [project] = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), orgCondition(projects.gcOrganizationId, orgId, shouldFilter)));
    if (!project) {
      res.status(400).json({ error: "Project not found in your organization" });
      return;
    }

    const contractOrgId = orgId || project.gcOrganizationId;
    if (!contractOrgId) {
      res.status(400).json({ error: "Cannot determine organization for this project" });
      return;
    }

    const [newContract] = await db.insert(contracts).values({
      organizationId: contractOrgId,
      projectId,
      bidId: bidId || null,
      contractNumber,
      contractType: ((contractType as string) || "PRIME") as "PRIME" | "SUBCONTRACT" | "JV" | "T_AND_M",
      status: "DRAFT" as const,
      parties: parties || null,
      contractValue: contractValue ? String(contractValue) : null,
      effectiveDate: effectiveDate ? new Date(effectiveDate) : null,
      expirationDate: expirationDate ? new Date(expirationDate) : null,
      paymentTerms: paymentTerms ? String(paymentTerms) : null,
      retentionPercent: retentionPercent ? String(retentionPercent) : null,
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
      orgId: contractOrgId,
      actorId: req.user!.id,
      payload: { contractId: newContract.id, projectId, contractNumber },
      status: "PENDING",
    });

    res.status(201).json(newContract);
  } catch (err) {
    next(err);
  }
});

router.patch("/api/contracts/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [existing] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));

    if (!existing) { res.status(404).json({ error: "Contract not found" }); return; }

    const parsed = updateContractSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { contractNumber, contractType, parties, contractValue, effectiveDate, expirationDate, paymentTerms, retentionPercent, insuranceRequirements, scopeSummary, keyDates } = parsed.data;

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
      changeNote: parsed.data.changeNote || "Contract updated",
    });

    res.json(updated);
  } catch (err) {
    next(err);
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

router.post("/api/contracts/:id/transition", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const parsed = transitionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { newStatus } = parsed.data;

    const [existing] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));

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
      updates.signatureDate = parsed.data.signatureDate ? new Date(parsed.data.signatureDate) : new Date();
      updates.signatoryNames = parsed.data.signatoryNames || null;
      updates.executedDocumentUrl = parsed.data.executedDocumentUrl || null;

      if (existing.contractValue) {
        await db.update(projects)
          .set({ contractAmount: existing.contractValue, updatedAt: new Date() })
          .where(and(eq(projects.id, existing.projectId), orgCondition(projects.gcOrganizationId, orgId, shouldFilter)));
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
      orgId: orgId || existing.organizationId,
      actorId: req.user!.id,
      payload: { contractId: updated.id, previousStatus: existing.status, newStatus },
      status: "PENDING",
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post("/api/contracts/:id/redlines", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [existing] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));
    if (!existing) { res.status(404).json({ error: "Contract not found" }); return; }

    const parsed = createRedlineSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { description, section } = parsed.data;

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
    next(err);
  }
});

router.patch("/api/contracts/:id/redlines/:redlineId", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const parsed = updateRedlineSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { status, resolution } = parsed.data;
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
    next(err);
  }
});

router.post("/api/contracts/:id/request-approval", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [existing] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));
    if (!existing) { res.status(404).json({ error: "Contract not found" }); return; }

    const APPROVAL_ELIGIBLE_STATUSES = ["IN_REVIEW", "REDLINED"];
    if (!APPROVAL_ELIGIBLE_STATUSES.includes(existing.status)) {
      res.status(400).json({ error: `Cannot request approval from status ${existing.status}. Contract must be IN_REVIEW or REDLINED.` });
      return;
    }

    const parsed = requestApprovalSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { reviewerIds } = parsed.data;

    const uniqueReviewerIds = [...new Set(reviewerIds)];

    const selfAssigned = uniqueReviewerIds.includes(req.user!.id);
    if (selfAssigned) {
      res.status(400).json({ error: "You cannot assign yourself as a reviewer." });
      return;
    }

    const ELIGIBLE_REVIEWER_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"];
    const reviewerUsers = await db.select({ id: users.id, organizationId: users.organizationId, role: users.role })
      .from(users)
      .where(and(inArray(users.id, uniqueReviewerIds), orgCondition(users.organizationId, orgId, shouldFilter)));

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
        organizationId: orgId,
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
    next(err);
  }
});

router.post("/api/contracts/:id/approve", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [existing] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));
    if (!existing) { res.status(404).json({ error: "Contract not found" }); return; }

    const [approval] = await db.select().from(contractApprovals)
      .where(and(eq(contractApprovals.contractId, req.params.id), eq(contractApprovals.reviewerId, req.user!.id), eq(contractApprovals.decision, "PENDING")));

    const parsed = approveRejectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
      return;
    }

    if (!approval) {
      res.status(403).json({ error: "No pending approval found for your user. You must be an assigned reviewer." });
      return;
    } else {
      await db.update(contractApprovals)
        .set({ decision: "APPROVED", comments: parsed.data.comments || null, decidedAt: new Date() })
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
        orgId: orgId || existing.organizationId,
        actorId: req.user!.id,
        payload: { contractId: existing.id },
        status: "PENDING",
      });
    }

    res.json({ message: "Contract approved" });
  } catch (err) {
    next(err);
  }
});

router.post("/api/contracts/:id/reject", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [existing] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));
    if (!existing) { res.status(404).json({ error: "Contract not found" }); return; }

    const [approval] = await db.select().from(contractApprovals)
      .where(and(eq(contractApprovals.contractId, req.params.id), eq(contractApprovals.reviewerId, req.user!.id), eq(contractApprovals.decision, "PENDING")));

    const parsed = approveRejectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
      return;
    }

    if (approval) {
      await db.update(contractApprovals)
        .set({ decision: "REJECTED", comments: parsed.data.comments || null, decidedAt: new Date() })
        .where(eq(contractApprovals.id, approval.id));
    } else {
      res.status(403).json({ error: "No pending approval found for your user. You must be an assigned reviewer." });
      return;
    }

    if (existing.status === "PENDING_APPROVAL") {
      await db.update(contracts)
        .set({ status: "REDLINED", updatedAt: new Date() })
        .where(eq(contracts.id, req.params.id));
      await recordVersionSnapshot(req.params.id, { ...existing, status: "REDLINED" }, req.user!.id, `Approval rejected: ${parsed.data.comments || "No comment"}`);
    }

    res.json({ message: "Contract rejected" });
  } catch (err) {
    next(err);
  }
});

router.get("/api/contracts/:id/versions", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canViewContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const versions = await db.select().from(contractVersions)
      .where(eq(contractVersions.contractId, req.params.id))
      .orderBy(desc(contractVersions.versionNumber));

    res.json(versions);
  } catch (err) {
    next(err);
  }
});

router.get("/api/contracts/:id/versions/compare", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canViewContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));
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
    next(err);
  }
});

router.post("/api/contracts/:id/attachments/upload-url", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const { ObjectStorageService } = await import("./objectStorage");
    const objectStorageService = new ObjectStorageService();
    const { uploadURL, objectKey } = await objectStorageService.getObjectEntityUploadURL(orgId || contract.organizationId);

    res.json({ uploadURL, objectKey });
  } catch (err) {
    next(err);
  }
});

router.post("/api/contracts/:id/attachments", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const parsed = addAttachmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { fileName, objectKey, fileType, fileSize } = parsed.data;

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
    next(err);
  }
});

router.get("/api/contracts/:id/attachments", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canViewContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const attachments = JSON.parse(contract.attachmentsJson || "[]");
    res.json(attachments);
  } catch (err) {
    next(err);
  }
});

router.delete("/api/contracts/:id/attachments/:attachmentId", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));
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
    next(err);
  }
});

router.delete("/api/contracts/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [existing] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));
    if (!existing) { res.status(404).json({ error: "Contract not found" }); return; }

    if (existing.status === "EXECUTED") {
      res.status(400).json({ error: "Cannot delete an executed contract" });
      return;
    }

    await db.delete(contracts).where(eq(contracts.id, req.params.id));
    res.json({ message: "Contract deleted" });
  } catch (err) {
    next(err);
  }
});

router.post("/api/contracts/:id/link-change-order", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canManageContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const parsed = linkChangeOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { changeOrderId } = parsed.data;

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
    next(err);
  }
});

router.get("/api/contracts/:id/change-orders", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canViewContracts(req.user?.role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const linkedCOs = await db.select().from(changeOrders)
      .where(eq(changeOrders.contractId, req.params.id));

    res.json(linkedCOs);
  } catch (err) {
    next(err);
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

router.post("/api/contracts/:id/signature-request", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canManageContracts(req.user?.role)) { res.status(403).json({ error: "Access denied" }); return; }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    if (contract.status !== "APPROVED") {
      res.status(400).json({ error: "Signature requests can only be created for APPROVED contracts" });
      return;
    }

    const parsed = signatureRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { signers, message, expiresInDays } = parsed.data;

    const signersWithStatus: Signer[] = signers.map((s: { name: string; email: string; role: string }) => ({
      id: crypto.randomUUID(),
      name: s.name,
      email: s.email,
      role: s.role,
      status: "PENDING" as const,
    }));

    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;

    const sigOrgId = orgId || contract.organizationId;

    const [sigReq] = await db.insert(signatureRequests).values({
      contractId: req.params.id,
      organizationId: sigOrgId,
      status: "SENT",
      signersJson: JSON.stringify(signersWithStatus),
      message: message || null,
      expiresAt,
      createdById: req.user!.id,
    }).returning();

    await db.insert(domainEvents).values({
      type: "contract.signature_requested",
      version: 1,
      orgId: sigOrgId,
      actorId: req.user!.id,
      payload: { contractId: req.params.id, signatureRequestId: sigReq.id, signerCount: signersWithStatus.length },
      status: "PENDING",
    });

    for (const signer of signersWithStatus) {
      const orgUsers = await db.select().from(users)
        .where(and(eq(users.organizationId, sigOrgId), eq(users.email, signer.email)));
      if (orgUsers.length > 0) {
        await insertNotification({
          userId: orgUsers[0].id,
          organizationId: sigOrgId,
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
    next(err);
  }
});

router.get("/api/contracts/:id/signature-requests", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canViewContracts(req.user?.role)) { res.status(403).json({ error: "Access denied" }); return; }
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.id), orgCondition(contracts.organizationId, orgId, shouldFilter)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const reqs = await db.select().from(signatureRequests)
      .where(and(eq(signatureRequests.contractId, req.params.id), orgCondition(signatureRequests.organizationId, orgId, shouldFilter)))
      .orderBy(desc(signatureRequests.createdAt));

    const enriched = reqs.map(r => ({
      ...r,
      signers: JSON.parse(r.signersJson || "[]") as Signer[],
    }));

    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

router.post("/api/contracts/:contractId/signature-requests/:reqId/sign", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const org = resolveOrgFilter(req, res);
    if (!org) return;
    const { orgId, shouldFilter } = org;

    const [sigReq] = await db.select().from(signatureRequests)
      .where(and(eq(signatureRequests.id, req.params.reqId), orgCondition(signatureRequests.organizationId, orgId, shouldFilter)));
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

    const parsed = signActionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { signerId, action, declineReason } = parsed.data;

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
    } else {
      signers[signerIndex].status = "DECLINED";
      signers[signerIndex].declinedAt = new Date().toISOString();
      signers[signerIndex].declineReason = declineReason || undefined;
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
          orgId: orgId || sigReq.organizationId,
          actorId: req.user!.id,
          payload: { contractId: sigReq.contractId, method: "e-signature", signers: signers.map(s => ({ name: s.name, role: s.role })) },
          status: "PENDING",
        });
      }
    }

    res.json({ signers, status: newStatus });
  } catch (err) {
    next(err);
  }
});

router.post("/api/contracts/:id/risk-analysis", requireAuth, requireRole(...CONTRACT_MANAGE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, isSuperAdmin: isSA, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || (!isSA && !orgId)) return res.status(403).json({ error: "Organization required" });

    const [contract] = await db.select().from(contracts)
      .where(isSA ? eq(contracts.id, req.params.id) : and(eq(contracts.id, req.params.id), eq(contracts.organizationId, orgId!)));
    if (!contract) return res.status(404).json({ error: "Contract not found" });

    const { contractRiskAnalyses } = await import("@shared/schema");
    const { governedAiCall } = await import("./services/aiGovernance");
    const { openai, AI_MODEL_GPT5 } = await import("./ai/openaiClient");

    const [project] = await db.select({ name: projects.name, code: projects.code })
      .from(projects).where(eq(projects.id, contract.projectId)).limit(1);

    const redlines = await db.select().from(contractRedlines)
      .where(eq(contractRedlines.contractId, contract.id));

    const effectiveOrgId = orgId || contract.organizationId;
    const clauses = await (async () => {
      const { contractClauses } = await import("@shared/schema");
      return db.select().from(contractClauses)
        .where(eq(contractClauses.organizationId, effectiveOrgId));
    })();

    const contractContext = [
      `Contract Number: ${contract.contractNumber}`,
      `Type: ${contract.contractType}`,
      `Status: ${contract.status}`,
      `Value: $${contract.contractValue || "Not specified"}`,
      `Parties: ${contract.parties || "Not specified"}`,
      `Effective Date: ${contract.effectiveDate || "Not specified"}`,
      `Expiration Date: ${contract.expirationDate || "Not specified"}`,
      `Payment Terms: ${contract.paymentTerms || "Not specified"}`,
      `Retention: ${contract.retentionPercent ? contract.retentionPercent + "%" : "Not specified"}`,
      `Insurance Requirements: ${contract.insuranceRequirements || "Not specified"}`,
      `Scope Summary: ${contract.scopeSummary || "Not specified"}`,
      `Key Dates: ${contract.keyDates || "Not specified"}`,
      `Project: ${project?.name || "Unknown"} (${project?.code || "N/A"})`,
      redlines.length > 0 ? `\nRedlines (${redlines.length}):\n${redlines.map(r => `- [${r.status}] ${r.description} (Section: ${r.section || "General"})`).join("\n")}` : "",
      clauses.length > 0 ? `\nOrg Clause Library (${clauses.length} clauses available):\n${clauses.map(c => `- ${c.title} [${c.category}]${c.isRequired ? " (Required)" : ""}`).join("\n")}` : "",
    ].filter(Boolean).join("\n");

    const systemPrompt = `You are an expert construction contract risk analyst. Analyze the provided contract details and produce a comprehensive risk assessment. You understand AIA, ConsensusDocs, and standard construction contract law.

Respond with a JSON object in this EXACT structure:
{
  "overallRiskScore": <number 0-100, where 0=no risk, 100=extreme risk>,
  "riskLevel": "<LOW|MODERATE|HIGH|CRITICAL>",
  "summary": "<2-3 sentence executive summary of the risk profile>",
  "clauseAnalysis": [
    {
      "category": "<PAYMENT|INSURANCE|INDEMNIFICATION|SCOPE|TERMINATION|DISPUTE_RESOLUTION|WARRANTY|SAFETY|COMPLIANCE|RETENTION|LIQUIDATED_DAMAGES|FORCE_MAJEURE|CHANGE_ORDER|CONFIDENTIALITY|OTHER>",
      "title": "<clause area name>",
      "riskScore": <0-100>,
      "riskLevel": "<LOW|MODERATE|HIGH|CRITICAL>",
      "finding": "<specific finding about this area>",
      "suggestion": "<actionable suggestion to mitigate risk>"
    }
  ],
  "missingProtections": [
    {
      "category": "<category>",
      "title": "<what is missing>",
      "severity": "<LOW|MODERATE|HIGH|CRITICAL>",
      "description": "<why this matters and what could happen without it>"
    }
  ],
  "recommendations": [
    {
      "priority": <1-5, 1=most urgent>,
      "title": "<short action title>",
      "description": "<detailed recommendation>",
      "impact": "<LOW|MODERATE|HIGH>"
    }
  ]
}

Analyze at minimum these areas: Payment terms, Insurance, Indemnification, Scope definition, Termination rights, Dispute resolution, Warranty, Retention, Change order provisions, and Force majeure. Flag any areas that are missing or underspecified. Compare against industry best practices for construction contracts.`;

    const { result, blocked, reason } = await governedAiCall<{
      overallRiskScore: number;
      riskLevel: string;
      summary: string;
      clauseAnalysis: Array<{ category: string; title: string; riskScore: number; riskLevel: string; finding: string; suggestion: string }>;
      missingProtections: Array<{ category: string; title: string; severity: string; description: string }>;
      recommendations: Array<{ priority: number; title: string; description: string; impact: string }>;
    }>({
      orgId: effectiveOrgId,
      userId: req.user!.id,
      actionType: "contract_risk_analysis",
      inputRefs: { contractId: contract.id, contractNumber: contract.contractNumber },
      fn: async () => {
        const completion = await openai.chat.completions.create({
          model: AI_MODEL_GPT5,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Analyze this construction contract for risks:\n\n${contractContext}` },
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 4096,
        });
        const content = completion.choices[0]?.message?.content;
        if (!content) throw new Error("No response from AI");
        return { result: JSON.parse(content), completion };
      },
    });

    if (blocked) {
      return res.status(429).json({ error: reason || "AI usage limit reached" });
    }

    const [analysis] = await db.insert(contractRiskAnalyses).values({
      contractId: contract.id,
      organizationId: effectiveOrgId,
      overallRiskScore: result.overallRiskScore,
      riskLevel: result.riskLevel,
      summaryText: result.summary,
      clauseAnalysisJson: JSON.stringify(result.clauseAnalysis || []),
      missingProtectionsJson: JSON.stringify(result.missingProtections || []),
      recommendationsJson: JSON.stringify(result.recommendations || []),
      analyzedById: req.user!.id,
    }).returning();

    res.json({
      id: analysis.id,
      contractId: analysis.contractId,
      overallRiskScore: analysis.overallRiskScore,
      riskLevel: analysis.riskLevel,
      summary: analysis.summaryText,
      clauseAnalysis: result.clauseAnalysis || [],
      missingProtections: result.missingProtections || [],
      recommendations: result.recommendations || [],
      analyzedAt: analysis.analyzedAt,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/api/contracts/:id/risk-analysis", requireAuth, requireRole(...CONTRACT_VIEW_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, isSuperAdmin: isSA, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || (!isSA && !orgId)) return res.status(403).json({ error: "Organization required" });

    const { contractRiskAnalyses } = await import("@shared/schema");

    const conditions = [eq(contractRiskAnalyses.contractId, req.params.id)];
    if (!isSA && orgId) {
      conditions.push(eq(contractRiskAnalyses.organizationId, orgId));
    }

    const analyses = await db.select().from(contractRiskAnalyses)
      .where(and(...conditions))
      .orderBy(desc(contractRiskAnalyses.analyzedAt));

    const formatted = analyses.map(a => ({
      id: a.id,
      contractId: a.contractId,
      overallRiskScore: a.overallRiskScore,
      riskLevel: a.riskLevel,
      summary: a.summaryText,
      clauseAnalysis: JSON.parse(a.clauseAnalysisJson || "[]"),
      missingProtections: JSON.parse(a.missingProtectionsJson || "[]"),
      recommendations: JSON.parse(a.recommendationsJson || "[]"),
      analyzedAt: a.analyzedAt,
    }));

    res.json(formatted);
  } catch (err) {
    next(err);
  }
});

export { CONTRACT_MANAGE_ROLES, CONTRACT_VIEW_ROLES };
export default router;
