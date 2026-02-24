export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface EndpointEntry {
  method: HttpMethod;
  path: string;
  description: string;
  requiresBody?: boolean;
  bodyFactory?: (orgResources: OrgResources) => Record<string, any>;
  paramResolver?: (orgResources: OrgResources) => Record<string, string>;
  knownIsolationGap?: boolean;
}

export interface OrgResources {
  orgId: string;
  projectCode: string;
  projectId: string;
  bidId: string;
  userId: string;
  crmOrgId: string;
  estimateId: string;
  crewId: string;
  equipmentId: string;
  changeOrderId: string;
  taskId: string;
  scopeItemId: string;
}

export const ORG_SCOPED_ENDPOINTS: EndpointEntry[] = [
  // ── Projects ──
  {
    method: "GET",
    path: "/api/projects",
    description: "List projects",
  },
  {
    method: "GET",
    path: "/api/projects/:code",
    description: "Get project by code",
    paramResolver: (r) => ({ code: r.projectCode }),
  },
  {
    method: "GET",
    path: "/api/projects/:code/scope",
    description: "Get project scope items",
    paramResolver: (r) => ({ code: r.projectCode }),
  },
  {
    method: "GET",
    path: "/api/projects/:code/financials",
    description: "Get project financials",
    paramResolver: (r) => ({ code: r.projectCode }),
  },
  {
    method: "GET",
    path: "/api/projects/:code/labor-rates",
    description: "Get project labor rates",
    paramResolver: (r) => ({ code: r.projectCode }),
  },
  {
    method: "PATCH",
    path: "/api/projects/:code",
    description: "Update project (cross-org write)",
    paramResolver: (r) => ({ code: r.projectCode }),
    requiresBody: true,
    bodyFactory: () => ({ name: "CROSS_ORG_ATTACK" }),
  },
  {
    method: "DELETE",
    path: "/api/projects/:code",
    description: "Delete project (cross-org write)",
    paramResolver: (r) => ({ code: r.projectCode }),
  },

  // ── Bids ──
  {
    method: "GET",
    path: "/api/bids",
    description: "List bids",
  },
  {
    method: "GET",
    path: "/api/bids/:id",
    description: "Get bid by ID",
    paramResolver: (r) => ({ id: r.bidId }),
  },

  // ── CRM ──
  {
    method: "GET",
    path: "/api/crm/organisations",
    description: "List CRM organisations",
  },
  {
    method: "GET",
    path: "/api/crm/organisations/:id",
    description: "Get CRM organisation by ID",
    paramResolver: (r) => ({ id: r.crmOrgId }),
  },
  {
    method: "GET",
    path: "/api/crm/organisations/:id/contacts",
    description: "Get CRM org contacts",
    paramResolver: (r) => ({ id: r.crmOrgId }),
  },
  {
    method: "GET",
    path: "/api/crm/organisations/:id/notes",
    description: "Get CRM org notes",
    paramResolver: (r) => ({ id: r.crmOrgId }),
  },
  {
    method: "GET",
    path: "/api/crm/organisations/:id/pricing",
    description: "Get CRM org pricing",
    paramResolver: (r) => ({ id: r.crmOrgId }),
  },
  {
    method: "PUT",
    path: "/api/crm/organisations/:id",
    description: "Update CRM org (cross-org write)",
    paramResolver: (r) => ({ id: r.crmOrgId }),
    requiresBody: true,
    bodyFactory: () => ({ name: "CROSS_ORG_ATTACK" }),
  },
  {
    method: "DELETE",
    path: "/api/crm/organisations/:id",
    description: "Delete CRM org (cross-org write)",
    paramResolver: (r) => ({ id: r.crmOrgId }),
  },

  // ── Users ──
  {
    method: "GET",
    path: "/api/users",
    description: "List users",
  },
  {
    method: "GET",
    path: "/api/users/:id",
    description: "Get user by ID",
    paramResolver: (r) => ({ id: r.userId }),
  },
  {
    method: "PATCH",
    path: "/api/users/:id",
    description: "Update user (cross-org write)",
    paramResolver: (r) => ({ id: r.userId }),
    requiresBody: true,
    bodyFactory: () => ({ firstName: "CROSS_ORG_ATTACK" }),
  },

  // ── Dashboard ──
  {
    method: "GET",
    path: "/api/dashboard/stats",
    description: "Dashboard stats",
  },

  // ── Estimates ──
  {
    method: "GET",
    path: "/api/estimates",
    description: "List estimates",
  },
  {
    method: "GET",
    path: "/api/estimates/:id",
    description: "Get estimate by ID",
    paramResolver: (r) => ({ id: r.estimateId }),
  },

  // ── Equipment ──
  {
    method: "GET",
    path: "/api/equipment",
    description: "List equipment",
  },
  {
    method: "GET",
    path: "/api/equipment/:id",
    description: "Get equipment by ID",
    paramResolver: (r) => ({ id: r.equipmentId }),
  },

  // ── Time Entries ──
  {
    method: "GET",
    path: "/api/time-entries",
    description: "List time entries",
  },

  // ── Crews ──
  {
    method: "GET",
    path: "/api/crews",
    description: "List crews",
  },
  {
    method: "GET",
    path: "/api/crews/:id",
    description: "Get crew by ID",
    paramResolver: (r) => ({ id: r.crewId }),
  },

  // ── Notifications ──
  {
    method: "GET",
    path: "/api/notifications",
    description: "List notifications",
  },

  // ── Messages ──
  {
    method: "GET",
    path: "/api/messages/conversations",
    description: "List conversations",
  },

  // ── Change Orders ──
  {
    method: "GET",
    path: "/api/change-orders",
    description: "List change orders",
  },
  {
    method: "GET",
    path: "/api/change-orders/:id",
    description: "Get change order by ID",
    paramResolver: (r) => ({ id: r.changeOrderId }),
  },

  // ── Tasks ──
  {
    method: "GET",
    path: "/api/tasks",
    description: "List tasks",
  },
  {
    method: "GET",
    path: "/api/tasks/:taskId",
    description: "Get task by ID",
    paramResolver: (r) => ({ taskId: r.taskId }),
    knownIsolationGap: true,
  },
  {
    method: "PATCH",
    path: "/api/tasks/:taskId",
    description: "Update task (cross-org write)",
    paramResolver: (r) => ({ taskId: r.taskId }),
    requiresBody: true,
    bodyFactory: () => ({ title: "CROSS_ORG_ATTACK" }),
    knownIsolationGap: true,
  },
  {
    method: "DELETE",
    path: "/api/tasks/:taskId",
    description: "Delete task (cross-org write)",
    paramResolver: (r) => ({ taskId: r.taskId }),
    knownIsolationGap: true,
  },

  // ── RFIs ──
  {
    method: "GET",
    path: "/api/rfis",
    description: "List RFIs",
  },

  // ── Submittals ──
  {
    method: "GET",
    path: "/api/submittals",
    description: "List submittals",
  },

  // ── Transmittals ──
  {
    method: "GET",
    path: "/api/transmittals",
    description: "List transmittals",
  },

  // ── Inspections ──
  {
    method: "GET",
    path: "/api/inspections",
    description: "List inspections",
  },

  // ── SOV ──
  {
    method: "GET",
    path: "/api/sov",
    description: "List SOV entries",
  },

  // ── Scope Items ──
  {
    method: "GET",
    path: "/api/scope-items/:scopeItemId/progress",
    description: "Get scope item progress",
    paramResolver: (r) => ({ scopeItemId: r.scopeItemId }),
  },
  {
    method: "PATCH",
    path: "/api/scope-items/:id",
    description: "Update scope item (cross-org write)",
    paramResolver: (r) => ({ id: r.scopeItemId }),
    requiresBody: true,
    bodyFactory: () => ({ name: "CROSS_ORG_ATTACK" }),
  },
  {
    method: "DELETE",
    path: "/api/scope-items/:id",
    description: "Delete scope item (cross-org write)",
    paramResolver: (r) => ({ id: r.scopeItemId }),
  },

  // ── Notes ──
  {
    method: "GET",
    path: "/api/daily-notes",
    description: "List daily notes",
  },

  // ── Production Rates ──
  {
    method: "GET",
    path: "/api/production-rates",
    description: "List production rates",
  },

  // ── Project Material Budgets ──
  {
    method: "GET",
    path: "/api/projects/:projectId/material-budgets",
    description: "Get project material budgets",
    paramResolver: (r) => ({ projectId: r.projectId }),
  },
  {
    method: "GET",
    path: "/api/projects/:projectId/material-usage",
    description: "Get project material usage",
    paramResolver: (r) => ({ projectId: r.projectId }),
  },
  {
    method: "GET",
    path: "/api/projects/:projectId/material-overages",
    description: "Get project material overages",
    paramResolver: (r) => ({ projectId: r.projectId }),
  },

  // ── Documents ──
  {
    method: "GET",
    path: "/api/organization/documents",
    description: "List org documents",
  },

  // ── Pricebook Imports ──
  {
    method: "GET",
    path: "/api/pricebook-imports",
    description: "List pricebook imports",
  },

  // ── Time Clock ──
  {
    method: "GET",
    path: "/api/timeclock/shifts",
    description: "List time clock shifts",
  },

  // ── Payroll ──
  {
    method: "GET",
    path: "/api/payroll/settings",
    description: "Get payroll settings",
  },

  // ── Subcontracts ──
  {
    method: "GET",
    path: "/api/subcontracts",
    description: "List subcontracts",
  },
];

export function resolveEndpointPath(
  entry: EndpointEntry,
  resources: OrgResources
): string {
  let resolved = entry.path;
  if (entry.paramResolver) {
    const params = entry.paramResolver(resources);
    for (const [key, value] of Object.entries(params)) {
      resolved = resolved.replace(`:${key}`, value);
    }
  }
  return resolved;
}
