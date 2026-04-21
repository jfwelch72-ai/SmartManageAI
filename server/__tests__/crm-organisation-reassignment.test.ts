/**
 * Task #738: integration tests for CRM organisation owner-reassignment
 * notifications.
 *
 * Task #731 wired the organisation PUT + bulk-reassign endpoints into the
 * shared coalescing helper (kind: "organization"). The coalescer itself is
 * already covered by `contact-reassignment-coalesce.test.ts`; these tests
 * pin the route-level contract so we don't regress:
 *
 *   - PUT /api/crm/organisations/:id emits exactly one immediate
 *     `CRM_ORGANIZATION_REASSIGNED` notification when the owner changes to a
 *     different active user, and emits nothing for self-assigns, no-op
 *     updates, or clears (ownerId -> null).
 *   - POST /api/crm/organisations/bulk-reassign-owner collapses to one
 *     immediate + one summary notification per call (not one per row),
 *     attributes both to the new owner, and skips rows that were already
 *     owned by the new owner (no-op rows).
 *
 * Strategy: mount the real `crmRoutes.ts` router in a minimal Express app
 * with a mocked DB and auth layer so the route handler runs end-to-end and
 * we can observe the `notifications` rows that `queueOwnerReassignmentNotification`
 * persists through the real coalescer.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

import {
  crmOrganisations,
  users,
  notifications,
  auditLog,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// Shared mutable state for the DB mock. Tests seed these before dispatching
// requests so the route handler "finds" the right rows.
// ---------------------------------------------------------------------------

interface FakeOrg {
  id: string;
  name: string;
  ownerId: string | null;
  organizationId: string;
  type: string;
}

const insertedNotifications: Array<Record<string, unknown>> = [];
const insertedAudits: Array<Record<string, unknown>> = [];

const state: {
  existingOrg: FakeOrg | null;
  ownerUser: { id: string } | null;
  updatedOrg: FakeOrg | null;
  bulkUpdatedRows: Array<{ id: string; name: string }>;
  currentUser: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    role: string;
    organizationId: string;
  };
} = {
  existingOrg: null,
  ownerUser: null,
  updatedOrg: null,
  bulkUpdatedRows: [],
  currentUser: {
    id: "user-actor",
    firstName: "Actor",
    lastName: "User",
    email: "actor@test.local",
    role: "ADMIN",
    organizationId: "tenant-org",
  },
};

// ---------------------------------------------------------------------------
// Pending-buffer simulation (copied + adapted from contact-reassignment-coalesce.test.ts).
// ---------------------------------------------------------------------------

interface PendingRow {
  kind: string;
  recipient_user_id: string;
  organization_id: string | null;
  additional_count: number;
  reassigner_names: string[];
  first_additional_contact_id: string | null;
  flush_at: Date;
}
const pendingRows = new Map<string, PendingRow>();
const rowKey = (kind: string, recipientUserId: string) =>
  `${kind}:${recipientUserId}`;

function poolQuery(
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: unknown[] }> {
  const text = sql.trim();
  if (text.startsWith("INSERT INTO pending_contact_reassignment_notifications")) {
    const [kind, recipientUserId, organizationId, reassignerName, contactId] =
      params as [string, string, string | null, string, string];
    const key = rowKey(kind, recipientUserId);
    const existing = pendingRows.get(key);
    if (!existing) {
      const row: PendingRow = {
        kind,
        recipient_user_id: recipientUserId,
        organization_id: organizationId,
        additional_count: 0,
        reassigner_names: [],
        first_additional_contact_id: null,
        flush_at: new Date(Date.now() + 5 * 60 * 1000),
      };
      pendingRows.set(key, row);
      return Promise.resolve({
        rows: [{ inserted: true, flush_at: row.flush_at }],
      });
    }
    existing.additional_count += 1;
    if (!existing.reassigner_names.includes(reassignerName)) {
      existing.reassigner_names.push(reassignerName);
    }
    if (!existing.first_additional_contact_id) {
      existing.first_additional_contact_id = contactId;
    }
    if (!existing.organization_id && organizationId) {
      existing.organization_id = organizationId;
    }
    return Promise.resolve({
      rows: [{ inserted: false, flush_at: existing.flush_at }],
    });
  }
  if (text.startsWith("DELETE FROM pending_contact_reassignment_notifications")) {
    const [kind, recipientUserId] = params as [string, string];
    const key = rowKey(kind, recipientUserId);
    const row = pendingRows.get(key);
    if (!row) return Promise.resolve({ rows: [] });
    pendingRows.delete(key);
    return Promise.resolve({ rows: [row] });
  }
  return Promise.resolve({ rows: [] });
}

// ---------------------------------------------------------------------------
// Drizzle db mock — returns tiny thenable builders so `await` at any step
// resolves to canned rows keyed off the `.from(TABLE)` reference.
// ---------------------------------------------------------------------------

function terminal<T>(rows: T[]): any {
  const builder: any = {
    from: () => builder,
    where: () => builder,
    limit: (_n: number) => Promise.resolve(rows),
    orderBy: () => builder,
    leftJoin: () => builder,
    innerJoin: () => builder,
    then: (resolve: any, reject: any) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return builder;
}

function makeSelectBuilder(table: any): any {
  if (table === crmOrganisations) {
    return terminal(state.existingOrg ? [state.existingOrg] : []);
  }
  if (table === users) {
    return terminal(state.ownerUser ? [state.ownerUser] : []);
  }
  return terminal([]);
}

function makeUpdateBuilder(table: any): any {
  const chain: any = {
    set: (_vals: Record<string, unknown>) => chain,
    where: (_cond: unknown) => chain,
    returning: (_shape?: unknown) => {
      if (table === crmOrganisations) {
        if (state.bulkUpdatedRows.length > 0) {
          return Promise.resolve(state.bulkUpdatedRows);
        }
        return Promise.resolve(state.updatedOrg ? [state.updatedOrg] : []);
      }
      return Promise.resolve([]);
    },
    then: (resolve: any, reject: any) =>
      Promise.resolve([]).then(resolve, reject),
  };
  return chain;
}

function makeInsertBuilder(table: any): any {
  return {
    values: (vals: any) => {
      const arr = Array.isArray(vals) ? vals : [vals];
      if (table === notifications) {
        insertedNotifications.push(...arr);
        const returning = async () =>
          arr.map((v, i) => ({
            ...v,
            id: `notif-${insertedNotifications.length - arr.length + i + 1}`,
          }));
        // Make thenable so `await db.insert(notifications).values(v)` also works.
        return {
          returning,
          then: (resolve: any, reject: any) =>
            Promise.resolve(undefined).then(resolve, reject),
        };
      }
      if (table === auditLog) {
        insertedAudits.push(...arr);
      }
      return {
        returning: async () => arr,
        then: (resolve: any, reject: any) =>
          Promise.resolve(undefined).then(resolve, reject),
      };
    },
  };
}

const mockDb: any = {
  select: (_shape?: any) => ({
    from: (table: any) => makeSelectBuilder(table),
  }),
  insert: (table: any) => makeInsertBuilder(table),
  update: (table: any) => makeUpdateBuilder(table),
  transaction: async (cb: (tx: any) => any) => cb(mockDb),
  execute: async () => ({ rows: [] }),
};

vi.mock("../db", () => ({
  db: mockDb,
  pool: { query: poolQuery },
}));

// ---------------------------------------------------------------------------
// Stub out everything else the route touches but isn't the subject of the
// test: auth middleware, org scoping, custom fields, notification delivery,
// and heavy AI/scoring modules.
// ---------------------------------------------------------------------------

vi.mock("../auth", async () => {
  const actual: any = await vi.importActual("../auth");
  return {
    ...actual,
    requireAuth: (req: any, _res: any, next: any) => {
      req.user = state.currentUser;
      next();
    },
    requireRole:
      (..._roles: string[]) =>
      (_req: any, _res: any, next: any) =>
        next(),
  };
});

vi.mock("../orgFilter", async () => {
  const actual: any = await vi.importActual("../orgFilter");
  return {
    ...actual,
    getOrgIdForFilter: (req: any) => ({
      shouldFilter: true,
      orgId: req.user?.organizationId ?? "tenant-org",
      mustDenyAccess: false,
      isSuperAdmin: false,
    }),
  };
});

vi.mock("../crmCustomFieldsRoutes", () => ({
  upsertCustomFieldValues: vi.fn(async () => ({ ok: true })),
  getCustomFieldsMap: vi.fn(async () => ({})),
  getCustomFieldsMapBatch: vi.fn(async () => ({})),
  getEntityIdsMatchingCustomFieldFilters: vi.fn(async () => []),
  deleteCustomFieldValuesForEntity: vi.fn(async () => undefined),
}));

vi.mock("../services/notificationDelivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

vi.mock("../events", () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock("../ai/winProbabilityService", () => ({
  scoreWinProbability: vi.fn(async () => ({ probability: 0 })),
}));

// ---------------------------------------------------------------------------
// Mount the real router into a minimal Express app for supertest.
// ---------------------------------------------------------------------------

async function buildApp() {
  const crmRouter = (await import("../crmRoutes")).default;
  const { __flushReassignmentForTest, __resetContactReassignmentQueueForTest } =
    await import("../services/notificationService");
  const app = express();
  app.use(express.json());
  app.use(crmRouter);
  return { app, __flushReassignmentForTest, __resetContactReassignmentQueueForTest };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) =>
    setImmediate(() => setImmediate(resolve)),
  );
}

describe("CRM organisation owner reassignment — route integration (Task #731 / #738)", () => {
  let app: express.Express;
  let __flushReassignmentForTest: (
    kind: string,
    recipientUserId: string,
  ) => Promise<void>;
  let __resetContactReassignmentQueueForTest: () => void;

  beforeEach(async () => {
    insertedNotifications.length = 0;
    insertedAudits.length = 0;
    pendingRows.clear();
    state.existingOrg = null;
    state.ownerUser = null;
    state.updatedOrg = null;
    state.bulkUpdatedRows = [];
    state.currentUser = {
      id: "user-actor",
      firstName: "Alice",
      lastName: "Actor",
      email: "alice@test.local",
      role: "ADMIN",
      organizationId: "tenant-org",
    };

    const built = await buildApp();
    app = built.app;
    __flushReassignmentForTest = built.__flushReassignmentForTest as any;
    __resetContactReassignmentQueueForTest =
      built.__resetContactReassignmentQueueForTest;
    __resetContactReassignmentQueueForTest();
  });

  describe("PUT /api/crm/organisations/:id", () => {
    it("emits exactly one immediate CRM_ORGANIZATION_REASSIGNED notification on a real owner change", async () => {
      state.existingOrg = {
        id: "org-1",
        name: "Acme Corp",
        ownerId: "owner-old",
        organizationId: "tenant-org",
        type: "CLIENT",
      };
      state.ownerUser = { id: "owner-new" };
      state.updatedOrg = {
        ...state.existingOrg,
        ownerId: "owner-new",
      };

      const res = await request(app)
        .put("/api/crm/organisations/org-1")
        .send({ ownerId: "owner-new" });

      expect(res.status).toBe(200);
      await flushMicrotasks();

      expect(insertedNotifications).toHaveLength(1);
      expect(insertedNotifications[0]).toMatchObject({
        userId: "owner-new",
        type: "CRM_ORGANIZATION_REASSIGNED",
        title: "A CRM organization was assigned to you",
        message: "Alice Actor assigned Acme Corp to you.",
        relatedEntityId: "org-1",
        relatedEntityType: "CRM_ORGANIZATION",
      });
    });

    it("emits no notification on a self-assignment", async () => {
      state.existingOrg = {
        id: "org-2",
        name: "Acme Corp",
        ownerId: "owner-old",
        organizationId: "tenant-org",
        type: "CLIENT",
      };
      state.ownerUser = { id: state.currentUser.id };
      state.updatedOrg = {
        ...state.existingOrg,
        ownerId: state.currentUser.id,
      };

      const res = await request(app)
        .put("/api/crm/organisations/org-2")
        .send({ ownerId: state.currentUser.id });

      expect(res.status).toBe(200);
      await flushMicrotasks();
      expect(insertedNotifications).toHaveLength(0);
    });

    it("emits no notification on a no-op update (owner unchanged)", async () => {
      state.existingOrg = {
        id: "org-3",
        name: "Acme Corp",
        ownerId: "owner-same",
        organizationId: "tenant-org",
        type: "CLIENT",
      };
      state.ownerUser = { id: "owner-same" };
      state.updatedOrg = { ...state.existingOrg };

      const res = await request(app)
        .put("/api/crm/organisations/org-3")
        .send({ ownerId: "owner-same" });

      expect(res.status).toBe(200);
      await flushMicrotasks();
      expect(insertedNotifications).toHaveLength(0);
    });

    it("emits no notification when the owner is cleared (ownerId -> null)", async () => {
      state.existingOrg = {
        id: "org-4",
        name: "Acme Corp",
        ownerId: "owner-old",
        organizationId: "tenant-org",
        type: "CLIENT",
      };
      state.updatedOrg = { ...state.existingOrg, ownerId: null };

      const res = await request(app)
        .put("/api/crm/organisations/org-4")
        .send({ ownerId: null });

      expect(res.status).toBe(200);
      await flushMicrotasks();
      expect(insertedNotifications).toHaveLength(0);
    });

    it("emits no notification when ownerId is omitted entirely from the update", async () => {
      state.existingOrg = {
        id: "org-5",
        name: "Acme Corp",
        ownerId: "owner-old",
        organizationId: "tenant-org",
        type: "CLIENT",
      };
      state.updatedOrg = { ...state.existingOrg, name: "Acme Corp LLC" };

      const res = await request(app)
        .put("/api/crm/organisations/org-5")
        .send({ name: "Acme Corp LLC" });

      expect(res.status).toBe(200);
      await flushMicrotasks();
      expect(insertedNotifications).toHaveLength(0);
    });
  });

  describe("POST /api/crm/organisations/bulk-reassign-owner", () => {
    it("collapses a bulk reassignment to one immediate + one summary notification (not one per row)", async () => {
      state.ownerUser = { id: "owner-new" };
      state.bulkUpdatedRows = [
        { id: "org-a", name: "Org A" },
        { id: "org-b", name: "Org B" },
        { id: "org-c", name: "Org C" },
        { id: "org-d", name: "Org D" },
        { id: "org-e", name: "Org E" },
      ];

      const res = await request(app)
        .post("/api/crm/organisations/bulk-reassign-owner")
        .send({
          organisationIds: ["org-a", "org-b", "org-c", "org-d", "org-e"],
          ownerId: "owner-new",
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ updated: 5, ownerId: "owner-new" });

      // Let the fire-and-forget coalescer microtasks settle before asserting.
      for (let i = 0; i < 10; i += 1) await flushMicrotasks();

      // Only the very first reassignment fires immediately.
      expect(insertedNotifications).toHaveLength(1);
      expect(insertedNotifications[0]).toMatchObject({
        userId: "owner-new",
        type: "CRM_ORGANIZATION_REASSIGNED",
        title: "A CRM organization was assigned to you",
        relatedEntityType: "CRM_ORGANIZATION",
        relatedEntityId: "org-a",
      });

      // Flush the 5-minute window manually → the remaining 4 collapse into
      // one summary notification, not four.
      await __flushReassignmentForTest("organization", "owner-new");

      expect(insertedNotifications).toHaveLength(2);
      expect(insertedNotifications[1]).toMatchObject({
        userId: "owner-new",
        type: "CRM_ORGANIZATION_REASSIGNED",
        title: "4 more CRM organizations assigned to you",
        relatedEntityType: "CRM_ORGANIZATION",
        relatedEntityId: "org-b",
      });
      expect(
        String(insertedNotifications[1].message),
      ).toContain("Alice Actor assigned 4 more CRM organizations");
    });

    it("skips no-op rows: only rows whose owner actually changed produce notifications", async () => {
      // Two of the five requested ids are already owned by the target user,
      // so the UPDATE ... WHERE ownerId IS DISTINCT FROM $new clause filters
      // them out and only three rows come back from RETURNING.
      state.ownerUser = { id: "owner-new" };
      state.bulkUpdatedRows = [
        { id: "org-a", name: "Org A" },
        { id: "org-b", name: "Org B" },
        { id: "org-c", name: "Org C" },
      ];

      const res = await request(app)
        .post("/api/crm/organisations/bulk-reassign-owner")
        .send({
          organisationIds: [
            "org-a",
            "org-b",
            "org-c",
            "org-noop-1",
            "org-noop-2",
          ],
          ownerId: "owner-new",
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ updated: 3 });

      for (let i = 0; i < 10; i += 1) await flushMicrotasks();
      await __flushReassignmentForTest("organization", "owner-new");

      // Only 3 real changes → 1 immediate + 1 summary for the other 2.
      expect(insertedNotifications).toHaveLength(2);
      expect(insertedNotifications[0]).toMatchObject({
        relatedEntityId: "org-a",
        title: "A CRM organization was assigned to you",
      });
      expect(insertedNotifications[1]).toMatchObject({
        title: "2 more CRM organizations assigned to you",
      });
    });

    it("emits nothing when all rows are no-ops", async () => {
      state.ownerUser = { id: "owner-new" };
      state.bulkUpdatedRows = [];

      const res = await request(app)
        .post("/api/crm/organisations/bulk-reassign-owner")
        .send({
          organisationIds: ["org-noop-1", "org-noop-2"],
          ownerId: "owner-new",
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ updated: 0 });

      for (let i = 0; i < 5; i += 1) await flushMicrotasks();
      expect(insertedNotifications).toHaveLength(0);
    });

    it("emits nothing when the actor bulk-reassigns to themselves", async () => {
      state.ownerUser = { id: state.currentUser.id };
      state.bulkUpdatedRows = [
        { id: "org-a", name: "Org A" },
        { id: "org-b", name: "Org B" },
      ];

      const res = await request(app)
        .post("/api/crm/organisations/bulk-reassign-owner")
        .send({
          organisationIds: ["org-a", "org-b"],
          ownerId: state.currentUser.id,
        });

      expect(res.status).toBe(200);
      for (let i = 0; i < 5; i += 1) await flushMicrotasks();
      expect(insertedNotifications).toHaveLength(0);
    });
  });
});
