import { Express } from "express";
import { db } from "./db";
import { 
  tmTickets, 
  tmInvoices,
  projects,
  users,
  auditLog,
} from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth, AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

function hasBillingApprovalAccess(role: string): boolean {
  return ["ADMIN", "MANAGER", "OFFICE_MANAGER"].includes(role);
}

export function registerTMInvoiceRoutes(app: Express) {
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
      console.error("Error fetching pending billing tickets:", error);
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

      res.json(updated);
    } catch (error) {
      console.error("Error approving ticket for billing:", error);
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
      console.error("Error fetching approved billing tickets:", error);
      res.status(500).json({ error: "Failed to fetch approved billing tickets" });
    }
  });

  app.post("/api/tm-invoices", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Error creating invoice:", error);
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
      console.error("Error fetching invoices:", error);
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
      console.error("Error fetching invoice:", error);
      res.status(500).json({ error: "Failed to fetch invoice" });
    }
  });

  app.post("/api/tm-invoices/:invoiceId/send", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Error sending invoice:", error);
      res.status(500).json({ error: "Failed to send invoice" });
    }
  });

  app.post("/api/tm-invoices/:invoiceId/mark-paid", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Error marking invoice as paid:", error);
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
      console.error("Error fetching billing summary:", error);
      res.status(500).json({ error: "Failed to fetch billing summary" });
    }
  });
}
