/**
 * @openapi
 * /api/crm/organisations:
 *   get:
 *     tags: [CRM]
 *     summary: List CRM organisations
 *     description: Returns all CRM organisations (clients, vendors, subcontractors) for the authenticated user's organization.
 *     parameters:
 *       - name: type
 *         in: query
 *         schema: { type: string, enum: [CLIENT, VENDOR, SUBCONTRACTOR, GC, OTHER] }
 *       - name: search
 *         in: query
 *         schema: { type: string }
 *       - name: status
 *         in: query
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of organisations
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/CrmOrganisation'
 *   post:
 *     tags: [CRM]
 *     summary: Create a CRM organisation
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InsertCrmOrganisation'
 *     responses:
 *       201: { description: Organisation created }
 *       400: { description: Invalid input }
 * /api/crm/organisations/{id}:
 *   get:
 *     tags: [CRM]
 *     summary: Get CRM organisation by ID
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Organisation details with contacts }
 *       404: { description: Organisation not found }
 *   patch:
 *     tags: [CRM]
 *     summary: Update a CRM organisation
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Organisation updated }
 *   delete:
 *     tags: [CRM]
 *     summary: Delete a CRM organisation
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Organisation deleted }
 * /api/crm/contacts:
 *   get:
 *     tags: [CRM]
 *     summary: List CRM contacts
 *     responses:
 *       200: { description: List of contacts }
 *   post:
 *     tags: [CRM]
 *     summary: Create a CRM contact
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InsertCrmContact'
 *     responses:
 *       201: { description: Contact created }
 * /api/crm/contacts/{id}:
 *   patch:
 *     tags: [CRM]
 *     summary: Update a CRM contact
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Contact updated }
 *   delete:
 *     tags: [CRM]
 *     summary: Delete a CRM contact
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Contact deleted }
 * /api/crm/opportunities:
 *   get:
 *     tags: [CRM]
 *     summary: List CRM opportunities
 *     description: Returns sales opportunities/pipeline for the organization.
 *     responses:
 *       200: { description: List of opportunities }
 *   post:
 *     tags: [CRM]
 *     summary: Create a CRM opportunity
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InsertCrmOpportunity'
 *     responses:
 *       201: { description: Opportunity created }
 * /api/crm/opportunities/{id}:
 *   get:
 *     tags: [CRM]
 *     summary: Get opportunity details
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Opportunity details with activities }
 *   patch:
 *     tags: [CRM]
 *     summary: Update an opportunity
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Opportunity updated }
 * /api/crm/organisations/{id}/notes:
 *   get:
 *     tags: [CRM]
 *     summary: Get notes for an organisation
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of notes }
 *   post:
 *     tags: [CRM]
 *     summary: Add a note to an organisation
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string }
 *     responses:
 *       201: { description: Note added }
 */
import { logError } from "./utils/logger";
import { z } from "zod";
import { Router } from "express";
import { validateBody } from "./utils/validation";
import { db } from "./db";
import { crmOrganisations, crmContacts, crmOrganisationNotes, insertCrmOrganisationSchema, insertCrmOrganisationNoteSchema, auditLog, users, emailThreads, emailMessages, calendarEvents, projects, crmOpportunities, vendorPricingCatalogs, vendorPricebooks, vendorPricebookItems, subcontractorContracts, rentalVendors, rentalEquipmentCatalog, vendorEnrollments, vendorUsers, websiteContactSubmissions, emailTasks, pricebookImportJobs, vendorScores, materialPriceIndex, rfis, transmittalRecipients, submittals, subcontractorPortalTokens, bidDocumentDistributions, insertCrmContactSchema, crmOpportunityActivities, insertCrmOpportunitySchema, insertCrmOpportunityActivitySchema, notifications, organizationNetworkSettings } from "@shared/schema";
import { eq, and, sql, desc, or, lte, gte, isNotNull, inArray, ilike, ne, type SQL, asc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { insertNotification } from "./services/notificationService";
import { eventBus } from "./events";
import { scoreWinProbability } from "./ai/winProbabilityService";
import { evaluateAssignment } from "./utils/crmAssignmentEngine";
import { scoreOpportunity } from "./utils/crmLeadScorer";
import { upsertCustomFieldValues, getCustomFieldsMap, getCustomFieldsMapBatch, getEntityIdsMatchingCustomFieldFilters, deleteCustomFieldValuesForEntity } from "./crmCustomFieldsRoutes";

const router = Router();

// ========================================
// Routes from crmVendorRoutes.ts
// ========================================

router.get("/api/crm/organisations", requireAuth, requireRole("ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { type, search, active, status, state } = req.query as Record<string, string | undefined>;
      // specialty may be repeated: ?specialty=A&specialty=B
      const specialtyRaw = req.query.specialty;
      const specialties: string[] = specialtyRaw
        ? Array.isArray(specialtyRaw) ? specialtyRaw as string[] : [specialtyRaw as string]
        : [];

      const conditions: SQL[] = [eq(crmOrganisations.isDeleted, false)];
      
      if (shouldFilter && orgId) {
        conditions.push(eq(crmOrganisations.organizationId, orgId));
      }
      
      if (type) {
        conditions.push(sql`${crmOrganisations.type} = ${type}`);
      }
      if (active !== undefined) {
        conditions.push(eq(crmOrganisations.isActive, active === 'true'));
      }
      if (status) {
        conditions.push(sql`${crmOrganisations.crmStatus} = ${status}`);
      }
      if (state) {
        conditions.push(ilike(crmOrganisations.state, state));
      }
      if (specialties.length > 0) {
        // match orgs that have ANY of the selected specialties
        const specConditions = specialties.map((s) => sql`${s} = ANY(${crmOrganisations.specialties})`);
        conditions.push(or(...specConditions) as SQL);
      }
      if (search) {
        conditions.push(
          sql`LOWER(${crmOrganisations.name}) LIKE LOWER(${'%' + search + '%'})`
        );
      }

      if (orgId) {
        const cfFilter = await getEntityIdsMatchingCustomFieldFilters(orgId, "ORGANISATION", req.query as Record<string, any>);
        if (cfFilter.applies) {
          if (cfFilter.ids.length === 0) return res.json([]);
          conditions.push(inArray(crmOrganisations.id, cfFilter.ids));
        }
      }

      const results = await db
        .select()
        .from(crmOrganisations)
        .where(and(...conditions))
        .orderBy(crmOrganisations.name);

      if (orgId && results.length) {
        const cfMap = await getCustomFieldsMapBatch(orgId, "ORGANISATION", results.map((r: any) => r.id));
        return res.json(results.map((r: any) => ({ ...r, customFields: cfMap[r.id] ?? {} })));
      }
      res.json(results);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/crm/organisations/expiring-compliance", requireAuth, requireRole("ADMIN", "HUSTLER", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }

      const now = new Date();
      const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const conditions: SQL[] = [];
      if (shouldFilter && orgId) {
        conditions.push(eq(crmOrganisations.organizationId, orgId));
      }
      conditions.push(eq(crmOrganisations.isActive, true));

      const expirationCheck = or(
        and(isNotNull(crmOrganisations.insuranceExpiration), lte(crmOrganisations.insuranceExpiration, thirtyDaysFromNow)),
        and(isNotNull(crmOrganisations.wcInsuranceExpiration), lte(crmOrganisations.wcInsuranceExpiration, thirtyDaysFromNow)),
        and(isNotNull(crmOrganisations.licenseExpiration), lte(crmOrganisations.licenseExpiration, thirtyDaysFromNow)),
        and(isNotNull(crmOrganisations.contractExpiration), lte(crmOrganisations.contractExpiration, thirtyDaysFromNow))
      );
      conditions.push(expirationCheck!);

      const orgs = await db
        .select({
          id: crmOrganisations.id,
          name: crmOrganisations.name,
          type: crmOrganisations.type,
          insuranceExpiration: crmOrganisations.insuranceExpiration,
          wcInsuranceExpiration: crmOrganisations.wcInsuranceExpiration,
          licenseExpiration: crmOrganisations.licenseExpiration,
          contractExpiration: crmOrganisations.contractExpiration,
        })
        .from(crmOrganisations)
        .where(and(...conditions))
        .orderBy(crmOrganisations.insuranceExpiration);

      const items: Array<{
        orgId: string;
        orgName: string;
        orgType: string;
        complianceType: string;
        expirationDate: string;
        status: "expired" | "expiring_soon";
        daysUntilExpiration: number;
      }> = [];

      for (const org of orgs) {
        const fields = [
          { type: "General Liability Insurance", date: org.insuranceExpiration },
          { type: "Workers Comp Insurance", date: org.wcInsuranceExpiration },
          { type: "License", date: org.licenseExpiration },
          { type: "Contract", date: org.contractExpiration },
        ];
        for (const field of fields) {
          if (field.date && new Date(field.date) <= thirtyDaysFromNow) {
            const expDate = new Date(field.date);
            const daysUntil = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            items.push({
              orgId: org.id,
              orgName: org.name,
              orgType: org.type || "UNKNOWN",
              complianceType: field.type,
              expirationDate: field.date instanceof Date ? field.date.toISOString() : String(field.date),
              status: daysUntil <= 0 ? "expired" : "expiring_soon",
              daysUntilExpiration: daysUntil,
            });
          }
        }
      }

      items.sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration);

      res.json({
        total: items.length,
        expired: items.filter(i => i.status === "expired").length,
        expiringSoon: items.filter(i => i.status === "expiring_soon").length,
        items,
      });
    } catch (error) {
      next(error);
    }
  });

  // Duplicate detection — must be before /:id to avoid route conflict
  router.get("/api/crm/organisations/duplicates", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }

      const conditions: SQL[] = [eq(crmOrganisations.isDeleted, false)];
      if (shouldFilter && orgId) {
        conditions.push(eq(crmOrganisations.organizationId, orgId));
      }

      const allOrgs = await db
        .select({
          id: crmOrganisations.id,
          name: crmOrganisations.name,
          type: crmOrganisations.type,
          city: crmOrganisations.city,
          state: crmOrganisations.state,
          crmStatus: crmOrganisations.crmStatus,
          isActive: crmOrganisations.isActive,
        })
        .from(crmOrganisations)
        .where(and(...conditions))
        .orderBy(crmOrganisations.name);

      // Fetch primary contact emails+phones for phone/email matching
      const orgIds = allOrgs.map((o) => o.id);
      const contacts = orgIds.length > 0
        ? await db
            .select({
              organisationId: crmContacts.organisationId,
              email: crmContacts.email,
              phone: crmContacts.phone,
            })
            .from(crmContacts)
            .where(inArray(crmContacts.organisationId, orgIds))
        : [];

      // Build lookup: orgId -> [emails], [phones]
      const emailsByOrg: Record<string, string[]> = {};
      const phonesByOrg: Record<string, string[]> = {};
      for (const c of contacts) {
        if (c.email) {
          emailsByOrg[c.organisationId] = emailsByOrg[c.organisationId] || [];
          emailsByOrg[c.organisationId].push(c.email.toLowerCase());
        }
        if (c.phone) {
          const normalized = c.phone.replace(/\D/g, "");
          phonesByOrg[c.organisationId] = phonesByOrg[c.organisationId] || [];
          phonesByOrg[c.organisationId].push(normalized);
        }
      }

      // Find pairs: name similarity (first 6 chars) or shared email/phone
      const pairs: Array<{
        orgA: typeof allOrgs[0];
        orgB: typeof allOrgs[0];
        matchReason: string;
      }> = [];
      const seen = new Set<string>();

      for (let i = 0; i < allOrgs.length; i++) {
        for (let j = i + 1; j < allOrgs.length; j++) {
          const a = allOrgs[i];
          const b = allOrgs[j];
          const pairKey = [a.id, b.id].sort().join("|");
          if (seen.has(pairKey)) continue;

          const reasons: string[] = [];

          // Name similarity: normalize and compare first 8 chars
          const normA = a.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          const normB = b.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (normA.length >= 4 && normB.length >= 4) {
            const prefix = Math.min(8, Math.min(normA.length, normB.length));
            if (normA.slice(0, prefix) === normB.slice(0, prefix)) {
              reasons.push("similar name");
            }
          }

          // Shared contact email
          const emailsA = emailsByOrg[a.id] || [];
          const emailsB = emailsByOrg[b.id] || [];
          if (emailsA.some((e) => emailsB.includes(e))) {
            reasons.push("shared contact email");
          }

          // Shared contact phone
          const phonesA = phonesByOrg[a.id] || [];
          const phonesB = phonesByOrg[b.id] || [];
          if (phonesA.some((p) => p.length >= 7 && phonesB.includes(p))) {
            reasons.push("shared contact phone");
          }

          if (reasons.length > 0) {
            seen.add(pairKey);
            pairs.push({ orgA: a, orgB: b, matchReason: reasons.join(", ") });
          }
        }
      }

      res.json({ pairs, total: pairs.length });
    } catch (error) {
      next(error);
    }
  });

  // Merge two orgs: re-parent contacts, notes, compliance records, then soft-delete loser
  router.post("/api/crm/organisations/:id/merge/:targetId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId: userOrgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }

      const winnerId = req.params.id;
      const loserId = req.params.targetId;

      if (winnerId === loserId) {
        return res.status(400).json({ error: "Cannot merge an organization with itself" });
      }

      const baseConditions: SQL[] = [eq(crmOrganisations.isDeleted, false)];
      if (shouldFilter && userOrgId) {
        baseConditions.push(eq(crmOrganisations.organizationId, userOrgId));
      }

      const [winner] = await db
        .select()
        .from(crmOrganisations)
        .where(and(eq(crmOrganisations.id, winnerId), ...baseConditions))
        .limit(1);

      const [loser] = await db
        .select()
        .from(crmOrganisations)
        .where(and(eq(crmOrganisations.id, loserId), ...baseConditions))
        .limit(1);

      if (!winner) return res.status(404).json({ error: "Winner organization not found" });
      if (!loser) return res.status(404).json({ error: "Loser organization not found" });

      await db.transaction(async (tx) => {
        // Re-parent contacts
        await tx
          .update(crmContacts)
          .set({ organisationId: winnerId })
          .where(eq(crmContacts.organisationId, loserId));

        // Re-parent notes
        await tx
          .update(crmOrganisationNotes)
          .set({ organisationId: winnerId })
          .where(eq(crmOrganisationNotes.organisationId, loserId));

        // Re-parent CRM opportunities
        await tx
          .update(crmOpportunities)
          .set({ crmOrganisationId: winnerId })
          .where(eq(crmOpportunities.crmOrganisationId, loserId));

        // Re-parent vendor pricing catalogs
        await tx
          .update(vendorPricingCatalogs)
          .set({ crmOrganisationId: winnerId })
          .where(eq(vendorPricingCatalogs.crmOrganisationId, loserId));

        // Re-parent vendor pricebooks (uses vendorId for crmOrganisations.id)
        await tx
          .update(vendorPricebooks)
          .set({ vendorId: winnerId })
          .where(eq(vendorPricebooks.vendorId, loserId));

        // Re-parent vendor pricebook items (also uses vendorId)
        await tx
          .update(vendorPricebookItems)
          .set({ vendorId: winnerId })
          .where(eq(vendorPricebookItems.vendorId, loserId));

        // Re-parent email threads (uses vendorId for crmOrganisations.id)
        await tx
          .update(emailThreads)
          .set({ vendorId: winnerId })
          .where(eq(emailThreads.vendorId, loserId));

        // Re-parent subcontractor contracts
        await tx
          .update(subcontractorContracts)
          .set({ subcontractorId: winnerId })
          .where(eq(subcontractorContracts.subcontractorId, loserId));

        // Re-parent rental vendors
        await tx
          .update(rentalVendors)
          .set({ crmOrganisationId: winnerId })
          .where(eq(rentalVendors.crmOrganisationId, loserId));

        // Re-parent rental equipment catalog
        await tx
          .update(rentalEquipmentCatalog)
          .set({ crmOrganisationId: winnerId })
          .where(eq(rentalEquipmentCatalog.crmOrganisationId, loserId));

        // Re-parent vendor enrollments
        await tx
          .update(vendorEnrollments)
          .set({ vendorCrmOrgId: winnerId })
          .where(eq(vendorEnrollments.vendorCrmOrgId, loserId));

        // Re-parent vendor users
        await tx
          .update(vendorUsers)
          .set({ crmOrganisationId: winnerId })
          .where(eq(vendorUsers.crmOrganisationId, loserId));

        // Re-parent website contact submissions
        await tx
          .update(websiteContactSubmissions)
          .set({ crmOrganisationId: winnerId })
          .where(eq(websiteContactSubmissions.crmOrganisationId, loserId));

        // Re-parent email tasks
        await tx
          .update(emailTasks)
          .set({ vendorId: winnerId })
          .where(eq(emailTasks.vendorId, loserId));

        // Re-parent pricebook import jobs
        await tx
          .update(pricebookImportJobs)
          .set({ crmOrganisationId: winnerId })
          .where(eq(pricebookImportJobs.crmOrganisationId, loserId));

        // Re-parent vendor scores
        await tx
          .update(vendorScores)
          .set({ crmEntityId: winnerId })
          .where(eq(vendorScores.crmEntityId, loserId));

        // Re-parent material price index source vendor
        await tx
          .update(materialPriceIndex)
          .set({ sourceVendorId: winnerId })
          .where(eq(materialPriceIndex.sourceVendorId, loserId));

        // Re-parent RFIs
        await tx
          .update(rfis)
          .set({ subcontractorId: winnerId })
          .where(eq(rfis.subcontractorId, loserId));

        // Re-parent transmittal recipients
        await tx
          .update(transmittalRecipients)
          .set({ subcontractorId: winnerId })
          .where(eq(transmittalRecipients.subcontractorId, loserId));

        // Re-parent submittals
        await tx
          .update(submittals)
          .set({ subcontractorId: winnerId })
          .where(eq(submittals.subcontractorId, loserId));

        // Re-parent subcontractor portal tokens
        await tx
          .update(subcontractorPortalTokens)
          .set({ crmOrganisationId: winnerId })
          .where(eq(subcontractorPortalTokens.crmOrganisationId, loserId));

        // Re-parent bid document distributions
        await tx
          .update(bidDocumentDistributions)
          .set({ crmOrganisationId: winnerId })
          .where(eq(bidDocumentDistributions.crmOrganisationId, loserId));

        // Soft-delete the loser
        await tx
          .update(crmOrganisations)
          .set({ isDeleted: true, deletedAt: new Date(), isActive: false })
          .where(eq(crmOrganisations.id, loserId));

        // Audit log
        await tx.insert(auditLog).values({
          userId: req.user!.id,
          action: "MERGE",
          entityType: "crm_organisations",
          entityId: winnerId,
          oldValue: JSON.stringify({ loserId, loserName: loser.name }),
          newValue: JSON.stringify({ winnerId, winnerName: winner.name }),
        });
      });

      res.json({ success: true, winnerId, loserId });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/crm/organisations/:id", requireAuth, requireRole("ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const conditions = [eq(crmOrganisations.id, req.params.id)];
      
      if (shouldFilter && orgId) {
        conditions.push(eq(crmOrganisations.organizationId, orgId));
      }
      
      const [organisation] = await db
        .select()
        .from(crmOrganisations)
        .where(and(...conditions))
        .limit(1);
      
      if (!organisation) {
        res.status(404).json({ error: "Organisation not found" });
        return;
      }
      
      const contacts = await db
        .select()
        .from(crmContacts)
        .where(eq(crmContacts.organisationId, req.params.id))
        .orderBy(desc(crmContacts.isPrimary), crmContacts.lastName, crmContacts.firstName);

      const orgIdEffective = orgId ?? organisation.organizationId;
      const [customFields, contactCustomFields] = await Promise.all([
        getCustomFieldsMap(orgIdEffective, "ORGANISATION", organisation.id),
        getCustomFieldsMapBatch(orgIdEffective, "CONTACT", contacts.map(c => c.id)),
      ]);
      const contactsWithCf = contacts.map(c => ({ ...c, customFields: contactCustomFields[c.id] ?? {} }));

      res.json({ ...organisation, contacts: contactsWithCf, customFields });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/crm/organisations", requireAuth, requireRole("ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess || !orgId) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }

      const body = { ...req.body };
      const dateFields = ["insuranceExpiration", "wcInsuranceExpiration", "licenseExpiration", "contractExpiration", "deletedAt"] as const;
      for (const f of dateFields) {
        if (body[f] && typeof body[f] === "string") {
          const d = new Date(body[f]);
          body[f] = isNaN(d.getTime()) ? undefined : d;
        }
      }
      
      const validationResult = insertCrmOrganisationSchema.safeParse({
        ...body,
        organizationId: orgId,
        createdById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }
      
      let newOrg: typeof crmOrganisations.$inferSelect;
      try {
        newOrg = await db.transaction(async (tx) => {
          const [n] = await tx
            .insert(crmOrganisations)
            .values(validationResult.data)
            .returning();
          const cfRes = await upsertCustomFieldValues({
            orgId,
            entityType: "ORGANISATION",
            entityId: n.id,
            customFields: req.body?.customFields,
            executor: tx,
          });
          if (!cfRes.ok) throw new Error(`__CF_VALIDATION__:${cfRes.error}`);
          return n;
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("__CF_VALIDATION__:")) {
          return res.status(400).json({ error: msg.slice("__CF_VALIDATION__:".length) });
        }
        throw e;
      }

      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "crm_organisations",
        entityId: newOrg.id,
        newValue: JSON.stringify({ name: newOrg.name, type: newOrg.type }),
      });

      const customFields = await getCustomFieldsMap(orgId, "ORGANISATION", newOrg.id);
      res.status(201).json({ ...newOrg, customFields });
    } catch (error) {
      next(error);
    }
  });

  router.put("/api/crm/organisations/:id", requireAuth, requireRole("ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const conditions = [eq(crmOrganisations.id, req.params.id)];
      
      if (shouldFilter && orgId) {
        conditions.push(eq(crmOrganisations.organizationId, orgId));
      }
      
      const [existing] = await db
        .select()
        .from(crmOrganisations)
        .where(and(...conditions))
        .limit(1);
      
      if (!existing) {
        res.status(404).json({ error: "Organisation not found" });
        return;
      }
      
      const updateBody = { ...req.body };
      const dateFields = ["insuranceExpiration", "wcInsuranceExpiration", "licenseExpiration", "contractExpiration", "deletedAt"] as const;
      for (const f of dateFields) {
        if (updateBody[f] && typeof updateBody[f] === "string") {
          const d = new Date(updateBody[f]);
          updateBody[f] = isNaN(d.getTime()) ? undefined : d;
        }
      }

      const validationResult = insertCrmOrganisationSchema.partial().safeParse(updateBody);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }
      
      const { organizationId: _, ...safeData } = validationResult.data;

      let updated: typeof existing;
      try {
        updated = await db.transaction(async (tx) => {
          const [u] = await tx
            .update(crmOrganisations)
            .set({
              ...safeData,
              updatedAt: new Date(),
            })
            .where(eq(crmOrganisations.id, req.params.id))
            .returning();

          if (req.body?.customFields !== undefined && orgId) {
            const cfRes = await upsertCustomFieldValues({
              orgId,
              entityType: "ORGANISATION",
              entityId: u.id,
              customFields: req.body.customFields,
              executor: tx,
            });
            if (!cfRes.ok) throw new Error(`__CF_VALIDATION__:${cfRes.error}`);
          }
          return u;
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("__CF_VALIDATION__:")) {
          return res.status(400).json({ error: msg.slice("__CF_VALIDATION__:".length) });
        }
        throw e;
      }

      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "crm_organisations",
        entityId: updated.id,
        oldValue: JSON.stringify({ name: existing.name, type: existing.type }),
        newValue: JSON.stringify({ name: updated.name, type: updated.type }),
      });

      const customFields = orgId ? await getCustomFieldsMap(orgId, "ORGANISATION", updated.id) : {};
      res.json({ ...updated, customFields });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/crm/organisations/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const conditions = [eq(crmOrganisations.id, req.params.id)];
      
      if (shouldFilter && orgId) {
        conditions.push(eq(crmOrganisations.organizationId, orgId));
      }
      
      const [existing] = await db
        .select()
        .from(crmOrganisations)
        .where(and(...conditions))
        .limit(1);
      
      if (!existing) {
        res.status(404).json({ error: "Organisation not found" });
        return;
      }
      
      await db.transaction(async (tx) => {
        await deleteCustomFieldValuesForEntity(existing.organizationId, "ORGANISATION", existing.id, tx);
        await tx.delete(crmOrganisations).where(and(...conditions));
      });

      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "DELETE",
        entityType: "crm_organisations",
        entityId: existing.id,
        oldValue: JSON.stringify({ name: existing.name, type: existing.type }),
      });
      
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/crm/organisations/:id/notes", requireAuth, requireRole("ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
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
      
      const notes = await db
        .select({
          id: crmOrganisationNotes.id,
          organisationId: crmOrganisationNotes.organisationId,
          contactId: crmOrganisationNotes.contactId,
          noteType: crmOrganisationNotes.noteType,
          content: crmOrganisationNotes.content,
          createdById: crmOrganisationNotes.createdById,
          createdAt: crmOrganisationNotes.createdAt,
          createdByFirstName: users.firstName,
          createdByLastName: users.lastName,
          contactFirstName: crmContacts.firstName,
          contactLastName: crmContacts.lastName,
        })
        .from(crmOrganisationNotes)
        .leftJoin(users, eq(users.id, crmOrganisationNotes.createdById))
        .leftJoin(crmContacts, eq(crmContacts.id, crmOrganisationNotes.contactId))
        .where(eq(crmOrganisationNotes.organisationId, req.params.id))
        .orderBy(desc(crmOrganisationNotes.createdAt));

      res.json(notes);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/crm/organisations/:id/notes", requireAuth, requireRole("ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess || !orgId) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const orgConditions = [eq(crmOrganisations.id, req.params.id)];
      if (shouldFilter && orgId) {
        orgConditions.push(eq(crmOrganisations.organizationId, orgId));
      }
      
      const [organisation] = await db
        .select()
        .from(crmOrganisations)
        .where(and(...orgConditions))
        .limit(1);

      if (!organisation) {
        res.status(404).json({ error: "Organisation not found" });
        return;
      }

      const validationResult = insertCrmOrganisationNoteSchema.safeParse({
        ...req.body,
        organizationId: orgId,
        organisationId: req.params.id,
        createdById: req.user!.id,
      });

      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newNote] = await db
        .insert(crmOrganisationNotes)
        .values(validationResult.data)
        .returning();

      const [noteWithDetails] = await db
        .select({
          id: crmOrganisationNotes.id,
          organisationId: crmOrganisationNotes.organisationId,
          contactId: crmOrganisationNotes.contactId,
          noteType: crmOrganisationNotes.noteType,
          content: crmOrganisationNotes.content,
          createdById: crmOrganisationNotes.createdById,
          createdAt: crmOrganisationNotes.createdAt,
          createdByFirstName: users.firstName,
          createdByLastName: users.lastName,
          contactFirstName: crmContacts.firstName,
          contactLastName: crmContacts.lastName,
        })
        .from(crmOrganisationNotes)
        .leftJoin(users, eq(users.id, crmOrganisationNotes.createdById))
        .leftJoin(crmContacts, eq(crmContacts.id, crmOrganisationNotes.contactId))
        .where(eq(crmOrganisationNotes.id, newNote.id));

      res.status(201).json(noteWithDetails);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/crm/organisations/:orgId/notes/:noteId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const conditions = [
        eq(crmOrganisationNotes.id, req.params.noteId),
        eq(crmOrganisationNotes.organisationId, req.params.orgId)
      ];
      if (shouldFilter && orgId) {
        conditions.push(eq(crmOrganisationNotes.organizationId, orgId));
      }
      
      const [existing] = await db
        .select()
        .from(crmOrganisationNotes)
        .where(and(...conditions))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Note not found" });
        return;
      }

      await db.delete(crmOrganisationNotes).where(and(...conditions));

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/crm/search", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { type, query } = req.query;
      
      if (!query || (query as string).length < 2) {
        res.json({ organisations: [], contacts: [] });
        return;
      }
      
      const conditions: SQL[] = [
        eq(crmOrganisations.isActive, true),
        sql`LOWER(${crmOrganisations.name}) LIKE LOWER(${'%' + query + '%'})`,
      ];
      
      if (shouldFilter && orgId) {
        conditions.push(eq(crmOrganisations.organizationId, orgId));
      }
      
      if (type) {
        conditions.push(sql`${crmOrganisations.type} = ${type}`);
      }
      
      const organisations = await db
        .select({
          id: crmOrganisations.id,
          type: crmOrganisations.type,
          name: crmOrganisations.name,
          city: crmOrganisations.city,
          state: crmOrganisations.state,
        })
        .from(crmOrganisations)
        .where(and(...conditions))
        .orderBy(crmOrganisations.name)
        .limit(20);
      
      res.json({ organisations });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/crm/organisations/:id/communications", requireAuth, requireRole("ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId: userOrgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }

      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
      const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.pageSize || "20"), 10)));
      const offset = (page - 1) * pageSize;

      const crmOrgConditions = [eq(crmOrganisations.id, req.params.id)];
      if (shouldFilter && userOrgId) {
        crmOrgConditions.push(eq(crmOrganisations.organizationId, userOrgId));
      }

      const [crmOrg] = await db
        .select({ id: crmOrganisations.id, activeProjectIds: crmOrganisations.activeProjectIds })
        .from(crmOrganisations)
        .where(and(...crmOrgConditions))
        .limit(1);

      if (!crmOrg) {
        return res.status(404).json({ error: "Organisation not found" });
      }

      const threadConditions: SQL[] = [eq(emailThreads.vendorId, crmOrg.id)];
      if (shouldFilter && userOrgId) {
        threadConditions.push(eq(emailThreads.organizationId, userOrgId));
      }

      const [totalRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(emailThreads)
        .where(and(...threadConditions));
      const totalEmails = totalRow?.count ?? 0;

      const threads = await db
        .select({
          id: emailThreads.id,
          subject: emailThreads.subject,
          lastMessageAt: emailThreads.lastMessageAt,
          messageCount: emailThreads.messageCount,
          aiSummary: emailThreads.aiSummary,
          status: emailThreads.status,
        })
        .from(emailThreads)
        .where(and(...threadConditions))
        .orderBy(desc(emailThreads.lastMessageAt))
        .limit(pageSize)
        .offset(offset);

      const emailRows: Array<{
        threadId: string;
        subject: string;
        lastMessageAt: Date;
        messageCount: number;
        aiSummary: string | null;
        status: string;
        fromAddress: string | null;
        fromName: string | null;
        snippet: string | null;
        receivedAt: Date | null;
      }> = [];

      for (const thread of threads) {
        const [latestMsg] = await db
          .select({
            fromAddress: emailMessages.fromAddress,
            fromName: emailMessages.fromName,
            snippet: emailMessages.snippet,
            receivedAt: emailMessages.receivedAt,
          })
          .from(emailMessages)
          .where(eq(emailMessages.threadId, thread.id))
          .orderBy(desc(emailMessages.receivedAt))
          .limit(1);

        emailRows.push({
          threadId: thread.id,
          subject: thread.subject,
          lastMessageAt: thread.lastMessageAt,
          messageCount: thread.messageCount,
          aiSummary: thread.aiSummary,
          status: thread.status,
          fromAddress: latestMsg?.fromAddress ?? null,
          fromName: latestMsg?.fromName ?? null,
          snippet: latestMsg?.snippet ?? null,
          receivedAt: latestMsg?.receivedAt ?? null,
        });
      }

      const now = new Date();
      const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      // Step 1: Collect CRM org's contact emails to find matching internal users
      const contacts = await db
        .select({ email: crmContacts.email })
        .from(crmContacts)
        .where(and(eq(crmContacts.organisationId, crmOrg.id), isNotNull(crmContacts.email)));
      const contactEmails = contacts.map((c) => c.email).filter(Boolean) as string[];

      // Step 2: Find internal users whose email matches a CRM contact, scoped to requester's org
      let contactUserIds: string[] = [];
      if (contactEmails.length > 0) {
        const userConditions: SQL[] = [inArray(users.email, contactEmails)];
        if (shouldFilter && userOrgId) {
          userConditions.push(eq(users.organizationId, userOrgId));
        }
        const matchedUsers = await db
          .select({ id: users.id })
          .from(users)
          .where(and(...userConditions));
        contactUserIds = matchedUsers.map((u) => u.id);
      }

      // Step 3: Validate activeProjectIds belong to the requester's org (security isolation)
      const rawProjectIds = (crmOrg.activeProjectIds ?? []).filter(Boolean);
      let validatedProjectIds: string[] = [];
      if (rawProjectIds.length > 0 && userOrgId) {
        const validProjects = await db
          .select({ id: projects.id })
          .from(projects)
          .where(and(
            inArray(projects.id, rawProjectIds),
            eq(projects.gcOrganizationId, userOrgId)
          ));
        validatedProjectIds = validProjects.map((p) => p.id);
      } else if (rawProjectIds.length > 0 && !shouldFilter) {
        // Super admin: trust the project IDs without org check
        validatedProjectIds = rawProjectIds;
      }

      // Step 4: Build OR linkage conditions for calendar events
      // - Direct org link (crmOrganisationId)
      // - Contact-participant link (userId matches a contact's internal user)
      // - Project-based fallback (project validated to requester's org)
      const linkageConditions: SQL[] = [eq(calendarEvents.crmOrganisationId, crmOrg.id)];
      if (contactUserIds.length > 0) {
        linkageConditions.push(inArray(calendarEvents.userId, contactUserIds));
      }
      if (validatedProjectIds.length > 0) {
        linkageConditions.push(inArray(calendarEvents.projectId, validatedProjectIds));
      }

      const upcomingEvents = await db
        .select({
          id: calendarEvents.id,
          title: calendarEvents.title,
          description: calendarEvents.description,
          startDate: calendarEvents.startDate,
          endDate: calendarEvents.endDate,
          allDay: calendarEvents.allDay,
          eventType: calendarEvents.eventType,
          projectId: calendarEvents.projectId,
          crmOrganisationId: calendarEvents.crmOrganisationId,
        })
        .from(calendarEvents)
        .where(
          and(
            gte(calendarEvents.startDate, now),
            lte(calendarEvents.startDate, thirtyDaysOut),
            or(...linkageConditions)
          )
        )
        .orderBy(calendarEvents.startDate)
        .limit(10);

      res.json({
        emails: emailRows,
        upcomingEvents,
        pagination: {
          page,
          pageSize,
          total: totalEmails,
          hasMore: offset + emailRows.length < totalEmails,
        },
      });
    } catch (error) {
      next(error);
    }
  });

// ========================================
// Routes from crmContactRoutes.ts
// ========================================

const CONTACT_READ_ROLES = [
  "ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT",
] as const;

router.get("/api/crm/contacts", requireAuth, requireRole(...CONTACT_READ_ROLES), async (req: AuthRequest, res, next) => {
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

    if (orgId) {
      const cfFilter = await getEntityIdsMatchingCustomFieldFilters(orgId, "CONTACT", req.query as Record<string, any>);
      if (cfFilter.applies) {
        if (cfFilter.ids.length === 0) return res.json([]);
        conditions.push(inArray(crmContacts.id, cfFilter.ids));
      }
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
        timezone: crmContacts.timezone,
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

    if (orgId && contacts.length) {
      const cfMap = await getCustomFieldsMapBatch(orgId, "CONTACT", contacts.map(c => c.id));
      return res.json(contacts.map(c => ({ ...c, customFields: cfMap[c.id] ?? {} })));
    }
    res.json(contacts);
  } catch (error) {
    next(error);
  }
});

router.get("/api/crm/organisations/:id/contacts", requireAuth, requireRole(...CONTACT_READ_ROLES), async (req: AuthRequest, res, next) => {
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
    next(error);
  }
});

router.post("/api/crm/contacts", requireAuth, requireRole("ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
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
      timezone: typeof req.body?.timezone === "string" && req.body.timezone.trim() === ""
        ? null
        : req.body?.timezone,
      organizationId: orgId,
      createdById: req.user!.id,
    });

    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    let newContact: typeof crmContacts.$inferSelect;
    try {
      newContact = await db.transaction(async (tx) => {
        if (validationResult.data.isPrimary) {
          await tx
            .update(crmContacts)
            .set({ isPrimary: false })
            .where(eq(crmContacts.organisationId, validationResult.data.organisationId));
        }
        const [n] = await tx
          .insert(crmContacts)
          .values(validationResult.data)
          .returning();
        const cfRes = await upsertCustomFieldValues({
          orgId: orgId!,
          entityType: "CONTACT",
          entityId: n.id,
          customFields: req.body?.customFields,
          executor: tx,
        });
        if (!cfRes.ok) throw new Error(`__CF_VALIDATION__:${cfRes.error}`);
        return n;
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("__CF_VALIDATION__:")) {
        return res.status(400).json({ error: msg.slice("__CF_VALIDATION__:".length) });
      }
      throw e;
    }

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "crm_contacts",
      entityId: newContact.id,
      newValue: JSON.stringify({ firstName: newContact.firstName, lastName: newContact.lastName }),
    });

    const customFields = await getCustomFieldsMap(orgId!, "CONTACT", newContact.id);
    res.status(201).json({ ...newContact, customFields });
  } catch (error) {
    next(error);
  }
});

router.get("/api/crm/contacts/:id", requireAuth, requireRole("ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied - no organization" });
    const conditions = [eq(crmContacts.id, req.params.id)];
    if (shouldFilter && orgId) conditions.push(eq(crmContacts.organizationId, orgId));
    const [contact] = await db.select().from(crmContacts).where(and(...conditions)).limit(1);
    if (!contact) return res.status(404).json({ error: "Contact not found" });
    res.json(contact);
  } catch (error) {
    next(error);
  }
});

router.put("/api/crm/contacts/:id", requireAuth, requireRole("ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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

    const updateBody = {
      ...req.body,
      ...(typeof req.body?.timezone === "string" && req.body.timezone.trim() === ""
        ? { timezone: null }
        : {}),
    };
    const validationResult = insertCrmContactSchema.partial().safeParse(updateBody);
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const { organizationId: _, ...safeData } = validationResult.data;

    let updated: typeof existing;
    try {
      updated = await db.transaction(async (tx) => {
        if (safeData.isPrimary) {
          const primaryConditions: SQL[] = [
            eq(crmContacts.organisationId, existing.organisationId),
            sql`${crmContacts.id} != ${req.params.id}`,
          ];
          if (shouldFilter && orgId) primaryConditions.push(eq(crmContacts.organizationId, orgId));
          await tx.update(crmContacts).set({ isPrimary: false }).where(and(...primaryConditions));
        }

        const [u] = await tx
          .update(crmContacts)
          .set({ ...safeData, updatedAt: new Date() })
          .where(eq(crmContacts.id, req.params.id))
          .returning();

        if (req.body?.customFields !== undefined && orgId) {
          const cfRes = await upsertCustomFieldValues({
            orgId,
            entityType: "CONTACT",
            entityId: u.id,
            customFields: req.body.customFields,
            executor: tx,
          });
          if (!cfRes.ok) throw new Error(`__CF_VALIDATION__:${cfRes.error}`);
        }
        return u;
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("__CF_VALIDATION__:")) {
        return res.status(400).json({ error: msg.slice("__CF_VALIDATION__:".length) });
      }
      throw e;
    }

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "crm_contacts",
      entityId: updated.id,
      oldValue: JSON.stringify({ firstName: existing.firstName, lastName: existing.lastName }),
      newValue: JSON.stringify({ firstName: updated.firstName, lastName: updated.lastName }),
    });

    const customFields = orgId ? await getCustomFieldsMap(orgId, "CONTACT", updated.id) : {};
    res.json({ ...updated, customFields });
  } catch (error) {
    next(error);
  }
});

router.delete("/api/crm/contacts/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
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

    await db.transaction(async (tx) => {
      await deleteCustomFieldValuesForEntity(existing.organizationId, "CONTACT", existing.id, tx);
      await tx.delete(crmContacts).where(and(...conditions));
    });

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "DELETE",
      entityType: "crm_contacts",
      entityId: existing.id,
      oldValue: JSON.stringify({ firstName: existing.firstName, lastName: existing.lastName }),
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ========================================
// Routes from crmPipelineRoutes.ts
// ========================================

const PIPELINE_ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR"] as const;
const EDIT_ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR"] as const;
const DELETE_ROLES = ["ADMIN", "MANAGER"] as const;

const STAGE_LABELS: Record<string, string> = {
  LEAD: "Lead",
  QUALIFIED: "Qualified",
  ESTIMATING: "Estimating",
  BID_SUBMITTED: "Bid Submitted",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  LOST: "Lost",
};

router.get("/api/crm/pipeline/users", requireAuth, requireRole(...PIPELINE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions: SQL[] = [];
    if (shouldFilter && orgId) conditions.push(eq(users.organizationId, orgId));
    conditions.push(eq(users.isActive, true));

    const orgUsers = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
      .from(users)
      .where(and(...conditions))
      .orderBy(asc(users.firstName));

    res.json(orgUsers);
  } catch (error) {
    next(error);
  }
});

router.get("/api/crm/pipeline/stats", requireAuth, requireRole(...PIPELINE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions: SQL[] = [];
    if (shouldFilter && orgId) conditions.push(eq(crmOpportunities.organizationId, orgId));

    const opps = await db
      .select({
        stage: crmOpportunities.stage,
        dealValue: crmOpportunities.dealValue,
        probability: crmOpportunities.probability,
      })
      .from(crmOpportunities)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    let totalValue = 0;
    let weightedValue = 0;
    let wonValue = 0;
    let wonCount = 0;
    let lostCount = 0;
    const stageCounts: Record<string, number> = {};
    const stageValues: Record<string, number> = {};

    for (const opp of opps) {
      const val = parseFloat(opp.dealValue ?? "0") || 0;
      const prob = opp.probability ?? 10;
      stageCounts[opp.stage] = (stageCounts[opp.stage] ?? 0) + 1;
      stageValues[opp.stage] = (stageValues[opp.stage] ?? 0) + val;

      if (opp.stage !== "WON" && opp.stage !== "LOST") {
        totalValue += val;
        weightedValue += val * prob / 100;
      }
      if (opp.stage === "WON") { wonValue += val; wonCount++; }
      if (opp.stage === "LOST") lostCount++;
    }

    const winRate = (wonCount + lostCount) > 0 ? Math.round(wonCount / (wonCount + lostCount) * 100) : 0;

    res.json({
      totalValue,
      weightedValue,
      wonValue,
      winRate,
      openDeals: opps.filter(o => o.stage !== "WON" && o.stage !== "LOST").length,
      totalDeals: opps.length,
      stageCounts,
      stageValues,
    });
  } catch (error) {
    next(error);
  }
});

const oppSelectFields = {
  id: crmOpportunities.id,
  organizationId: crmOpportunities.organizationId,
  name: crmOpportunities.name,
  stage: crmOpportunities.stage,
  dealValue: crmOpportunities.dealValue,
  probability: crmOpportunities.probability,
  crmOrganisationId: crmOpportunities.crmOrganisationId,
  contactId: crmOpportunities.contactId,
  assignedToId: crmOpportunities.assignedToId,
  projectType: crmOpportunities.projectType,
  projectLocation: crmOpportunities.projectLocation,
  expectedCloseDate: crmOpportunities.expectedCloseDate,
  source: crmOpportunities.source,
  notes: crmOpportunities.notes,
  lostReason: crmOpportunities.lostReason,
  aiWinProbability: crmOpportunities.aiWinProbability,
  aiWinProbabilityRationale: crmOpportunities.aiWinProbabilityRationale,
  createdById: crmOpportunities.createdById,
  createdAt: crmOpportunities.createdAt,
  updatedAt: crmOpportunities.updatedAt,
  crmOrgName: crmOrganisations.name,
  contactFirstName: crmContacts.firstName,
  contactLastName: crmContacts.lastName,
  assignedFirstName: users.firstName,
  assignedLastName: users.lastName,
};

function buildOppBaseQuery() {
  return db
    .select(oppSelectFields)
    .from(crmOpportunities)
    .leftJoin(crmOrganisations, eq(crmOrganisations.id, crmOpportunities.crmOrganisationId))
    .leftJoin(crmContacts, eq(crmContacts.id, crmOpportunities.contactId))
    .leftJoin(users, eq(users.id, crmOpportunities.assignedToId));
}

router.get("/api/crm/opportunities", requireAuth, requireRole(...PIPELINE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const { stage, assignedToId, search, page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: SQL[] = [];
    if (shouldFilter && orgId) conditions.push(eq(crmOpportunities.organizationId, orgId));
    if (stage && stage !== "all") {
      conditions.push(sql`${crmOpportunities.stage} = ${stage}`);
    }
    if (assignedToId && assignedToId !== "all") {
      conditions.push(eq(crmOpportunities.assignedToId, assignedToId));
    }
    if (search) {
      const term = `%${search}%`;
      conditions.push(
        or(
          ilike(crmOpportunities.name, term),
          ilike(crmOpportunities.projectType, term),
          ilike(crmOpportunities.projectLocation, term),
        ) as SQL
      );
    }

    if (orgId) {
      const cfFilter = await getEntityIdsMatchingCustomFieldFilters(orgId, "OPPORTUNITY", req.query as Record<string, any>);
      if (cfFilter.applies) {
        if (cfFilter.ids.length === 0) return res.json([]);
        conditions.push(inArray(crmOpportunities.id, cfFilter.ids));
      }
    }

    const results = await buildOppBaseQuery()
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(crmOpportunities.updatedAt))
      .limit(limitNum)
      .offset(offset);

    if (orgId && results.length) {
      const cfMap = await getCustomFieldsMapBatch(orgId, "OPPORTUNITY", results.map((r: any) => r.id));
      res.json(results.map((r: any) => ({ ...r, customFields: cfMap[r.id] ?? {} })));
      return;
    }
    res.json(results);
  } catch (error) {
    next(error);
  }
});

router.get("/api/crm/opportunities/:id", requireAuth, requireRole(...PIPELINE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions: SQL[] = [eq(crmOpportunities.id, req.params.id)];
    if (shouldFilter && orgId) conditions.push(eq(crmOpportunities.organizationId, orgId));

    const [opp] = await buildOppBaseQuery()
      .where(and(...conditions))
      .limit(1);

    if (!opp) return res.status(404).json({ error: "Opportunity not found" });

    const orgIdEffective = orgId ?? opp.organizationId;
    const customFields = orgIdEffective
      ? await getCustomFieldsMap(orgIdEffective, "OPPORTUNITY", opp.id)
      : {};
    res.json({ ...opp, customFields });
  } catch (error) {
    next(error);
  }
});

router.post("/api/crm/opportunities", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const parsed = insertCrmOpportunitySchema.safeParse({
      ...req.body,
      organizationId: orgId,
      createdById: req.user!.id,
    });

    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

    // Auto-assignment: if no assignedToId provided, evaluate rules
    let toInsert = parsed.data;
    if (!toInsert.assignedToId) {
      const autoAssignedTo = await evaluateAssignment(orgId, {
        source: toInsert.source,
        projectType: toInsert.projectType,
        projectLocation: toInsert.projectLocation,
        dealValue: toInsert.dealValue,
      });
      if (autoAssignedTo) toInsert = { ...toInsert, assignedToId: autoAssignedTo };
    }

    // Auto lead-scoring
    try {
      const score = await scoreOpportunity(orgId, toInsert);
      toInsert = { ...toInsert, leadScore: score };
    } catch { /* non-fatal */ }

    let created: typeof crmOpportunities.$inferSelect;
    try {
      created = await db.transaction(async (tx) => {
        const [c] = await tx.insert(crmOpportunities).values(toInsert).returning();
        const cfRes = await upsertCustomFieldValues({
          orgId,
          entityType: "OPPORTUNITY",
          entityId: c.id,
          customFields: req.body?.customFields,
          executor: tx,
        });
        if (!cfRes.ok) throw new Error(`__CF_VALIDATION__:${cfRes.error}`);
        return c;
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("__CF_VALIDATION__:")) {
        return res.status(400).json({ error: msg.slice("__CF_VALIDATION__:".length) });
      }
      throw e;
    }

    await db.insert(crmOpportunityActivities).values({
      opportunityId: created.id,
      activityType: "NOTE",
      description: `Opportunity created at stage: ${STAGE_LABELS[created.stage] ?? created.stage}`,
      createdById: req.user!.id,
    });

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "crm_opportunities",
      entityId: created.id,
      newValue: JSON.stringify({ name: created.name, stage: created.stage }),
    });

    await eventBus.emit({
      type: "crm.opportunity_created",
      version: 1,
      orgId,
      actorId: req.user!.id,
      timestamp: new Date(),
      payload: { opportunityId: created.id, name: created.name, stage: created.stage },
    });

    const customFields = await getCustomFieldsMap(orgId, "OPPORTUNITY", created.id);
    res.status(201).json({ ...created, customFields });
  } catch (error) {
    next(error);
  }
});

router.patch("/api/crm/opportunities/:id", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions: SQL[] = [eq(crmOpportunities.id, req.params.id)];
    if (shouldFilter && orgId) conditions.push(eq(crmOpportunities.organizationId, orgId));

    const [existing] = await db.select().from(crmOpportunities).where(and(...conditions)).limit(1);
    if (!existing) return res.status(404).json({ error: "Opportunity not found" });

    const parsed = insertCrmOpportunitySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

    const { organizationId: _orgId, ...safeData } = parsed.data;

    // Win/loss timestamps + leadScore recalc on stage change
    const stageChange = safeData.stage && safeData.stage !== existing.stage;
    const patchExtras: Record<string, unknown> = {};
    if (stageChange) {
      patchExtras.stageEnteredAt = new Date();
      patchExtras.slaBreachedAt = null;
      patchExtras.needsAttentionReason = null;
      if (safeData.stage === "WON" && !existing.wonAt) {
        // Approval gating for high-value won deals
        const wonThreshold = Number(process.env.CRM_OPPORTUNITY_WON_APPROVAL_THRESHOLD ?? "100000");
        const dealValue = Number(existing.dealValue ?? 0);
        if (dealValue >= wonThreshold) {
          const { createApprovalRequest, getApprovalStatus } = await import("./services/approvalService");
          const pending = await getApprovalStatus(existing.organizationId, "CRM_OPPORTUNITY", existing.id);
          if (!pending || pending.status === "rejected") {
            const approval = await createApprovalRequest(existing.organizationId, "CRM_OPPORTUNITY" as any, existing.id, req.user!.id, `Mark "${existing.name}" Won (deal value ${dealValue.toFixed(2)}) requires manager approval`);
            return res.status(202).json({ ok: false, requiresApproval: true, approvalId: approval.id });
          }
          if (pending.status === "pending") {
            return res.status(409).json({ error: "Won transition pending approval", approvalId: pending.id });
          }
        }
        patchExtras.wonAt = new Date();
      }
      if (safeData.stage === "LOST" && !existing.lostAt) patchExtras.lostAt = new Date();
    }
    // Recalc leadScore if any scorable field changed
    try {
      const merged = { ...existing, ...safeData };
      const score = await scoreOpportunity(existing.organizationId, merged as any);
      patchExtras.leadScore = score;
    } catch { /* non-fatal */ }

    let updated: typeof existing;
    try {
      updated = await db.transaction(async (tx) => {
        const [u] = await tx
          .update(crmOpportunities)
          .set({ ...safeData, ...patchExtras, updatedAt: new Date() })
          .where(eq(crmOpportunities.id, req.params.id))
          .returning();

        if (req.body?.customFields !== undefined && orgId) {
          const cfRes = await upsertCustomFieldValues({
            orgId,
            entityType: "OPPORTUNITY",
            entityId: u.id,
            customFields: req.body.customFields,
            executor: tx,
          });
          if (!cfRes.ok) throw new Error(`__CF_VALIDATION__:${cfRes.error}`);
        }
        return u;
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("__CF_VALIDATION__:")) {
        return res.status(400).json({ error: msg.slice("__CF_VALIDATION__:".length) });
      }
      throw e;
    }

    if (safeData.stage && safeData.stage !== existing.stage) {
      await db.insert(crmOpportunityActivities).values({
        opportunityId: existing.id,
        activityType: "NOTE",
        description: `[Stage Change] ${STAGE_LABELS[existing.stage] ?? existing.stage} → ${STAGE_LABELS[safeData.stage] ?? safeData.stage}`,
        createdById: req.user!.id,
      });

      const assigneeId = updated.assignedToId;
      if (assigneeId) {
        const [orgSetting] = await db
          .select({ notifyInApp: organizationNetworkSettings.notifyInApp })
          .from(organizationNetworkSettings)
          .where(eq(organizationNetworkSettings.organizationId, updated.organizationId))
          .limit(1);
        const inAppEnabled = orgSetting?.notifyInApp ?? true;
        if (inAppEnabled) {
          await insertNotification({
            userId: assigneeId,
            organizationId: updated.organizationId,
            type: "CRM_STAGE_CHANGE",
            title: "Pipeline stage updated",
            message: `"${updated.name}" moved to ${STAGE_LABELS[updated.stage] ?? updated.stage}`,
            relatedEntityId: updated.id,
            relatedEntityType: "CRM_OPPORTUNITY",
          });
        }
      }

      await eventBus.emit({
        type: "crm.opportunity_stage_changed",
        version: 1,
        orgId: updated.organizationId,
        actorId: req.user!.id,
        timestamp: new Date(),
        payload: {
          opportunityId: updated.id,
          name: updated.name,
          oldStage: existing.stage,
          newStage: safeData.stage,
        },
      });

      // Fire CRM automations on stage change
      try {
        const { runAutomationsForTrigger } = await import("./services/crmAutomationEngine");
        await runAutomationsForTrigger({
          orgId: updated.organizationId,
          trigger: "STAGE_CHANGE",
          entityType: "OPPORTUNITY",
          entityId: updated.id,
          context: { oldStage: existing.stage, newStage: updated.stage, score: updated.leadScore ?? 0 },
        });
      } catch { /* non-fatal */ }
    }

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "crm_opportunities",
      entityId: updated.id,
      oldValue: JSON.stringify({ stage: existing.stage }),
      newValue: JSON.stringify({ stage: updated.stage }),
    });

    const customFields = orgId
      ? await getCustomFieldsMap(orgId, "OPPORTUNITY", updated.id)
      : {};
    res.json({ ...updated, customFields });
  } catch (error) {
    next(error);
  }
});

router.delete("/api/crm/opportunities/:id", requireAuth, requireRole(...DELETE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions: SQL[] = [eq(crmOpportunities.id, req.params.id)];
    if (shouldFilter && orgId) conditions.push(eq(crmOpportunities.organizationId, orgId));

    const [existing] = await db.select().from(crmOpportunities).where(and(...conditions)).limit(1);
    if (!existing) return res.status(404).json({ error: "Opportunity not found" });

    await db.transaction(async (tx) => {
      await deleteCustomFieldValuesForEntity(existing.organizationId, "OPPORTUNITY", existing.id, tx);
      await tx.delete(crmOpportunities).where(and(...conditions));
    });

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "DELETE",
      entityType: "crm_opportunities",
      entityId: existing.id,
      oldValue: JSON.stringify({ name: existing.name }),
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get("/api/crm/opportunities/:id/activities", requireAuth, requireRole(...PIPELINE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const oppConditions: SQL[] = [eq(crmOpportunities.id, req.params.id)];
    if (shouldFilter && orgId) oppConditions.push(eq(crmOpportunities.organizationId, orgId));

    const [opp] = await db.select().from(crmOpportunities).where(and(...oppConditions)).limit(1);
    if (!opp) return res.status(404).json({ error: "Opportunity not found" });

    const createdByAlias = db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
    }).from(users).as("creator");

    const activities = await db
      .select({
        id: crmOpportunityActivities.id,
        opportunityId: crmOpportunityActivities.opportunityId,
        activityType: crmOpportunityActivities.activityType,
        description: crmOpportunityActivities.description,
        scheduledAt: crmOpportunityActivities.scheduledAt,
        completedAt: crmOpportunityActivities.completedAt,
        createdById: crmOpportunityActivities.createdById,
        createdAt: crmOpportunityActivities.createdAt,
        createdByFirstName: createdByAlias.firstName,
        createdByLastName: createdByAlias.lastName,
      })
      .from(crmOpportunityActivities)
      .leftJoin(createdByAlias, eq(createdByAlias.id, crmOpportunityActivities.createdById))
      .where(eq(crmOpportunityActivities.opportunityId, req.params.id))
      .orderBy(desc(crmOpportunityActivities.createdAt));

    res.json(activities);
  } catch (error) {
    next(error);
  }
});

router.post("/api/crm/opportunities/:id/activities", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const oppConditions: SQL[] = [eq(crmOpportunities.id, req.params.id)];
    if (shouldFilter) oppConditions.push(eq(crmOpportunities.organizationId, orgId));

    const [opp] = await db.select().from(crmOpportunities).where(and(...oppConditions)).limit(1);
    if (!opp) return res.status(404).json({ error: "Opportunity not found" });

    const parsed = insertCrmOpportunityActivitySchema.safeParse({
      ...req.body,
      opportunityId: req.params.id,
      createdById: req.user!.id,
    });

    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

    const [created] = await db.insert(crmOpportunityActivities).values(parsed.data).returning();

    const createdByAlias = db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
    }).from(users).as("creator");

    const [withUser] = await db
      .select({
        id: crmOpportunityActivities.id,
        opportunityId: crmOpportunityActivities.opportunityId,
        activityType: crmOpportunityActivities.activityType,
        description: crmOpportunityActivities.description,
        scheduledAt: crmOpportunityActivities.scheduledAt,
        completedAt: crmOpportunityActivities.completedAt,
        createdById: crmOpportunityActivities.createdById,
        createdAt: crmOpportunityActivities.createdAt,
        createdByFirstName: createdByAlias.firstName,
        createdByLastName: createdByAlias.lastName,
      })
      .from(crmOpportunityActivities)
      .leftJoin(createdByAlias, eq(createdByAlias.id, crmOpportunityActivities.createdById))
      .where(eq(crmOpportunityActivities.id, created.id));

    await eventBus.emit({
      type: "crm.activity_created",
      version: 1,
      orgId,
      actorId: req.user!.id,
      timestamp: new Date(),
      payload: { opportunityId: req.params.id, activityType: created.activityType },
    });

    res.status(201).json(withUser);
  } catch (error) {
    next(error);
  }
});

const BID_CODE_START = 260001;
async function getNextProjectCode(): Promise<string> {
  const result = await db.execute(sql`
    SELECT GREATEST(
      COALESCE((SELECT MAX(CAST(code AS INTEGER)) FROM bids WHERE code ~ '^[0-9]+$' AND CAST(code AS INTEGER) >= ${BID_CODE_START}), ${BID_CODE_START - 1}),
      COALESCE((SELECT MAX(CAST(code AS INTEGER)) FROM projects WHERE code ~ '^[0-9]+$' AND CAST(code AS INTEGER) >= ${BID_CODE_START}), ${BID_CODE_START - 1})
    ) as max_code
  `);
  const maxCode = Number(result.rows[0]?.max_code) || BID_CODE_START - 1;
  return String(maxCode + 1);
}

router.post("/api/crm/opportunities/:id/convert-to-project", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const oppConditions: SQL[] = [eq(crmOpportunities.id, req.params.id)];
    if (shouldFilter) oppConditions.push(eq(crmOpportunities.organizationId, orgId));

    const [opp] = await db.select().from(crmOpportunities).where(and(...oppConditions)).limit(1);
    if (!opp) return res.status(404).json({ error: "Opportunity not found" });
    if (opp.stage !== "WON") return res.status(400).json({ error: "Only WON opportunities can be converted to projects" });

    const convertToProjectSchema = z.object({
      name: z.string().max(500).optional(),
      clientName: z.string().max(500).optional(),
      description: z.string().max(5000).optional(),
      startDate: z.string().optional(),
      targetEndDate: z.string().optional(),
      location: z.string().max(1000).optional(),
    });
    const parsed = validateBody(convertToProjectSchema, req.body || {}, res);
    if (!parsed) return;
    const { name, clientName, description, startDate, targetEndDate, location } = parsed;

    const code = await getNextProjectCode();

    const [newProject] = await db.insert(projects).values({
      gcOrganizationId: orgId,
      code,
      name: name || opp.name,
      clientName: clientName || opp.crmOrganisationId || "TBD",
      description: description || opp.notes || null,
      locationAddress: location || opp.projectLocation || null,
      startDate: startDate ? new Date(startDate) : null,
      status: "PLANNING",
      contractAmount: opp.dealValue || null,
    }).returning();

    await db.insert(crmOpportunityActivities).values({
      opportunityId: opp.id,
      activityType: "NOTE",
      description: `[Converted] Opportunity converted to project: ${newProject.name} (ID: ${newProject.id})`,
      createdById: req.user!.id,
    });

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "projects",
      entityId: newProject.id,
      newValue: JSON.stringify({ name: newProject.name, fromOpportunity: opp.id }),
    });

    res.status(201).json({ project: newProject, opportunityId: opp.id });
  } catch (error) {
    next(error);
  }
});

router.post("/api/crm/opportunities/:id/create-bid", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const oppConditions: SQL[] = [eq(crmOpportunities.id, req.params.id)];
    if (shouldFilter) oppConditions.push(eq(crmOpportunities.organizationId, orgId));

    const [opp] = await db.select().from(crmOpportunities).where(and(...oppConditions)).limit(1);
    if (!opp) return res.status(404).json({ error: "Opportunity not found" });
    if (opp.stage === "LOST") return res.status(400).json({ error: "Cannot create a bid from a LOST opportunity" });

    const { bids } = await import("@shared/schema");

    const createBidSchema = z.object({
      name: z.string().max(500).optional(),
      description: z.string().max(5000).optional(),
    });
    const parsedBid = validateBody(createBidSchema, req.body || {}, res);
    if (!parsedBid) return;
    const { name, description } = parsedBid;

    const code = await getNextProjectCode();

    const [newBid] = await db.insert(bids).values({
      code,
      name: name || opp.name,
      clientName: opp.name,
      gcOrganizationId: orgId,
      status: "DRAFT",
      estimatorId: req.user!.id,
      locationAddress: opp.projectLocation || null,
      description: description || opp.notes || null,
      crmOpportunityId: opp.id,
      aiWinProbability: opp.aiWinProbability,
    }).returning();

    await db.insert(crmOpportunityActivities).values({
      opportunityId: opp.id,
      activityType: "NOTE",
      description: `[Bid Created] Bid #${newBid.code} "${newBid.name}" created from this opportunity`,
      createdById: req.user!.id,
    });

    if (opp.stage === "LEAD" || opp.stage === "QUALIFIED") {
      await db.update(crmOpportunities)
        .set({ stage: "ESTIMATING", updatedAt: new Date() })
        .where(eq(crmOpportunities.id, opp.id));
    }

    res.status(201).json({ bid: newBid, opportunityId: opp.id });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// CRM PIPELINE REPORTS
// ============================================================

const ORDERED_STAGES = ["LEAD", "QUALIFIED", "ESTIMATING", "BID_SUBMITTED", "NEGOTIATION", "WON", "LOST"];

function parseDays(query: Record<string, string>): number {
  const d = parseInt(query.days ?? "30");
  return [30, 90, 365].includes(d) ? d : 30;
}

// Win/Loss Summary — counts, values, and win rate for closed deals in a date range
router.get("/api/crm/reports/win-loss", requireAuth, requireRole(...PIPELINE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const days = parseDays(req.query as Record<string, string>);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const conditions: SQL[] = [
      sql`${crmOpportunities.stage} IN ('WON','LOST')`,
      sql`${crmOpportunities.updatedAt} >= ${since}`,
    ];
    if (shouldFilter && orgId) conditions.push(eq(crmOpportunities.organizationId, orgId));

    const opps = await db
      .select({
        stage: crmOpportunities.stage,
        dealValue: crmOpportunities.dealValue,
      })
      .from(crmOpportunities)
      .where(and(...conditions));

    let wonCount = 0; let lostCount = 0;
    let wonValue = 0; let lostValue = 0;

    for (const opp of opps) {
      const val = parseFloat(opp.dealValue ?? "0") || 0;
      if (opp.stage === "WON") { wonCount++; wonValue += val; }
      else { lostCount++; lostValue += val; }
    }

    const totalClosed = wonCount + lostCount;
    const winRate = totalClosed > 0 ? Math.round(wonCount / totalClosed * 100) : 0;
    const avgWonDeal = wonCount > 0 ? wonValue / wonCount : 0;
    const avgLostDeal = lostCount > 0 ? lostValue / lostCount : 0;

    res.json({
      days,
      wonCount,
      lostCount,
      totalClosed,
      wonValue,
      lostValue,
      winRate,
      avgWonDeal,
      avgLostDeal,
    });
  } catch (error) {
    next(error);
  }
});

// Time in Stage — average days each opp spent in each stage, derived from stage-change activity logs
router.get("/api/crm/reports/time-in-stage", requireAuth, requireRole(...PIPELINE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const days = parseDays(req.query as Record<string, string>);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const oppConditions: SQL[] = [sql`${crmOpportunities.createdAt} >= ${since}`];
    if (shouldFilter && orgId) oppConditions.push(eq(crmOpportunities.organizationId, orgId));

    // Fetch all opps with their stage-change activities
    const opps = await db
      .select({ id: crmOpportunities.id, stage: crmOpportunities.stage, createdAt: crmOpportunities.createdAt, updatedAt: crmOpportunities.updatedAt })
      .from(crmOpportunities)
      .where(and(...oppConditions));

    if (opps.length === 0) {
      return res.json({ stages: ORDERED_STAGES.map(s => ({ stage: s, label: STAGE_LABELS[s], avgDays: 0, count: 0 })) });
    }

    const oppIds = opps.map(o => o.id);

    // Get all stage-change activities for these opps
    const activities = await db
      .select({
        opportunityId: crmOpportunityActivities.opportunityId,
        description: crmOpportunityActivities.description,
        createdAt: crmOpportunityActivities.createdAt,
      })
      .from(crmOpportunityActivities)
      .where(and(
        sql`${crmOpportunityActivities.opportunityId} = ANY(ARRAY[${sql.join(oppIds.map(id => sql`${id}`), sql`, `)}]::text[])`,
        sql`${crmOpportunityActivities.description} LIKE '[Stage Change]%'`
      ))
      .orderBy(asc(crmOpportunityActivities.createdAt));

    // Build a per-opp timeline of stage transitions
    const stageDurations: Record<string, number[]> = {};
    for (const stage of ORDERED_STAGES) stageDurations[stage] = [];

    const actsByOpp: Record<string, typeof activities> = {};
    for (const act of activities) {
      if (!actsByOpp[act.opportunityId]) actsByOpp[act.opportunityId] = [];
      actsByOpp[act.opportunityId].push(act);
    }

    for (const opp of opps) {
      const acts = actsByOpp[opp.id] ?? [];
      // Build timeline starting from the opp's actual initial stage.
      // The first stage-change activity's "from" label tells us the real starting stage.
      // If no activities exist, the opp has never changed stage.
      type Transition = { stage: string; at: Date };

      // Helper: label→key
      const labelToKey = (label: string): string =>
        Object.entries(STAGE_LABELS).find(([, lbl]) => lbl === label.trim())?.[0] ?? label.trim();

      let initialStage: string;
      if (acts.length > 0) {
        const firstMatch = acts[0].description.match(/\[Stage Change\]\s+(.+?)\s+→\s+(.+)/);
        initialStage = firstMatch ? labelToKey(firstMatch[1]) : opp.stage;
      } else {
        initialStage = opp.stage;
      }

      const timeline: Transition[] = [{ stage: initialStage, at: new Date(opp.createdAt) }];

      for (const act of acts) {
        // description format: "[Stage Change] From → To"
        const match = act.description.match(/\[Stage Change\]\s+(.+?)\s+→\s+(.+)/);
        if (match) {
          const toStage = labelToKey(match[2]);
          timeline.push({ stage: toStage, at: new Date(act.createdAt) });
        }
      }

      // Calculate duration per stage (time until next transition)
      for (let i = 0; i < timeline.length - 1; i++) {
        const fromStage = timeline[i].stage;
        const durationMs = timeline[i + 1].at.getTime() - timeline[i].at.getTime();
        const durationDays = durationMs / (1000 * 60 * 60 * 24);
        if (stageDurations[fromStage]) stageDurations[fromStage].push(durationDays);
      }
      // Last stage: opp.updatedAt - last transition
      const last = timeline[timeline.length - 1];
      const finalDays = (new Date(opp.updatedAt).getTime() - last.at.getTime()) / (1000 * 60 * 60 * 24);
      if (stageDurations[last.stage]) stageDurations[last.stage].push(finalDays);
    }

    const stages = ORDERED_STAGES.map(stage => {
      const durations = stageDurations[stage];
      const avgDays = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
      return { stage, label: STAGE_LABELS[stage], avgDays: Math.round(avgDays * 10) / 10, count: durations.length };
    });

    res.json({ days, stages });
  } catch (error) {
    next(error);
  }
});

// Rep Performance — per-assignee breakdown of open deals, pipeline value, wins, losses, win rate
router.get("/api/crm/reports/rep-performance", requireAuth, requireRole(...PIPELINE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const days = parseDays(req.query as Record<string, string>);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const conditions: SQL[] = [sql`${crmOpportunities.createdAt} >= ${since}`];
    if (shouldFilter && orgId) conditions.push(eq(crmOpportunities.organizationId, orgId));

    const opps = await db
      .select({
        assignedToId: crmOpportunities.assignedToId,
        stage: crmOpportunities.stage,
        dealValue: crmOpportunities.dealValue,
        assignedFirstName: users.firstName,
        assignedLastName: users.lastName,
      })
      .from(crmOpportunities)
      .leftJoin(users, eq(users.id, crmOpportunities.assignedToId))
      .where(and(...conditions));

    const repMap = new Map<string, {
      repId: string; repName: string;
      openCount: number; pipelineValue: number;
      wonCount: number; lostCount: number;
    }>();

    for (const opp of opps) {
      const repId = opp.assignedToId ?? "__unassigned__";
      const repName = opp.assignedToId
        ? `${opp.assignedFirstName ?? ""} ${opp.assignedLastName ?? ""}`.trim()
        : "Unassigned";
      const val = parseFloat(opp.dealValue ?? "0") || 0;

      if (!repMap.has(repId)) {
        repMap.set(repId, { repId, repName, openCount: 0, pipelineValue: 0, wonCount: 0, lostCount: 0 });
      }
      const r = repMap.get(repId)!;
      if (opp.stage === "WON") r.wonCount++;
      else if (opp.stage === "LOST") r.lostCount++;
      else { r.openCount++; r.pipelineValue += val; }
    }

    const reps = Array.from(repMap.values()).map(r => ({
      ...r,
      winRate: (r.wonCount + r.lostCount) > 0
        ? Math.round(r.wonCount / (r.wonCount + r.lostCount) * 100)
        : 0,
    })).sort((a, b) => b.pipelineValue - a.pipelineValue);

    res.json({ days, reps });
  } catch (error) {
    next(error);
  }
});

const PIPELINE_OPEN_STAGES = ["LEAD", "QUALIFIED", "ESTIMATING", "BID_SUBMITTED", "NEGOTIATION"];

router.post("/api/crm/opportunities/:id/rescore", requireAuth, requireRole(...PIPELINE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions: SQL[] = [eq(crmOpportunities.id, req.params.id)];
    if (shouldFilter && orgId) conditions.push(eq(crmOpportunities.organizationId, orgId));

    const [opp] = await db.select().from(crmOpportunities).where(and(...conditions)).limit(1);
    if (!opp) return res.status(404).json({ error: "Opportunity not found" });

    const result = await scoreWinProbability(opp.id);
    res.json({ opportunityId: opp.id, aiWinProbability: result.score, aiWinProbabilityRationale: result.rationale });
  } catch (error) {
    next(error);
  }
});

router.get("/api/crm/reports/revenue-forecast", requireAuth, requireRole(...PIPELINE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions: SQL[] = [
      sql`${crmOpportunities.stage} IN ('LEAD','QUALIFIED','ESTIMATING','BID_SUBMITTED','NEGOTIATION')`,
    ];
    if (shouldFilter && orgId) conditions.push(eq(crmOpportunities.organizationId, orgId));

    const opps = await db
      .select({
        id: crmOpportunities.id,
        name: crmOpportunities.name,
        stage: crmOpportunities.stage,
        dealValue: crmOpportunities.dealValue,
        probability: crmOpportunities.probability,
        aiWinProbability: crmOpportunities.aiWinProbability,
        expectedCloseDate: crmOpportunities.expectedCloseDate,
      })
      .from(crmOpportunities)
      .where(and(...conditions));

    let totalWeightedValue = 0;
    const monthlyMap = new Map<string, number>();

    for (const opp of opps) {
      const dealVal = parseFloat(opp.dealValue ?? "0") || 0;
      const prob = (opp.aiWinProbability ?? opp.probability ?? 10) / 100;
      const weighted = dealVal * prob;
      totalWeightedValue += weighted;

      if (opp.expectedCloseDate) {
        const d = new Date(opp.expectedCloseDate);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        monthlyMap.set(monthKey, (monthlyMap.get(monthKey) ?? 0) + weighted);
      }
    }

    const now = new Date();
    const monthlyProjections: { month: string; label: string; value: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      monthlyProjections.push({ month: key, label, value: Math.round((monthlyMap.get(key) ?? 0) * 100) / 100 });
    }

    res.json({
      totalWeightedValue: Math.round(totalWeightedValue * 100) / 100,
      openDealsCount: opps.length,
      totalUnweightedValue: Math.round(opps.reduce((s, o) => s + (parseFloat(o.dealValue ?? "0") || 0), 0) * 100) / 100,
      monthlyProjections,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
