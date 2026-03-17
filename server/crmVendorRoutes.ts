import { Router } from "express";
import { db } from "./db";
import {
  crmOrganisations, crmContacts, crmOrganisationNotes,
  insertCrmOrganisationSchema, insertCrmOrganisationNoteSchema,
  auditLog, users, emailThreads, emailMessages, calendarEvents, projects,
} from "@shared/schema";
import { eq, and, sql, desc, or, lte, gte, isNotNull, inArray, type SQL } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

  router.get("/api/crm/organisations", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER", "SALES", "MARKETING", "PROCUREMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { type, search, active } = req.query;
      
      let query = db
        .select({
          id: crmOrganisations.id,
          organizationId: crmOrganisations.organizationId,
          type: crmOrganisations.type,
          name: crmOrganisations.name,
          address: crmOrganisations.address,
          city: crmOrganisations.city,
          state: crmOrganisations.state,
          zipCode: crmOrganisations.zipCode,
          website: crmOrganisations.website,
          specialties: crmOrganisations.specialties,
          insuranceExpiration: crmOrganisations.insuranceExpiration,
          wcInsuranceExpiration: crmOrganisations.wcInsuranceExpiration,
          licenseExpiration: crmOrganisations.licenseExpiration,
          paymentTerms: crmOrganisations.paymentTerms,
          notes: crmOrganisations.notes,
          isActive: crmOrganisations.isActive,
          crmStatus: crmOrganisations.crmStatus,
          activeProjectIds: crmOrganisations.activeProjectIds,
          bondingCapacity: crmOrganisations.bondingCapacity,
          tradeSpecialty: crmOrganisations.tradeSpecialty,
          materialCategories: crmOrganisations.materialCategories,
          serviceCategory: crmOrganisations.serviceCategory,
          contractExpiration: crmOrganisations.contractExpiration,
          equipmentCategory: crmOrganisations.equipmentCategory,
          rentalTerms: crmOrganisations.rentalTerms,
          companyRepresented: crmOrganisations.companyRepresented,
          createdAt: crmOrganisations.createdAt,
          updatedAt: crmOrganisations.updatedAt,
        })
        .from(crmOrganisations);
      
      const conditions: SQL[] = [];
      
      if (shouldFilter && orgId) {
        conditions.push(eq(crmOrganisations.organizationId, orgId));
      }
      
      if (type) {
        conditions.push(sql`${crmOrganisations.type} = ${type}`);
      }
      if (active !== undefined) {
        conditions.push(eq(crmOrganisations.isActive, active === 'true'));
      }
      if (search) {
        conditions.push(
          sql`LOWER(${crmOrganisations.name}) LIKE LOWER(${'%' + search + '%'})`
        );
      }
      
      let results;
      if (conditions.length > 0) {
        results = await query.where(and(...conditions)).orderBy(crmOrganisations.name);
      } else {
        results = await query.orderBy(crmOrganisations.name);
      }
      
      res.json(results);
    } catch (error) {
      console.error("Get CRM organisations error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/crm/organisations/expiring-compliance", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER", "PROCUREMENT_MANAGER"), async (req: AuthRequest, res) => {
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
      console.error("Expiring compliance check error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/crm/organisations/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER", "SALES", "MARKETING", "PROCUREMENT_MANAGER"), async (req: AuthRequest, res) => {
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
      
      res.json({ ...organisation, contacts });
    } catch (error) {
      console.error("Get CRM organisation error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/crm/organisations", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess || !orgId) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const validationResult = insertCrmOrganisationSchema.safeParse({
        ...req.body,
        organizationId: orgId,
        createdById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }
      
      const [newOrg] = await db
        .insert(crmOrganisations)
        .values(validationResult.data)
        .returning();
      
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "crm_organisations",
        entityId: newOrg.id,
        newValue: JSON.stringify({ name: newOrg.name, type: newOrg.type }),
      });
      
      res.status(201).json(newOrg);
    } catch (error) {
      console.error("Create CRM organisation error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.put("/api/crm/organisations/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
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
      
      const validationResult = insertCrmOrganisationSchema.partial().safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }
      
      const { organizationId: _, ...safeData } = validationResult.data;
      
      const [updated] = await db
        .update(crmOrganisations)
        .set({
          ...safeData,
          updatedAt: new Date(),
        })
        .where(eq(crmOrganisations.id, req.params.id))
        .returning();
      
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "crm_organisations",
        entityId: updated.id,
        oldValue: JSON.stringify({ name: existing.name, type: existing.type }),
        newValue: JSON.stringify({ name: updated.name, type: updated.type }),
      });
      
      res.json(updated);
    } catch (error) {
      console.error("Update CRM organisation error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.delete("/api/crm/organisations/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
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
      
      await db.delete(crmOrganisations).where(and(...conditions));
      
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "DELETE",
        entityType: "crm_organisations",
        entityId: existing.id,
        oldValue: JSON.stringify({ name: existing.name, type: existing.type }),
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error("Delete CRM organisation error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/crm/organisations/:id/notes", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER", "SALES", "MARKETING", "PROCUREMENT_MANAGER"), async (req: AuthRequest, res) => {
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
      console.error("Get CRM organisation notes error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/crm/organisations/:id/notes", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER", "SALES", "MARKETING", "PROCUREMENT_MANAGER"), async (req: AuthRequest, res) => {
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
      console.error("Create CRM organisation note error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.delete("/api/crm/organisations/:orgId/notes/:noteId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
      console.error("Delete CRM organisation note error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/crm/search", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("CRM search error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/crm/organisations/:id/communications", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER", "SALES", "MARKETING", "PROCUREMENT_MANAGER"), async (req: AuthRequest, res) => {
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
      console.error("Get CRM org communications error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

export default router;
