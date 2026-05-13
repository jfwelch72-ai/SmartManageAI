import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import {
  projects,
  bids,
  crmOrganisations,
  crmContacts,
  crmOpportunities,
  crmCalls,
  crmCallRecordings,
  equipment,
  tasks,
  changeOrders,
  rfis,
  submittals,
  purchaseOrders,
  vendorInvoices,
  users,
  punchListItems,
  projectInspections,
  safetyObservations,
  inventoryMaterials,
  warrantyCases,
  hiringJobs,
} from "@shared/schema";
import { and, eq, ilike, or, sql, desc, inArray, type SQL, type AnyColumn } from "drizzle-orm";
import { z } from "zod";
import { type AuthRequest, requireAuth, getEffectivePermissions, getEffectiveRole } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { sensitiveLimiter } from "./rateLimiter";

const router = Router();

const PER_ENTITY_CAP = 5;
const TOTAL_CAP = 30;

const querySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(5).optional(),
});

export type SearchResultType =
  | "deal"
  | "organization"
  | "contact"
  | "project"
  | "bid"
  | "vendor"
  | "subcontractor"
  | "call"
  | "equipment"
  | "task"
  | "change_order"
  | "rfi"
  | "submittal"
  | "purchase_order"
  | "vendor_invoice"
  | "team_member"
  | "punch_list_item"
  | "inspection"
  | "safety_observation"
  | "inventory_material"
  | "warranty_case"
  | "hiring_job";

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle?: string | null;
  url: string;
  icon: string;
  snippet?: string | null;
}

const ACTIVE_PROJECT_STATUSES = ["BID", "PLANNING", "ACTIVE"] as const;

router.get(
  "/api/search",
  requireAuth,
  sensitiveLimiter,
  async (req: AuthRequest, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
    }
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { q } = parsed.data;
    const perEntityLimit = Math.min(parsed.data.limit ?? PER_ENTITY_CAP, PER_ENTITY_CAP);

    const ctx = getOrgIdForFilter(req);
    if (ctx.mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const orgId = ctx.orgId;
    const isSuper = ctx.isSuperAdmin;

    const effectiveRole = getEffectiveRole(req.user);
    const perms = await getEffectivePermissions(
      req.user.id,
      req.user.organizationId ?? null,
      effectiveRole,
    );

    const allowProjects = perms.canAccessProjects === true;
    const allowBids = perms.canViewBids === true;
    const allowCrm = perms.canAccessCRM === true;
    const TRANSCRIPT_ROLES = new Set(["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPER_ADMIN"]);
    const allowCallTranscripts = allowCrm && TRANSCRIPT_ROLES.has(effectiveRole);
    const projectScope = perms.projectScope === "ACTIVE_ONLY" ? "ACTIVE_ONLY" : "ALL";

    const allowEquipment = perms.canManageEquipment === true;
    const allowProcurement = perms.canManageProcurement === true;
    const allowSafety = perms.canViewSafety === true;
    const allowHiring = perms.canManageHiring === true;
    const allowWorkforce = perms.canManageWorkforce === true;

    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

    const orgFilter = (col: AnyColumn): SQL | undefined =>
      isSuper || !orgId ? undefined : eq(col, orgId);

    const compose = (...conds: Array<SQL | undefined>): SQL | undefined => {
      const filtered = conds.filter((c): c is SQL => Boolean(c));
      if (filtered.length === 0) return undefined;
      if (filtered.length === 1) return filtered[0];
      return and(...filtered);
    };

    // Project scope filter for project-based queries
    const projectScopeFilter = projectScope === "ACTIVE_ONLY"
      ? inArray(projects.status, [...ACTIVE_PROJECT_STATUSES])
      : undefined;

    const projectsQuery = allowProjects
      ? db
          .select({
            id: projects.id,
            name: projects.name,
            code: projects.code,
            status: projects.status,
            city: projects.city,
            state: projects.state,
          })
          .from(projects)
          .where(
            compose(
              orgFilter(projects.gcOrganizationId),
              projectScope === "ACTIVE_ONLY"
                ? inArray(projects.status, [...ACTIVE_PROJECT_STATUSES])
                : undefined,
              or(
                ilike(projects.name, like),
                ilike(projects.code, like),
                ilike(projects.clientName, like),
              ),
            ),
          )
          .orderBy(desc(projects.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; name: string; code: string; status: string | null; city: string | null; state: string | null }>);

    const bidsQuery = allowBids
      ? db
          .select({
            id: bids.id,
            name: bids.name,
            code: bids.code,
            status: bids.status,
            clientName: bids.clientName,
          })
          .from(bids)
          .where(
            compose(
              orgFilter(bids.gcOrganizationId),
              or(
                ilike(bids.name, like),
                ilike(bids.code, like),
                ilike(bids.clientName, like),
              ),
            ),
          )
          .orderBy(desc(bids.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; name: string; code: string; status: string | null; clientName: string | null }>);

    const opportunitiesQuery = allowCrm
      ? db
          .select({
            id: crmOpportunities.id,
            name: crmOpportunities.name,
            stage: crmOpportunities.stage,
            dealValue: crmOpportunities.dealValue,
          })
          .from(crmOpportunities)
          .where(
            compose(
              orgFilter(crmOpportunities.organizationId),
              or(
                ilike(crmOpportunities.name, like),
                ilike(crmOpportunities.notes, like),
              ),
            ),
          )
          .orderBy(desc(crmOpportunities.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; name: string; stage: string | null; dealValue: string | null }>);

    const contactsQuery = allowCrm
      ? db
          .select({
            id: crmContacts.id,
            firstName: crmContacts.firstName,
            lastName: crmContacts.lastName,
            title: crmContacts.title,
            email: crmContacts.email,
          })
          .from(crmContacts)
          .where(
            compose(
              orgFilter(crmContacts.organizationId),
              eq(crmContacts.isActive, true),
              or(
                ilike(crmContacts.firstName, like),
                ilike(crmContacts.lastName, like),
                ilike(crmContacts.email, like),
                sql`(${crmContacts.firstName} || ' ' || ${crmContacts.lastName}) ILIKE ${like}`,
              ),
            ),
          )
          .orderBy(desc(crmContacts.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; firstName: string; lastName: string; title: string | null; email: string | null }>);

    const clientOrgsQuery = allowCrm
      ? db
          .select({
            id: crmOrganisations.id,
            name: crmOrganisations.name,
            type: crmOrganisations.type,
            city: crmOrganisations.city,
            state: crmOrganisations.state,
          })
          .from(crmOrganisations)
          .where(
            compose(
              orgFilter(crmOrganisations.organizationId),
              eq(crmOrganisations.isDeleted, false),
              or(
                eq(crmOrganisations.type, "CONTRACTOR"),
                eq(crmOrganisations.type, "OWNER_REP"),
              ),
              or(
                ilike(crmOrganisations.name, like),
                ilike(crmOrganisations.tradeSpecialty, like),
              ),
            ),
          )
          .orderBy(desc(crmOrganisations.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; name: string; type: string | null; city: string | null; state: string | null }>);

    const vendorsQuery = allowCrm
      ? db
          .select({
            id: crmOrganisations.id,
            name: crmOrganisations.name,
            type: crmOrganisations.type,
            city: crmOrganisations.city,
            state: crmOrganisations.state,
          })
          .from(crmOrganisations)
          .where(
            compose(
              orgFilter(crmOrganisations.organizationId),
              eq(crmOrganisations.isDeleted, false),
              or(
                eq(crmOrganisations.type, "VENDOR"),
                eq(crmOrganisations.type, "SUPPLIER"),
                eq(crmOrganisations.type, "RENTAL_VENDOR"),
                eq(crmOrganisations.type, "SERVICE_VENDOR"),
              ),
              or(
                ilike(crmOrganisations.name, like),
                ilike(crmOrganisations.tradeSpecialty, like),
              ),
            ),
          )
          .orderBy(desc(crmOrganisations.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; name: string; type: string | null; city: string | null; state: string | null }>);

    const subsQuery = allowCrm
      ? db
          .select({
            id: crmOrganisations.id,
            name: crmOrganisations.name,
            type: crmOrganisations.type,
            city: crmOrganisations.city,
            state: crmOrganisations.state,
          })
          .from(crmOrganisations)
          .where(
            compose(
              orgFilter(crmOrganisations.organizationId),
              eq(crmOrganisations.isDeleted, false),
              eq(crmOrganisations.type, "SUBCONTRACTOR"),
              or(
                ilike(crmOrganisations.name, like),
                ilike(crmOrganisations.tradeSpecialty, like),
              ),
            ),
          )
          .orderBy(desc(crmOrganisations.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; name: string; type: string | null; city: string | null; state: string | null }>);

    const callsQuery = allowCallTranscripts
      ? db
          .select({
            callId: crmCalls.id,
            opportunityId: crmCalls.opportunityId,
            contactId: crmCalls.contactId,
            crmOrganisationId: crmCalls.crmOrganisationId,
            startedAt: crmCalls.startedAt,
            direction: crmCalls.direction,
            outcome: crmCalls.outcome,
            transcript: crmCallRecordings.transcript,
            opportunityName: crmOpportunities.name,
            contactFirstName: crmContacts.firstName,
            contactLastName: crmContacts.lastName,
            organisationName: crmOrganisations.name,
          })
          .from(crmCalls)
          .innerJoin(crmCallRecordings, eq(crmCallRecordings.callId, crmCalls.id))
          .leftJoin(crmOpportunities, eq(crmOpportunities.id, crmCalls.opportunityId))
          .leftJoin(crmContacts, eq(crmContacts.id, crmCalls.contactId))
          .leftJoin(crmOrganisations, eq(crmOrganisations.id, crmCalls.crmOrganisationId))
          .where(
            compose(
              orgFilter(crmCalls.organizationId),
              sql`${crmCallRecordings.transcript} IS NOT NULL`,
              ilike(crmCallRecordings.transcript, like),
            ),
          )
          .orderBy(desc(crmCalls.startedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{
          callId: string;
          opportunityId: string | null;
          contactId: string | null;
          crmOrganisationId: string | null;
          startedAt: Date;
          direction: string | null;
          outcome: string | null;
          transcript: string | null;
          opportunityName: string | null;
          contactFirstName: string | null;
          contactLastName: string | null;
          organisationName: string | null;
        }>);

    // ─── New entity queries ───────────────────────────────────────────────────

    const equipmentQuery = allowEquipment
      ? db
          .select({
            id: equipment.id,
            name: equipment.name,
            equipmentCode: equipment.equipmentCode,
            make: equipment.make,
            model: equipment.model,
            status: equipment.status,
          })
          .from(equipment)
          .where(
            compose(
              orgFilter(equipment.organizationId),
              or(
                ilike(equipment.name, like),
                ilike(equipment.equipmentCode, like),
                ilike(equipment.make, like),
                ilike(equipment.model, like),
              ),
            ),
          )
          .orderBy(desc(equipment.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; name: string; equipmentCode: string; make: string | null; model: string | null; status: string }>);

    const tasksQuery = allowProjects
      ? db
          .select({
            id: tasks.id,
            title: tasks.title,
            description: tasks.description,
            status: tasks.status,
            priority: tasks.priority,
          })
          .from(tasks)
          .where(
            compose(
              orgFilter(tasks.organizationId),
              or(
                ilike(tasks.title, like),
                ilike(tasks.description, like),
              ),
            ),
          )
          .orderBy(desc(tasks.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; title: string; description: string | null; status: string; priority: string }>);

    const changeOrdersQuery = allowProjects
      ? db
          .select({
            id: changeOrders.id,
            changeOrderNumber: changeOrders.changeOrderNumber,
            description: changeOrders.description,
            status: changeOrders.status,
            projectCode: projects.code,
            projectName: projects.name,
          })
          .from(changeOrders)
          .innerJoin(projects, eq(changeOrders.projectId, projects.id))
          .where(
            compose(
              orgFilter(projects.gcOrganizationId),
              projectScopeFilter,
              or(
                ilike(changeOrders.changeOrderNumber, like),
                ilike(changeOrders.description, like),
              ),
            ),
          )
          .orderBy(desc(changeOrders.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; changeOrderNumber: string; description: string; status: string; projectCode: string; projectName: string }>);

    const rfisQuery = allowProjects
      ? db
          .select({
            id: rfis.id,
            rfiNumber: rfis.rfiNumber,
            subject: rfis.subject,
            status: rfis.status,
            projectCode: projects.code,
            projectName: projects.name,
          })
          .from(rfis)
          .innerJoin(projects, eq(rfis.projectId, projects.id))
          .where(
            compose(
              orgFilter(rfis.organizationId),
              projectScopeFilter,
              or(
                ilike(rfis.rfiNumber, like),
                ilike(rfis.subject, like),
                ilike(rfis.question, like),
              ),
            ),
          )
          .orderBy(desc(rfis.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; rfiNumber: string; subject: string; status: string; projectCode: string; projectName: string }>);

    const submittalsQuery = allowProjects
      ? db
          .select({
            id: submittals.id,
            submittalNumber: submittals.submittalNumber,
            subject: submittals.subject,
            status: submittals.status,
            projectCode: projects.code,
            projectName: projects.name,
          })
          .from(submittals)
          .innerJoin(projects, eq(submittals.projectId, projects.id))
          .where(
            compose(
              orgFilter(submittals.organizationId),
              projectScopeFilter,
              or(
                ilike(submittals.submittalNumber, like),
                ilike(submittals.subject, like),
                ilike(submittals.description, like),
              ),
            ),
          )
          .orderBy(desc(submittals.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; submittalNumber: string; subject: string; status: string; projectCode: string; projectName: string }>);

    const purchaseOrdersQuery = allowProcurement
      ? db
          .select({
            id: purchaseOrders.id,
            poNumber: purchaseOrders.poNumber,
            status: purchaseOrders.status,
            notes: purchaseOrders.notes,
          })
          .from(purchaseOrders)
          .where(
            compose(
              isSuper || !orgId ? undefined : eq(purchaseOrders.orgId, orgId),
              or(
                ilike(purchaseOrders.poNumber, like),
                ilike(purchaseOrders.notes, like),
              ),
            ),
          )
          .orderBy(desc(purchaseOrders.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; poNumber: string; status: string; notes: string | null }>);

    const vendorInvoicesQuery = allowProcurement
      ? db
          .select({
            id: vendorInvoices.id,
            invoiceNumber: vendorInvoices.invoiceNumber,
            status: vendorInvoices.status,
            notes: vendorInvoices.notes,
            totalAmount: vendorInvoices.totalAmount,
          })
          .from(vendorInvoices)
          .where(
            compose(
              isSuper || !orgId ? undefined : eq(vendorInvoices.orgId, orgId),
              or(
                ilike(vendorInvoices.invoiceNumber, like),
                ilike(vendorInvoices.notes, like),
              ),
            ),
          )
          .orderBy(desc(vendorInvoices.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; invoiceNumber: string; status: string; notes: string | null; totalAmount: string }>);

    const teamMembersQuery = allowWorkforce
      ? db
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            role: users.role,
          })
          .from(users)
          .where(
            compose(
              isSuper || !orgId ? undefined : eq(users.organizationId, orgId),
              eq(users.isActive, true),
              or(
                ilike(users.firstName, like),
                ilike(users.lastName, like),
                ilike(users.email, like),
                sql`(${users.firstName} || ' ' || ${users.lastName}) ILIKE ${like}`,
              ),
            ),
          )
          .orderBy(desc(users.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; firstName: string | null; lastName: string | null; email: string; role: string }>);

    const punchListQuery = allowProjects
      ? db
          .select({
            id: punchListItems.id,
            title: punchListItems.title,
            description: punchListItems.description,
            location: punchListItems.location,
            status: punchListItems.status,
            projectCode: projects.code,
            projectName: projects.name,
          })
          .from(punchListItems)
          .innerJoin(projects, eq(punchListItems.projectId, projects.id))
          .where(
            compose(
              orgFilter(projects.gcOrganizationId),
              projectScopeFilter,
              or(
                ilike(punchListItems.title, like),
                ilike(punchListItems.description, like),
                ilike(punchListItems.location, like),
              ),
            ),
          )
          .orderBy(desc(punchListItems.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; title: string; description: string | null; location: string | null; status: string; projectCode: string; projectName: string }>);

    const inspectionsQuery = allowProjects
      ? db
          .select({
            id: projectInspections.id,
            title: projectInspections.title,
            inspectionNumber: projectInspections.inspectionNumber,
            inspectorName: projectInspections.inspectorName,
            status: projectInspections.status,
            projectCode: projects.code,
            projectName: projects.name,
          })
          .from(projectInspections)
          .innerJoin(projects, eq(projectInspections.projectId, projects.id))
          .where(
            compose(
              orgFilter(projects.gcOrganizationId),
              projectScopeFilter,
              or(
                ilike(projectInspections.title, like),
                ilike(projectInspections.inspectionNumber, like),
                ilike(projectInspections.inspectorName, like),
              ),
            ),
          )
          .orderBy(desc(projectInspections.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; title: string; inspectionNumber: string; inspectorName: string | null; status: string; projectCode: string; projectName: string }>);

    const safetyObsQuery = allowSafety
      ? db
          .select({
            id: safetyObservations.id,
            description: safetyObservations.description,
            location: safetyObservations.location,
            observationType: safetyObservations.observationType,
            severity: safetyObservations.severity,
            status: safetyObservations.status,
          })
          .from(safetyObservations)
          .where(
            compose(
              orgFilter(safetyObservations.organizationId),
              or(
                ilike(safetyObservations.description, like),
                ilike(safetyObservations.location, like),
              ),
            ),
          )
          .orderBy(desc(safetyObservations.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; description: string; location: string | null; observationType: string; severity: string; status: string }>);

    const inventoryQuery = allowProjects || allowProcurement
      ? db
          .select({
            id: inventoryMaterials.id,
            name: inventoryMaterials.name,
            sku: inventoryMaterials.sku,
            category: inventoryMaterials.category,
          })
          .from(inventoryMaterials)
          .where(
            compose(
              orgFilter(inventoryMaterials.organizationId),
              eq(inventoryMaterials.isActive, true),
              or(
                ilike(inventoryMaterials.name, like),
                ilike(inventoryMaterials.sku, like),
                ilike(inventoryMaterials.category, like),
              ),
            ),
          )
          .orderBy(desc(inventoryMaterials.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; name: string; sku: string; category: string | null }>);

    const warrantyCasesQuery = allowProjects
      ? db
          .select({
            id: warrantyCases.id,
            caseNumber: warrantyCases.caseNumber,
            title: warrantyCases.title,
            description: warrantyCases.description,
            status: warrantyCases.status,
            projectCode: projects.code,
            projectName: projects.name,
          })
          .from(warrantyCases)
          .innerJoin(projects, eq(warrantyCases.projectId, projects.id))
          .where(
            compose(
              orgFilter(projects.gcOrganizationId),
              projectScopeFilter,
              or(
                ilike(warrantyCases.caseNumber, like),
                ilike(warrantyCases.title, like),
                ilike(warrantyCases.description, like),
              ),
            ),
          )
          .orderBy(desc(warrantyCases.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; caseNumber: string; title: string; description: string | null; status: string; projectCode: string; projectName: string }>);

    const hiringJobsQuery = allowHiring
      ? db
          .select({
            id: hiringJobs.id,
            title: hiringJobs.title,
            trade: hiringJobs.trade,
            department: hiringJobs.department,
            status: hiringJobs.status,
          })
          .from(hiringJobs)
          .where(
            compose(
              orgFilter(hiringJobs.organizationId),
              or(
                ilike(hiringJobs.title, like),
                ilike(hiringJobs.trade, like),
                ilike(hiringJobs.department, like),
              ),
            ),
          )
          .orderBy(desc(hiringJobs.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; title: string; trade: string | null; department: string | null; status: string }>);

    try {
      const [
        projectRows,
        bidRows,
        opportunityRows,
        contactRows,
        clientOrgRows,
        vendorRows,
        subRows,
        callRows,
        equipmentRows,
        taskRows,
        changeOrderRows,
        rfiRows,
        submittalRows,
        purchaseOrderRows,
        vendorInvoiceRows,
        teamMemberRows,
        punchListRows,
        inspectionRows,
        safetyObsRows,
        inventoryRows,
        warrantyCaseRows,
        hiringJobRows,
      ] = await Promise.all([
        projectsQuery,
        bidsQuery,
        opportunitiesQuery,
        contactsQuery,
        clientOrgsQuery,
        vendorsQuery,
        subsQuery,
        callsQuery,
        equipmentQuery,
        tasksQuery,
        changeOrdersQuery,
        rfisQuery,
        submittalsQuery,
        purchaseOrdersQuery,
        vendorInvoicesQuery,
        teamMembersQuery,
        punchListQuery,
        inspectionsQuery,
        safetyObsQuery,
        inventoryQuery,
        warrantyCasesQuery,
        hiringJobsQuery,
      ]);

      const results: SearchResult[] = [];

      for (const p of projectRows) {
        results.push({
          id: p.id,
          type: "project",
          title: p.name,
          subtitle: [p.code, [p.city, p.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
          url: `/projects/${encodeURIComponent(p.code)}`,
          icon: "briefcase",
        });
      }
      for (const b of bidRows) {
        results.push({
          id: b.id,
          type: "bid",
          title: b.name,
          subtitle: [b.code, b.clientName, b.status].filter(Boolean).join(" · "),
          url: `/bids/${encodeURIComponent(b.code)}`,
          icon: "file-text",
        });
      }
      for (const o of opportunityRows) {
        results.push({
          id: o.id,
          type: "deal",
          title: o.name,
          subtitle: [o.stage, o.dealValue ? `$${o.dealValue}` : null].filter(Boolean).join(" · "),
          url: `/crm/deals/${encodeURIComponent(o.id)}`,
          icon: "handshake",
        });
      }
      for (const c of clientOrgRows) {
        results.push({
          id: c.id,
          type: "organization",
          title: c.name,
          subtitle: [c.type, [c.city, c.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
          url: `/crm?tab=orgs&organisationId=${encodeURIComponent(c.id)}`,
          icon: "building",
        });
      }
      for (const c of contactRows) {
        const fullName = `${c.firstName} ${c.lastName}`.trim();
        results.push({
          id: c.id,
          type: "contact",
          title: fullName,
          subtitle: [c.title, c.email].filter(Boolean).join(" · "),
          url: `/crm?tab=contacts&contactId=${encodeURIComponent(c.id)}`,
          icon: "user",
        });
      }
      for (const v of vendorRows) {
        results.push({
          id: v.id,
          type: "vendor",
          title: v.name,
          subtitle: [v.type, [v.city, v.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
          url: `/crm?tab=orgs&organisationId=${encodeURIComponent(v.id)}`,
          icon: "truck",
        });
      }
      for (const c of callRows) {
        const transcript = c.transcript || "";
        const lowerT = transcript.toLowerCase();
        const lowerQ = q.toLowerCase();
        const idx = lowerT.indexOf(lowerQ);
        const start = Math.max(0, idx - 60);
        const end =
          idx >= 0
            ? Math.min(transcript.length, idx + q.length + 60)
            : Math.min(transcript.length, 160);
        const snippet =
          (start > 0 ? "…" : "") +
          transcript.slice(start, end) +
          (end < transcript.length ? "…" : "");

        const contactName = [c.contactFirstName, c.contactLastName].filter(Boolean).join(" ").trim();
        const contextName = c.opportunityName || contactName || c.organisationName || "Call";
        const dateLabel = c.startedAt
          ? new Date(c.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
          : null;
        const directionLabel = c.direction ? c.direction.toLowerCase() : null;

        const queryParams = new URLSearchParams();
        queryParams.set("q", q);
        queryParams.set("callId", c.callId);
        let url: string;
        if (c.opportunityId) {
          url = `/crm/deals/${encodeURIComponent(c.opportunityId)}?${queryParams.toString()}`;
        } else if (c.contactId) {
          url = `/crm?tab=contacts&contactId=${encodeURIComponent(c.contactId)}&${queryParams.toString()}`;
        } else if (c.crmOrganisationId) {
          url = `/crm?tab=orgs&organisationId=${encodeURIComponent(c.crmOrganisationId)}&${queryParams.toString()}`;
        } else {
          url = `/crm?${queryParams.toString()}`;
        }

        results.push({
          id: c.callId,
          type: "call",
          title: `Call · ${contextName}`,
          subtitle: [dateLabel, directionLabel, c.outcome ?? null].filter(Boolean).join(" · "),
          url,
          icon: "phone",
          snippet,
        });
      }
      for (const s of subRows) {
        results.push({
          id: s.id,
          type: "subcontractor",
          title: s.name,
          subtitle: [[s.city, s.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
          url: `/crm?tab=orgs&organisationId=${encodeURIComponent(s.id)}`,
          icon: "hard-hat",
        });
      }

      // ─── New entity results ────────────────────────────────────────────────

      for (const e of equipmentRows) {
        results.push({
          id: e.id,
          type: "equipment",
          title: e.name,
          subtitle: [e.equipmentCode, [e.make, e.model].filter(Boolean).join(" "), e.status].filter(Boolean).join(" · "),
          url: `/equipment/${encodeURIComponent(e.id)}`,
          icon: "wrench",
        });
      }

      for (const t of taskRows) {
        results.push({
          id: t.id,
          type: "task",
          title: t.title,
          subtitle: [t.priority, t.status].filter(Boolean).join(" · "),
          url: `/tasks`,
          icon: "clipboard-list",
        });
      }

      for (const co of changeOrderRows) {
        results.push({
          id: co.id,
          type: "change_order",
          title: co.description,
          subtitle: [co.changeOrderNumber, co.projectName, co.status].filter(Boolean).join(" · "),
          url: `/projects/${encodeURIComponent(co.projectCode)}?tab=change-orders`,
          icon: "file-plus",
        });
      }

      for (const r of rfiRows) {
        results.push({
          id: r.id,
          type: "rfi",
          title: r.subject,
          subtitle: [r.rfiNumber, r.projectName, r.status].filter(Boolean).join(" · "),
          url: `/projects/${encodeURIComponent(r.projectCode)}?tab=rfis`,
          icon: "help-circle",
        });
      }

      for (const s of submittalRows) {
        results.push({
          id: s.id,
          type: "submittal",
          title: s.subject,
          subtitle: [s.submittalNumber, s.projectName, s.status].filter(Boolean).join(" · "),
          url: `/projects/${encodeURIComponent(s.projectCode)}?tab=submittals`,
          icon: "send",
        });
      }

      for (const po of purchaseOrderRows) {
        results.push({
          id: po.id,
          type: "purchase_order",
          title: po.poNumber,
          subtitle: [po.status, po.notes].filter(Boolean).join(" · "),
          url: `/procurement-module?tab=purchase-orders`,
          icon: "shopping-cart",
        });
      }

      for (const vi of vendorInvoiceRows) {
        results.push({
          id: vi.id,
          type: "vendor_invoice",
          title: vi.invoiceNumber,
          subtitle: [vi.status, vi.totalAmount ? `$${vi.totalAmount}` : null].filter(Boolean).join(" · "),
          url: `/procurement-module?tab=vendor-invoices`,
          icon: "receipt",
        });
      }

      for (const tm of teamMemberRows) {
        results.push({
          id: tm.id,
          type: "team_member",
          title: [`${tm.firstName ?? ""} ${tm.lastName ?? ""}`.trim() || tm.email].filter(Boolean).join(""),
          subtitle: [tm.role, tm.email].filter(Boolean).join(" · "),
          url: `/manage-workers`,
          icon: "user-check",
        });
      }

      for (const pl of punchListRows) {
        results.push({
          id: pl.id,
          type: "punch_list_item",
          title: pl.title,
          subtitle: [pl.location, pl.projectName, pl.status].filter(Boolean).join(" · "),
          url: `/projects/${encodeURIComponent(pl.projectCode)}?tab=punch-list`,
          icon: "check-square",
        });
      }

      for (const insp of inspectionRows) {
        results.push({
          id: insp.id,
          type: "inspection",
          title: insp.title,
          subtitle: [insp.inspectionNumber, insp.projectName, insp.status].filter(Boolean).join(" · "),
          url: `/projects/${encodeURIComponent(insp.projectCode)}?tab=inspections`,
          icon: "clipboard-check",
        });
      }

      for (const obs of safetyObsRows) {
        results.push({
          id: obs.id,
          type: "safety_observation",
          title: obs.description.length > 80 ? obs.description.slice(0, 80) + "…" : obs.description,
          subtitle: [obs.observationType, obs.location, obs.severity].filter(Boolean).join(" · "),
          url: `/safety?tab=observations`,
          icon: "shield-alert",
        });
      }

      for (const mat of inventoryRows) {
        results.push({
          id: mat.id,
          type: "inventory_material",
          title: mat.name,
          subtitle: [mat.sku, mat.category].filter(Boolean).join(" · "),
          url: `/inventory`,
          icon: "package",
        });
      }

      for (const wc of warrantyCaseRows) {
        results.push({
          id: wc.id,
          type: "warranty_case",
          title: wc.title,
          subtitle: [wc.caseNumber, wc.projectName, wc.status].filter(Boolean).join(" · "),
          url: `/projects/${encodeURIComponent(wc.projectCode)}?tab=warranty`,
          icon: "shield-check",
        });
      }

      for (const job of hiringJobRows) {
        results.push({
          id: job.id,
          type: "hiring_job",
          title: job.title,
          subtitle: [job.trade, job.department, job.status].filter(Boolean).join(" · "),
          url: `/hiring`,
          icon: "user-plus",
        });
      }

      const capped = results.slice(0, TOTAL_CAP);
      res.json({ results: capped });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logError("Search error:", message);
      res.status(500).json({ error: "Search failed" });
    }
  },
);

export default router;
