import { logError } from "./utils/logger";
import { Express } from "express";
import { db } from "./db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth, requireFeaturePermission, AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { notifyApprovers, notifySubmitter, getApproverUserIds, notifyUsers } from "./services/approvalNotificationService";
import { eventBus } from "./events";
import { 
  tmTickets, 
  tmTicketLaborEntries,
  tmTicketEquipmentEntries,
  tmTicketMaterialEntries,
  tmTicketScopeModifiers,
  tmInvoices,
  projects,
  users,
  auditLog,
} from "@shared/schema";

// ========================================
// T&M Billing Lock Helper
// ========================================

function isTicketLocked(billingStatus: string): boolean {
  return billingStatus === "INVOICED" || billingStatus === "BILLED";
}

async function syncTicketScopeModifiers(
  tx: typeof db,
  ticketId: string,
  scopeModifierIds: string | null | undefined,
  scopeModifierNames: string | null | undefined,
): Promise<void> {
  await tx.delete(tmTicketScopeModifiers).where(eq(tmTicketScopeModifiers.ticketId, ticketId));

  if (!scopeModifierIds) return;

  let ids: string[];
  try { ids = JSON.parse(scopeModifierIds); } catch { return; }
  if (!Array.isArray(ids) || ids.length === 0) return;

  let names: string[] = [];
  try { names = scopeModifierNames ? JSON.parse(scopeModifierNames) : []; } catch { /* ignore */ }

  await tx.insert(tmTicketScopeModifiers).values(
    ids.map((modId, i) => ({
      ticketId,
      modifierId: modId,
      modifierName: names[i] || modId,
      sortOrder: i,
    }))
  );
}

// ========================================
// T&M Approval Routes (from tmApprovalRoutes.ts)
// ========================================

function hasTMApprovalAccess(role: string): boolean {
  return ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(role);
}

function registerTMApprovalRoutes(app: Express) {
  app.post("/api/tm-tickets/:ticketId/submit", requireAuth, requireFeaturePermission('canAccessTimeMaterial'), async (req: AuthRequest, res) => {
    try {
      const { ticketId } = req.params;
      const userId = req.user!.id;
      
      const ticket = await db.query.tmTickets.findFirst({
        where: eq(tmTickets.id, ticketId),
      });
      
      if (!ticket) {
        return res.status(404).json({ error: "T&M ticket not found" });
      }
      
      if (isTicketLocked(ticket.billingStatus)) {
        return res.status(400).json({ error: "Ticket is locked — it has been billed and cannot be modified" });
      }

      if (ticket.status !== "DRAFT" && ticket.status !== "REJECTED") {
        return res.status(400).json({ error: "Ticket is already submitted or approved" });
      }
      
      const [updatedTicket] = await db.update(tmTickets)
        .set({
          status: "SUBMITTED",
          submittedAt: new Date(),
          submittedById: userId,
          updatedAt: new Date(),
        })
        .where(eq(tmTickets.id, ticketId))
        .returning();
      
      await db.insert(auditLog).values({
        userId,
        action: "SUBMIT",
        entityType: "tm_ticket",
        entityId: ticketId,
        newValue: JSON.stringify({ ticketNumber: ticket.ticketNumber }),
      });

      await notifyApprovers(
        ticket.organizationId,
        userId,
        {
          type: "TM_TICKET_SUBMITTED",
          title: "T&M Ticket Submitted",
          message: `T&M Ticket ${ticket.ticketNumber} has been submitted for approval`,
          relatedEntityId: ticket.projectId || ticketId,
          relatedEntityType: "project",
        }
      );
      
      res.json(updatedTicket);
    } catch (error) {
      logError("Error submitting T&M ticket:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to submit T&M ticket" });
    }
  });

  app.post("/api/tm-tickets/:ticketId/approve", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { ticketId } = req.params;
      const userId = req.user!.id;
      
      if (!hasTMApprovalAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions to approve T&M tickets" });
      }
      
      const ticket = await db.query.tmTickets.findFirst({
        where: eq(tmTickets.id, ticketId),
      });
      
      if (!ticket) {
        return res.status(404).json({ error: "T&M ticket not found" });
      }
      
      if (isTicketLocked(ticket.billingStatus)) {
        return res.status(400).json({ error: "Ticket is locked — it has been billed and cannot be modified" });
      }

      if (ticket.status !== "SUBMITTED") {
        return res.status(400).json({ error: "Only submitted tickets can be approved" });
      }
      
      const [updatedTicket] = await db.update(tmTickets)
        .set({
          status: "APPROVED",
          billingStatus: "PENDING",
          approvedAt: new Date(),
          approvedById: userId,
          updatedAt: new Date(),
        })
        .where(eq(tmTickets.id, ticketId))
        .returning();
      
      await db.insert(auditLog).values({
        userId,
        action: "APPROVE",
        entityType: "tm_ticket",
        entityId: ticketId,
        newValue: JSON.stringify({ ticketNumber: ticket.ticketNumber, grandTotal: ticket.grandTotal }),
      });

      if (ticket.submittedById) {
        await notifySubmitter(ticket.submittedById, {
          type: "TM_TICKET_APPROVED",
          title: "T&M Ticket Approved",
          message: `T&M Ticket ${ticket.ticketNumber} has been approved`,
          relatedEntityId: ticket.projectId || ticketId,
          relatedEntityType: "project",
        }, req.user?.organizationId);
      }

      if (ticket.projectId) {
        try {
          await eventBus.emit({
            version: 1,
            orgId: ticket.organizationId || "",
            actorId: userId,
            timestamp: new Date(),
            type: "tm_ticket.approved" as const,
            payload: {
              ticketId: ticket.id,
              projectId: ticket.projectId,
              costCode: ticket.costCode || null,
              laborCost: parseFloat(ticket.laborTotal?.toString() || "0"),
              equipmentCost: parseFloat(ticket.equipmentTotal?.toString() || "0"),
              materialCost: parseFloat(ticket.materialTotal?.toString() || "0"),
              grandTotal: parseFloat(ticket.grandTotal?.toString() || "0"),
            },
          });
        } catch (emitErr) {
          logError("Failed to emit tm_ticket.approved event:", {}, emitErr instanceof Error ? emitErr : new Error(String(emitErr)));
        }
      }
      
      res.json(updatedTicket);
    } catch (error) {
      logError("Error approving T&M ticket:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to approve T&M ticket" });
    }
  });

  app.post("/api/tm-tickets/:ticketId/reject", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { ticketId } = req.params;
      const { reason } = req.body;
      const userId = req.user!.id;
      
      if (!hasTMApprovalAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions to reject T&M tickets" });
      }
      
      const ticket = await db.query.tmTickets.findFirst({
        where: eq(tmTickets.id, ticketId),
      });
      
      if (!ticket) {
        return res.status(404).json({ error: "T&M ticket not found" });
      }
      
      if (isTicketLocked(ticket.billingStatus)) {
        return res.status(400).json({ error: "Ticket is locked — it has been billed and cannot be modified" });
      }

      if (ticket.status !== "SUBMITTED") {
        return res.status(400).json({ error: "Only submitted tickets can be rejected" });
      }
      
      const [updatedTicket] = await db.update(tmTickets)
        .set({
          status: "REJECTED",
          rejectedAt: new Date(),
          rejectedById: userId,
          rejectionReason: reason || null,
          updatedAt: new Date(),
        })
        .where(eq(tmTickets.id, ticketId))
        .returning();
      
      await db.insert(auditLog).values({
        userId,
        action: "REJECT",
        entityType: "tm_ticket",
        entityId: ticketId,
        newValue: JSON.stringify({ ticketNumber: ticket.ticketNumber, reason }),
      });

      if (ticket.submittedById) {
        await notifySubmitter(ticket.submittedById, {
          type: "TM_TICKET_REJECTED",
          title: "T&M Ticket Rejected",
          message: `T&M Ticket ${ticket.ticketNumber} has been rejected${reason ? `: ${reason}` : ""}`,
          relatedEntityId: ticket.projectId || ticketId,
          relatedEntityType: "project",
        }, req.user?.organizationId);
      }
      
      res.json(updatedTicket);
    } catch (error) {
      logError("Error rejecting T&M ticket:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to reject T&M ticket" });
    }
  });

  app.post("/api/tm-tickets/:ticketId/signed-document", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { ticketId } = req.params;
      const { url, fileName, objectKey } = req.body;
      const userId = req.user!.id;
      
      if (!hasTMApprovalAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions to upload signed documents" });
      }
      
      const ticket = await db.query.tmTickets.findFirst({
        where: eq(tmTickets.id, ticketId),
      });
      
      if (!ticket) {
        return res.status(404).json({ error: "T&M ticket not found" });
      }

      if (isTicketLocked(ticket.billingStatus)) {
        return res.status(400).json({ error: "Ticket is locked — it has been billed and cannot be modified" });
      }
      
      const [updatedTicket] = await db.update(tmTickets)
        .set({
          signedDocumentUrl: url,
          signedDocumentFileName: fileName,
          signedDocumentObjectKey: objectKey,
          signedDocumentUploadedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tmTickets.id, ticketId))
        .returning();
      
      await db.insert(auditLog).values({
        userId,
        action: "UPDATE",
        entityType: "tm_ticket",
        entityId: ticketId,
        newValue: JSON.stringify({ action: "signed_document_upload", fileName }),
      });
      
      res.json(updatedTicket);
    } catch (error) {
      logError("Error uploading signed document:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to upload signed document" });
    }
  });
}


// ========================================
// T&M Invoice Routes (from tmInvoiceRoutes.ts)
// ========================================

function hasBillingApprovalAccess(role: string): boolean {
  return ["ADMIN", "MANAGER"].includes(role);
}

function registerTMInvoiceRoutes(app: Express) {
  app.get("/api/tm-billing/pending", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      const effectiveRole = req.user?.effectiveRole || req.user?.role;
      
      if (mustDenyAccess || !hasBillingApprovalAccess(effectiveRole || "")) {
        return res.status(403).json({ error: "Access denied" });
      }

      const tickets = await db.query.tmTickets.findMany({
        where: and(
          eq(tmTickets.status, "APPROVED"),
          eq(tmTickets.billingStatus, "PENDING")
        ),
        orderBy: [desc(tmTickets.workDate)],
      });

      const projectIdSet = new Set(tickets.map(t => t.projectId));
      const projectIds = Array.from(projectIdSet);
      const projectsData = projectIds.length > 0 
        ? await db.query.projects.findMany({ where: inArray(projects.id, projectIds) })
        : [];
      
      const projectMap = new Map(projectsData.map(p => [p.id, p]));
      
      let filteredTickets = tickets;
      if (shouldFilter && orgId) {
        filteredTickets = tickets.filter(t => {
          const project = projectMap.get(t.projectId);
          return project?.gcOrganizationId === orgId;
        });
      }

      const enrichedTickets = await Promise.all(filteredTickets.map(async (ticket) => {
        const project = projectMap.get(ticket.projectId);
        const createdBy = await db.query.users.findFirst({ where: eq(users.id, ticket.createdById) });
        
        return {
          ...ticket,
          project: project ? { id: project.id, name: project.name, clientName: project.clientName } : null,
          createdBy: createdBy ? { id: createdBy.id, firstName: createdBy.firstName, lastName: createdBy.lastName } : null,
        };
      }));

      res.json(enrichedTickets);
    } catch (error) {
      logError("Error fetching pending billing tickets:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to fetch pending billing tickets" });
    }
  });

  app.post("/api/tm-tickets/:ticketId/approve-for-billing", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { ticketId } = req.params;
      const { billingNotes } = req.body;
      const effectiveRole = req.user?.effectiveRole || req.user?.role;
      
      if (!hasBillingApprovalAccess(effectiveRole || "")) {
        return res.status(403).json({ error: "Access denied - requires billing approval permission" });
      }

      const ticket = await db.query.tmTickets.findFirst({ where: eq(tmTickets.id, ticketId) });
      if (!ticket) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      if (ticket.status !== "APPROVED") {
        return res.status(400).json({ error: "Ticket must be approved before billing approval" });
      }

      if (ticket.billingStatus !== "PENDING") {
        return res.status(400).json({ error: "Ticket has already been processed for billing" });
      }

      const [updated] = await db.update(tmTickets)
        .set({
          billingStatus: "APPROVED_FOR_BILLING",
          billingApprovedAt: new Date(),
          billingApprovedById: req.user!.id,
          billingNotes: billingNotes || null,
          updatedAt: new Date(),
        })
        .where(eq(tmTickets.id, ticketId))
        .returning();

      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "tm_ticket",
        entityId: ticketId,
        newValue: JSON.stringify({ billingStatus: "APPROVED_FOR_BILLING", billingNotes }),
        ipAddress: req.ip || "unknown",
      });

      const project = await db.query.projects.findFirst({ where: eq(projects.id, ticket.projectId) });
      if (project?.autoInvoice && project.gcOrganizationId) {
        try {
          await db.transaction(async (tx) => {
            const existingDraft = await tx.query.tmInvoices.findFirst({
              where: and(
                eq(tmInvoices.projectId, project.id),
                eq(tmInvoices.status, "DRAFT"),
              ),
            });

            if (existingDraft) {
              const draftTickets = await tx.query.tmTickets.findMany({
                where: eq(tmTickets.invoiceId, existingDraft.id),
              });
              const newSubtotal = draftTickets.reduce((sum, t) => sum + Number(t.grandTotal || 0), 0) + Number(ticket.grandTotal || 0);
              const taxRate = Number(existingDraft.taxRate || 0);
              const newTax = newSubtotal * (taxRate / 100);
              const newTotal = newSubtotal + newTax;

              await tx.update(tmInvoices)
                .set({
                  subtotal: String(newSubtotal),
                  taxAmount: String(newTax),
                  total: String(newTotal),
                  updatedAt: new Date(),
                })
                .where(eq(tmInvoices.id, existingDraft.id));

              await tx.update(tmTickets)
                .set({
                  billingStatus: "INVOICED",
                  invoiceId: existingDraft.id,
                  updatedAt: new Date(),
                })
                .where(eq(tmTickets.id, ticketId));
            } else {
              const existingInvoices = await tx.query.tmInvoices.findMany({
                where: eq(tmInvoices.organizationId, project.gcOrganizationId!),
              });
              const invoiceNumber = `TM-${String(existingInvoices.length + 1).padStart(5, "0")}`;
              const subtotal = Number(ticket.grandTotal || 0);

              const [newInvoice] = await tx.insert(tmInvoices).values({
                organizationId: project.gcOrganizationId!,
                projectId: project.id,
                invoiceNumber,
                invoiceDate: new Date().toISOString().split("T")[0],
                clientName: project.clientName || "Client",
                subtotal: String(subtotal),
                taxRate: "0",
                taxAmount: "0",
                total: String(subtotal),
                status: "DRAFT",
                createdById: req.user!.id,
              }).returning();

              await tx.update(tmTickets)
                .set({
                  billingStatus: "INVOICED",
                  invoiceId: newInvoice.id,
                  updatedAt: new Date(),
                })
                .where(eq(tmTickets.id, ticketId));
            }
          });

          const billingRoles = ["ADMIN", "MANAGER"] as const;
          const billingUserIds = await getApproverUserIds(project.gcOrganizationId, req.user!.id, billingRoles);
          if (billingUserIds.length > 0) {
            await notifyUsers(billingUserIds, {
              type: "TM_INVOICE_AUTO_CREATED",
              title: "Draft Invoice Auto-Created",
              message: `A draft invoice has been auto-created/updated for project ${project.name} — ticket ${ticket.ticketNumber} was added`,
              relatedEntityId: project.id,
              relatedEntityType: "project",
            });
          }
        } catch (autoInvoiceError) {
          logError("Auto-invoice error (non-fatal):", {}, autoInvoiceError instanceof Error ? autoInvoiceError : new Error(String(autoInvoiceError)));
        }
      }

      const finalTicket = await db.query.tmTickets.findFirst({ where: eq(tmTickets.id, ticketId) });
      res.json(finalTicket || updated);
    } catch (error) {
      logError("Error approving ticket for billing:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to approve ticket for billing" });
    }
  });

  app.get("/api/tm-billing/approved", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      const effectiveRole = req.user?.effectiveRole || req.user?.role;
      
      if (mustDenyAccess || !hasBillingApprovalAccess(effectiveRole || "")) {
        return res.status(403).json({ error: "Access denied" });
      }

      const tickets = await db.query.tmTickets.findMany({
        where: eq(tmTickets.billingStatus, "APPROVED_FOR_BILLING"),
        orderBy: [desc(tmTickets.workDate)],
      });

      const projectIdSet = new Set(tickets.map(t => t.projectId));
      const projectIds = Array.from(projectIdSet);
      const projectsData = projectIds.length > 0 
        ? await db.query.projects.findMany({ where: inArray(projects.id, projectIds) })
        : [];
      
      const projectMap = new Map(projectsData.map(p => [p.id, p]));
      
      let filteredTickets = tickets;
      if (shouldFilter && orgId) {
        filteredTickets = tickets.filter(t => {
          const project = projectMap.get(t.projectId);
          return project?.gcOrganizationId === orgId;
        });
      }

      const enrichedTickets = await Promise.all(filteredTickets.map(async (ticket) => {
        const project = projectMap.get(ticket.projectId);
        return {
          ...ticket,
          project: project ? { id: project.id, name: project.name, clientName: project.clientName } : null,
        };
      }));

      res.json(enrichedTickets);
    } catch (error) {
      logError("Error fetching approved billing tickets:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to fetch approved billing tickets" });
    }
  });

  app.post("/api/tm-invoices", requireAuth, requireFeaturePermission('canEditFinancials'), async (req: AuthRequest, res) => {
    try {
      const { ticketIds, projectId, clientName, clientAddress, clientEmail, dueDate, notes, taxRate } = req.body;
      const effectiveRole = req.user?.effectiveRole || req.user?.role;
      
      if (!hasBillingApprovalAccess(effectiveRole || "")) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
        return res.status(400).json({ error: "At least one ticket is required" });
      }

      const tickets = await db.query.tmTickets.findMany({
        where: inArray(tmTickets.id, ticketIds),
      });

      if (tickets.length !== ticketIds.length) {
        return res.status(400).json({ error: "One or more tickets not found" });
      }

      const invalidTickets = tickets.filter(t => t.billingStatus !== "APPROVED_FOR_BILLING");
      if (invalidTickets.length > 0) {
        return res.status(400).json({ error: "All tickets must be approved for billing" });
      }

      const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId || tickets[0].projectId) });
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const subtotal = tickets.reduce((sum, t) => sum + Number(t.grandTotal || 0), 0);
      const tax = taxRate ? subtotal * (Number(taxRate) / 100) : 0;
      const total = subtotal + tax;

      const orgId = project.gcOrganizationId;
      if (!orgId) {
        return res.status(400).json({ error: "Project has no organization" });
      }
      const existingInvoices = await db.query.tmInvoices.findMany({
        where: eq(tmInvoices.organizationId, orgId),
      });
      const invoiceNumber = `TM-${String(existingInvoices.length + 1).padStart(5, "0")}`;

      const [invoice] = await db.insert(tmInvoices).values({
        organizationId: orgId,
        projectId: project.id,
        invoiceNumber,
        invoiceDate: new Date().toISOString().split("T")[0],
        dueDate: dueDate || null,
        clientName: clientName || project.clientName || "Client",
        clientAddress: clientAddress || null,
        clientEmail: clientEmail || null,
        subtotal: String(subtotal),
        taxRate: taxRate ? String(taxRate) : "0",
        taxAmount: String(tax),
        total: String(total),
        status: "DRAFT",
        notes: notes || null,
        createdById: req.user!.id,
      }).returning();

      await db.update(tmTickets)
        .set({
          billingStatus: "INVOICED",
          invoiceId: invoice.id,
          updatedAt: new Date(),
        })
        .where(inArray(tmTickets.id, ticketIds));

      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "tm_invoice",
        entityId: invoice.id,
        newValue: JSON.stringify({ ticketIds, invoiceNumber, total }),
        ipAddress: req.ip || "unknown",
      });

      res.json({ ...invoice, tickets });
    } catch (error) {
      logError("Error creating invoice:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to create invoice" });
    }
  });

  app.get("/api/tm-invoices", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      const effectiveRole = req.user?.effectiveRole || req.user?.role;
      
      if (mustDenyAccess || !hasBillingApprovalAccess(effectiveRole || "")) {
        return res.status(403).json({ error: "Access denied" });
      }

      let invoices;
      if (shouldFilter && orgId) {
        invoices = await db.query.tmInvoices.findMany({
          where: eq(tmInvoices.organizationId, orgId),
          orderBy: [desc(tmInvoices.invoiceDate)],
        });
      } else {
        invoices = await db.query.tmInvoices.findMany({
          orderBy: [desc(tmInvoices.invoiceDate)],
        });
      }

      const enrichedInvoices = await Promise.all(invoices.map(async (invoice) => {
        const project = await db.query.projects.findFirst({ where: eq(projects.id, invoice.projectId) });
        const tickets = await db.query.tmTickets.findMany({ where: eq(tmTickets.invoiceId, invoice.id) });
        
        return {
          ...invoice,
          project: project ? { id: project.id, name: project.name } : null,
          ticketCount: tickets.length,
        };
      }));

      res.json(enrichedInvoices);
    } catch (error) {
      logError("Error fetching invoices:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  app.get("/api/tm-invoices/:invoiceId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { invoiceId } = req.params;
      
      const invoice = await db.query.tmInvoices.findFirst({ where: eq(tmInvoices.id, invoiceId) });
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }

      const [project, tickets, createdBy] = await Promise.all([
        db.query.projects.findFirst({ where: eq(projects.id, invoice.projectId) }),
        db.query.tmTickets.findMany({ where: eq(tmTickets.invoiceId, invoiceId) }),
        db.query.users.findFirst({ where: eq(users.id, invoice.createdById) }),
      ]);

      res.json({
        ...invoice,
        project: project ? { id: project.id, name: project.name, clientName: project.clientName } : null,
        tickets,
        createdBy: createdBy ? { id: createdBy.id, firstName: createdBy.firstName, lastName: createdBy.lastName } : null,
      });
    } catch (error) {
      logError("Error fetching invoice:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to fetch invoice" });
    }
  });

  app.post("/api/tm-tickets/:ticketId/client-signoff", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { ticketId } = req.params;
      const { clientName, signature } = req.body;

      if (!clientName || !signature) {
        return res.status(400).json({ error: "Client name and signature are required" });
      }

      const ticket = await db.query.tmTickets.findFirst({ where: eq(tmTickets.id, ticketId) });
      if (!ticket) {
        return res.status(404).json({ error: "T&M ticket not found" });
      }

      if (ticket.clientSignoffAt) {
        return res.status(400).json({ error: "Client sign-off has already been recorded for this ticket" });
      }

      if (ticket.status !== "SUBMITTED" && ticket.status !== "APPROVED") {
        return res.status(400).json({ error: "Ticket must be in SUBMITTED or APPROVED status for client sign-off" });
      }

      if (isTicketLocked(ticket.billingStatus)) {
        return res.status(400).json({ error: "Ticket is locked — it has been billed and cannot be modified" });
      }

      if (typeof clientName !== "string" || clientName.length > 200) {
        return res.status(400).json({ error: "Client name must be a string under 200 characters" });
      }

      if (typeof signature !== "string" || signature.length > 500000) {
        return res.status(400).json({ error: "Signature data is too large" });
      }

      const [updated] = await db.update(tmTickets)
        .set({
          clientSignoffName: clientName.trim(),
          clientSignoffSignature: signature,
          clientSignoffAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tmTickets.id, ticketId))
        .returning();

      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "tm_ticket",
        entityId: ticketId,
        newValue: JSON.stringify({ action: "client_signoff", clientName }),
        ipAddress: req.ip || "unknown",
      });

      res.json(updated);
    } catch (error) {
      logError("Error saving client sign-off:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to save client sign-off" });
    }
  });

  app.post("/api/tm-invoices/:invoiceId/send", requireAuth, requireFeaturePermission('canEditFinancials'), async (req: AuthRequest, res) => {
    try {
      const { invoiceId } = req.params;
      const effectiveRole = req.user?.effectiveRole || req.user?.role;
      
      if (!hasBillingApprovalAccess(effectiveRole || "")) {
        return res.status(403).json({ error: "Access denied" });
      }

      const invoice = await db.query.tmInvoices.findFirst({ where: eq(tmInvoices.id, invoiceId) });
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }

      const [updated] = await db.update(tmInvoices)
        .set({
          status: "SENT",
          sentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tmInvoices.id, invoiceId))
        .returning();

      res.json(updated);
    } catch (error) {
      logError("Error sending invoice:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to send invoice" });
    }
  });

  app.post("/api/tm-invoices/:invoiceId/mark-paid", requireAuth, requireFeaturePermission('canEditFinancials'), async (req: AuthRequest, res) => {
    try {
      const { invoiceId } = req.params;
      const effectiveRole = req.user?.effectiveRole || req.user?.role;
      
      if (!hasBillingApprovalAccess(effectiveRole || "")) {
        return res.status(403).json({ error: "Access denied" });
      }

      const invoice = await db.query.tmInvoices.findFirst({ where: eq(tmInvoices.id, invoiceId) });
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }

      const [updated] = await db.update(tmInvoices)
        .set({
          status: "PAID",
          paidAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tmInvoices.id, invoiceId))
        .returning();

      await db.update(tmTickets)
        .set({
          billingStatus: "BILLED",
          billedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tmTickets.invoiceId, invoiceId));

      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "tm_invoice",
        entityId: invoiceId,
        newValue: JSON.stringify({ status: "PAID", invoiceNumber: invoice.invoiceNumber, total: invoice.total }),
        ipAddress: req.ip || "unknown",
      });

      res.json(updated);
    } catch (error) {
      logError("Error marking invoice as paid:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to mark invoice as paid" });
    }
  });

  app.get("/api/tm-billing/summary", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      const effectiveRole = req.user?.effectiveRole || req.user?.role;
      
      if (mustDenyAccess || !hasBillingApprovalAccess(effectiveRole || "")) {
        return res.status(403).json({ error: "Access denied" });
      }

      const allTickets = await db.query.tmTickets.findMany({
        where: eq(tmTickets.status, "APPROVED"),
      });

      let filteredTickets = allTickets;
      if (shouldFilter && orgId) {
        const projectIdSet = new Set(allTickets.map(t => t.projectId));
        const projectIds = Array.from(projectIdSet);
        const projectsData = projectIds.length > 0 
          ? await db.query.projects.findMany({ where: inArray(projects.id, projectIds) })
          : [];
        const projectMap = new Map(projectsData.map(p => [p.id, p]));
        
        filteredTickets = allTickets.filter(t => {
          const project = projectMap.get(t.projectId);
          return project?.gcOrganizationId === orgId;
        });
      }

      let invoices;
      if (shouldFilter && orgId) {
        invoices = await db.query.tmInvoices.findMany({
          where: eq(tmInvoices.organizationId, orgId),
        });
      } else {
        invoices = await db.query.tmInvoices.findMany();
      }

      const pending = filteredTickets.filter(t => t.billingStatus === "PENDING");
      const approvedForBilling = filteredTickets.filter(t => t.billingStatus === "APPROVED_FOR_BILLING");
      const invoiced = filteredTickets.filter(t => t.billingStatus === "INVOICED");
      const billed = filteredTickets.filter(t => t.billingStatus === "BILLED");

      res.json({
        pendingCount: pending.length,
        pendingTotal: pending.reduce((sum, t) => sum + Number(t.grandTotal || 0), 0),
        approvedForBillingCount: approvedForBilling.length,
        approvedForBillingTotal: approvedForBilling.reduce((sum, t) => sum + Number(t.grandTotal || 0), 0),
        invoicedCount: invoiced.length,
        invoicedTotal: invoiced.reduce((sum, t) => sum + Number(t.grandTotal || 0), 0),
        billedCount: billed.length,
        billedTotal: billed.reduce((sum, t) => sum + Number(t.grandTotal || 0), 0),
        draftInvoices: invoices.filter(i => i.status === "DRAFT").length,
        sentInvoices: invoices.filter(i => i.status === "SENT").length,
        paidInvoices: invoices.filter(i => i.status === "PAID").length,
        totalInvoiced: invoices.reduce((sum, i) => sum + Number(i.total || 0), 0),
        totalPaid: invoices.filter(i => i.status === "PAID").reduce((sum, i) => sum + Number(i.total || 0), 0),
      });
    } catch (error) {
      logError("Error fetching billing summary:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to fetch billing summary" });
    }
  });
}


// ========================================
// T&M Ticket Routes
// ========================================

function hasTMCreateAccess(role: string): boolean {
  return ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(role);
}

export function registerTMTicketRoutes(app: Express) {
  app.use("/api/tm-tickets", requireAuth, requireFeaturePermission('canAccessTimeMaterial'));
  app.use("/api/tm-billing", requireAuth, requireFeaturePermission('canViewFinancials'));
  app.use("/api/tm-invoices", requireAuth, requireFeaturePermission('canViewFinancials'));

  registerTMApprovalRoutes(app);
  registerTMInvoiceRoutes(app);

  app.get("/api/projects/:projectId/tm-tickets", requireAuth, requireFeaturePermission('canAccessTimeMaterial'), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }

      const { projectId } = req.params;
      
      const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
        return res.json([]);
      }
      
      const tickets = await db.query.tmTickets.findMany({
        where: eq(tmTickets.projectId, projectId),
        orderBy: [desc(tmTickets.workDate), desc(tmTickets.createdAt)],
      });
      
      const enrichedTickets = await Promise.all(tickets.map(async (ticket) => {
        const [rep, approvedBy, submittedBy, createdBy] = await Promise.all([
          db.query.users.findFirst({ where: eq(users.id, ticket.tfrRepresentativeId) }),
          ticket.approvedById ? db.query.users.findFirst({ where: eq(users.id, ticket.approvedById) }) : null,
          ticket.submittedById ? db.query.users.findFirst({ where: eq(users.id, ticket.submittedById) }) : null,
          db.query.users.findFirst({ where: eq(users.id, ticket.createdById) }),
        ]);
        
        return {
          ...ticket,
          tfrRepresentative: rep ? { id: rep.id, firstName: rep.firstName, lastName: rep.lastName } : null,
          approvedBy: approvedBy ? { id: approvedBy.id, firstName: approvedBy.firstName, lastName: approvedBy.lastName } : null,
          submittedBy: submittedBy ? { id: submittedBy.id, firstName: submittedBy.firstName, lastName: submittedBy.lastName } : null,
          createdBy: createdBy ? { id: createdBy.id, firstName: createdBy.firstName, lastName: createdBy.lastName } : null,
        };
      }));
      
      res.json(enrichedTickets);
    } catch (error) {
      logError("Error fetching T&M tickets:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to fetch T&M tickets" });
    }
  });

  app.get("/api/tm-tickets/:ticketId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { ticketId } = req.params;
      
      const ticket = await db.query.tmTickets.findFirst({
        where: eq(tmTickets.id, ticketId),
      });
      
      if (!ticket) {
        return res.status(404).json({ error: "T&M ticket not found" });
      }
      
      const [laborEntries, equipmentEntries, materialEntries] = await Promise.all([
        db.query.tmTicketLaborEntries.findMany({ where: eq(tmTicketLaborEntries.ticketId, ticketId) }),
        db.query.tmTicketEquipmentEntries.findMany({ where: eq(tmTicketEquipmentEntries.ticketId, ticketId) }),
        db.query.tmTicketMaterialEntries.findMany({ where: eq(tmTicketMaterialEntries.ticketId, ticketId) }),
      ]);
      
      const [rep, project] = await Promise.all([
        db.query.users.findFirst({ where: eq(users.id, ticket.tfrRepresentativeId) }),
        db.query.projects.findFirst({ where: eq(projects.id, ticket.projectId) }),
      ]);
      
      res.json({
        ...ticket,
        laborEntries,
        equipmentEntries,
        materialEntries,
        tfrRepresentative: rep ? { id: rep.id, firstName: rep.firstName, lastName: rep.lastName } : null,
        project: project ? { id: project.id, name: project.name, code: project.code, clientName: project.clientName, locationAddress: project.locationAddress } : null,
      });
    } catch (error) {
      logError("Error fetching T&M ticket:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to fetch T&M ticket" });
    }
  });

  app.post("/api/projects/:projectId/tm-tickets", requireAuth, requireFeaturePermission('canAccessTimeMaterial'), async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user!.id;
      
      if (!hasTMCreateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions to create T&M tickets" });
      }
      
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, projectId),
      });
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      const existingTickets = await db.query.tmTickets.findMany({
        where: eq(tmTickets.projectId, projectId),
      });
      const ticketNumber = `TM-${project.code}-${String(existingTickets.length + 1).padStart(3, '0')}`;
      
      const { 
        laborEntries, 
        equipmentEntries, 
        materialEntries, 
        description,
        workTypeId,
        organizationSowItemId,
        workTypeCode,
        workTypeName,
        categoryName,
        scopeModifierIds,
        scopeModifierNames,
        canonicalName,
        scopeUnit,
        scopeQuantity,
        costCode,
        ...restTicketData 
      } = req.body;
      
      const sowItemId = organizationSowItemId || workTypeId || null;

      const mapLaborEntries = (entries: any[], ticketId: string) => entries.map((entry: any) => {
        const name = entry.employeeName || entry.workerName || entry.name;
        if (!name) throw new Error("Labor entry missing employee name");
        const regularHours = parseFloat(entry.regularHours || entry.hoursWorked || "0");
        if (!isFinite(regularHours)) throw new Error("Labor entry has invalid hours");
        const overtimeHours = parseFloat(entry.overtimeHours || "0");
        const regularRate = parseFloat(entry.rate || entry.hourlyRate || "0");
        if (!isFinite(regularRate)) throw new Error("Labor entry has invalid rate");
        const overtimeRate = parseFloat(entry.overtimeRate || String(regularRate * 1.5));
        const totalHours = regularHours + overtimeHours;
        const totalCost = (regularHours * regularRate) + (overtimeHours * overtimeRate);
        return {
          ticketId,
          employeeName: name,
          position: entry.position || entry.role || "General Labor",
          crewMemberCount: entry.crewMemberCount || 1,
          hoursWorked: String(regularHours),
          totalHours: String(totalHours),
          hourlyRate: String(regularRate),
          totalCost: String(totalCost),
        };
      });

      const mapEquipmentEntries = (entries: any[], ticketId: string) => entries.map((entry: any) => {
        const type = entry.equipmentType || entry.equipmentName || entry.name;
        if (!type) throw new Error("Equipment entry missing equipment type");
        const qty = parseFloat(entry.quantity || "1");
        const hours = parseFloat(entry.hours || entry.hoursUsed || "0");
        const rate = parseFloat(entry.rate || entry.hourlyRate || "0");
        const totalCost = qty * hours * rate;
        return {
          ticketId,
          equipmentType: type,
          quantity: qty,
          hoursUsed: String(hours),
          hourlyRate: String(rate),
          totalCost: String(totalCost),
        };
      });

      const mapMaterialEntries = (entries: any[], ticketId: string) => entries.map((entry: any) => {
        const desc = entry.description || entry.materialDescription || entry.materialName || entry.name;
        if (!desc) throw new Error("Material entry missing description");
        const qty = parseFloat(entry.quantity || "1");
        const unitCost = parseFloat(entry.unitCost || "0");
        const totalCost = qty * unitCost;
        return {
          ticketId,
          materialDescription: desc,
          quantity: String(qty),
          unit: entry.unit || "EA",
          unitCost: String(unitCost),
          totalCost: String(totalCost),
        };
      });

      const newTicket = await db.transaction(async (tx) => {
        const [ticket] = await tx.insert(tmTickets).values({
          ...restTicketData,
          projectId,
          ticketNumber,
          createdById: userId,
          tfrRepresentativeId: restTicketData.tfrRepresentativeId || userId,
          scopeDescription: description || restTicketData.scopeDescription || "Work performed",
          organizationSowItemId: sowItemId,
          workTypeId: null,
          workTypeCode: workTypeCode || null,
          workTypeName: workTypeName || null,
          categoryName: categoryName || null,
          scopeModifierIds: scopeModifierIds || null,
          scopeModifierNames: scopeModifierNames || null,
          canonicalName: canonicalName || null,
          scopeUnit: scopeUnit || null,
          scopeQuantity: scopeQuantity || null,
          costCode: costCode || null,
          status: "DRAFT",
        }).returning();

        await syncTicketScopeModifiers(tx, ticket.id, scopeModifierIds, scopeModifierNames);

        if (laborEntries && laborEntries.length > 0) {
          await tx.insert(tmTicketLaborEntries).values(mapLaborEntries(laborEntries, ticket.id));
        }
        if (equipmentEntries && equipmentEntries.length > 0) {
          await tx.insert(tmTicketEquipmentEntries).values(mapEquipmentEntries(equipmentEntries, ticket.id));
        }
        if (materialEntries && materialEntries.length > 0) {
          await tx.insert(tmTicketMaterialEntries).values(mapMaterialEntries(materialEntries, ticket.id));
        }

        return ticket;
      });

      await recalculateTicketTotals(newTicket.id);
      
      await db.insert(auditLog).values({
        userId,
        action: "CREATE",
        entityType: "tm_ticket",
        entityId: newTicket.id,
        newValue: JSON.stringify({ ticketNumber, projectId }),
      });
      
      res.status(201).json(newTicket);
    } catch (error: any) {
      logError("Error creating T&M ticket:", {}, error instanceof Error ? error : new Error(String(error)));
      if (error.message?.includes("missing")) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Failed to create T&M ticket" });
    }
  });

  app.put("/api/tm-tickets/:ticketId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { ticketId } = req.params;
      const userId = req.user!.id;
      
      const ticket = await db.query.tmTickets.findFirst({
        where: eq(tmTickets.id, ticketId),
      });
      
      if (!ticket) {
        return res.status(404).json({ error: "T&M ticket not found" });
      }
      
      if (isTicketLocked(ticket.billingStatus)) {
        return res.status(400).json({ error: "Ticket is locked — it has been billed and cannot be modified" });
      }

      if (ticket.status !== "DRAFT" && ticket.status !== "REJECTED") {
        return res.status(400).json({ error: "Cannot edit a submitted or approved ticket" });
      }
      
      if (!hasTMCreateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      
      const { laborEntries, equipmentEntries, materialEntries, ...ticketData } = req.body;
      
      const [updatedTicket] = await db.update(tmTickets)
        .set({
          ...ticketData,
          status: "DRAFT",
          rejectedAt: null,
          rejectedById: null,
          rejectionReason: null,
          updatedAt: new Date(),
        })
        .where(eq(tmTickets.id, ticketId))
        .returning();

      await syncTicketScopeModifiers(db, ticketId, ticketData.scopeModifierIds, ticketData.scopeModifierNames);
      
      await db.delete(tmTicketLaborEntries).where(eq(tmTicketLaborEntries.ticketId, ticketId));
      if (laborEntries && laborEntries.length > 0) {
        await db.insert(tmTicketLaborEntries).values(
          laborEntries.map((entry: any) => ({
            ticketId,
            employeeName: entry.employeeName,
            position: entry.position,
            crewMemberCount: entry.crewMemberCount || 1,
            hoursWorked: entry.hoursWorked,
            totalHours: String(Number(entry.hoursWorked) * (entry.crewMemberCount || 1)),
            hourlyRate: entry.hourlyRate || null,
            totalCost: entry.totalCost || null,
          }))
        );
      }
      
      await db.delete(tmTicketEquipmentEntries).where(eq(tmTicketEquipmentEntries.ticketId, ticketId));
      if (equipmentEntries && equipmentEntries.length > 0) {
        await db.insert(tmTicketEquipmentEntries).values(
          equipmentEntries.map((entry: any) => ({
            ticketId,
            equipmentType: entry.equipmentType,
            quantity: entry.quantity || 1,
            hoursUsed: entry.hoursUsed,
            hourlyRate: entry.hourlyRate || null,
            totalCost: entry.totalCost || null,
          }))
        );
      }
      
      await db.delete(tmTicketMaterialEntries).where(eq(tmTicketMaterialEntries.ticketId, ticketId));
      if (materialEntries && materialEntries.length > 0) {
        await db.insert(tmTicketMaterialEntries).values(
          materialEntries.map((entry: any) => ({
            ticketId,
            materialDescription: entry.materialDescription,
            quantity: entry.quantity,
            unit: entry.unit,
            unitCost: entry.unitCost || null,
            totalCost: entry.totalCost || null,
          }))
        );
      }
      
      await recalculateTicketTotals(ticketId);
      
      await db.insert(auditLog).values({
        userId,
        action: "UPDATE",
        entityType: "tm_ticket",
        entityId: ticketId,
        newValue: JSON.stringify({ ticketNumber: ticket.ticketNumber }),
      });
      
      res.json(updatedTicket);
    } catch (error) {
      logError("Error updating T&M ticket:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to update T&M ticket" });
    }
  });

  app.delete("/api/tm-tickets/:ticketId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { ticketId } = req.params;
      const userId = req.user!.id;
      
      const ticket = await db.query.tmTickets.findFirst({
        where: eq(tmTickets.id, ticketId),
      });
      
      if (!ticket) {
        return res.status(404).json({ error: "T&M ticket not found" });
      }
      
      if (isTicketLocked(ticket.billingStatus)) {
        return res.status(400).json({ error: "Ticket is locked — it has been billed and cannot be deleted" });
      }

      if (ticket.status !== "DRAFT" && req.user!.role !== "ADMIN") {
        return res.status(400).json({ error: "Only draft tickets can be deleted" });
      }
      
      if (!hasTMCreateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      
      await db.delete(tmTickets).where(eq(tmTickets.id, ticketId));
      
      await db.insert(auditLog).values({
        userId,
        action: "DELETE",
        entityType: "tm_ticket",
        entityId: ticketId,
        oldValue: JSON.stringify({ ticketNumber: ticket.ticketNumber }),
      });
      
      res.json({ success: true });
    } catch (error) {
      logError("Error deleting T&M ticket:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to delete T&M ticket" });
    }
  });

  app.get("/api/tm-tickets/:ticketId/pdf", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { ticketId } = req.params;
      
      const ticket = await db.query.tmTickets.findFirst({
        where: eq(tmTickets.id, ticketId),
      });
      
      if (!ticket) {
        return res.status(404).json({ error: "T&M ticket not found" });
      }
      
      const [laborEntries, equipmentEntries, materialEntries, project, rep, createdBy] = await Promise.all([
        db.query.tmTicketLaborEntries.findMany({ where: eq(tmTicketLaborEntries.ticketId, ticketId) }),
        db.query.tmTicketEquipmentEntries.findMany({ where: eq(tmTicketEquipmentEntries.ticketId, ticketId) }),
        db.query.tmTicketMaterialEntries.findMany({ where: eq(tmTicketMaterialEntries.ticketId, ticketId) }),
        db.query.projects.findFirst({ where: eq(projects.id, ticket.projectId) }),
        db.query.users.findFirst({ where: eq(users.id, ticket.tfrRepresentativeId) }),
        db.query.users.findFirst({ where: eq(users.id, ticket.createdById) }),
      ]);
      
      const formatCurrency = (val: string | number | null) => {
        const num = typeof val === 'string' ? parseFloat(val) : (val || 0);
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
      };
      
      const formatDate = (dateStr: string | Date) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      };
      
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>T&M Work Ticket - ${ticket.ticketNumber}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; max-width: 800px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
    .header h1 { font-size: 24px; margin-bottom: 5px; }
    .header h2 { font-size: 16px; font-weight: normal; color: #666; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; }
    .info-row { display: flex; }
    .info-label { font-weight: bold; min-width: 120px; }
    .info-value { flex: 1; }
    .section { margin-bottom: 20px; }
    .section-title { font-size: 14px; font-weight: bold; background: #f0f0f0; padding: 5px 10px; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    th, td { border: 1px solid #333; padding: 5px 8px; text-align: left; }
    th { background: #f0f0f0; font-weight: bold; }
    .text-right { text-align: right; }
    .totals { margin-top: 20px; border-top: 2px solid #333; padding-top: 10px; }
    .totals-row { display: flex; justify-content: flex-end; margin-bottom: 5px; }
    .totals-label { font-weight: bold; min-width: 150px; }
    .totals-value { min-width: 100px; text-align: right; }
    .grand-total { font-size: 16px; font-weight: bold; border-top: 1px solid #333; padding-top: 10px; }
    .signatures { margin-top: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
    .signature-line { border-top: 1px solid #333; margin-top: 40px; padding-top: 5px; }
    .notes { background: #f9f9f9; padding: 10px; border: 1px solid #ddd; margin-top: 10px; }
    .status-badge { display: inline-block; padding: 3px 10px; border-radius: 3px; font-weight: bold; }
    .status-approved { background: #4ade80; color: #166534; }
    .status-submitted { background: #fbbf24; color: #92400e; }
    .status-draft { background: #e5e7eb; color: #374151; }
    .status-rejected { background: #f87171; color: #991b1b; }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>SmartManageAI</h1>
    <h2>TIME AND MATERIAL WORK TICKET</h2>
  </div>
  
  <div class="info-grid">
    <div class="info-row">
      <span class="info-label">Ticket Number:</span>
      <span class="info-value">${ticket.ticketNumber}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Status:</span>
      <span class="info-value">
        <span class="status-badge status-${ticket.status.toLowerCase()}">${ticket.status}</span>
      </span>
    </div>
    <div class="info-row">
      <span class="info-label">Project:</span>
      <span class="info-value">${project?.name || 'N/A'} (${project?.code || 'N/A'})</span>
    </div>
    <div class="info-row">
      <span class="info-label">Work Date:</span>
      <span class="info-value">${formatDate(ticket.workDate)}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Client:</span>
      <span class="info-value">${project?.clientName || 'N/A'}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Company Rep:</span>
      <span class="info-value">${rep ? `${rep.firstName} ${rep.lastName}` : 'N/A'}</span>
    </div>
    ${ticket.workOrderReference ? `
    <div class="info-row">
      <span class="info-label">Work Order Ref:</span>
      <span class="info-value">${ticket.workOrderReference}</span>
    </div>
    ` : ''}
  </div>
  
  <div class="section">
    <div class="section-title">SCOPE OF WORK</div>
    <div class="notes">${ticket.scopeDescription}</div>
    ${ticket.notes ? `
    <div style="margin-top: 10px;">
      <strong>Notes:</strong>
      <div class="notes">${ticket.notes}</div>
    </div>
    ` : ''}
  </div>
  
  ${laborEntries.length > 0 ? `
  <div class="section">
    <div class="section-title">LABOR</div>
    <table>
      <thead>
        <tr>
          <th>Employee Name</th>
          <th>Position</th>
          <th class="text-right">Crew</th>
          <th class="text-right">Hours</th>
          <th class="text-right">Rate</th>
          <th class="text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${laborEntries.map(entry => `
        <tr>
          <td>${entry.employeeName}</td>
          <td>${entry.position}</td>
          <td class="text-right">${entry.crewMemberCount}</td>
          <td class="text-right">${entry.hoursWorked}</td>
          <td class="text-right">${formatCurrency(entry.hourlyRate)}</td>
          <td class="text-right">${formatCurrency(entry.totalCost)}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}
  
  ${equipmentEntries.length > 0 ? `
  <div class="section">
    <div class="section-title">EQUIPMENT</div>
    <table>
      <thead>
        <tr>
          <th>Equipment Type</th>
          <th class="text-right">Quantity</th>
          <th class="text-right">Hours</th>
          <th class="text-right">Rate</th>
          <th class="text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${equipmentEntries.map(entry => `
        <tr>
          <td>${entry.equipmentType}</td>
          <td class="text-right">${entry.quantity}</td>
          <td class="text-right">${entry.hoursUsed}</td>
          <td class="text-right">${formatCurrency(entry.hourlyRate)}</td>
          <td class="text-right">${formatCurrency(entry.totalCost)}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}
  
  ${materialEntries.length > 0 ? `
  <div class="section">
    <div class="section-title">MATERIALS</div>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="text-right">Quantity</th>
          <th>Unit</th>
          <th class="text-right">Unit Cost</th>
          <th class="text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${materialEntries.map(entry => `
        <tr>
          <td>${entry.materialDescription}</td>
          <td class="text-right">${entry.quantity}</td>
          <td>${entry.unit || '-'}</td>
          <td class="text-right">${formatCurrency(entry.unitCost)}</td>
          <td class="text-right">${formatCurrency(entry.totalCost)}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}
  
  <div class="totals">
    <div class="totals-row">
      <span class="totals-label">Labor Total:</span>
      <span class="totals-value">${formatCurrency(ticket.totalLaborCost)}</span>
    </div>
    <div class="totals-row">
      <span class="totals-label">Equipment Total:</span>
      <span class="totals-value">${formatCurrency(ticket.totalEquipmentCost)}</span>
    </div>
    <div class="totals-row">
      <span class="totals-label">Materials Total:</span>
      <span class="totals-value">${formatCurrency(ticket.totalMaterialCost)}</span>
    </div>
    <div class="totals-row grand-total">
      <span class="totals-label">GRAND TOTAL:</span>
      <span class="totals-value">${formatCurrency(ticket.grandTotal)}</span>
    </div>
  </div>
  
  <div class="signatures">
    <div>
      <p><strong>Contractor Representative</strong></p>
      <div class="signature-line">
        <p>Name: ${rep ? `${rep.firstName} ${rep.lastName}` : '_________________'}</p>
        <p>Date: _________________</p>
      </div>
    </div>
    <div>
      <p><strong>Client Representative</strong></p>
      <div class="signature-line">
        <p>Name: _________________</p>
        <p>Date: _________________</p>
      </div>
    </div>
  </div>
  
  <div style="margin-top: 30px; font-size: 10px; color: #666; text-align: center;">
    <p>Generated on ${new Date().toLocaleString()} | SmartManageAI Construction Management Platform</p>
  </div>
</body>
</html>
      `;
      
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `inline; filename="tm-ticket-${ticket.ticketNumber}.html"`);
      res.send(html);
    } catch (error) {
      logError("Error generating T&M ticket PDF:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to generate T&M ticket PDF" });
    }
  });

  app.get("/api/projects/:projectId/tm-summary", requireAuth, requireFeaturePermission('canAccessTimeMaterial'), async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      
      const tickets = await db.query.tmTickets.findMany({
        where: eq(tmTickets.projectId, projectId),
      });
      
      const approvedTickets = tickets.filter(t => t.status === "APPROVED");
      const pendingTickets = tickets.filter(t => t.status === "SUBMITTED");
      
      const approvedTotal = approvedTickets.reduce((sum, t) => sum + Number(t.grandTotal || 0), 0);
      const pendingTotal = pendingTickets.reduce((sum, t) => sum + Number(t.grandTotal || 0), 0);
      
      res.json({
        totalTickets: tickets.length,
        approvedTickets: approvedTickets.length,
        pendingTickets: pendingTickets.length,
        draftTickets: tickets.filter(t => t.status === "DRAFT").length,
        rejectedTickets: tickets.filter(t => t.status === "REJECTED").length,
        approvedTotal,
        pendingTotal,
        totalLaborHours: approvedTickets.reduce((sum, t) => sum + Number(t.totalLaborHours || 0), 0),
      });
    } catch (error) {
      logError("Error fetching T&M summary:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to fetch T&M summary" });
    }
  });
}

async function recalculateTicketTotals(ticketId: string) {
  const [laborEntries, equipmentEntries, materialEntries] = await Promise.all([
    db.query.tmTicketLaborEntries.findMany({ where: eq(tmTicketLaborEntries.ticketId, ticketId) }),
    db.query.tmTicketEquipmentEntries.findMany({ where: eq(tmTicketEquipmentEntries.ticketId, ticketId) }),
    db.query.tmTicketMaterialEntries.findMany({ where: eq(tmTicketMaterialEntries.ticketId, ticketId) }),
  ]);
  
  const totalLaborHours = laborEntries.reduce((sum, e) => sum + Number(e.totalHours || 0), 0);
  const totalLaborCost = laborEntries.reduce((sum, e) => sum + Number(e.totalCost || 0), 0);
  const totalEquipmentCost = equipmentEntries.reduce((sum, e) => sum + Number(e.totalCost || 0), 0);
  const totalMaterialCost = materialEntries.reduce((sum, e) => sum + Number(e.totalCost || 0), 0);
  const grandTotal = totalLaborCost + totalEquipmentCost + totalMaterialCost;
  
  await db.update(tmTickets)
    .set({
      totalLaborHours: String(totalLaborHours),
      totalLaborCost: String(totalLaborCost),
      totalEquipmentCost: String(totalEquipmentCost),
      totalMaterialCost: String(totalMaterialCost),
      grandTotal: String(grandTotal),
      updatedAt: new Date(),
    })
    .where(eq(tmTickets.id, ticketId));
}
