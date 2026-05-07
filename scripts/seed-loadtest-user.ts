/**
 * Seed Script: deterministic load-test fixtures (multi-tenant)
 *
 * Creates TWO independent tenants so the noisy-neighbor scenario has
 * realistic heavy-vs-quiet cohorts to split traffic across:
 *
 *   - "LoadTest Heavy Co"   admin: loadtest-heavy@example.com / loadtest
 *   - "LoadTest Quiet Co"   admin: loadtest-quiet@example.com / loadtest
 *
 * Each tenant gets one project + one bid so the `:id` budget entries
 * are exercised by `top-endpoints.js` (which fetches the first id of
 * each kind for the logged-in user's org).
 *
 * The first credential pair is also what `LOAD_TENANT_USERS` defaults
 * to in `loadtests/lib/config.js` and the load-test workflows, so a
 * single-tenant smoke run still picks up the heavy admin transparently.
 *
 * Idempotent: re-running is a no-op once both user rows exist.
 *
 * Run with: npx tsx scripts/seed-loadtest-user.ts
 */

import { db } from "../server/db";
import { organizations, users, projects, bids } from "../shared/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const PASSWORD = process.env.LOAD_SEED_PASSWORD || "loadtest";

// Narrow string-literal casts on enum-backed columns only. Mirrors the
// pattern used by `scripts/seed-test-company.ts` for `tradeType`.
type TradeType = typeof organizations.$inferInsert["tradeType"];
type OnboardingStatus = typeof organizations.$inferInsert["onboardingStatus"];
type UserRole = typeof users.$inferInsert["role"];

interface TenantSpec {
  email: string;
  orgName: string;
  orgSlug: string;
  projectCode: string;
  bidCode: string;
}

const TENANTS: TenantSpec[] = [
  {
    email: process.env.LOAD_SEED_HEAVY_EMAIL || "loadtest-heavy@example.com",
    orgName: "LoadTest Heavy Co",
    orgSlug: "loadtest-heavy-co",
    projectCode: "LT-H-001",
    bidCode: "LT-H-BID-001",
  },
  {
    email: process.env.LOAD_SEED_QUIET_EMAIL || "loadtest-quiet@example.com",
    orgName: "LoadTest Quiet Co",
    orgSlug: "loadtest-quiet-co",
    projectCode: "LT-Q-001",
    bidCode: "LT-Q-BID-001",
  },
];

async function seedTenant(t: TenantSpec, passwordHash: string) {
  const existing = await db.select().from(users).where(eq(users.email, t.email)).limit(1);
  if (existing.length > 0) {
    console.log(`[seed-loadtest-user] already exists: ${t.email}`);
    return;
  }

  const [org] = await db
    .insert(organizations)
    .values({
      name: t.orgName,
      slug: t.orgSlug,
      tradeType: "GENERAL_CONTRACTOR" satisfies TradeType,
      onboardingStatus: "COMPLETED" satisfies OnboardingStatus,
      isActive: true,
    })
    .returning();

  await db.insert(users).values({
    email: t.email,
    passwordHash,
    firstName: "Load",
    lastName: "Test",
    role: "ADMIN" satisfies UserRole,
    organizationId: org.id,
    emailVerified: true,
    isActive: true,
  });

  await db.insert(projects).values({
    name: `${t.orgName} Project`,
    code: t.projectCode,
    clientName: `${t.orgName} Client`,
    organizationId: org.id,
  });

  await db.insert(bids).values({
    name: `${t.orgName} Bid`,
    code: t.bidCode,
    clientName: `${t.orgName} Client`,
    organizationId: org.id,
  });

  console.log(`[seed-loadtest-user] created ${t.email} in org ${org.id}`);
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  for (const t of TENANTS) {
    await seedTenant(t, passwordHash);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed-loadtest-user] failed", err);
    process.exit(1);
  });
