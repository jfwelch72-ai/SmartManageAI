import { Express } from "express";
import { db } from "./db";
import { 
  tmTickets, 
  users,
  auditLog,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { requireAuth, AuthRequest } from "./auth";
import { notifyApprovers, notifySubmitter } from "./services/approvalNotificationService";

function hasTMApprovalAccess(role: string): boolean {
  return ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(role);
}

export function registerTMApprovalRoutes(app: Express) {
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
      console.error("Error submitting T&M ticket:", error);
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
        });
      }
      
      res.json(updatedTicket);
    } catch (error) {
      console.error("Error approving T&M ticket:", error);
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
        });
      }
      
      res.json(updatedTicket);
    } catch (error) {
      console.error("Error rejecting T&M ticket:", error);
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
      console.error("Error uploading signed document:", error);
      res.status(500).json({ error: "Failed to upload signed document" });
    }
  });
}
