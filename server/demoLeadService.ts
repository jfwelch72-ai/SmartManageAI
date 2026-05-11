// Task #2783 — Track demo request leads inside the CRM.
// ai-router-bypass: no LLM calls in this file.
import { db } from "./db";
import { sql } from "drizzle-orm";
import { crmOrganisations, crmContacts, crmOpportunities, crmOpportunityActivities } from "@shared/schema";
import { eq, and, ilike } from "drizzle-orm";
import { logError, logInfo, logWarn } from "./utils/logger";

interface DemoLeadInput {
  name: string;
  company: string;
  email: string;
  phone?: string | null;
  notes?: string | null;
}

interface DemoLeadCrmConfig {
  enabled: boolean;
  targetOrgId: string | null;
  initialStage: string;
  crmOrgType: string;
}

async function loadConfig(): Promise<DemoLeadCrmConfig> {
  const envOrgId = process.env.DEMO_CRM_ORG_ID?.trim() || null;

  let dbRow: {
    enabled: boolean;
    target_org_id: string | null;
    initial_stage: string;
    crm_org_type: string;
  } | undefined;

  try {
    const rows = await db.execute(
      sql`SELECT enabled, target_org_id, initial_stage, crm_org_type FROM demo_lead_crm_config WHERE id = 'singleton' LIMIT 1`,
    );
    dbRow = rows.rows[0] as typeof dbRow;
  } catch {
    // Table may not exist yet on first boot.
  }

  return {
    enabled: dbRow?.enabled ?? true,
    targetOrgId: envOrgId ?? dbRow?.target_org_id ?? null,
    initialStage: dbRow?.initial_stage ?? "LEAD",
    crmOrgType: dbRow?.crm_org_type ?? "CONTRACTOR",
  };
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "—" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

const DEMO_REQUEST_TAG = "Demo Request";

const VALID_CRM_ORG_TYPES = ["CONTRACTOR", "SUBCONTRACTOR", "SUPPLIER", "VENDOR", "OWNER_REP", "RENTAL_VENDOR", "SERVICE_VENDOR"] as const;
type CrmOrgType = typeof VALID_CRM_ORG_TYPES[number];

const VALID_STAGES = ["LEAD", "QUALIFIED", "ESTIMATING", "BID_SUBMITTED", "NEGOTIATION", "WON", "LOST"] as const;
type PipelineStage = typeof VALID_STAGES[number];

function toValidCrmOrgType(value: string): CrmOrgType {
  return (VALID_CRM_ORG_TYPES as readonly string[]).includes(value)
    ? (value as CrmOrgType)
    : "CONTRACTOR";
}

function toValidStage(value: string): PipelineStage {
  return (VALID_STAGES as readonly string[]).includes(value)
    ? (value as PipelineStage)
    : "LEAD";
}

/**
 * Creates or matches CRM records for a demo request.
 *  1. Find or create a crm_organisations row for the company.
 *  2. Find or create a crm_contacts row; always tag as "Demo Request" lead.
 *  3. Insert a crm_opportunities row (stage=LEAD, source=DEMO_REQUEST).
 *  4. Insert a NOTE activity on the opportunity.
 * All failures are non-fatal.
 */
export async function createDemoLeadInCrm(
  input: DemoLeadInput,
): Promise<{ opportunityId: string } | null> {
  try {
    const config = await loadConfig();

    if (!config.enabled) {
      logInfo("demo_lead_crm: disabled, skipping CRM sync", { email: input.email });
      return null;
    }

    if (!config.targetOrgId) {
      logWarn(
        "demo_lead_crm: no target org configured (set DEMO_CRM_ORG_ID or use platform settings)",
        { email: input.email },
      );
      return null;
    }

    const orgId = config.targetOrgId;

    // 1. Find or create CRM organisation for the prospect's company.
    let crmOrgId: string;
    const [existingCrmOrg] = await db
      .select({ id: crmOrganisations.id })
      .from(crmOrganisations)
      .where(and(eq(crmOrganisations.organizationId, orgId), ilike(crmOrganisations.name, input.company)))
      .limit(1);

    if (existingCrmOrg) {
      crmOrgId = existingCrmOrg.id;
    } else {
      const [newCrmOrg] = await db
        .insert(crmOrganisations)
        .values({
          organizationId: orgId,
          type: toValidCrmOrgType(config.crmOrgType),
          name: input.company,
          notes: "Auto-created from demo request.",
        })
        .returning({ id: crmOrganisations.id });
      crmOrgId = newCrmOrg.id;
    }

    // 2. Find or create CRM contact. Tag as "Demo Request" in both cases.
    let contactId: string;
    const [existingContact] = await db
      .select({ id: crmContacts.id, notes: crmContacts.notes })
      .from(crmContacts)
      .where(and(eq(crmContacts.organizationId, orgId), ilike(crmContacts.email, input.email)))
      .limit(1);

    if (existingContact) {
      contactId = existingContact.id;
      // Ensure the matched contact carries the Demo Request tag.
      const existingNotes = existingContact.notes ?? "";
      if (!existingNotes.includes(DEMO_REQUEST_TAG)) {
        const updatedNotes = existingNotes
          ? `${existingNotes}\n[${DEMO_REQUEST_TAG}]`
          : `[${DEMO_REQUEST_TAG}]`;
        await db
          .update(crmContacts)
          .set({ notes: updatedNotes })
          .where(eq(crmContacts.id, contactId));
      }
    } else {
      const { firstName, lastName } = splitName(input.name);
      const [newContact] = await db
        .insert(crmContacts)
        .values({
          organizationId: orgId,
          organisationId: crmOrgId,
          firstName,
          lastName,
          email: input.email,
          phone: input.phone ?? null,
          role: "OTHER",
          isPrimary: false,
          notes: `[${DEMO_REQUEST_TAG}]`,
        })
        .returning({ id: crmContacts.id });
      contactId = newContact.id;
    }

    // 3. Create the opportunity.
    const oppName = `Demo Request — ${input.name} (${input.company})`;
    const oppNotes = [
      `Lead source: ${DEMO_REQUEST_TAG} (landing page form).`,
      input.notes ? `Requester notes: ${input.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const [opportunity] = await db
      .insert(crmOpportunities)
      .values({
        organizationId: orgId,
        name: oppName,
        stage: toValidStage(config.initialStage),
        probability: 10,
        crmOrganisationId: crmOrgId,
        contactId,
        source: "DEMO_REQUEST",
        notes: oppNotes,
      })
      .returning({ id: crmOpportunities.id });

    // 4. Log an activity note.
    await db.insert(crmOpportunityActivities).values({
      opportunityId: opportunity.id,
      activityType: "NOTE",
      description: `Demo request received. Contact: ${input.name} <${input.email}>${input.phone ? ` ${input.phone}` : ""}. Company: ${input.company}. Tagged as "${DEMO_REQUEST_TAG}" lead.`,
    });

    logInfo("demo_lead_crm: CRM records created", {
      email: input.email,
      opportunityId: opportunity.id,
      crmOrgId,
      contactId,
      orgId,
    });

    return { opportunityId: opportunity.id };
  } catch (err) {
    logError(
      "demo_lead_crm: failed to create CRM records (non-fatal)",
      { email: input.email },
      err instanceof Error ? err : new Error(String(err)),
    );
    return null;
  }
}
