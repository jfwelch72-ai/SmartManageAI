import { describe, it, expect } from "vitest";
import {
  insertOrganizationSchema,
  insertProjectSchema,
  insertUserSchema,
  insertBidSchema,
  insertCrmOrganisationSchema,
  insertEstimateSchema,
  insertTimeEntrySchema,
  insertChangeOrderSchema,
  insertNotificationSchema,
  userRoleEnum,
  projectStatusEnum,
  bidStatusEnum,
  planTierEnum,
} from "@shared/schema";

describe("Schema Enums", () => {
  it("should have valid user roles", () => {
    const roles = userRoleEnum.enumValues;
    expect(roles).toContain("ADMIN");
    expect(roles).toContain("MANAGER");
    expect(roles).toContain("SUPER_ADMIN");
    expect(roles).toContain("FIELD_WORKER");
    expect(roles).toContain("HUSTLER");
    expect(roles).toContain("SUPERINTENDENT");
    expect(roles).toContain("ESTIMATOR");
    expect(roles).toContain("VENDOR");
    expect(roles.length).toBe(8);
  });

  it("should have valid project statuses", () => {
    const statuses = projectStatusEnum.enumValues;
    expect(statuses).toContain("BID");
    expect(statuses).toContain("ACTIVE");
    expect(statuses).toContain("COMPLETE");
  });

  it("should have valid bid statuses", () => {
    const statuses = bidStatusEnum.enumValues;
    expect(statuses).toContain("DRAFT");
    expect(statuses).toContain("AWARDED");
    expect(statuses).toContain("LOST");
  });

  it("should have valid plan tiers", () => {
    const tiers = planTierEnum.enumValues;
    expect(tiers).toEqual(["free", "starter", "professional", "enterprise"]);
  });
});

describe("Insert Schemas - Validation", () => {
  it("should validate organization insert schema", () => {
    const valid = insertOrganizationSchema.safeParse({
      name: "Test Construction Co",
      slug: "test-construction-co",
      tradeType: "GENERAL_CONTRACTOR",
    });
    expect(valid.success).toBe(true);
  });

  it("should reject organization without name", () => {
    const invalid = insertOrganizationSchema.safeParse({
      slug: "test",
      tradeType: "GENERAL_CONTRACTOR",
    });
    expect(invalid.success).toBe(false);
  });

  it("should reject organization with invalid trade type", () => {
    const invalid = insertOrganizationSchema.safeParse({
      name: "Test Co",
      slug: "test-co",
      tradeType: "invalid_trade",
    });
    expect(invalid.success).toBe(false);
  });

  it("should validate user insert schema", () => {
    const valid = insertUserSchema.safeParse({
      username: "testuser",
      passwordHash: "hashedpassword123",
      firstName: "Test",
      lastName: "User",
      email: "test@example.com",
      role: "ADMIN",
      organizationId: "org-123",
    });
    expect(valid.success).toBe(true);
  });

  it("should validate bid insert schema", () => {
    const valid = insertBidSchema.safeParse({
      code: "BID-001",
      name: "New Office Building",
      projectName: "Office Project",
      clientName: "Test Client",
      organizationId: "org-123",
    });
    expect(valid.success).toBe(true);
  });

  it("should validate change order insert schema", () => {
    const valid = insertChangeOrderSchema.safeParse({
      projectId: "proj-123",
      organizationId: "org-123",
      changeOrderNumber: "CO-001",
      description: "Additional concrete work",
      amount: "5000.00",
      requestedById: "user-123",
    });
    expect(valid.success).toBe(true);
  });
});

describe("Schema Module Re-exports", () => {
  it("should re-export all core schemas from barrel index", () => {
    expect(insertOrganizationSchema).toBeDefined();
    expect(insertProjectSchema).toBeDefined();
    expect(insertUserSchema).toBeDefined();
    expect(insertBidSchema).toBeDefined();
    expect(insertCrmOrganisationSchema).toBeDefined();
    expect(insertEstimateSchema).toBeDefined();
    expect(insertTimeEntrySchema).toBeDefined();
    expect(insertChangeOrderSchema).toBeDefined();
    expect(insertNotificationSchema).toBeDefined();
  });
});
