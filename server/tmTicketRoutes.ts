import { Express } from "express";
import { db } from "./db";
import { 
  tmTickets, 
  tmTicketLaborEntries, 
  tmTicketEquipmentEntries, 
  tmTicketMaterialEntries,
  projects,
  users,
  auditLog,
  insertTMTicketSchema,
  insertTMTicketLaborEntrySchema,
  insertTMTicketEquipmentEntrySchema,
  insertTMTicketMaterialEntrySchema,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, AuthRequest } from "./auth";

function hasTMCreateAccess(role: string): boolean {
  return ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(role);
}

function hasTMApprovalAccess(role: string): boolean {
  return ["ADMIN", "MANAGER"].includes(role);
}

export function registerTMTicketRoutes(app: Express) {
  // Get all T&M tickets for a project
  app.get("/api/projects/:projectId/tm-tickets", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      
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
        workTypeId,
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
      
      // Create the ticket with standardized scope data
      const [newTicket] = await db.insert(tmTickets).values({
        ...restTicketData,
        projectId,
        ticketNumber,
        createdById: userId,
        tfrRepresentativeId: restTicketData.tfrRepresentativeId || userId,
        scopeDescription: description || restTicketData.scopeDescription || "Work performed",
        // Standardized scope of work (matches estimating sheets for production rate tracking)
        workTypeId: workTypeId || null,
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
    <h1>TFR CONSTRUCTION</h1>
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
      <span class="info-label">TFR Rep:</span>
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
      <p><strong>TFR Representative</strong></p>
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
    <p>Generated on ${new Date().toLocaleString()} | TFR Construction Management Platform</p>
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
