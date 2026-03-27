import { eventBus } from "../eventBus";
import { logError } from "../../utils/logger";
import { postTransaction, bulkPost } from "../../costEngineService";
import type {
  PayrollRunCompletedEvent,
  PoReceiptRecordedEvent,
  TmTicketApprovedEvent,
  SubcontractorPaymentMadeEvent,
  ReceiptCreatedEvent,
} from "../eventTypes";

export function registerCostEngineListener(): void {
  eventBus.on("payroll.run.completed", async (event: PayrollRunCompletedEvent) => {
    try {
      const { db } = await import("../../db");
      const { costLedgerPostings } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const postings = await db
        .select()
        .from(costLedgerPostings)
        .where(eq(costLedgerPostings.payRunId, event.payload.payRunId));

      if (postings.length > 0) {
        const inputs = postings.map(p => ({
          projectId: p.projectId,
          costCode: p.costCode || "UNASSIGNED",
          sourceCategory: "LABOR" as const,
          originModule: "PAYROLL" as const,
          amount: Number(p.burdenedTotalAmount) > 0 ? String(p.burdenedTotalAmount) : String(p.totalAmount),
          transactionDate: new Date().toISOString().split("T")[0],
          referenceId: `payrun:${event.payload.payRunId}`,
          description: `Payroll run ${event.payload.periodStart} – ${event.payload.periodEnd}`,
          createdBy: event.actorId !== "system" ? event.actorId : undefined,
        }));
        await bulkPost(inputs);
      }
    } catch (err) {
      logError("costEngineListener: payroll.run.completed failed", { error: String(err) });
    }
  });

  eventBus.on("po.receipt_recorded", async (event: PoReceiptRecordedEvent) => {
    try {
      const inputs = event.payload.items
        .filter(item => item.amount > 0)
        .map(item => ({
          projectId: event.payload.projectId,
          costCode: item.costCode || "UNASSIGNED",
          sourceCategory: "MATERIAL" as const,
          originModule: "PO" as const,
          amount: String(item.amount),
          transactionDate: new Date().toISOString().split("T")[0],
          referenceId: `po_receipt:${event.payload.receiptId}`,
          description: item.description || `PO receipt for PO ${event.payload.poId}`,
          createdBy: event.actorId !== "system" ? event.actorId : undefined,
        }));

      if (inputs.length > 0) {
        await bulkPost(inputs);
      }
    } catch (err) {
      logError("costEngineListener: po.receipt_recorded failed", { error: String(err) });
    }
  });

  eventBus.on("tm_ticket.approved", async (event: TmTicketApprovedEvent) => {
    try {
      const inputs = [];
      const baseRef = `tm_ticket:${event.payload.ticketId}`;
      const date = new Date().toISOString().split("T")[0];
      const costCode = event.payload.costCode || "UNASSIGNED";

      if (event.payload.laborCost > 0) {
        inputs.push({
          projectId: event.payload.projectId,
          costCode,
          sourceCategory: "LABOR" as const,
          originModule: "TM" as const,
          amount: String(event.payload.laborCost),
          transactionDate: date,
          referenceId: baseRef,
          description: `T&M ticket labor`,
          createdBy: event.actorId !== "system" ? event.actorId : undefined,
        });
      }
      if (event.payload.equipmentCost > 0) {
        inputs.push({
          projectId: event.payload.projectId,
          costCode,
          sourceCategory: "EQUIPMENT" as const,
          originModule: "TM" as const,
          amount: String(event.payload.equipmentCost),
          transactionDate: date,
          referenceId: baseRef,
          description: `T&M ticket equipment`,
          createdBy: event.actorId !== "system" ? event.actorId : undefined,
        });
      }
      if (event.payload.materialCost > 0) {
        inputs.push({
          projectId: event.payload.projectId,
          costCode,
          sourceCategory: "MATERIAL" as const,
          originModule: "TM" as const,
          amount: String(event.payload.materialCost),
          transactionDate: date,
          referenceId: baseRef,
          description: `T&M ticket materials`,
          createdBy: event.actorId !== "system" ? event.actorId : undefined,
        });
      }

      if (inputs.length > 0) {
        await bulkPost(inputs);
      }
    } catch (err) {
      logError("costEngineListener: tm_ticket.approved failed", { error: String(err) });
    }
  });

  eventBus.on("subcontractor.payment_made", async (event: SubcontractorPaymentMadeEvent) => {
    try {
      if (event.payload.amount > 0) {
        await postTransaction({
          projectId: event.payload.projectId,
          costCode: event.payload.costCode || "UNASSIGNED",
          sourceCategory: "SUBCONTRACTOR",
          originModule: "SUBCONTRACTOR",
          amount: String(event.payload.amount),
          transactionDate: new Date().toISOString().split("T")[0],
          referenceId: `sub_payment:${event.payload.paymentId}`,
          description: `Subcontractor payment for contract ${event.payload.contractId}`,
          createdBy: event.actorId !== "system" ? event.actorId : undefined,
        });
      }
    } catch (err) {
      logError("costEngineListener: subcontractor.payment_made failed", { error: String(err) });
    }
  });

  eventBus.on("receipt.created", async (event: ReceiptCreatedEvent) => {
    try {
      if (event.payload.amount > 0) {
        await postTransaction({
          projectId: event.payload.projectId,
          costCode: event.payload.costCode || "UNASSIGNED",
          sourceCategory: "OTHER",
          originModule: "RECEIPT",
          amount: String(event.payload.amount),
          transactionDate: new Date().toISOString().split("T")[0],
          referenceId: `receipt:${event.payload.receiptId}`,
          description: `Receipt expense${event.payload.category ? ` (${event.payload.category})` : ""}`,
          createdBy: event.actorId !== "system" ? event.actorId : undefined,
        });
      }
    } catch (err) {
      logError("costEngineListener: receipt.created failed", { error: String(err) });
    }
  });
}
