/**
 * API-level tenant isolation negative cases.
 *
 * Where `server/__tests__/tenant-rls.test.ts` covers the database
 * layer (RLS policies + dbContext), this spec exercises the same
 * invariants against the live HTTP API: an authenticated session in
 * Org A must NEVER be able to read or mutate an entity owned by
 * Org B, even when it knows that entity's primary-key UUID.
 *
 * Notes on org topology under the dev seed:
 *  - The default `Dev Sandbox Organization` is the canonical Org A;
 *    every `devLogin(role)` call links the user to it.
 *  - `POST /api/dev/fresh-admin-login` produces an unrelated, fully
 *    isolated org-with-admin pair we use as Org B. That endpoint
 *    sets the auth cookie on the request context it was called on,
 *    so we drive Org B from a dedicated APIRequestContext.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { installCsrf, installCsrfOnRequest } from "./helpers/csrf";
import { devLogin } from "./helpers/auth";
import {
  awardBidAndConvert,
  createBid,
  createSOV,
  createPayApp,
  createChangeOrder,
} from "./helpers/factories";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface FreshAdminResponse {
  user: { id: string; email: string; organizationId: string };
}

async function freshAdmin(request: APIRequestContext): Promise<FreshAdminResponse> {
  // Patch CSRF onto the request context BEFORE the first mutation
  // so the negative-write assertions below can never pass for a CSRF
  // reason; they must fail because Org B genuinely has no access.
  await installCsrfOnRequest(request);
  const res = await request.post(`${BASE_URL}/api/dev/fresh-admin-login`);
  expect(res.status(), `fresh-admin-login failed: ${await res.text()}`).toBe(200);
  return (await res.json()) as FreshAdminResponse;
}

test.describe("Tenant isolation: Org A entities are invisible / immutable to Org B", () => {
  test("bid, project, SOV, pay app, and change order are all 404 for the other org", async ({
    page,
    browser,
  }) => {
    // Org A — Dev Sandbox.
    await installCsrf(page);
    await devLogin(page, "ADMIN");

    const bidA = await createBid(page, { bidAmount: 75_000 });
    const projectA = await awardBidAndConvert(page, bidA.code);
    const sovA = await createSOV(page, { projectId: projectA.id, contractValue: 75_000 });
    const payAppA = await createPayApp(page, { projectId: projectA.id, sovId: sovA.id });
    const coA = await createChangeOrder(page, { projectId: projectA.id, amount: 5_000 });

    // Org B — fresh admin in its own context (= its own cookie jar).
    const orgBCtx = await browser.newContext();
    try {
      await freshAdmin(orgBCtx.request);

      // GET single bid by code.
      const bidGet = await orgBCtx.request.get(`${BASE_URL}/api/bids/${bidA.code}`);
      expect([403, 404]).toContain(bidGet.status());

      // GET single project by code.
      const projGet = await orgBCtx.request.get(`${BASE_URL}/api/projects/${projectA.code}`);
      expect([403, 404]).toContain(projGet.status());

      // GET SOV by id (and by project).
      const sovGet = await orgBCtx.request.get(`${BASE_URL}/api/sov/${sovA.id}`);
      expect([403, 404]).toContain(sovGet.status());
      const sovByProj = await orgBCtx.request.get(
        `${BASE_URL}/api/projects/${projectA.id}/sov`,
      );
      expect([403, 404]).toContain(sovByProj.status());

      // Mutating Org A's SOV from Org B must be denied with an authz status.
      const sovMutate = await orgBCtx.request.patch(`${BASE_URL}/api/sov/${sovA.id}`, {
        data: { contractValue: 1 },
      });
      expect([403, 404]).toContain(sovMutate.status());

      // GET pay application by id.
      const payGet = await orgBCtx.request.get(
        `${BASE_URL}/api/aia-billing/pay-applications/${payAppA.id}`,
      );
      expect([403, 404]).toContain(payGet.status());

      // GET change order by id.
      const coGet = await orgBCtx.request.get(`${BASE_URL}/api/change-orders/${coA.id}`);
      expect([403, 404]).toContain(coGet.status());

      // Mutating attempts must fail with an authz status (403/404).
      // 400 is excluded so a CSRF-shaped failure can't quietly pass
      // for the wrong reason — CSRF is installed on the Org B context
      // by `freshAdmin()` above, so any 400 here would be a true
      // validation error, not an auth check.
      const coApprove = await orgBCtx.request.post(
        `${BASE_URL}/api/change-orders/${coA.id}/approve`,
        { data: {} },
      );
      expect([403, 404]).toContain(coApprove.status());

      const payApprove = await orgBCtx.request.patch(
        `${BASE_URL}/api/aia-billing/pay-applications/${payAppA.id}/status`,
        { data: { status: "APPROVED" } },
      );
      expect([403, 404]).toContain(payApprove.status());

      // Listing endpoints must NOT enumerate Org A's records.
      const bidsList = await orgBCtx.request.get(`${BASE_URL}/api/bids`);
      expect(bidsList.status()).toBe(200);
      const bidsBody = await bidsList.json();
      const bidIds = (Array.isArray(bidsBody) ? bidsBody : bidsBody.bids ?? []).map(
        (b: { id: string }) => b.id,
      );
      expect(bidIds).not.toContain(bidA.id);

      const projList = await orgBCtx.request.get(`${BASE_URL}/api/projects`);
      expect(projList.status()).toBe(200);
      const projBody = await projList.json();
      const projIds = (Array.isArray(projBody) ? projBody : projBody.projects ?? []).map(
        (p: { id: string }) => p.id,
      );
      expect(projIds).not.toContain(projectA.id);
    } finally {
      await orgBCtx.close();
    }
  });
});
