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
      
      const { laborEntries, equipmentEntries, materialEntries, ...ticketData } = req.body;
      
      // Create the ticket
      const [newTicket] = await db.insert(tmTickets).values({
        ...ticketData,
        projectId,
        ticketNumber,
        createdById: userId,
        tfrRepresentativeId: ticketData.tfrRepresentativeId || userId,
        status: "DRAFT",
      }).returning();
      
      // Insert labor entries
      if (laborEntries && laborEntries.length > 0) {
        await db.insert(tmTicketLaborEntries).values(
          laborEntries.map((entry: any) => ({
            ticketId: newTicket.id,
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
      
      // Insert equipment entries
      if (equipmentEntries && equipmentEntries.length > 0) {
        await db.insert(tmTicketEquipmentEntries).values(
          equipmentEntries.map((entry: any) => ({
            ticketId: newTicket.id,
            equipmentType: entry.equipmentType,
            quantity: entry.quantity || 1,
            hoursUsed: entry.hoursUsed,
            hourlyRate: entry.hourlyRate || null,
            totalCost: entry.totalCost || null,
          }))
        );
      }
      
      // Insert material entries
      if (materialEntries && materialEntries.length > 0) {
        await db.insert(tmTicketMaterialEntries).values(
          materialEntries.map((entry: any) => ({
            ticketId: newTicket.id,
            materialDescription: entry.materialDescription,
            quantity: entry.quantity,
            unit: entry.unit,
            unitCost: entry.unitCost || null,
            totalCost: entry.totalCost || null,
          }))
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
