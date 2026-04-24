/**
 * Task #1606 — shared row resolution + PDF buffer helpers for the
 * project RFI / submittal logs.
 *
 * Background
 * ----------
 * `server/rfiRoutes.ts` and `server/submittalRoutes.ts` each ship the
 * "Download log (PDF)" endpoint introduced in Task #1599 Phase A. Now
 * that the same logs are also delivered on a schedule by the cron in
 * `jobRunner.ts` (`processProjectLogEmailSchedules`), we factor the
 * row-resolution + branding lookup out of the routes so the cron and
 * the on-demand endpoint share one code path.
 *
 * Why factor at the row level instead of the buffer level
 * -------------------------------------------------------
 * The route streams PDFKit chunks straight to the HTTP response (no
 * in-memory buffering). The cron, by contrast, must hand a Buffer to
 * the email transport. Returning typed rows from this module keeps
 * the route's streaming behaviour intact — it pipes the stream
 * `generateRfiLogPdf` returns directly — while letting the cron call
 * `streamToBuffer` to materialise the same bytes for the attachment.
 */

import { PassThrough } from "stream";
import { and, desc, eq, inArray } from "drizzle-orm";
import { aliasedTable } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  projects,
  rfis,
  submittalReviews,
  submittals,
  users,
} from "@shared/schema";
import {
  generateRfiLogPdf,
  generateSubmittalLogPdf,
  type LogPdfBranding,
  type RfiLogRow,
  type SubmittalLogRow,
} from "./logPdfService";

export type ProjectLogProjectInfo = {
  id: string;
  name: string;
  gcOrganizationId: string | null;
};

/**
 * Resolves the org branding strip the PDF header uses. Returns
 * `undefined` (NOT a partial branding object) when there's no GC org —
 * the PDF service falls back to its built-in defaults in that case.
 */
export async function fetchProjectBranding(gcOrganizationId: string | null): Promise<LogPdfBranding | undefined> {
  if (!gcOrganizationId) return undefined;
  const [orgRow] = await db
    .select({ name: organizations.name, primaryColor: organizations.primaryColor })
    .from(organizations)
    .where(eq(organizations.id, gcOrganizationId))
    .limit(1);
  if (!orgRow) return undefined;
  return { organizationName: orgRow.name, primaryColor: orgRow.primaryColor ?? null };
}

/**
 * Pulls the RFI rows for `projectId` shaped exactly the way
 * `generateRfiLogPdf` wants them, including the joined "ball-in-court"
 * resolution that the route used to do inline. Sorted newest-first to
 * match the on-demand download.
 */
export async function fetchProjectRfiLogRows(projectId: string): Promise<RfiLogRow[]> {
  const assignedUser = aliasedTable(users, "rfi_assigned_user");
  const forwardedUser = aliasedTable(users, "rfi_forwarded_user");
  const rows = await db
    .select({
      rfiNumber: rfis.rfiNumber,
      subject: rfis.subject,
      status: rfis.status,
      priority: rfis.priority,
      dateSubmitted: rfis.dateSubmitted,
      dateRequired: rfis.dateRequired,
      dateAnswered: rfis.dateAnswered,
      submittedByName: rfis.submittedByName,
      answeredByName: rfis.answeredByName,
      updatedAt: rfis.updatedAt,
      assignedFirst: assignedUser.firstName,
      assignedLast: assignedUser.lastName,
      forwardedFirst: forwardedUser.firstName,
      forwardedLast: forwardedUser.lastName,
      externalAssigneeEmail: rfis.externalAssigneeEmail,
    })
    .from(rfis)
    .leftJoin(assignedUser, eq(assignedUser.id, rfis.assignedToId))
    .leftJoin(forwardedUser, eq(forwardedUser.id, rfis.forwardedToId))
    .where(eq(rfis.projectId, projectId))
    .orderBy(desc(rfis.createdAt));

  const fullName = (first?: string | null, last?: string | null): string | null => {
    const v = `${first ?? ""} ${last ?? ""}`.trim();
    return v.length ? v : null;
  };
  const ballInCourt = (r: typeof rows[number]): string | null => {
    const closed = r.status === "ANSWERED" || r.status === "CLOSED";
    if (closed) return r.answeredByName ?? null;
    return (
      fullName(r.forwardedFirst, r.forwardedLast)
      ?? fullName(r.assignedFirst, r.assignedLast)
      ?? r.externalAssigneeEmail
      ?? null
    );
  };

  return rows.map((r) => ({
    rfiNumber: r.rfiNumber,
    subject: r.subject,
    status: r.status,
    priority: r.priority ?? null,
    dateSubmitted: r.dateSubmitted ?? null,
    dateRequired: r.dateRequired ?? null,
    dateAnswered: r.dateAnswered ?? null,
    submittedByName: r.submittedByName ?? null,
    answeredByName: r.answeredByName ?? null,
    ballInCourt: ballInCourt(r),
    lastActivity: r.updatedAt ?? null,
  }));
}

/**
 * Pulls the submittal rows for `projectId`, joining the first open
 * submittal review (oldest sequenceOrder) per submittal so
 * "ball-in-court" reflects the active reviewer rather than the
 * denormalised reviewerName column when a review chain is mid-flight.
 */
export async function fetchProjectSubmittalLogRows(projectId: string): Promise<SubmittalLogRow[]> {
  const rows = await db
    .select({
      id: submittals.id,
      submittalNumber: submittals.submittalNumber,
      subject: submittals.subject,
      status: submittals.status,
      specSection: submittals.specSection,
      dateSubmitted: submittals.dateSubmitted,
      dateRequired: submittals.dateRequired,
      dateReviewed: submittals.dateReviewed,
      reviewerName: submittals.reviewerName,
      submittedByName: submittals.submittedByName,
      updatedAt: submittals.updatedAt,
    })
    .from(submittals)
    .where(eq(submittals.projectId, projectId))
    .orderBy(desc(submittals.createdAt));

  const openReviewMap = new Map<string, string>();
  if (rows.length > 0) {
    const openReviews = await db
      .select({
        submittalId: submittalReviews.submittalId,
        reviewerName: submittalReviews.reviewerName,
        sequenceOrder: submittalReviews.sequenceOrder,
      })
      .from(submittalReviews)
      .innerJoin(submittals, eq(submittals.id, submittalReviews.submittalId))
      .where(and(
        eq(submittals.projectId, projectId),
        inArray(submittalReviews.status, ["PENDING", "IN_REVIEW"]),
      ))
      .orderBy(submittalReviews.sequenceOrder);
    for (const r of openReviews) {
      if (!openReviewMap.has(r.submittalId)) {
        openReviewMap.set(r.submittalId, r.reviewerName ?? "—");
      }
    }
  }

  const ballInCourt = (r: typeof rows[number]): string | null => {
    const closed = r.status === "APPROVED" || r.status === "REJECTED" || r.status === "CLOSED";
    if (closed) return r.reviewerName ?? null;
    return openReviewMap.get(r.id) ?? r.reviewerName ?? r.submittedByName ?? null;
  };

  return rows.map((r) => ({
    submittalNumber: r.submittalNumber,
    subject: r.subject,
    status: r.status,
    specSection: r.specSection ?? null,
    dateSubmitted: r.dateSubmitted ?? null,
    dateRequired: r.dateRequired ?? null,
    dateReviewed: r.dateReviewed ?? null,
    reviewerName: r.reviewerName ?? null,
    submittedByName: r.submittedByName ?? null,
    ballInCourt: ballInCourt(r),
    lastActivity: r.updatedAt ?? null,
  }));
}

/**
 * Drains the PDFKit `PassThrough` stream produced by
 * `generateRfiLogPdf` / `generateSubmittalLogPdf` into a Buffer for
 * places that need to attach the bytes (the scheduled-email cron) as
 * opposed to streaming them down an HTTP response.
 */
export function streamToBuffer(stream: PassThrough): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/**
 * Convenience used by the email cron — fetches the rows, builds the
 * branding header, generates the PDF stream, and returns the
 * materialised Buffer ready for an email attachment.
 */
export async function buildProjectLogPdfBuffer(
  logType: "RFI" | "SUBMITTAL",
  project: ProjectLogProjectInfo,
): Promise<Buffer> {
  const branding = await fetchProjectBranding(project.gcOrganizationId);
  if (logType === "RFI") {
    const rows = await fetchProjectRfiLogRows(project.id);
    const stream = generateRfiLogPdf({ branding, projectName: project.name, rows });
    return streamToBuffer(stream);
  }
  const rows = await fetchProjectSubmittalLogRows(project.id);
  const stream = generateSubmittalLogPdf({ branding, projectName: project.name, rows });
  return streamToBuffer(stream);
}
