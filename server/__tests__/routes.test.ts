import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Route Module Structure", () => {
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

  it("should export notificationRoutes2 as a router", async () => {
    const mod = await import("../notificationRoutes2");
    expect(mod.default).toBeDefined();
    expect(mod.default.stack).toBeDefined();
  });

  it("should export auditBillingStorageRoutes as a router", async () => {
    const mod = await import("../auditBillingStorageRoutes");
    expect(mod.default).toBeDefined();
    expect(mod.default.stack).toBeDefined();
  });

  it("should export crewRoutes2 as a router", async () => {
    const mod = await import("../crewRoutes2");
    expect(mod.default).toBeDefined();
    expect(mod.default.stack).toBeDefined();
  });

  it("should export skillRoutes as a router", async () => {
    const mod = await import("../skillRoutes");
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
