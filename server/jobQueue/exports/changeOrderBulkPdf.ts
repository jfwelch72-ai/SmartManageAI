// Task #2517 — `bulk_export` generator for the change-order bulk PDF
// ZIP download (`/api/change-orders/project/:projectId/bulk-pdf`).
// Mirrors the legacy inline path; writes the ZIP to GCS instead of
// streaming straight to the HTTP client.

import { eq } from "drizzle-orm";
import { PassThrough } from "node:stream";
import { db } from "../../db";
import {
  projects,
  changeOrders,
  changeOrderApprovals,
  changeOrderRevisions,
  orgCostCodes,
  rfis,
  tmTickets,
  users,
  organizations,
} from "@shared/schema";
import { logError, logWarn } from "../../utils/logger";
import { registerExportGenerator } from "../handlers";
import { uploadExportArtifact } from "./uploadExportArtifact";
import type { JobContext } from "../index";

export const CHANGE_ORDER_BULK_PDF_EXPORT_TYPE = "change_order_bulk_pdf";

export interface ChangeOrderBulkPdfParams {
  organizationId: string;
  projectId: string;
  changeOrderIds?: string[];
}

function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function runChangeOrderBulkPdfExport(
  p: ChangeOrderBulkPdfParams,
  _ctx: JobContext,
): Promise<{ url: string; bytes: number }> {
  const [projectData] = await db
    .select({
      id: projects.id,
      name: projects.name,
      code: projects.code,
      clientName: projects.clientName,
      locationAddress: projects.locationAddress,
      gcOrganizationId: projects.gcOrganizationId,
    })
    .from(projects)
    .where(eq(projects.id, p.projectId))
    .limit(1);
  if (!projectData) {
    throw new Error(`Project ${p.projectId} not found`);
  }

  const allCOs = await db
    .select()
    .from(changeOrders)
    .where(eq(changeOrders.projectId, p.projectId));
  const draftStatuses = new Set(["DRAFT", "PENDING_APPROVAL"]);
  let eligible = allCOs.filter((co) => !draftStatuses.has(co.status));
  if (p.changeOrderIds && p.changeOrderIds.length > 0) {
    const sel = new Set(p.changeOrderIds);
    eligible = eligible.filter((co) => sel.has(co.id));
  }
  if (eligible.length === 0) {
    throw new Error("No eligible change orders to export");
  }

  let orgBranding: { organizationName: string; primaryColor?: string } | undefined;
  if (projectData.gcOrganizationId) {
    const [org] = await db
      .select({ name: organizations.name, primaryColor: organizations.primaryColor })
      .from(organizations)
      .where(eq(organizations.id, projectData.gcOrganizationId))
      .limit(1);
    if (org) {
      orgBranding = {
        organizationName: org.name,
        primaryColor: org.primaryColor || undefined,
      };
    }
  }

  const { generateChangeOrderPDF } = await import("../../co-pdf-service");
  const archiver = (await import("archiver")).default;
  const archive = archiver("zip", { zlib: { level: 5 } });
  const passthrough = new PassThrough();
  archive.pipe(passthrough);

  // Buffer the archive in memory — bulk-pdf zips are typically <50MB,
  // and the legacy path materialised them in memory too via the HTTP
  // response buffer.
  const chunks: Buffer[] = [];
  passthrough.on("data", (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  const finished = new Promise<void>((resolve, reject) => {
    passthrough.on("end", () => resolve());
    passthrough.on("error", reject);
    archive.on("error", reject);
  });

  for (const co of eligible) {
    try {
      let costBreakdownData: unknown = null;
      if (co.costBreakdownJson) {
        costBreakdownData =
          typeof co.costBreakdownJson === "string"
            ? safeJsonParse(co.costBreakdownJson, null)
            : co.costBreakdownJson;
      }

      let costCodeLabel: string | null = null;
      if (co.costCodeId) {
        const [cc] = await db
          .select({ code: orgCostCodes.code, description: orgCostCodes.description })
          .from(orgCostCodes)
          .where(eq(orgCostCodes.id, co.costCodeId))
          .limit(1);
        if (cc) costCodeLabel = `${cc.code} — ${cc.description}`;
      }

      const [requestedBy] = await db
        .select({ firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(eq(users.id, co.requestedById))
        .limit(1);

      let approvedByName: string | undefined;
      if (co.approvedById) {
        const [approver] = await db
          .select({ firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(eq(users.id, co.approvedById))
          .limit(1);
        if (approver) approvedByName = `${approver.firstName} ${approver.lastName}`;
      }

      let linkedRfiNumber: string | null = null;
      if (co.linkedRfiId) {
        const [rfi] = await db
          .select({ rfiNumber: rfis.rfiNumber })
          .from(rfis)
          .where(eq(rfis.id, co.linkedRfiId))
          .limit(1);
        if (rfi) linkedRfiNumber = rfi.rfiNumber;
      }

      let linkedTmTicketNumber: string | null = null;
      if (co.linkedTmTicketId) {
        const [tm] = await db
          .select({ ticketNumber: tmTickets.ticketNumber })
          .from(tmTickets)
          .where(eq(tmTickets.id, co.linkedTmTicketId))
          .limit(1);
        if (tm) linkedTmTicketNumber = tm.ticketNumber;
      }

      let contractNumber: string | null = null;
      if (co.contractId) {
        const { contracts } = await import("@shared/schema");
        const [contract] = await db
          .select({ contractNumber: contracts.contractNumber })
          .from(contracts)
          .where(eq(contracts.id, co.contractId))
          .limit(1);
        if (contract) contractNumber = contract.contractNumber;
      }

      const approvalRows = await db
        .select({
          approval: {
            approverRole: changeOrderApprovals.approverRole,
            status: changeOrderApprovals.status,
            stepOrder: changeOrderApprovals.stepOrder,
            comments: changeOrderApprovals.comments,
            decidedAt: changeOrderApprovals.decidedAt,
          },
        })
        .from(changeOrderApprovals)
        .where(eq(changeOrderApprovals.changeOrderId, co.id))
        .orderBy(changeOrderApprovals.stepOrder);

      const revisionRows = await db
        .select({
          revision: {
            revisionNumber: changeOrderRevisions.revisionNumber,
            previousStatus: changeOrderRevisions.previousStatus,
            newStatus: changeOrderRevisions.newStatus,
            description: changeOrderRevisions.description,
            createdAt: changeOrderRevisions.createdAt,
          },
        })
        .from(changeOrderRevisions)
        .where(eq(changeOrderRevisions.changeOrderId, co.id))
        .orderBy(changeOrderRevisions.revisionNumber);

      const stream = generateChangeOrderPDF({
        changeOrder: {
          ...co,
          costCodeLabel,
          linkedTmTicketNumber,
          linkedRfiNumber,
          contractNumber,
          requestedByName: requestedBy ? `${requestedBy.firstName} ${requestedBy.lastName}` : undefined,
          approvedByName,
        },
        project: {
          name: projectData.name,
          code: projectData.code,
          clientName: projectData.clientName || undefined,
          locationAddress: projectData.locationAddress,
        },
        lineItems: costBreakdownData as Parameters<typeof generateChangeOrderPDF>[0]["lineItems"],
        approvals: approvalRows.map((a) => ({
          ...a.approval,
          decidedAt: a.approval.decidedAt ? String(a.approval.decidedAt) : null,
        })),
        revisions: revisionRows.map((r) => ({
          ...r.revision,
          createdAt: String(r.revision.createdAt),
        })),
        branding: orgBranding,
      });

      const safeNumber = co.changeOrderNumber.replace(/[^a-zA-Z0-9-]/g, "_");
      archive.append(stream, { name: `${safeNumber}.pdf` });
    } catch (coErr) {
      logWarn(`Bulk PDF: skipping CO ${co.changeOrderNumber}`, {
        error: String(coErr),
      });
    }
  }

  await archive.finalize();
  try {
    await finished;
  } catch (err) {
    logError("change_order_bulk_pdf archive failed", {}, err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
  const buf = Buffer.concat(chunks);

  const safeProjectCode = projectData.code.replace(/[^a-zA-Z0-9-]/g, "_");
  return uploadExportArtifact({
    organizationId: p.organizationId,
    extension: "zip",
    filename: `ChangeOrders_${safeProjectCode}`,
    contentType: "application/zip",
    body: buf,
  });
}

registerExportGenerator(CHANGE_ORDER_BULK_PDF_EXPORT_TYPE, async (params, ctx) => {
  const typed = params as unknown as ChangeOrderBulkPdfParams;
  return runChangeOrderBulkPdfExport(typed, ctx);
});
