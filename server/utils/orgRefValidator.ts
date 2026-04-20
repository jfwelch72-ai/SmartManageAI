import { db } from "../db";
import { crmOpportunities, crmOrganisations, crmContacts, users } from "@shared/schema";
import { and, eq } from "drizzle-orm";

export async function validateOrgRefs(
  orgId: string,
  refs: {
    opportunityId?: string | null;
    crmOrganisationId?: string | null;
    contactId?: string | null;
    assignedToId?: string | null;
  },
): Promise<{ ok: true } | { ok: false; field: string }> {
  if (refs.opportunityId) {
    const [r] = await db
      .select({ id: crmOpportunities.id })
      .from(crmOpportunities)
      .where(and(eq(crmOpportunities.id, refs.opportunityId), eq(crmOpportunities.organizationId, orgId)))
      .limit(1);
    if (!r) return { ok: false, field: "opportunityId" };
  }
  if (refs.crmOrganisationId) {
    const [r] = await db
      .select({ id: crmOrganisations.id })
      .from(crmOrganisations)
      .where(and(eq(crmOrganisations.id, refs.crmOrganisationId), eq(crmOrganisations.organizationId, orgId)))
      .limit(1);
    if (!r) return { ok: false, field: "crmOrganisationId" };
  }
  if (refs.contactId) {
    const [r] = await db
      .select({ id: crmContacts.id })
      .from(crmContacts)
      .where(and(eq(crmContacts.id, refs.contactId), eq(crmContacts.organizationId, orgId)))
      .limit(1);
    if (!r) return { ok: false, field: "contactId" };
  }
  if (refs.assignedToId) {
    const [r] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, refs.assignedToId), eq(users.organizationId, orgId)))
      .limit(1);
    if (!r) return { ok: false, field: "assignedToId" };
  }
  return { ok: true };
}
