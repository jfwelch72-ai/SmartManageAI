import { describe, it, expect, vi } from "vitest";

vi.mock("../utils/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

import { generateEstimatePdf } from "../estimate-pdf-service";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

describe("generateEstimatePdf", () => {
  it("produces a non-empty PDF for an estimate with no line items", async () => {
    const buf = await generateEstimatePdf({
      estimate: { id: "e1", versionNumber: 1, status: "DRAFT" },
      context: { title: "Test Estimate" },
      lineItems: [],
      totals: {
        materialCost: 0,
        laborCost: 0,
        equipmentCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
        totalCost: 0,
      },
      resolvePhoto: async () => null,
    });
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.slice(0, 4).toString()).toBe("%PDF");
  });

  it("invokes the photo resolver for every line item photo URL", async () => {
    const calls: string[] = [];
    const resolvePhoto = vi.fn(async (url: string) => {
      calls.push(url);
      return { buffer: PNG_1x1, contentType: "image/png" };
    });

    const buf = await generateEstimatePdf({
      estimate: { id: "e2", versionNumber: 3, status: "APPROVED" },
      context: { title: "Photo Test", code: "BID-1", clientName: "Acme" },
      lineItems: [
        {
          id: "li-1",
          description: "Concrete pour",
          category: "MATERIAL",
          quantity: 10,
          unit: "CY",
          totalCost: 1500,
          photoUrl: "/api/estimates/line-item-photos/org/li-1/a.png",
          photoUrls: [
            "/api/estimates/line-item-photos/org/li-1/a.png", // duplicate of legacy, should dedupe
            "/api/estimates/line-item-photos/org/li-1/b.png",
          ],
        },
        {
          id: "li-2",
          description: "Rebar",
          category: "MATERIAL",
          quantity: 200,
          unit: "LF",
          totalCost: 800,
          photoUrls: ["/api/estimates/line-item-photos/org/li-2/c.png"],
        },
      ],
      totals: {
        materialCost: 2300,
        laborCost: 0,
        equipmentCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
        totalCost: 2300,
      },
      resolvePhoto,
    });

    expect(buf.slice(0, 4).toString()).toBe("%PDF");
    expect(calls).toEqual([
      "/api/estimates/line-item-photos/org/li-1/a.png",
      "/api/estimates/line-item-photos/org/li-1/b.png",
      "/api/estimates/line-item-photos/org/li-2/c.png",
    ]);
  });

  it("renders a placeholder when a photo cannot be resolved", async () => {
    const buf = await generateEstimatePdf({
      estimate: { id: "e3", versionNumber: 1, status: "DRAFT" },
      context: { title: "Missing photo" },
      lineItems: [
        {
          id: "li-1",
          description: "Asphalt",
          category: "MATERIAL",
          quantity: 1,
          unit: "TON",
          totalCost: 100,
          photoUrls: ["/api/estimates/line-item-photos/org/li-1/missing.png"],
        },
      ],
      totals: {
        materialCost: 100,
        laborCost: 0,
        equipmentCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
        totalCost: 100,
      },
      resolvePhoto: async () => null,
    });

    expect(buf.length).toBeGreaterThan(500);
    expect(buf.slice(0, 4).toString()).toBe("%PDF");
  });
});
