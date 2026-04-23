// Task #1165 — End-to-end coverage for the bid tab importer. Drives the same
// sequence the BidTabImportDialog runs in the browser:
//   1. parse a sample CSV with the real parser
//   2. POST each parsed row to /api/dot/pay-items/match
//   3. POST one line item per row to /api/estimates/:id/line-items, carrying
//      the matched pay item's id, item number, unit, and spec section
//   4. GET the line items back and assert dotPayItemId / payItemNumber /
//      unit / specSection all round-tripped to the database
//
// The e2e DB has DOT agencies + pay items seeded by `seedDotAgenciesAndSpecBooks`
// at boot, so the matcher returns real candidates we can save against.

import { test, expect, type APIRequestContext } from "@playwright/test";
import { installCsrfOnRequest } from "./helpers/csrf";
import Papa from "papaparse";
import { parseRows } from "../client/src/lib/bidTabParser";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

const SAMPLE_CSV = [
  "Description,Quantity,Unit",
  "Roadway excavation,250,CY",
  "Asphalt concrete pavement,500,TON",
  "Concrete pavement,100,SY",
].join("\n");

async function devLogin(request: APIRequestContext, role: string) {
  const res = await request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(res.status(), await res.text()).toBe(200);
}

async function pickPayItemForDescription(
  request: APIRequestContext,
  description: string,
  unit: string,
): Promise<{
  payItem: { id: string; itemNumber: string; unit: string; specSection: string | null };
  specBook: { id: string };
} | null> {
  const res = await request.post(`${BASE_URL}/api/dot/pay-items/match`, {
    data: { description, unit, limit: 5 },
  });
  expect(res.status(), `match ${description}`).toBe(200);
  const body = (await res.json()) as {
    matches: Array<{
      payItem: { id: string; itemNumber: string; unit: string; specSection: string | null };
      specBook: { id: string };
      score: number;
    }>;
  };
  if (!body.matches || body.matches.length === 0) return null;
  return body.matches[0];
}

test.describe("Bid tab importer — end-to-end", () => {
  test("imports a sample bid tab and saves line items with DOT linkage", async ({ browser }) => {
    test.setTimeout(60_000);
    // Use a fresh BrowserContext so the auth_token cookie set by dev-login
    // is the same one carried by every subsequent API call.
    const context = await browser.newContext();
    const request = context.request;
    await installCsrfOnRequest(request, context);
    await devLogin(request, "ADMIN");

    // Step 1: parse the sample bid tab through the real parser. This is the
    // same code path the dialog runs on every CSV/XLSX upload — testing it
    // here means a regression in detectColumns/parseRows would fail this
    // e2e even before the network calls fire.
    const parsed = parseRows(
      Papa.parse<string[]>(SAMPLE_CSV, { skipEmptyLines: true }).data as unknown[][],
    );
    expect(parsed.length).toBe(3);
    expect(parsed.map((r) => r.description)).toEqual([
      "Roadway excavation",
      "Asphalt concrete pavement",
      "Concrete pavement",
    ]);

    // Step 2: spin up a project + estimate to receive the imported rows.
    // We use the public CRUD surface so this exercise stays end-to-end.
    const projectRes = await request.post(`${BASE_URL}/api/projects`, {
      data: {
        name: `BidTab Import E2E ${Date.now()}`,
        clientName: "E2E Client",
        status: "ACTIVE",
      },
    });
    expect(projectRes.status(), await projectRes.text()).toBe(201);
    const project = (await projectRes.json()) as { id: string };

    const estimateRes = await request.post(
      `${BASE_URL}/api/projects/${project.id}/estimate`,
      { data: {} },
    );
    expect(estimateRes.status(), await estimateRes.text()).toBe(201);
    const estimate = (await estimateRes.json()) as { id: string };

    // Step 3: per-row match → save. Some descriptions may not match against
    // every seeded agency catalog; we record which rows landed with DOT
    // linkage and assert at least one did, then verify each saved row's
    // shape on disk.
    interface SavedRow {
      description: string;
      lineItemId: string;
      withDotLink: boolean;
      expectedItemNumber?: string;
      expectedSpecSection?: string | null;
      expectedUnit?: string;
    }
    const saved: SavedRow[] = [];

    for (const row of parsed) {
      const top = await pickPayItemForDescription(request, row.description, row.unit);
      const usingDot = top !== null && top.payItem.id !== undefined;

      const payload: Record<string, unknown> = {
        category: "OTHER",
        description: row.description,
        quantity: row.quantity,
        unit: usingDot ? top!.payItem.unit : (row.unit || "EA"),
        materialCost: 0,
        laborCost: 0,
        laborHours: 0,
        equipmentCost: 0,
        equipmentHours: 0,
        consumablesCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
      };
      if (usingDot && top) {
        payload.dotPayItemId = top.payItem.id;
        payload.dotSpecBookId = top.specBook.id;
        payload.payItemNumber = top.payItem.itemNumber;
        payload.specSection = top.payItem.specSection ?? null;
      }

      const createRes = await request.post(
        `${BASE_URL}/api/estimates/${estimate.id}/line-items`,
        { data: payload },
      );
      expect(createRes.status(), await createRes.text()).toBe(201);
      const created = (await createRes.json()) as { id: string };
      saved.push({
        description: row.description,
        lineItemId: created.id,
        withDotLink: usingDot,
        expectedItemNumber: usingDot ? top!.payItem.itemNumber : undefined,
        expectedSpecSection: usingDot ? top!.payItem.specSection ?? null : undefined,
        expectedUnit: usingDot ? top!.payItem.unit : (row.unit || "EA"),
      });
    }

    expect(saved.length).toBe(parsed.length);
    expect(saved.some((r) => r.withDotLink), "at least one row should match a seeded DOT pay item")
      .toBe(true);

    // Step 4: round-trip check — fetch the persisted line items and verify
    // every accepted row carries dotPayItemId, payItemNumber, unit, and
    // specSection exactly as the dialog set them. The project-scoped getter
    // is the closest production-side read path (the bid-estimate page uses
    // its bid-scoped sibling); both source line items from the same table.
    const projectEstimateRes = await request.get(
      `${BASE_URL}/api/projects/${project.id}/estimate`,
    );
    expect(projectEstimateRes.status()).toBe(200);
    const wrapper = (await projectEstimateRes.json()) as {
      estimate: {
        id: string;
        lineItems: Array<{
          id: string;
          description: string;
          unit: string;
          dotPayItemId: string | null;
          payItemNumber: string | null;
          specSection: string | null;
        }>;
      } | null;
    };
    expect(wrapper.estimate, "estimate must exist").not.toBeNull();
    const list = wrapper.estimate!.lineItems;
    expect(list.length).toBeGreaterThanOrEqual(parsed.length);

    for (const s of saved) {
      const persisted = list.find((r) => r.id === s.lineItemId);
      expect(persisted, `persisted row for ${s.description}`).toBeDefined();
      expect(persisted!.unit).toBe(s.expectedUnit);
      if (s.withDotLink) {
        expect(persisted!.dotPayItemId, `dotPayItemId for ${s.description}`).not.toBeNull();
        expect(persisted!.payItemNumber).toBe(s.expectedItemNumber);
        expect(persisted!.specSection ?? null).toBe(s.expectedSpecSection ?? null);
      }
    }

    await context.close();
  });
});
