import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import {
  subcontractorPortalTokens,
  crmOrganisations,
  crmContacts,
  projects,
} from "@shared/schema";
import { generatePortalToken, hashPortalToken } from "../portalAuth";
import { sendEmail } from "../services/emailService";
import { isFeatureEnabled } from "./featureFlagService";
import { logAudit } from "../auditLogger";
import { logError, logInfo, logWarn } from "../utils/logger";

/**
 * Task #1599 — outbound transactional email to an external A/E or
 * sub-consultant who has no internal user account, used by the
 * Submittals review chain ("/start") and the RFI forward route.
 *
 * Behaviour summary
 * -----------------
 *   - Gated by the per-org `EXTERNAL_DOC_EMAIL` feature flag (default
 *     OFF). When the flag is off this function is a noop — callers
 *     can call it unconditionally and rely on the in-app/internal
 *     fanout that already happens via `notifyDocumentEvent` /
 *     `notifyUsers`.
 *   - The recipient must already exist as a `crm_contact` whose
 *     organisation is in the same tenant, because portal tokens are
 *     scoped per `crm_organisation_id`. If we can't resolve the
 *     contact we log a warning and return — we never silently email a
 *     stranger.
 *   - Mints a single-use portal token (90 day TTL) tied to the
 *     project + crm organisation so the deep-link in the email lands
 *     the recipient on `/sub-portal?token=...` with read access.
 *   - Sends the email via the shared `sendEmail` (Resend wrapper).
 *     Failures are logged but never thrown so a downstream Resend
 *     hiccup can't break the calling write transaction.
 */
export type ExternalDocKind = "RFI_FORWARD" | "SUBMITTAL_REVIEW";

export interface ExternalDocEmailInput {
  organizationId: string;
  projectId: string;
  recipientEmail: string;
  documentNumber: string;
  documentSubject: string;
  kind: ExternalDocKind;
  inviterId: string | null;
  inviterName: string | null;
  // Submittal review payload extras (rendered into the email body so
  // the external reviewer sees the deadline + scope before opening the
  // portal).
  dueDate?: Date | string | null;
  itemCount?: number | null;
  // Linkage back to the source document (rfis.id / submittals.id) so
  // the audit trail entry can be filtered per document.
  documentId?: string | null;
}

export interface ExternalDocEmailResult {
  delivered: boolean;
  reason?: string;
  portalTokenId?: string;
}

function buildBaseUrl(): string {
  return process.env.REPLIT_DOMAINS
    ? `https://${process.env.REPLIT_DOMAINS}`
    : process.env.APP_URL || "http://localhost:5000";
}

export async function sendExternalDocEmail(
  input: ExternalDocEmailInput,
): Promise<ExternalDocEmailResult> {
  // (1) Per-org gate. Off by default; explicit opt-in protects existing
  // tenants from unintentionally fanning emails to external parties.
  const flagOn = await isFeatureEnabled(input.organizationId, "EXTERNAL_DOC_EMAIL");
  if (!flagOn) return { delivered: false, reason: "feature_flag_off" };

  const recipientEmail = (input.recipientEmail ?? "").trim().toLowerCase();
  if (!recipientEmail) return { delivered: false, reason: "missing_email" };

  // (2) Resolve the recipient through CRM. The portal token table
  // requires a crm_organisation_id (it's NOT NULL) so we can only
  // mint a token when we can attribute the email to a known org in
  // this tenant. If no contact match exists we log + return — never
  // email a stranger.
  const matches = await db
    .select({
      contactId: crmContacts.id,
      contactName: sql<string>`coalesce(${crmContacts.firstName} || ' ' || ${crmContacts.lastName}, ${crmContacts.email})`,
      crmOrganisationId: crmContacts.organisationId,
      crmOrgName: crmOrganisations.name,
      crmOrgOrganizationId: crmOrganisations.organizationId,
    })
    .from(crmContacts)
    .innerJoin(crmOrganisations, eq(crmContacts.organisationId, crmOrganisations.id))
    .where(and(
      sql`lower(${crmContacts.email}) = ${recipientEmail}`,
      eq(crmOrganisations.organizationId, input.organizationId),
    ))
    .limit(1);

  if (matches.length === 0) {
    logWarn("[ExternalDocEmail] No CRM contact match — refusing to email stranger", {
      organizationId: input.organizationId,
      projectId: input.projectId,
      kind: input.kind,
      documentNumber: input.documentNumber,
    });
    return { delivered: false, reason: "no_crm_contact_match" };
  }

  const match = matches[0];

  // (3) Mint a fresh portal token (90 day TTL — same default as the
  // human-driven invite endpoint) scoped to this project + crm org.
  const rawToken = generatePortalToken();
  const tokenHash = await hashPortalToken(rawToken);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);

  let createdTokenId: string | undefined;
  try {
    const [created] = await db
      .insert(subcontractorPortalTokens)
      .values({
        organizationId: input.organizationId,
        projectId: input.projectId,
        crmOrganisationId: match.crmOrganisationId,
        contactEmail: recipientEmail,
        contactName: match.contactName ?? recipientEmail,
        tokenHash,
        permissions: ["view", "comment"],
        status: "active",
        expiresAt,
        invitedById: input.inviterId,
        invitedByName: input.inviterName,
      })
      .returning({ id: subcontractorPortalTokens.id });
    createdTokenId = created?.id;
  } catch (err) {
    logError(
      "[ExternalDocEmail] Portal token insert failed",
      {
        organizationId: input.organizationId,
        projectId: input.projectId,
        kind: input.kind,
      },
      err instanceof Error ? err : new Error(String(err)),
    );
    return { delivered: false, reason: "token_insert_failed" };
  }

  // (4) Compose the email. The portal link carries the raw token in
  // the query string — same deep-link shape used by the existing
  // subcontractor invite emails.
  const baseUrl = buildBaseUrl();
  const portalLink = `${baseUrl}/sub-portal?token=${rawToken}`;

  const [project] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  const projectName = project?.name ?? "your project";

  const heading = input.kind === "RFI_FORWARD"
    ? `RFI ${input.documentNumber} forwarded for your review`
    : `Submittal ${input.documentNumber} awaiting your review`;
  const bodyLine = input.kind === "RFI_FORWARD"
    ? `An RFI (#${input.documentNumber} — ${input.documentSubject}) on the project "${projectName}" has been forwarded to you for response.`
    : `A submittal (#${input.documentNumber} — ${input.documentSubject}) on the project "${projectName}" is awaiting your review.`;

  // Submittal review emails carry the due-date and item-count hint so
  // external reviewers can triage from inbox without opening the portal.
  const dueDateStr = input.dueDate
    ? (input.dueDate instanceof Date ? input.dueDate : new Date(input.dueDate)).toLocaleDateString()
    : null;
  const detailLines: string[] = [];
  if (input.kind === "SUBMITTAL_REVIEW") {
    if (dueDateStr) detailLines.push(`Review due: <strong>${dueDateStr}</strong>`);
    if (typeof input.itemCount === "number" && input.itemCount > 0) {
      detailLines.push(`Items in package: <strong>${input.itemCount}</strong>`);
    }
  }
  const detailHtml = detailLines.length
    ? `<ul style="margin: 12px 0; padding-left: 18px;">${detailLines.map(l => `<li>${l}</li>`).join("")}</ul>`
    : "";
  const detailText = detailLines.length
    ? "\n\n" + detailLines.map(l => l.replace(/<[^>]+>/g, "")).join("\n") + "\n"
    : "";

  try {
    await sendEmail({
      to: recipientEmail,
      subject: `${heading} — ${projectName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1a1a2e;">${heading}</h2>
          <p>${bodyLine}</p>
          ${detailHtml}
          <p style="margin: 24px 0;">
            <a href="${portalLink}" style="background: #1a1a2e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
              Open project portal
            </a>
          </p>
          <p style="font-size: 12px; color: #666;">
            This link grants temporary access to the relevant document on
            the project portal and expires in 90 days. If you weren't
            expecting this message, you can safely ignore it.
          </p>
        </div>`,
      text: `${heading}\n\n${bodyLine}${detailText}\n\nOpen the project portal:\n${portalLink}\n\nThis link expires in 90 days.`,
    });
  } catch (err) {
    logError(
      "[ExternalDocEmail] sendEmail failed",
      {
        organizationId: input.organizationId,
        projectId: input.projectId,
        kind: input.kind,
        portalTokenId: createdTokenId,
      },
      err instanceof Error ? err : new Error(String(err)),
    );
    if (input.inviterId) {
      await logAudit({
        userId: input.inviterId,
        entityType: input.kind === "RFI_FORWARD" ? "rfi" : "submittal",
        entityId: input.documentId ?? input.documentNumber,
        action: "EXTERNAL_EMAIL_FAILED",
        oldValue: null,
        newValue: JSON.stringify({
          recipientEmail,
          portalTokenId: createdTokenId,
          documentNumber: input.documentNumber,
          reason: "email_send_failed",
        }),
      });
    }
    return { delivered: false, reason: "email_send_failed", portalTokenId: createdTokenId };
  }

  if (input.inviterId) {
    await logAudit({
      userId: input.inviterId,
      entityType: input.kind === "RFI_FORWARD" ? "rfi" : "submittal",
      entityId: input.documentId ?? input.documentNumber,
      action: "EXTERNAL_EMAIL_SENT",
      oldValue: null,
      newValue: JSON.stringify({
        recipientEmail,
        portalTokenId: createdTokenId,
        documentNumber: input.documentNumber,
        kind: input.kind,
        dueDate: input.dueDate ?? null,
        itemCount: input.itemCount ?? null,
      }),
    });
  }

  logInfo("[ExternalDocEmail] sent", {
    organizationId: input.organizationId,
    projectId: input.projectId,
    kind: input.kind,
    documentNumber: input.documentNumber,
    portalTokenId: createdTokenId,
  });
  return { delivered: true, portalTokenId: createdTokenId };
}
