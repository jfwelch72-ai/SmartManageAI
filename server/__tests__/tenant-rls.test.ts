// Task #2478 — Cross-tenant isolation contract tests for the RLS policies
// installed by `migrations/0096_enable_tenant_rls.sql` and the
// `withOrgContext` / `runAsSuperadmin` wrappers in `server/dbContext.ts`.
//
// The tests pick a representative tenant table (`bids`) — anything with an
// `organization_id` column would do; the policy is the same shape on every
// table in `TENANT_TABLES`.
//
// Run via:
//   npm test -- server/__tests__/tenant-rls.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import type { QueryResult } from "pg";
import { pool, db } from "../db";
import { withOrgContext, runAsSuperadmin, withJobOrgContext } from "../dbContext";
import { ensureRlsPolicies } from "../utils/ensureRlsPolicies";

const TAG = `__rls_test_${Date.now()}__`;

interface Seeded {
  orgAId: string;
  orgBId: string;
  bidAId: string;
  bidBId: string;
}

let seeded: Seeded;

// drizzle's `db.execute(sql\`…\`)` returns a node-postgres `QueryResult<T>`
// at runtime. Its declared return type widens to `unknown` in some drizzle
// versions, so we narrow once here instead of sprinkling `as any` casts
// through every assertion.
function rows<T extends Record<string, unknown>>(result: unknown): T[] {
  return (result as QueryResult<T>).rows;
}

async function insertOrg(name: string): Promise<string> {
  const r = await db.execute(
    sql`INSERT INTO organizations (name, slug, trade_type, onboarding_status, is_active)
        VALUES (${name}, ${name}, 'GENERAL_CONTRACTOR', 'COMPLETED', true)
        RETURNING id`,
  );
  return rows<{ id: string }>(r)[0].id;
}

async function insertBid(orgId: string, code: string): Promise<string> {
  const r = await db.execute(
    sql`INSERT INTO bids (code, name, gc_organization_id, organization_id, status)
        VALUES (${code}, ${code}, ${orgId}, ${orgId}, 'DRAFT')
        RETURNING id`,
  );
  return rows<{ id: string }>(r)[0].id;
}

describe("tenant RLS isolation", () => {
  beforeAll(async () => {
    // Make sure the policies are in place even on a freshly built test DB.
    await ensureRlsPolicies();

    // Seed runs as superadmin because RLS policies are now fail-closed:
    // an INSERT outside any context would be blocked by the FORCE policy
    // unless this test process happens to be running with the default
    // superadmin connect handler (the production setup). Going through
    // runAsSuperadmin makes the test stable in either mode.
    await runAsSuperadmin("rls-test-seed", async () => {
      const orgAId = await insertOrg(`${TAG}-A`);
      const orgBId = await insertOrg(`${TAG}-B`);
      const bidAId = await insertBid(orgAId, `${TAG}-A-bid`);
      const bidBId = await insertBid(orgBId, `${TAG}-B-bid`);
      seeded = { orgAId, orgBId, bidAId, bidBId };
    });
  });

  afterAll(async () => {
    // Cleanup runs as superadmin so the cross-tenant DELETE is allowed.
    await runAsSuperadmin("rls-test-cleanup", async () => {
      await db.execute(sql`DELETE FROM bids WHERE name LIKE ${TAG + "%"}`);
      await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${TAG + "%"}`);
    });
  });

  it("Org A context cannot SELECT Org B rows", async () => {
    await withOrgContext(
      { organizationId: seeded.orgAId, source: "test" },
      async () => {
        const r = await db.execute(
          sql`SELECT id FROM bids WHERE name LIKE ${TAG + "%"}`,
        );
        expect(rows<{ id: string }>(r).map((x) => x.id)).toEqual([seeded.bidAId]);
      },
    );
  });

  it("Org A context cannot UPDATE Org B rows", async () => {
    await withOrgContext(
      { organizationId: seeded.orgAId, source: "test" },
      async () => {
        const r = await db.execute(
          sql`UPDATE bids SET name = name || '_x' WHERE id = ${seeded.bidBId} RETURNING id`,
        );
        expect(rows<{ id: string }>(r)).toHaveLength(0);
      },
    );

    // Verify Org B's row is unchanged when read from a context that can see it.
    await runAsSuperadmin("rls-test-verify", async () => {
      const r = await db.execute(
        sql`SELECT name FROM bids WHERE id = ${seeded.bidBId}`,
      );
      expect(rows<{ name: string }>(r)[0].name).toBe(`${TAG}-B-bid`);
    });
  });

  it("Org A context cannot DELETE Org B rows", async () => {
    await withOrgContext(
      { organizationId: seeded.orgAId, source: "test" },
      async () => {
        const r = await db.execute(
          sql`DELETE FROM bids WHERE id = ${seeded.bidBId} RETURNING id`,
        );
        expect(rows<{ id: string }>(r)).toHaveLength(0);
      },
    );
  });

  it("runAsSuperadmin sees rows from every org", async () => {
    await runAsSuperadmin("rls-test-superadmin-read", async () => {
      const r = await db.execute(
        sql`SELECT id FROM bids WHERE name LIKE ${TAG + "%"} ORDER BY id`,
      );
      const ids = rows<{ id: string }>(r).map((x) => x.id).sort();
      expect(ids).toEqual([seeded.bidAId, seeded.bidBId].sort());
    });
  });

  it("withJobOrgContext scopes a background job to a single tenant", async () => {
    // Mirrors the wrapper used in `server/jobs/jobRunner.ts` around per-org
    // loops. Inside the wrapped block, the session is downgraded to non-
    // superadmin and bound to org A — so org B's rows are invisible even
    // though the SQL has no `WHERE organization_id` clause.
    await withJobOrgContext("rls-test-job", seeded.orgAId, async () => {
      const r = await db.execute(
        sql`SELECT id FROM bids WHERE name LIKE ${TAG + "%"}`,
      );
      expect(rows<{ id: string }>(r).map((x) => x.id)).toEqual([seeded.bidAId]);
    });
  });

  it("strict mode: a raw client with non-superadmin + empty org id sees zero rows", async () => {
    // Simulates `STRICT_TENANT_RLS=true` for a single connection: drop the
    // superadmin default and clear the org id, then prove that the
    // FORCE-RLS / fail-closed policy returns nothing. This is the
    // behavioural contract the env flag relies on.
    const client = await pool.connect();
    try {
      await client.query(
        "SELECT set_config('app.is_superadmin', 'false', false), set_config('app.current_org_id', '', false)",
      );
      const r = await client.query<{ id: string }>(
        `SELECT id FROM bids WHERE name LIKE $1`,
        [`${TAG}%`],
      );
      expect(r.rows).toHaveLength(0);
    } finally {
      // Restore the superadmin default so the recycled connection doesn't
      // poison subsequent tests.
      try {
        await client.query("SELECT set_config('app.is_superadmin', 'true', false)");
      } catch {
        // ignore — connection will be discarded if it errored
      }
      client.release();
    }
  });
});
