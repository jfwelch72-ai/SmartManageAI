import { Router } from "express";
import { db } from "./db";
import {
  crmOrganisations, crmContacts,
  insertCrmContactSchema,
  auditLog,
} from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

router.get("/api/crm/organisations/:id/contacts", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER", "SALES", "MARKETING", "PROCUREMENT_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied - no organization" });
    }
    
    const orgConditions = [eq(crmOrganisations.id, req.params.id)];
    if (shouldFilter && orgId) {
      orgConditions.push(eq(crmOrganisations.organizationId, orgId));
    }
    
    const [parentOrg] = await db
      .select()
      .from(crmOrganisations)
      .where(and(...orgConditions))
      .limit(1);
    
    if (!parentOrg) {
      return res.status(404).json({ error: "Organisation not found" });
    }
    
    const contacts = await db
      .select()
      .from(crmContacts)
      .where(eq(crmContacts.organisationId, req.params.id))
      .orderBy(desc(crmContacts.isPrimary), crmContacts.lastName, crmContacts.firstName);
    
    res.json(contacts);
  } catch (error) {
    console.error("Get CRM contacts error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/crm/contacts", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "SALES", "PROCUREMENT_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied - no organization" });
    }
    
    const orgConditions = [eq(crmOrganisations.id, req.body.organisationId)];
    if (shouldFilter && orgId) {
      orgConditions.push(eq(crmOrganisations.organizationId, orgId));
    }
    
    const [parentOrg] = await db
      .select()
      .from(crmOrganisations)
      .where(and(...orgConditions))
      .limit(1);
    
    if (!parentOrg) {
      return res.status(404).json({ error: "Parent organisation not found" });
    }
    
    const validationResult = insertCrmContactSchema.safeParse({
      ...req.body,
      organizationId: orgId,
      createdById: req.user!.id,
    });
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }
    
    if (validationResult.data.isPrimary) {
      await db
        .update(crmContacts)
        .set({ isPrimary: false })
        .where(eq(crmContacts.organisationId, validationResult.data.organisationId));
    }
    
    const [newContact] = await db
      .insert(crmContacts)
      .values(validationResult.data)
      .returning();
    
    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "crm_contacts",
      entityId: newContact.id,
      newValue: JSON.stringify({ firstName: newContact.firstName, lastName: newContact.lastName }),
    });
    
    res.status(201).json(newContact);
  } catch (error) {
    console.error("Create CRM contact error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/api/crm/contacts/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied - no organization" });
    }
    
    const conditions = [eq(crmContacts.id, req.params.id)];
    if (shouldFilter && orgId) {
      conditions.push(eq(crmContacts.organizationId, orgId));
    }
    
    const [existing] = await db
      .select()
      .from(crmContacts)
      .where(and(...conditions))
      .limit(1);
    
    if (!existing) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    
    const validationResult = insertCrmContactSchema.partial().safeParse(req.body);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }
    
    const { organizationId: _, ...safeData } = validationResult.data;
    
    if (safeData.isPrimary) {
      const primaryConditions = [
        eq(crmContacts.organisationId, existing.organisationId),
        sql`${crmContacts.id} != ${req.params.id}`
      ];
      if (shouldFilter && orgId) {
        primaryConditions.push(eq(crmContacts.organizationId, orgId));
      }
      await db
        .update(crmContacts)
        .set({ isPrimary: false })
        .where(and(...primaryConditions));
    }
    
    const [updated] = await db
      .update(crmContacts)
      .set({
        ...safeData,
        updatedAt: new Date(),
      })
      .where(eq(crmContacts.id, req.params.id))
      .returning();
    
    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "crm_contacts",
      entityId: updated.id,
      oldValue: JSON.stringify({ firstName: existing.firstName, lastName: existing.lastName }),
      newValue: JSON.stringify({ firstName: updated.firstName, lastName: updated.lastName }),
    });
    
    res.json(updated);
  } catch (error) {
    console.error("Update CRM contact error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/crm/contacts/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied - no organization" });
    }
    
    const conditions = [eq(crmContacts.id, req.params.id)];
    if (shouldFilter && orgId) {
      conditions.push(eq(crmContacts.organizationId, orgId));
    }
    
    const [existing] = await db
      .select()
      .from(crmContacts)
      .where(and(...conditions))
      .limit(1);
    
    if (!existing) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    
    await db.delete(crmContacts).where(and(...conditions));
    
    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "DELETE",
      entityType: "crm_contacts",
      entityId: existing.id,
      oldValue: JSON.stringify({ firstName: existing.firstName, lastName: existing.lastName }),
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error("Delete CRM contact error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
