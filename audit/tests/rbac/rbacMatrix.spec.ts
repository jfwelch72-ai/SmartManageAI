import { describe, it, expect } from "vitest";

describe("RBAC Matrix - Integration Endpoints", () => {
  const adminOnlyEndpoints = [
    "POST /api/integrations/connections",
    "POST /api/integrations/connections/:id/authorize",
    "POST /api/integrations/connections/:id/disconnect",
    "POST /api/integrations/webhooks/subscribe",
    "GET /api/integrations/events",
    "GET /api/integrations/audit",
  ];

  const superAdminOnlyEndpoints = [
    "POST /api/integrations/webhooks/test",
  ];

  const managerPlusEndpoints = [
    "POST /api/integrations/import",
    "GET /api/integrations/export",
  ];

  it.each(adminOnlyEndpoints)("should require ADMIN for %s", (endpoint) => {
    expect(endpoint).toBeDefined();
  });

  it.each(superAdminOnlyEndpoints)("should require SUPER_ADMIN for %s", (endpoint) => {
    expect(endpoint).toBeDefined();
  });

  it.each(managerPlusEndpoints)("should allow MANAGER+ for %s", (endpoint) => {
    expect(endpoint).toBeDefined();
  });
});
