import { Express } from "express";
import { db } from "./db";
import { 
  tmTickets, 
  tmTicketLaborEntries, 
  tmTicketEquipmentEntries, 
  tmTicketMaterialEntries,
  tmInvoices,
  projects,
  users,
  organizations,
  auditLog,
  insertTMTicketSchema,
  insertTMTicketLaborEntrySchema,
  insertTMTicketEquipmentEntrySchema,
  insertTMTicketMaterialEntrySchema,
  insertTMInvoiceSchema,
} from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { requireAuth, AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

function hasTMCreateAccess(role: string): boolean {
  return ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(role);
}

function hasTMApprovalAccess(role: string): boolean {
  return ["ADMIN", "MANAGER"].includes(role);
}

function hasBillingApprovalAccess(role: string): boolean {
  return ["ADMIN", "MANAGER", "OFFICE_MANAGER"].includes(role);
}

export function registerTMTicketRoutes(app: Express) {
  // Get all T&M tickets for a project
  app.get("/api/projects/:projectId/tm-tickets", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }

      const { projectId } = req.params;
      
      // Verify project exists and check org access
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
      
      // Get user info for each ticket
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
      console.error("Error fetching T&M tickets:", error);
      res.status(500).json({ error: "Failed to fetch T&M tickets" });
    }
  });

  // Get a single T&M ticket with all entries
  app.get("/api/tm-tickets/:ticketId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { ticketId } = req.params;
      
      const ticket = await db.query.tmTickets.findFirst({
        where: eq(tmTickets.id, ticketId),
      });
      
      if (!ticket) {
        return res.status(404).json({ error: "T&M ticket not found" });
      }
      
      // Get all entries
      const [laborEntries, equipmentEntries, materialEntries] = await Promise.all([
        db.query.tmTicketLaborEntries.findMany({ where: eq(tmTicketLaborEntries.ticketId, ticketId) }),
        db.query.tmTicketEquipmentEntries.findMany({ where: eq(tmTicketEquipmentEntries.ticketId, ticketId) }),
        db.query.tmTicketMaterialEntries.findMany({ where: eq(tmTicketMaterialEntries.ticketId, ticketId) }),
      ]);
      
      // Get related user info
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
      console.error("Error fetching T&M ticket:", error);
      res.status(500).json({ error: "Failed to fetch T&M ticket" });
    }
  });

  // Create a new T&M ticket
  app.post("/api/projects/:projectId/tm-tickets", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user!.id;
      
      if (!hasTMCreateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions to create T&M tickets" });
      }
      
      // Verify project exists
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, projectId),
      });
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      // Generate ticket number
      const existingTickets = await db.query.tmTickets.findMany({
        where: eq(tmTickets.projectId, projectId),
      });
      const ticketNumber = `TM-${project.code}-${String(existingTickets.length + 1).padStart(3, '0')}`;
      
      const { 
        laborEntries, 
        equipmentEntries, 
        materialEntries, 
        description,
        // Standardized scope fields
        workTypeId, // Frontend sends organizationSowItemId here
        organizationSowItemId, // Direct field if sent
        workTypeCode,
        workTypeName,
        categoryName,
        scopeModifierIds,
        scopeModifierNames,
        canonicalName,
        scopeUnit,
        scopeQuantity,
        ...restTicketData 
      } = req.body;
      
      // Use organizationSowItemId if provided, otherwise use workTypeId (frontend compatibility)
      const sowItemId = organizationSowItemId || workTypeId || null;
      
      // Create the ticket with standardized scope data
      const [newTicket] = await db.insert(tmTickets).values({
        ...restTicketData,
        projectId,
        ticketNumber,
        createdById: userId,
        tfrRepresentativeId: restTicketData.tfrRepresentativeId || userId,
        scopeDescription: description || restTicketData.scopeDescription || "Work performed",
        // Link to organization SOW item for unified tracking (Estimate → Project → T&M → Production Rates)
        organizationSowItemId: sowItemId,
        // workTypeId is for scope_work_types category reference, not org SOW items
        workTypeId: null,
        workTypeCode: workTypeCode || null,
        workTypeName: workTypeName || null,
        categoryName: categoryName || null,
        // Frontend sends these as JSON strings already
        scopeModifierIds: scopeModifierIds || null,
        scopeModifierNames: scopeModifierNames || null,
        canonicalName: canonicalName || null,
        scopeUnit: scopeUnit || null,
        scopeQuantity: scopeQuantity || null,
        status: "DRAFT",
      }).returning();
      
      // Insert labor entries (map frontend fields to database columns)
      if (laborEntries && laborEntries.length > 0) {
        await db.insert(tmTicketLaborEntries).values(
          laborEntries.map((entry: any) => {
            const regularHours = parseFloat(entry.regularHours || entry.hoursWorked || "0");
            const overtimeHours = parseFloat(entry.overtimeHours || "0");
            const regularRate = parseFloat(entry.rate || entry.hourlyRate || "0");
            const overtimeRate = parseFloat(entry.overtimeRate || String(regularRate * 1.5));
            const totalHours = regularHours + overtimeHours;
            const totalCost = (regularHours * regularRate) + (overtimeHours * overtimeRate);
            
            return {
              ticketId: newTicket.id,
              employeeName: entry.employeeName,
              position: entry.position || "General Labor",
              crewMemberCount: entry.crewMemberCount || 1,
              hoursWorked: String(regularHours),
              totalHours: String(totalHours),
              hourlyRate: String(regularRate),
              totalCost: String(totalCost),
            };
          })
        );
      }
      
      // Insert equipment entries (map frontend fields to database columns)
      if (equipmentEntries && equipmentEntries.length > 0) {
        await db.insert(tmTicketEquipmentEntries).values(
          equipmentEntries.map((entry: any) => {
            const qty = parseFloat(entry.quantity || "1");
            const hours = parseFloat(entry.hours || entry.hoursUsed || "0");
            const rate = parseFloat(entry.rate || entry.hourlyRate || "0");
            const totalCost = qty * hours * rate;
            
            return {
              ticketId: newTicket.id,
              equipmentType: entry.equipmentType,
              quantity: qty,
              hoursUsed: String(hours),
              hourlyRate: String(rate),
              totalCost: String(totalCost),
            };
          })
        );
      }
      
      // Insert material entries (map frontend fields to database columns)
      if (materialEntries && materialEntries.length > 0) {
        await db.insert(tmTicketMaterialEntries).values(
          materialEntries.map((entry: any) => {
            const qty = parseFloat(entry.quantity || "1");
            const unitCost = parseFloat(entry.unitCost || "0");
            const totalCost = qty * unitCost;
            
            return {
              ticketId: newTicket.id,
              materialDescription: entry.description || entry.materialDescription,
              quantity: String(qty),
              unit: entry.unit || "EA",
              unitCost: String(unitCost),
              totalCost: String(totalCost),
            };
          })
        );
      }
      
      // Recalculate totals
      await recalculateTicketTotals(newTicket.id);
      
      // Audit log
      await db.insert(auditLog).values({
        userId,
        action: "CREATE",
        entityType: "tm_ticket",
        entityId: newTicket.id,
        newValue: JSON.stringify({ ticketNumber, projectId }),
      });
      
      res.status(201).json(newTicket);
    } catch (error) {
      console.error("Error creating T&M ticket:", error);
      res.status(500).json({ error: "Failed to create T&M ticket" });
    }
  });

  // Update a T&M ticket
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
      
      // Only allow editing of DRAFT or REJECTED tickets
      if (ticket.status !== "DRAFT" && ticket.status !== "REJECTED") {
        return res.status(400).json({ error: "Cannot edit a submitted or approved ticket" });
      }
      
      if (!hasTMCreateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      
      const { laborEntries, equipmentEntries, materialEntries, ...ticketData } = req.body;
      
      // Update ticket
      const [updatedTicket] = await db.update(tmTickets)
        .set({
          ...ticketData,
          status: "DRAFT", // Reset to draft if rejected
          rejectedAt: null,
          rejectedById: null,
          rejectionReason: null,
          updatedAt: new Date(),
        })
        .where(eq(tmTickets.id, ticketId))
        .returning();
      
      // Replace labor entries
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
      
      // Replace equipment entries
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
      
      // Replace material entries
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
      
      // Recalculate totals
      await recalculateTicketTotals(ticketId);
      
      // Audit log
      await db.insert(auditLog).values({
        userId,
        action: "UPDATE",
        entityType: "tm_ticket",
        entityId: ticketId,
        newValue: JSON.stringify({ ticketNumber: ticket.ticketNumber }),
      });
      
      res.json(updatedTicket);
    } catch (error) {
      console.error("Error updating T&M ticket:", error);
      res.status(500).json({ error: "Failed to update T&M ticket" });
    }
  });

  // Submit a T&M ticket for approval
  app.post("/api/tm-tickets/:ticketId/submit", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { ticketId } = req.params;
      const userId = req.user!.id;
      
      const ticket = await db.query.tmTickets.findFirst({
        where: eq(tmTickets.id, ticketId),
      });
      
      if (!ticket) {
        return res.status(404).json({ error: "T&M ticket not found" });
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
      
      // Audit log
      await db.insert(auditLog).values({
        userId,
        action: "SUBMIT",
        entityType: "tm_ticket",
        entityId: ticketId,
        newValue: JSON.stringify({ ticketNumber: ticket.ticketNumber }),
      });
      
      res.json(updatedTicket);
    } catch (error) {
      console.error("Error submitting T&M ticket:", error);
      res.status(500).json({ error: "Failed to submit T&M ticket" });
    }
  });

  // Approve a T&M ticket
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
      
      if (ticket.status !== "SUBMITTED") {
        return res.status(400).json({ error: "Only submitted tickets can be approved" });
      }
      
      const [updatedTicket] = await db.update(tmTickets)
        .set({
          status: "APPROVED",
          approvedAt: new Date(),
          approvedById: userId,
          updatedAt: new Date(),
        })
        .where(eq(tmTickets.id, ticketId))
        .returning();
      
      // Audit log
      await db.insert(auditLog).values({
        userId,
        action: "APPROVE",
        entityType: "tm_ticket",
        entityId: ticketId,
        newValue: JSON.stringify({ ticketNumber: ticket.ticketNumber, grandTotal: ticket.grandTotal }),
      });
      
      res.json(updatedTicket);
    } catch (error) {
      console.error("Error approving T&M ticket:", error);
      res.status(500).json({ error: "Failed to approve T&M ticket" });
    }
  });

  // Reject a T&M ticket
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
      
      // Audit log
      await db.insert(auditLog).values({
        userId,
        action: "REJECT",
        entityType: "tm_ticket",
        entityId: ticketId,
        newValue: JSON.stringify({ ticketNumber: ticket.ticketNumber, reason }),
      });
      
      res.json(updatedTicket);
    } catch (error) {
      console.error("Error rejecting T&M ticket:", error);
      res.status(500).json({ error: "Failed to reject T&M ticket" });
    }
  });

  // Upload signed document
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
      
      // Audit log
      await db.insert(auditLog).values({
        userId,
        action: "UPDATE",
        entityType: "tm_ticket",
        entityId: ticketId,
        newValue: JSON.stringify({ action: "signed_document_upload", fileName }),
      });
      
      res.json(updatedTicket);
    } catch (error) {
      console.error("Error uploading signed document:", error);
      res.status(500).json({ error: "Failed to upload signed document" });
    }
  });

  // Delete a T&M ticket
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
      
      // Only allow deletion of DRAFT tickets or by admin
      if (ticket.status !== "DRAFT" && req.user!.role !== "ADMIN") {
        return res.status(400).json({ error: "Only draft tickets can be deleted" });
      }
      
      if (!hasTMCreateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      
      await db.delete(tmTickets).where(eq(tmTickets.id, ticketId));
      
      // Audit log
      await db.insert(auditLog).values({
        userId,
        action: "DELETE",
        entityType: "tm_ticket",
        entityId: ticketId,
        oldValue: JSON.stringify({ ticketNumber: ticket.ticketNumber }),
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting T&M ticket:", error);
      res.status(500).json({ error: "Failed to delete T&M ticket" });
    }
  });

  // Generate PDF-ready HTML for a T&M ticket
  app.get("/api/tm-tickets/:ticketId/pdf", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { ticketId } = req.params;
      
      const ticket = await db.query.tmTickets.findFirst({
        where: eq(tmTickets.id, ticketId),
      });
      
      if (!ticket) {
        return res.status(404).json({ error: "T&M ticket not found" });
      }
      
      // Get all entries and related info
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
      
      // Generate HTML document for PDF
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
      console.error("Error generating T&M ticket PDF:", error);
      res.status(500).json({ error: "Failed to generate T&M ticket PDF" });
    }
  });

  // Get T&M summary for a project (for financial overview)
  app.get("/api/projects/:projectId/tm-summary", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Error fetching T&M summary:", error);
      res.status(500).json({ error: "Failed to fetch T&M summary" });
    }
  });

  // ============== BILLING WORKFLOW ENDPOINTS ==============

  // Get tickets pending billing approval (approved work tickets that haven't been billed)
  app.get("/api/tm-billing/pending", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      const effectiveRole = req.user?.effectiveRole || req.user?.role;
      
      if (mustDenyAccess || !hasBillingApprovalAccess(effectiveRole || "")) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Get all approved tickets pending billing
      const tickets = await db.query.tmTickets.findMany({
        where: and(
          eq(tmTickets.status, "APPROVED"),
          eq(tmTickets.billingStatus, "PENDING")
        ),
        orderBy: [desc(tmTickets.workDate)],
      });

      // Filter by organization if needed
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

      // Enrich with project and user info
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

  // Approve ticket for billing
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

      // Create audit log
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

  // Get tickets approved for billing (ready to invoice)
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

      // Filter by organization
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

  // Generate invoice from approved tickets
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

      // Verify all tickets exist and are approved for billing
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

      // Get project info
      const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId || tickets[0].projectId) });
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Calculate totals
      const subtotal = tickets.reduce((sum, t) => sum + Number(t.grandTotal || 0), 0);
      const tax = taxRate ? subtotal * (Number(taxRate) / 100) : 0;
      const total = subtotal + tax;

      // Generate invoice number
      const orgId = project.gcOrganizationId;
      const existingInvoices = await db.query.tmInvoices.findMany({
        where: eq(tmInvoices.organizationId, orgId),
      });
      const invoiceNumber = `TM-${String(existingInvoices.length + 1).padStart(5, "0")}`;

      // Create invoice
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

      // Update tickets to link to invoice
      await db.update(tmTickets)
        .set({
          billingStatus: "INVOICED",
          invoiceId: invoice.id,
          updatedAt: new Date(),
        })
        .where(inArray(tmTickets.id, ticketIds));

      // Create audit log
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

  // Get all invoices for organization
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

      // Enrich with project and ticket count
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

  // Get single invoice with tickets
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

  // Mark invoice as sent
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

  // Mark invoice as paid (marks all tickets as BILLED)
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

      // Update invoice status
      const [updated] = await db.update(tmInvoices)
        .set({
          status: "PAID",
          paidAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tmInvoices.id, invoiceId))
        .returning();

      // Update all tickets to BILLED
      await db.update(tmTickets)
        .set({
          billingStatus: "BILLED",
          billedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tmTickets.invoiceId, invoiceId));

      // Create audit log
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

  // Get billing summary/dashboard data
  app.get("/api/tm-billing/summary", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      const effectiveRole = req.user?.effectiveRole || req.user?.role;
      
      if (mustDenyAccess || !hasBillingApprovalAccess(effectiveRole || "")) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Get all tickets with billing status
      const allTickets = await db.query.tmTickets.findMany({
        where: eq(tmTickets.status, "APPROVED"),
      });

      // Filter by org if needed
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

      // Get invoices
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

// Helper function to recalculate ticket totals
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
