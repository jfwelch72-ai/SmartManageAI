import { Router } from "express";
import { db } from "./db";
import {
  projects,
  bids,
  crmOrganisations,
  crmContacts,
  crmOpportunities,
} from "@shared/schema";
import { and, eq, ilike, or, sql, desc, inArray, type SQL, type AnyColumn } from "drizzle-orm";
import { z } from "zod";
import { type AuthRequest, requireAuth, getEffectivePermissions, getEffectiveRole } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { sensitiveLimiter } from "./rateLimiter";

const router = Router();

const PER_ENTITY_CAP = 5;
const TOTAL_CAP = 30;

const querySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(5).optional(),
});

export type SearchResultType =
  | "deal"
  | "organization"
  | "contact"
  | "project"
  | "bid"
  | "vendor"
  | "subcontractor";

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle?: string | null;
  url: string;
  icon: string;
}

const ACTIVE_PROJECT_STATUSES = ["BID", "PLANNING", "ACTIVE"] as const;

router.get(
  "/api/search",
  requireAuth,
  sensitiveLimiter,
  async (req: AuthRequest, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
    }
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { q } = parsed.data;
    const perEntityLimit = Math.min(parsed.data.limit ?? PER_ENTITY_CAP, PER_ENTITY_CAP);

    const ctx = getOrgIdForFilter(req);
    if (ctx.mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const orgId = ctx.orgId;
    const isSuper = ctx.isSuperAdmin;

    const effectiveRole = getEffectiveRole(req.user);
    const perms = await getEffectivePermissions(
      req.user.id,
      req.user.organizationId ?? null,
      effectiveRole,
    );

    const allowProjects = perms.canAccessProjects === true;
    const allowBids = perms.canViewBids === true;
    const allowCrm = perms.canAccessCRM === true;
    const projectScope = perms.projectScope === "ACTIVE_ONLY" ? "ACTIVE_ONLY" : "ALL";

    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

    const orgFilter = (col: AnyColumn): SQL | undefined =>
      isSuper || !orgId ? undefined : eq(col, orgId);

    const compose = (...conds: Array<SQL | undefined>): SQL | undefined => {
      const filtered = conds.filter((c): c is SQL => Boolean(c));
      if (filtered.length === 0) return undefined;
      if (filtered.length === 1) return filtered[0];
      return and(...filtered);
    };

    const projectsQuery = allowProjects
      ? db
          .select({
            id: projects.id,
            name: projects.name,
            code: projects.code,
            status: projects.status,
            city: projects.city,
            state: projects.state,
          })
          .from(projects)
          .where(
            compose(
              orgFilter(projects.gcOrganizationId),
              projectScope === "ACTIVE_ONLY"
                ? inArray(projects.status, [...ACTIVE_PROJECT_STATUSES])
                : undefined,
              or(
                ilike(projects.name, like),
                ilike(projects.code, like),
                ilike(projects.clientName, like),
              ),
            ),
          )
          .orderBy(desc(projects.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; name: string; code: string; status: string | null; city: string | null; state: string | null }>);

    const bidsQuery = allowBids
      ? db
          .select({
            id: bids.id,
            name: bids.name,
            code: bids.code,
            status: bids.status,
            clientName: bids.clientName,
          })
          .from(bids)
          .where(
            compose(
              orgFilter(bids.gcOrganizationId),
              or(
                ilike(bids.name, like),
                ilike(bids.code, like),
                ilike(bids.clientName, like),
              ),
            ),
          )
          .orderBy(desc(bids.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; name: string; code: string; status: string | null; clientName: string | null }>);

    const opportunitiesQuery = allowCrm
      ? db
          .select({
            id: crmOpportunities.id,
            name: crmOpportunities.name,
            stage: crmOpportunities.stage,
            dealValue: crmOpportunities.dealValue,
          })
          .from(crmOpportunities)
          .where(
            compose(
              orgFilter(crmOpportunities.organizationId),
              or(
                ilike(crmOpportunities.name, like),
                ilike(crmOpportunities.notes, like),
              ),
            ),
          )
          .orderBy(desc(crmOpportunities.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; name: string; stage: string | null; dealValue: string | null }>);

    const contactsQuery = allowCrm
      ? db
          .select({
            id: crmContacts.id,
            firstName: crmContacts.firstName,
            lastName: crmContacts.lastName,
            title: crmContacts.title,
            email: crmContacts.email,
          })
          .from(crmContacts)
          .where(
            compose(
              orgFilter(crmContacts.organizationId),
              eq(crmContacts.isActive, true),
              or(
                ilike(crmContacts.firstName, like),
                ilike(crmContacts.lastName, like),
                ilike(crmContacts.email, like),
                sql`(${crmContacts.firstName} || ' ' || ${crmContacts.lastName}) ILIKE ${like}`,
              ),
            ),
          )
          .orderBy(desc(crmContacts.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; firstName: string; lastName: string; title: string | null; email: string | null }>);

    const clientOrgsQuery = allowCrm
      ? db
          .select({
            id: crmOrganisations.id,
            name: crmOrganisations.name,
            type: crmOrganisations.type,
            city: crmOrganisations.city,
            state: crmOrganisations.state,
          })
          .from(crmOrganisations)
          .where(
            compose(
              orgFilter(crmOrganisations.organizationId),
              eq(crmOrganisations.isDeleted, false),
              or(
                eq(crmOrganisations.type, "CONTRACTOR"),
                eq(crmOrganisations.type, "OWNER_REP"),
              ),
              or(
                ilike(crmOrganisations.name, like),
                ilike(crmOrganisations.tradeSpecialty, like),
              ),
            ),
          )
          .orderBy(desc(crmOrganisations.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; name: string; type: string | null; city: string | null; state: string | null }>);

    const vendorsQuery = allowCrm
      ? db
          .select({
            id: crmOrganisations.id,
            name: crmOrganisations.name,
            type: crmOrganisations.type,
            city: crmOrganisations.city,
            state: crmOrganisations.state,
          })
          .from(crmOrganisations)
          .where(
            compose(
              orgFilter(crmOrganisations.organizationId),
              eq(crmOrganisations.isDeleted, false),
              or(
                eq(crmOrganisations.type, "VENDOR"),
                eq(crmOrganisations.type, "SUPPLIER"),
                eq(crmOrganisations.type, "RENTAL_VENDOR"),
                eq(crmOrganisations.type, "SERVICE_VENDOR"),
              ),
              or(
                ilike(crmOrganisations.name, like),
                ilike(crmOrganisations.tradeSpecialty, like),
              ),
            ),
          )
          .orderBy(desc(crmOrganisations.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; name: string; type: string | null; city: string | null; state: string | null }>);

    const subsQuery = allowCrm
      ? db
          .select({
            id: crmOrganisations.id,
            name: crmOrganisations.name,
            type: crmOrganisations.type,
            city: crmOrganisations.city,
            state: crmOrganisations.state,
          })
          .from(crmOrganisations)
          .where(
            compose(
              orgFilter(crmOrganisations.organizationId),
              eq(crmOrganisations.isDeleted, false),
              eq(crmOrganisations.type, "SUBCONTRACTOR"),
              or(
                ilike(crmOrganisations.name, like),
                ilike(crmOrganisations.tradeSpecialty, like),
              ),
            ),
          )
          .orderBy(desc(crmOrganisations.updatedAt))
          .limit(perEntityLimit)
      : Promise.resolve([] as Array<{ id: string; name: string; type: string | null; city: string | null; state: string | null }>);

    try {
      const [
        projectRows,
        bidRows,
        opportunityRows,
        contactRows,
        clientOrgRows,
        vendorRows,
        subRows,
      ] = await Promise.all([
        projectsQuery,
        bidsQuery,
        opportunitiesQuery,
        contactsQuery,
        clientOrgsQuery,
        vendorsQuery,
        subsQuery,
      ]);

      const results: SearchResult[] = [];

      for (const p of projectRows) {
        results.push({
          id: p.id,
          type: "project",
          title: p.name,
          subtitle: [p.code, [p.city, p.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
          url: `/projects/${encodeURIComponent(p.code)}`,
          icon: "briefcase",
        });
      }
      for (const b of bidRows) {
        results.push({
          id: b.id,
          type: "bid",
          title: b.name,
          subtitle: [b.code, b.clientName, b.status].filter(Boolean).join(" · "),
          url: `/bids/${encodeURIComponent(b.code)}`,
          icon: "file-text",
        });
      }
      for (const o of opportunityRows) {
        results.push({
          id: o.id,
          type: "deal",
          title: o.name,
          subtitle: [o.stage, o.dealValue ? `$${o.dealValue}` : null].filter(Boolean).join(" · "),
          url: `/crm/deals/${encodeURIComponent(o.id)}`,
          icon: "handshake",
        });
      }
      for (const c of clientOrgRows) {
        results.push({
          id: c.id,
          type: "organization",
          title: c.name,
          subtitle: [c.type, [c.city, c.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
          url: `/crm?tab=orgs&organisationId=${encodeURIComponent(c.id)}`,
          icon: "building",
        });
      }
      for (const c of contactRows) {
        const fullName = `${c.firstName} ${c.lastName}`.trim();
        results.push({
          id: c.id,
          type: "contact",
          title: fullName,
          subtitle: [c.title, c.email].filter(Boolean).join(" · "),
          url: `/crm?tab=contacts&contactId=${encodeURIComponent(c.id)}`,
          icon: "user",
        });
      }
      for (const v of vendorRows) {
        results.push({
          id: v.id,
          type: "vendor",
          title: v.name,
          subtitle: [v.type, [v.city, v.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
          url: `/crm?tab=orgs&organisationId=${encodeURIComponent(v.id)}`,
          icon: "truck",
        });
      }
      for (const s of subRows) {
        results.push({
          id: s.id,
          type: "subcontractor",
          title: s.name,
          subtitle: [[s.city, s.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
          url: `/crm?tab=orgs&organisationId=${encodeURIComponent(s.id)}`,
          icon: "hard-hat",
        });
      }

      const capped = results.slice(0, TOTAL_CAP);
      res.json({ results: capped });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Search error:", message);
      res.status(500).json({ error: "Search failed" });
    }
  },
);

export default router;
