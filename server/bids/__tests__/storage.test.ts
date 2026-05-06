import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BidStorageDrizzle } from "../storage.drizzle";
import { CrossOrgAccessError } from "../storage";
import { seedTestOrg, cleanupTestData, type TestOrg } from "../../__tests__/org-isolation/test-harness";

describe("BidStorageDrizzle (Task #2431 — per-domain storage seam pilot)", () => {
  let orgA: TestOrg;
  let orgB: TestOrg;

  beforeAll(async () => {
    orgA = await seedTestOrg("bids-A");
    orgB = await seedTestOrg("bids-B");
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe("constructor + tenancy filtering", () => {
    it("scopes getBidById to its org and returns the bid for the same-org caller", async () => {
      const storage = new BidStorageDrizzle(orgA.org.id);
      const bid = await storage.getBidById(orgA.resources.bidId);
      expect(bid).not.toBeNull();
      expect(bid?.id).toBe(orgA.resources.bidId);
      expect(bid?.gcOrganizationId).toBe(orgA.org.id);
    });

    it("returns null when reading another org's bid via getBidById (no leakage)", async () => {
      const storage = new BidStorageDrizzle(orgA.org.id);
      const leaked = await storage.getBidById(orgB.resources.bidId);
      expect(leaked).toBeNull();
    });

    it("listBidsWithEstimateSummary only returns the caller's org bids", async () => {
      const storageA = new BidStorageDrizzle(orgA.org.id);
      const rowsA = await storageA.listBidsWithEstimateSummary();
      const ids = rowsA.map((r) => r.id);
      expect(ids).toContain(orgA.resources.bidId);
      expect(ids).not.toContain(orgB.resources.bidId);
    });

    it("orgId=null (super-admin / public path) sees both orgs' bids", async () => {
      const unscoped = new BidStorageDrizzle(null);
      const rows = await unscoped.listBidsWithEstimateSummary();
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(orgA.resources.bidId);
      expect(ids).toContain(orgB.resources.bidId);
    });
  });

  describe("CrossOrgAccessError on writes that target another org's bid", () => {
    it("updateBidByCode for a foreign-org code throws CrossOrgAccessError (mapped to 403 by routes)", async () => {
      const storageA = new BidStorageDrizzle(orgA.org.id);
      const foreignBid = await new BidStorageDrizzle(null).getBidById(orgB.resources.bidId);
      expect(foreignBid).not.toBeNull();
      await expect(
        storageA.updateBidByCode(foreignBid!.code, { name: "should-not-update" }),
      ).rejects.toBeInstanceOf(CrossOrgAccessError);
    });

    it("deleteBidByCode for a foreign-org code throws CrossOrgAccessError", async () => {
      const storageA = new BidStorageDrizzle(orgA.org.id);
      const foreignBid = await new BidStorageDrizzle(null).getBidById(orgB.resources.bidId);
      await expect(
        storageA.deleteBidByCode(foreignBid!.code),
      ).rejects.toBeInstanceOf(CrossOrgAccessError);
    });
  });

  describe("createBid stamps the storage's orgId", () => {
    it("createBid writes gcOrganizationId from the constructor scope, not the input", async () => {
      const storageA = new BidStorageDrizzle(orgA.org.id);
      const created = await storageA.createBid({
        code: `__isolation_test__BID-CTOR-${Date.now()}`,
        name: "Constructor-scoped Bid",
        clientName: "Test Client",
        gcOrganizationId: orgA.org.id,
      } as any);
      expect(created.gcOrganizationId).toBe(orgA.org.id);

      // And the cross-org caller cannot see it
      const storageB = new BidStorageDrizzle(orgB.org.id);
      const leak = await storageB.getBidById(created.id);
      expect(leak).toBeNull();
    });
  });
});
