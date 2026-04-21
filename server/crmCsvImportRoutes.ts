import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import {
  crmCsvImportJobs,
  crmContacts, crmOrganisations, crmOpportunities,
} from "@shared/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();
const READ_ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR"] as const;
const EDIT_ROLES = ["ADMIN", "HUSTLER", "MANAGER"] as const;

const importBody = z.object({
  entityType: z.enum(["CONTACT", "ORGANISATION", "OPPORTUNITY"]),
  filename: z.string().optional(),
  mapping: z.record(z.string()).default({}),
  rows: z.array(z.record(z.any())).max(5000),
});

function pick(row: Record<string, any>, mapping: Record<string, string>, target: string): any {
  for (const [csvCol, schemaField] of Object.entries(mapping)) {
    if (schemaField === target) {
      const v = row[csvCol];
      return typeof v === "string" ? v.trim() : v;
    }
  }
  return undefined;
}

router.get("/api/crm/csv-imports", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const rows = await db.select().from(crmCsvImportJobs).where(eq(crmCsvImportJobs.organizationId, orgId)).orderBy(desc(crmCsvImportJobs.createdAt)).limit(50);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post("/api/crm/csv-imports", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = importBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

    const { entityType, filename, mapping, rows } = parsed.data;

    const [job] = await db.insert(crmCsvImportJobs).values({
      organizationId: orgId,
      entityType,
      status: "PROCESSING",
      filename: filename ?? null,
      totalRows: rows.length,
      mapping,
      createdById: req.user!.id,
    } as any).returning();

    let inserted = 0, updated = 0, skipped = 0, errored = 0;
    const errors: { row: number; error: string }[] = [];
    const insertedIds: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        if (entityType === "CONTACT") {
          const email = pick(row, mapping, "email");
          const fullName = pick(row, mapping, "fullName") || pick(row, mapping, "name");
          const firstNameRaw = pick(row, mapping, "firstName");
          const lastNameRaw = pick(row, mapping, "lastName");
          if (!fullName && !firstNameRaw) { skipped++; continue; }
          const parts = (fullName || "").split(/\s+/).filter(Boolean);
          const firstName = firstNameRaw || parts[0] || "Imported";
          const lastName = lastNameRaw || parts.slice(1).join(" ") || "Contact";
          if (email) {
            const [existing] = await db.select().from(crmContacts).where(and(eq(crmContacts.organizationId, orgId), eq(crmContacts.email, email))).limit(1);
            if (existing) {
              await db.update(crmContacts).set({
                firstName,
                lastName,
                phone: pick(row, mapping, "phone") ?? existing.phone,
                title: pick(row, mapping, "title") ?? existing.title,
              } as any).where(eq(crmContacts.id, existing.id));
              updated++;
              continue;
            }
          }
          const companyName = pick(row, mapping, "company") || pick(row, mapping, "organisation") || "Imported Contacts";
          let [orgRow] = await db.select().from(crmOrganisations)
            .where(and(eq(crmOrganisations.organizationId, orgId), eq(crmOrganisations.name, companyName)))
            .limit(1);
          if (!orgRow) {
            [orgRow] = await db.insert(crmOrganisations).values({
              organizationId: orgId,
              name: companyName,
              type: "CONTRACTOR",
            } as any).returning();
          }
          const [c] = await db.insert(crmContacts).values({
            organizationId: orgId,
            organisationId: orgRow.id,
            firstName,
            lastName,
            email: email ?? null,
            phone: pick(row, mapping, "phone") ?? null,
            title: pick(row, mapping, "title") ?? null,
          } as any).returning();
          insertedIds.push(c.id);
          inserted++;
        } else if (entityType === "ORGANISATION") {
          const name = pick(row, mapping, "name");
          if (!name) { skipped++; continue; }
          const ALLOWED_ORG_TYPES = ["CONTRACTOR", "SUBCONTRACTOR", "SUPPLIER", "VENDOR", "OWNER_REP", "RENTAL_VENDOR", "SERVICE_VENDOR"] as const;
          const requestedType = pick(row, mapping, "type");
          if (requestedType && !(ALLOWED_ORG_TYPES as readonly string[]).includes(requestedType)) {
            errored++;
            errors.push({ row: i + 1, error: `Invalid organisation type "${requestedType}"; allowed: ${ALLOWED_ORG_TYPES.join(", ")}` });
            continue;
          }
          const [existing] = await db.select().from(crmOrganisations).where(and(eq(crmOrganisations.organizationId, orgId), eq(crmOrganisations.name, name))).limit(1);
          if (existing) { updated++; continue; }
          const [o] = await db.insert(crmOrganisations).values({
            organizationId: orgId,
            name,
            type: (requestedType as any) || "CONTRACTOR",
            website: pick(row, mapping, "website") ?? null,
            phone: pick(row, mapping, "phone") ?? null,
            address: pick(row, mapping, "address") ?? null,
          } as any).returning();
          insertedIds.push(o.id);
          inserted++;
        } else if (entityType === "OPPORTUNITY") {
          const name = pick(row, mapping, "name");
          if (!name) { skipped++; continue; }
          const [o] = await db.insert(crmOpportunities).values({
            organizationId: orgId,
            name,
            stage: (pick(row, mapping, "stage") as any) || "LEAD",
            dealValue: pick(row, mapping, "dealValue") ?? null,
            source: pick(row, mapping, "source") ?? "CSV Import",
            stageEnteredAt: new Date(),
          } as any).returning();
          insertedIds.push(o.id);
          inserted++;
        }
      } catch (err: any) {
        errored++;
        errors.push({ row: i + 1, error: err?.message ?? String(err) });
      }
    }

    const [final] = await db.update(crmCsvImportJobs).set({
      status: "COMPLETED",
      processedRows: rows.length,
      insertedRows: inserted,
      updatedRows: updated,
      skippedRows: skipped,
      errorRows: errored,
      errors: errors.slice(0, 100),
      insertedIds,
      completedAt: new Date(),
    } as any).where(eq(crmCsvImportJobs.id, job.id)).returning();

    res.status(201).json(final);
  } catch (e) { next(e); }
});

router.post("/api/crm/csv-imports/:id/revert", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const [job] = await db.select().from(crmCsvImportJobs).where(and(eq(crmCsvImportJobs.id, req.params.id), eq(crmCsvImportJobs.organizationId, orgId))).limit(1);
    if (!job) return res.status(404).json({ error: "Not found" });
    if (job.status === "REVERTED") return res.json(job);
    const ids = (job.insertedIds as string[]) || [];
    if (ids.length > 0) {
      if (job.entityType === "CONTACT") await db.delete(crmContacts).where(and(eq(crmContacts.organizationId, orgId), inArray(crmContacts.id, ids)));
      else if (job.entityType === "ORGANISATION") await db.delete(crmOrganisations).where(and(eq(crmOrganisations.organizationId, orgId), inArray(crmOrganisations.id, ids)));
      else if (job.entityType === "OPPORTUNITY") await db.delete(crmOpportunities).where(and(eq(crmOpportunities.organizationId, orgId), inArray(crmOpportunities.id, ids)));
    }
    const [updated] = await db.update(crmCsvImportJobs).set({ status: "REVERTED", completedAt: new Date() } as any).where(eq(crmCsvImportJobs.id, job.id)).returning();
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
