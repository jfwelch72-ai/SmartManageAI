import { Router } from "express";
import { db } from "./db";
import {
  crmOrganisations, crmContacts,
  insertCrmContactSchema,
  auditLog,
} from "@shared/schema";
import { eq, and, sql, desc, ilike, or, type SQL, asc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

const CONTACT_READ_ROLES = [
  "ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT",
  "OFFICE_MANAGER", "SALES", "MARKETING", "PROCUREMENT_MANAGER",
] as const;

router.get("/api/crm/contacts", requireAuth, requireRole(...CONTACT_READ_ROLES), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied - no organization" });

    const { organisationId, search } = req.query as Record<string, string>;

    const conditions: SQL[] = [];
    if (shouldFilter && orgId) conditions.push(eq(crmContacts.organizationId, orgId));
    if (organisationId) conditions.push(eq(crmContacts.organisationId, organisationId));
    if (search) {
      const term = `%${search}%`;
      conditions.push(
        or(
          ilike(crmContacts.firstName, term),
          ilike(crmContacts.lastName, term),
          ilike(crmContacts.email, term),
          ilike(crmOrganisations.name, term),
        ) as SQL
      );
    }

    const contacts = await db
      .select({
        id: crmContacts.id,
        organisationId: crmContacts.organisationId,
        organizationId: crmContacts.organizationId,
        firstName: crmContacts.firstName,
        lastName: crmContacts.lastName,
        title: crmContacts.title,
        role: crmContacts.role,
        email: crmContacts.email,
        phone: crmContacts.phone,
        mobile: crmContacts.mobile,
        isPrimary: crmContacts.isPrimary,
        preferredContact: crmContacts.preferredContact,
        notes: crmContacts.notes,
        createdAt: crmContacts.createdAt,
        updatedAt: crmContacts.updatedAt,
        orgName: crmOrganisations.name,
        orgType: crmOrganisations.type,
      })
      .from(crmContacts)
      .leftJoin(crmOrganisations, eq(crmOrganisations.id, crmContacts.organisationId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(crmContacts.isPrimary), asc(crmContacts.lastName), asc(crmContacts.firstName));

    res.json(contacts);
  } catch (error) {
    console.error("Get CRM contacts (all) error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/crm/organisations/:id/contacts", requireAuth, requireRole(...CONTACT_READ_ROLES), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied - no organization" });

    const orgConditions: SQL[] = [eq(crmOrganisations.id, req.params.id)];
    if (shouldFilter && orgId) orgConditions.push(eq(crmOrganisations.organizationId, orgId));

    const [parentOrg] = await db
      .select()
      .from(crmOrganisations)
      .where(and(...orgConditions))
      .limit(1);

    if (!parentOrg) return res.status(404).json({ error: "Organisation not found" });

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
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied - no organization" });

    const orgConditions: SQL[] = [eq(crmOrganisations.id, req.body.organisationId)];
    if (shouldFilter && orgId) orgConditions.push(eq(crmOrganisations.organizationId, orgId));

    const [parentOrg] = await db
      .select()
      .from(crmOrganisations)
      .where(and(...orgConditions))
      .limit(1);

    if (!parentOrg) return res.status(404).json({ error: "Parent organisation not found" });

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
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied - no organization" });

    const conditions: SQL[] = [eq(crmContacts.id, req.params.id)];
    if (shouldFilter && orgId) conditions.push(eq(crmContacts.organizationId, orgId));

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
      const primaryConditions: SQL[] = [
        eq(crmContacts.organisationId, existing.organisationId),
        sql`${crmContacts.id} != ${req.params.id}`,
      ];
      if (shouldFilter && orgId) primaryConditions.push(eq(crmContacts.organizationId, orgId));
      await db.update(crmContacts).set({ isPrimary: false }).where(and(...primaryConditions));
    }

    const [updated] = await db
      .update(crmContacts)
      .set({ ...safeData, updatedAt: new Date() })
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
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied - no organization" });

    const conditions: SQL[] = [eq(crmContacts.id, req.params.id)];
    if (shouldFilter && orgId) conditions.push(eq(crmContacts.organizationId, orgId));

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
