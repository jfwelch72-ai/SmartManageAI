import { logError } from "./utils/logger";
import { Router, type Response } from "express";
import { db } from "./db";
import { eq, and, desc, asc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { contractClauses, contractTemplates, contracts, contractVersions, type ContractClause } from "@shared/schema";
import { inArray } from "drizzle-orm";

const router = Router();

const MANAGE_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"];

function canManage(role?: string) {
  return MANAGE_ROLES.includes(role || "");
}

const VIEW_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"];

function canView(role?: string) {
  return VIEW_ROLES.includes(role || "");
}

function extractOrgId(req: AuthRequest): string | null {
  const filter = getOrgIdForFilter(req);
  if (filter.mustDenyAccess) return null;
  return filter.orgId || req.user?.organizationId || null;
}

router.get("/api/clause-library/clauses", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canView(req.user?.role)) { res.status(403).json({ error: "Access denied" }); return; }
    const orgId = extractOrgId(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const clauses = await db.select().from(contractClauses)
      .where(eq(contractClauses.organizationId, orgId))
      .orderBy(asc(contractClauses.category), asc(contractClauses.sortOrder));

    res.json(clauses);
  } catch (err) {
    logError("[ClauseLibrary] List error:", {}, err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ error: "Failed to list clauses" });
  }
});

router.post("/api/clause-library/clauses", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req.user?.role)) { res.status(403).json({ error: "Access denied" }); return; }
    const orgId = extractOrgId(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const { title, category, content, isRequired, isDefault, sortOrder } = req.body;
    if (!title || !category || !content) {
      res.status(400).json({ error: "title, category, and content are required" });
      return;
    }

    const [clause] = await db.insert(contractClauses).values({
      organizationId: orgId,
      title,
      category,
      content,
      isRequired: isRequired || false,
      isDefault: isDefault || false,
      sortOrder: sortOrder || 0,
      createdById: req.user!.id,
    }).returning();

    res.status(201).json(clause);
  } catch (err) {
    logError("[ClauseLibrary] Create error:", {}, err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ error: "Failed to create clause" });
  }
});

router.patch("/api/clause-library/clauses/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req.user?.role)) { res.status(403).json({ error: "Access denied" }); return; }
    const orgId = extractOrgId(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [existing] = await db.select().from(contractClauses)
      .where(and(eq(contractClauses.id, req.params.id), eq(contractClauses.organizationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Clause not found" }); return; }

    const { title, category, content, isRequired, isDefault, sortOrder } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title;
    if (category !== undefined) updates.category = category;
    if (content !== undefined) updates.content = content;
    if (isRequired !== undefined) updates.isRequired = isRequired;
    if (isDefault !== undefined) updates.isDefault = isDefault;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;

    const [updated] = await db.update(contractClauses)
      .set(updates)
      .where(eq(contractClauses.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (err) {
    logError("[ClauseLibrary] Update error:", {}, err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ error: "Failed to update clause" });
  }
});

router.delete("/api/clause-library/clauses/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req.user?.role)) { res.status(403).json({ error: "Access denied" }); return; }
    const orgId = extractOrgId(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [existing] = await db.select().from(contractClauses)
      .where(and(eq(contractClauses.id, req.params.id), eq(contractClauses.organizationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Clause not found" }); return; }

    await db.delete(contractClauses).where(eq(contractClauses.id, req.params.id));
    res.json({ message: "Clause deleted" });
  } catch (err) {
    logError("[ClauseLibrary] Delete error:", {}, err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ error: "Failed to delete clause" });
  }
});

router.get("/api/clause-library/templates", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canView(req.user?.role)) { res.status(403).json({ error: "Access denied" }); return; }
    const orgId = extractOrgId(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const templates = await db.select().from(contractTemplates)
      .where(eq(contractTemplates.organizationId, orgId))
      .orderBy(desc(contractTemplates.createdAt));

    res.json(templates);
  } catch (err) {
    logError("[ClauseLibrary] List templates error:", {}, err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ error: "Failed to list templates" });
  }
});

router.get("/api/clause-library/templates/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canView(req.user?.role)) { res.status(403).json({ error: "Access denied" }); return; }
    const orgId = extractOrgId(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [template] = await db.select().from(contractTemplates)
      .where(and(eq(contractTemplates.id, req.params.id), eq(contractTemplates.organizationId, orgId)));
    if (!template) { res.status(404).json({ error: "Template not found" }); return; }

    const clauseIds: string[] = JSON.parse(template.clauseIdsJson || "[]");
    let clauses: ContractClause[] = [];
    if (clauseIds.length > 0) {
      clauses = await db.select().from(contractClauses)
        .where(and(inArray(contractClauses.id, clauseIds), eq(contractClauses.organizationId, orgId)))
        .orderBy(asc(contractClauses.sortOrder));
    }

    res.json({ ...template, clauses });
  } catch (err) {
    logError("[ClauseLibrary] Get template error:", {}, err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ error: "Failed to get template" });
  }
});

router.post("/api/clause-library/templates", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req.user?.role)) { res.status(403).json({ error: "Access denied" }); return; }
    const orgId = extractOrgId(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const { name, description, contractType, clauseIds, defaultPaymentTerms, defaultRetentionPercent, defaultInsuranceRequirements } = req.body;
    if (!name) { res.status(400).json({ error: "Template name is required" }); return; }

    const [template] = await db.insert(contractTemplates).values({
      organizationId: orgId,
      name,
      description: description || null,
      contractType: contractType || "PRIME",
      clauseIdsJson: JSON.stringify(clauseIds || []),
      defaultPaymentTerms: defaultPaymentTerms || null,
      defaultRetentionPercent: defaultRetentionPercent || null,
      defaultInsuranceRequirements: defaultInsuranceRequirements || null,
      createdById: req.user!.id,
    }).returning();

    res.status(201).json(template);
  } catch (err) {
    logError("[ClauseLibrary] Create template error:", {}, err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ error: "Failed to create template" });
  }
});

router.patch("/api/clause-library/templates/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req.user?.role)) { res.status(403).json({ error: "Access denied" }); return; }
    const orgId = extractOrgId(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [existing] = await db.select().from(contractTemplates)
      .where(and(eq(contractTemplates.id, req.params.id), eq(contractTemplates.organizationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Template not found" }); return; }

    const { name, description, contractType, clauseIds, defaultPaymentTerms, defaultRetentionPercent, defaultInsuranceRequirements, isActive } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (contractType !== undefined) updates.contractType = contractType;
    if (clauseIds !== undefined) updates.clauseIdsJson = JSON.stringify(clauseIds);
    if (defaultPaymentTerms !== undefined) updates.defaultPaymentTerms = defaultPaymentTerms;
    if (defaultRetentionPercent !== undefined) updates.defaultRetentionPercent = defaultRetentionPercent;
    if (defaultInsuranceRequirements !== undefined) updates.defaultInsuranceRequirements = defaultInsuranceRequirements;
    if (isActive !== undefined) updates.isActive = isActive;

    const [updated] = await db.update(contractTemplates)
      .set(updates)
      .where(eq(contractTemplates.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (err) {
    logError("[ClauseLibrary] Update template error:", {}, err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ error: "Failed to update template" });
  }
});

router.delete("/api/clause-library/templates/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req.user?.role)) { res.status(403).json({ error: "Access denied" }); return; }
    const orgId = extractOrgId(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [existing] = await db.select().from(contractTemplates)
      .where(and(eq(contractTemplates.id, req.params.id), eq(contractTemplates.organizationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Template not found" }); return; }

    await db.delete(contractTemplates).where(eq(contractTemplates.id, req.params.id));
    res.json({ message: "Template deleted" });
  } catch (err) {
    logError("[ClauseLibrary] Delete template error:", {}, err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ error: "Failed to delete template" });
  }
});

router.post("/api/clause-library/templates/:id/apply/:contractId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req.user?.role)) { res.status(403).json({ error: "Access denied" }); return; }
    const orgId = extractOrgId(req);
    if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

    const [template] = await db.select().from(contractTemplates)
      .where(and(eq(contractTemplates.id, req.params.id), eq(contractTemplates.organizationId, orgId)));
    if (!template) { res.status(404).json({ error: "Template not found" }); return; }

    const [contract] = await db.select().from(contracts)
      .where(and(eq(contracts.id, req.params.contractId), eq(contracts.organizationId, orgId)));
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    if (contract.status !== "DRAFT") {
      res.status(400).json({ error: "Templates can only be applied to DRAFT contracts" });
      return;
    }

    const clauseIds: string[] = JSON.parse(template.clauseIdsJson || "[]");
    let scopeContent = contract.scopeSummary || "";
    if (clauseIds.length > 0) {
      const clauses = await db.select().from(contractClauses)
        .where(and(inArray(contractClauses.id, clauseIds), eq(contractClauses.organizationId, orgId)))
        .orderBy(asc(contractClauses.sortOrder));

      const clauseText = clauses.map(c => `## ${c.title} (${c.category})\n${c.content}`).join("\n\n");
      scopeContent = scopeContent ? `${scopeContent}\n\n---\n\n${clauseText}` : clauseText;
    }

    const updateFields: Record<string, unknown> = {
      contractType: template.contractType,
      scopeSummary: scopeContent,
      updatedAt: new Date(),
    };
    if (template.defaultPaymentTerms) updateFields.paymentTerms = template.defaultPaymentTerms;
    if (template.defaultRetentionPercent) updateFields.retentionPercent = template.defaultRetentionPercent;
    if (template.defaultInsuranceRequirements) updateFields.insuranceRequirements = template.defaultInsuranceRequirements;

    const [updated] = await db.update(contracts)
      .set(updateFields)
      .where(eq(contracts.id, req.params.contractId))
      .returning();

    const newVersion = (updated.currentVersion || 0) + 1;
    await db.update(contracts)
      .set({ currentVersion: newVersion, updatedAt: new Date() })
      .where(eq(contracts.id, req.params.contractId));
    await db.insert(contractVersions).values({
      contractId: req.params.contractId,
      versionNumber: newVersion,
      snapshotJson: JSON.stringify({ ...updated, currentVersion: newVersion }),
      changedById: req.user!.id,
      changeNote: `Template "${template.name}" applied`,
    });

    res.json({ ...updated, currentVersion: newVersion });
  } catch (err) {
    logError("[ClauseLibrary] Apply template error:", {}, err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ error: "Failed to apply template" });
  }
});

export default router;
