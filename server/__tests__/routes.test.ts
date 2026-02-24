import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Route Module Structure", () => {
  it("should export dashboardUserRoutes as a router", async () => {
    const mod = await import("../dashboardUserRoutes");
    expect(mod.default).toBeDefined();
    expect(mod.default.stack).toBeDefined();
  });

  it("should export projectCoreRoutes as a router", async () => {
    const mod = await import("../projectCoreRoutes");
    expect(mod.default).toBeDefined();
    expect(mod.default.stack).toBeDefined();
  });

  it("should export crmVendorRoutes as a router", async () => {
    const mod = await import("../crmVendorRoutes");
    expect(mod.default).toBeDefined();
    expect(mod.default.stack).toBeDefined();
  });

  it("should export scopeConfigRoutes as a router", async () => {
    const mod = await import("../scopeConfigRoutes");
    expect(mod.default).toBeDefined();
    expect(mod.default.stack).toBeDefined();
  });

  it("should export projectContentRoutes as a router", async () => {
    const mod = await import("../projectContentRoutes");
    expect(mod.default).toBeDefined();
    expect(mod.default.stack).toBeDefined();
  });

  it("should export projectOpsRoutes as a router", async () => {
    const mod = await import("../projectOpsRoutes");
    expect(mod.default).toBeDefined();
    expect(mod.default.stack).toBeDefined();
  });

  it("should export notificationCrewRoutes as a router", async () => {
    const mod = await import("../notificationCrewRoutes");
    expect(mod.default).toBeDefined();
    expect(mod.default.stack).toBeDefined();
  });

  it("should export takeoffSubRoutes as a router", async () => {
    const mod = await import("../takeoffSubRoutes");
    expect(mod.default).toBeDefined();
    expect(mod.default.stack).toBeDefined();
  });

  it("should export equipmentMgmtRoutes as a router", async () => {
    const mod = await import("../equipmentMgmtRoutes");
    expect(mod.default).toBeDefined();
    expect(mod.default.stack).toBeDefined();
  });

  it("should export platformAdminRoutes as a router", async () => {
    const mod = await import("../platformAdminRoutes");
    expect(mod.default).toBeDefined();
    expect(mod.default.stack).toBeDefined();
  });
});

describe("Auth Module", () => {
  it("should export authentication middleware", async () => {
    const auth = await import("../auth");
    expect(auth.requireAuth).toBeDefined();
    expect(auth.requireRole).toBeDefined();
    expect(typeof auth.requireAuth).toBe("function");
    expect(typeof auth.requireRole).toBe("function");
  });
});

describe("Utility Modules", () => {
  it("should export audit logger", async () => {
    const auditLogger = await import("../auditLogger");
    expect(auditLogger.logAudit).toBeDefined();
    expect(typeof auditLogger.logAudit).toBe("function");
  });

  it("should export org filter helper", async () => {
    const orgFilter = await import("../orgFilter");
    expect(orgFilter.getOrgIdForFilter).toBeDefined();
    expect(typeof orgFilter.getOrgIdForFilter).toBe("function");
  });
});
