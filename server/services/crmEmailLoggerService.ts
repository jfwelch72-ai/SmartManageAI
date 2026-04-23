/**
 * Task #886 — CRM Email Logger Service
 *
 * When a Gmail/Outlook message is persisted (or backfilled), inspect the
 * sender + recipients against `crm_contacts.email`. If a match is found and
 * the org's email logging mode permits it, write to `crm_email_threads`,
 * `crm_email_messages`, and create a `crm_opportunity_activities` row of
 * type EMAIL so the unified CRM activity timeline picks it up automatically.
 *
 * Idempotent on (organizationId, externalMessageId, direction) so re-runs
 * never duplicate rows. Suppression list and OFF / MY_DOMAIN / ALL mode are
 * honored.
 */

import { and, desc, eq, inArray, gte, notInArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  crmContacts,
  crmEmailLoggingSettings,
  crmEmailLoggingSuppressions,
  crmEmailMessages,
  crmEmailThreads,
  crmOpportunities,
  crmOpportunityActivities,
  emailAccounts,
  emailMessages,
  emailThreads,
} from "@shared/schema";
import { logError, logInfo } from "../utils/logger";

export type LoggingMode = "OFF" | "MY_DOMAIN" | "ALL";

export interface LogCandidate {
  organizationId: string;
  provider: "GMAIL" | "OUTLOOK";
  ownerEmail: string; // mailbox owner (the rep)
  externalMessageId: string;
  externalThreadId: string | null;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses?: string[];
  subject: string;
  snippet?: string | null;
  bodyText?: string | null;
  sentAt: Date;
  isIncoming: boolean;
  sourceEmailMessageId?: string | null;
}

const featureFlagEnabled = () =>
  (process.env.CRM_EMAIL_LOGGING ?? "true").toLowerCase() !== "false";

function normalizeAddr(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase();
}

function parseJsonAddrList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((v) => (typeof v === "string" ? v : v?.address || ""))
        .map(normalizeAddr)
        .filter(Boolean);
    }
  } catch {
    // Fallback: comma split.
    return raw.split(",").map(normalizeAddr).filter(Boolean);
  }
  return [];
}

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "";
}

function buildProviderDeepLink(provider: "GMAIL" | "OUTLOOK", externalId: string): string | null {
  if (!externalId) return null;
  if (provider === "GMAIL") return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(externalId)}`;
  if (provider === "OUTLOOK") return `https://outlook.office.com/mail/inbox/id/${encodeURIComponent(externalId)}`;
  return null;
}

interface OrgConfig {
  mode: LoggingMode;
  suppressed: Set<string>; // either "addr@host" or "@domain"
}

const orgCache = new Map<string, { at: number; cfg: OrgConfig }>();
const ORG_CACHE_TTL_MS = 30_000;

export function invalidateOrgCache(orgId: string): void {
  orgCache.delete(orgId);
}

async function getOrgConfig(orgId: string): Promise<OrgConfig> {
  const hit = orgCache.get(orgId);
  if (hit && Date.now() - hit.at < ORG_CACHE_TTL_MS) return hit.cfg;
  const [settings] = await db
    .select()
    .from(crmEmailLoggingSettings)
    .where(eq(crmEmailLoggingSettings.organizationId, orgId))
    .limit(1);
  const supp = await db
    .select({ pattern: crmEmailLoggingSuppressions.pattern })
    .from(crmEmailLoggingSuppressions)
    .where(eq(crmEmailLoggingSuppressions.organizationId, orgId));
  const cfg: OrgConfig = {
    mode: ((settings?.mode || "OFF") as LoggingMode),
    suppressed: new Set(supp.map((s) => s.pattern.toLowerCase())),
  };
  orgCache.set(orgId, { at: Date.now(), cfg });
  return cfg;
}

function isSuppressed(addr: string, suppressed: Set<string>): boolean {
  if (!addr) return false;
  if (suppressed.has(addr)) return true;
  const dom = domainOf(addr);
  if (dom && suppressed.has("@" + dom)) return true;
  return false;
}

// Built-in heuristics for noise we should never log: bounce daemons,
// no-reply mailers, calendar-invite system addresses, common newsletter
// senders. These run before the org-configured suppression list.
const AUTO_SUPPRESS_LOCAL_PARTS = [
  "no-reply", "noreply", "no_reply", "donotreply", "do-not-reply", "do_not_reply",
  "mailer-daemon", "mailer_daemon", "postmaster",
  "bounce", "bounces", "notifications", "notification",
  "newsletter", "newsletters", "marketing", "updates",
  "calendar-server", "calendar-notification", "ical",
];
const AUTO_SUPPRESS_DOMAIN_FRAGMENTS = [
  "bounces.", "bounce.", "mailgun.org", "sendgrid.net", "amazonses.com",
  "mcsv.net", "mcdlv.net", "mailchimpapp.com", "list-manage.com",
];
function isAutoSuppressed(addr: string, subject?: string | null): boolean {
  if (!addr) return false;
  const a = addr.toLowerCase();
  const local = a.split("@")[0] ?? "";
  const dom = domainOf(a) ?? "";
  if (AUTO_SUPPRESS_LOCAL_PARTS.some((p) => local === p || local.startsWith(p + "+") || local.includes(p))) return true;
  if (AUTO_SUPPRESS_DOMAIN_FRAGMENTS.some((d) => dom.includes(d))) return true;
  // Calendar invite subjects are usually duplicates of meeting activity
  const subj = (subject ?? "").toLowerCase();
  if (subj.startsWith("invitation:") || subj.startsWith("updated invitation:") || subj.startsWith("canceled event:") || subj.startsWith("declined:") || subj.startsWith("accepted:")) return true;
  return false;
}

/**
 * Decide whether a candidate email should be logged given the org's mode and
 * the mailbox owner. Returns the matched contact email (if any) plus all
 * non-owner counterparties so we can pick the contact match.
 */
function candidateAddresses(c: LogCandidate): string[] {
  const owner = normalizeAddr(c.ownerEmail);
  const all = [normalizeAddr(c.fromAddress), ...c.toAddresses.map(normalizeAddr), ...(c.ccAddresses ?? []).map(normalizeAddr)]
    .filter(Boolean);
  return Array.from(new Set(all.filter((a) => a !== owner)));
}

/**
 * Public entry point — call once per persisted message.
 * Errors are swallowed (logged) so we never break the email sync path.
 */
export async function logEmailMessageForCrm(c: LogCandidate): Promise<{ logged: boolean; reason?: string }> {
  if (!featureFlagEnabled()) return { logged: false, reason: "flag_off" };
  try {
    const cfg = await getOrgConfig(c.organizationId);
    if (cfg.mode === "OFF") return { logged: false, reason: "mode_off" };

    const ownerDomain = domainOf(normalizeAddr(c.ownerEmail));
    // Built-in noise suppression — applies before org-level rules.
    if (isAutoSuppressed(normalizeAddr(c.fromAddress), c.subject)) {
      return { logged: false, reason: "auto_suppressed" };
    }
    const candidates = candidateAddresses(c)
      .filter((a) => !isAutoSuppressed(a, c.subject))
      .filter((a) => !isSuppressed(a, cfg.suppressed));
    if (candidates.length === 0) return { logged: false, reason: "no_candidates" };

    // MY_DOMAIN mode: at least one counterparty must share owner's domain.
    if (cfg.mode === "MY_DOMAIN") {
      const inDomain = candidates.some((a) => domainOf(a) === ownerDomain);
      if (!inDomain) return { logged: false, reason: "outside_domain" };
    }

    // Match counterparties against crm_contacts.email
    const contacts = await db
      .select({
        id: crmContacts.id,
        email: crmContacts.email,
        crmOrganisationId: crmContacts.organisationId,
      })
      .from(crmContacts)
      .where(
        and(
          eq(crmContacts.organizationId, c.organizationId),
          inArray(crmContacts.email, candidates),
        ),
      );
    if (contacts.length === 0) return { logged: false, reason: "no_contact_match" };

    // Pick first matched contact (deterministic).
    const contact = contacts[0];
    const contactEmail = normalizeAddr(contact.email);

    // Find a related OPEN opportunity for the contact's organisation
    // (most recently updated, excluding WON/LOST). Best-effort — null if none.
    let opportunityId: string | null = null;
    if (contact.crmOrganisationId) {
      const [opp] = await db
        .select({ id: crmOpportunities.id })
        .from(crmOpportunities)
        .where(
          and(
            eq(crmOpportunities.crmOrganisationId, contact.crmOrganisationId),
            notInArray(crmOpportunities.stage, ["WON", "LOST"]),
          ),
        )
        .orderBy(desc(crmOpportunities.updatedAt))
        .limit(1);
      opportunityId = opp?.id ?? null;
    }

    const direction: "INBOUND" | "OUTBOUND" = c.isIncoming ? "INBOUND" : "OUTBOUND";

    // Idempotency: skip if a row already exists for this (org, ext, direction).
    const [existing] = await db
      .select({ id: crmEmailMessages.id })
      .from(crmEmailMessages)
      .where(
        and(
          eq(crmEmailMessages.organizationId, c.organizationId),
          eq(crmEmailMessages.externalMessageId, c.externalMessageId),
          eq(crmEmailMessages.direction, direction),
        ),
      )
      .limit(1);
    if (existing) return { logged: false, reason: "dedup" };

    // Upsert thread by (org, externalThreadId). When externalThreadId is null
    // we still create a thread but will not benefit from grouping.
    let threadId: string | null = null;
    if (c.externalThreadId) {
      const [t] = await db
        .select({ id: crmEmailThreads.id })
        .from(crmEmailThreads)
        .where(
          and(
            eq(crmEmailThreads.organizationId, c.organizationId),
            eq(crmEmailThreads.externalThreadId, c.externalThreadId),
          ),
        )
        .limit(1);
      threadId = t?.id ?? null;
    }
    if (!threadId) {
      const [inserted] = await db
        .insert(crmEmailThreads)
        .values({
          organizationId: c.organizationId,
          contactId: contact.id,
          opportunityId,
          organisationId: contact.crmOrganisationId ?? null,
          subject: c.subject || "(no subject)",
          externalThreadId: c.externalThreadId,
          provider: c.provider,
          messageCount: 0,
          lastMessageAt: c.sentAt,
        })
        .returning({ id: crmEmailThreads.id });
      threadId = inserted!.id;
    }

    // Aggregate activity per (thread, direction): reuse the existing activity
    // row already linked to a message of the same direction on this thread.
    let activityId: string | null = null;
    if (opportunityId) {
      const [reusable] = await db
        .select({ activityId: crmEmailMessages.activityId })
        .from(crmEmailMessages)
        .where(
          and(
            eq(crmEmailMessages.threadId, threadId),
            eq(crmEmailMessages.direction, direction),
          ),
        )
        .limit(1);
      const aggregateDesc =
        `[${direction}] ${c.subject || "(no subject)"} — ` +
        `${direction === "INBOUND" ? c.fromAddress : c.toAddresses.join(", ")}` +
        (c.snippet ? `\n\n${c.snippet}` : "");
      if (reusable?.activityId) {
        await db
          .update(crmOpportunityActivities)
          .set({
            description: aggregateDesc.slice(0, 4000),
            completedAt: c.sentAt,
          })
          .where(eq(crmOpportunityActivities.id, reusable.activityId));
        activityId = reusable.activityId;
      } else {
        const [act] = await db
          .insert(crmOpportunityActivities)
          .values({
            opportunityId,
            activityType: "EMAIL",
            description: aggregateDesc.slice(0, 4000),
            completedAt: c.sentAt,
          })
          .returning({ id: crmOpportunityActivities.id });
        activityId = act?.id ?? null;
      }
    }

    await db.insert(crmEmailMessages).values({
      organizationId: c.organizationId,
      threadId,
      contactId: contact.id,
      opportunityId,
      externalMessageId: c.externalMessageId,
      direction,
      fromAddress: normalizeAddr(c.fromAddress),
      toAddresses: JSON.stringify(c.toAddresses),
      ccAddresses: c.ccAddresses ? JSON.stringify(c.ccAddresses) : null,
      subject: c.subject || "(no subject)",
      snippet: c.snippet ?? null,
      bodyText: c.bodyText ? c.bodyText.slice(0, 16_000) : null,
      sentAt: c.sentAt,
      sourceEmailMessageId: c.sourceEmailMessageId ?? null,
      activityId,
      provider: c.provider,
      providerDeepLink: buildProviderDeepLink(c.provider, c.externalMessageId),
    });

    // Bump thread metadata
    await db
      .update(crmEmailThreads)
      .set({
        messageCount: (await countThreadMessages(threadId)),
        lastMessageAt: c.sentAt,
        updatedAt: new Date(),
      })
      .where(eq(crmEmailThreads.id, threadId));

    return { logged: true };
  } catch (err) {
    logError(
      "[crmEmailLogger] failed to log email",
      { externalMessageId: c.externalMessageId },
      err instanceof Error ? err : new Error(String(err)),
    );
    return { logged: false, reason: "error" };
  }
}

async function countThreadMessages(threadId: string): Promise<number> {
  const rows = await db
    .select({ id: crmEmailMessages.id })
    .from(crmEmailMessages)
    .where(eq(crmEmailMessages.threadId, threadId));
  return rows.length;
}

/**
 * Backfill recent email messages (default 90 days) for a freshly-connected
 * email account through the same logger pipeline. Idempotent.
 */
export async function backfillCrmEmailLogging(
  accountId: string,
  daysBack = 90,
): Promise<{ scanned: number; logged: number }> {
  if (!featureFlagEnabled()) return { scanned: 0, logged: 0 };
  const [account] = await db
    .select()
    .from(emailAccounts)
    .where(eq(emailAccounts.id, accountId))
    .limit(1);
  if (!account) return { scanned: 0, logged: 0 };

  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      m: emailMessages,
      providerThreadId: emailThreads.externalThreadId,
    })
    .from(emailMessages)
    .leftJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
    .where(
      and(
        eq(emailMessages.emailAccountId, account.id),
        gte(emailMessages.receivedAt, since),
      ),
    )
    .orderBy(desc(emailMessages.receivedAt))
    .limit(2000);

  let logged = 0;
  for (const { m, providerThreadId } of rows) {
    const result = await logEmailMessageForCrm({
      organizationId: account.organizationId,
      provider: account.provider === "OUTLOOK" ? "OUTLOOK" : "GMAIL",
      ownerEmail: account.emailAddress,
      externalMessageId: m.externalId,
      externalThreadId: providerThreadId ?? null,
      fromAddress: m.fromAddress,
      toAddresses: parseJsonAddrList(m.toAddresses),
      ccAddresses: parseJsonAddrList(m.ccAddresses),
      subject: m.subject,
      snippet: m.snippet,
      bodyText: m.bodyText,
      sentAt: m.receivedAt,
      isIncoming: m.isIncoming,
      sourceEmailMessageId: m.id,
    });
    if (result.logged) logged++;
  }
  logInfo("[crmEmailLogger] backfill complete", {
    accountId,
    daysBack,
    scanned: rows.length,
    logged,
  });
  return { scanned: rows.length, logged };
}
