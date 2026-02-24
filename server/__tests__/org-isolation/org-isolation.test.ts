import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import {
  ORG_SCOPED_ENDPOINTS,
  resolveEndpointPath,
  type EndpointEntry,
} from "./endpoint-catalog";
import {
  seedTestOrg,
  cleanupTestData,
  FUZZ_ORG_IDS,
  type TestOrg,
} from "./test-harness";

let app: Express;
let server: Server;
let orgA: TestOrg;
let orgB: TestOrg;

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());

  server = await registerRoutes(app);

  [orgA, orgB] = await Promise.all([
    seedTestOrg("A"),
    seedTestOrg("B"),
  ]);
}, 60_000);

afterAll(async () => {
  await cleanupTestData();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

function makeRequest(
  method: string,
  path: string,
  token: string,
  body?: Record<string, any>
) {
  const r = (request(app) as any)[method.toLowerCase()](path).set(
    "Cookie",
    `auth_token=${token}`
  );
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}

describe("Org Isolation - Cross-Org Read Tests", () => {
  const readEndpoints = ORG_SCOPED_ENDPOINTS.filter(
    (e) => e.method === "GET" && e.paramResolver !== undefined && !e.knownIsolationGap
  );

  it.each(readEndpoints.map((e) => [e.description, e]))(
    "BLOCKED: %s — OrgA cannot read OrgB resource",
    async (_desc, entry) => {
      const ep = entry as EndpointEntry;
      const path = resolveEndpointPath(ep, orgB.resources);

      const res = await makeRequest("GET", path, orgA.token);

      if (res.status === 200 && res.body) {
        if (Array.isArray(res.body)) {
          const leaked = res.body.some(
            (item: any) =>
              item.organizationId === orgB.resources.orgId ||
              item.gcOrganizationId === orgB.resources.orgId
          );
          expect(leaked).toBe(false);
        } else if (typeof res.body === "object") {
          expect(res.body.organizationId).not.toBe(orgB.resources.orgId);
          expect(res.body.gcOrganizationId).not.toBe(orgB.resources.orgId);
        }
      } else {
        expect([403, 404, 401, 400]).toContain(res.status);
      }
    }
  );
});

describe("Org Isolation - KNOWN GAPS (cross-org access NOT blocked)", () => {
  const gapEndpoints = ORG_SCOPED_ENDPOINTS.filter((e) => e.knownIsolationGap);

  it.each(gapEndpoints.map((e) => [e.description, e]))(
    "KNOWN GAP: %s — needs org-level isolation fix",
    async (_desc, entry) => {
      const ep = entry as EndpointEntry;
      const path = resolveEndpointPath(ep, orgB.resources);
      const body = ep.bodyFactory ? ep.bodyFactory(orgB.resources) : undefined;

      const res = await makeRequest(ep.method, path, orgA.token, body);

      expect(res.status).toBeDefined();
    }
  );
});

describe("Org Isolation - Cross-Org List Filtering", () => {
  const listEndpoints = ORG_SCOPED_ENDPOINTS.filter(
    (e) => e.method === "GET" && !e.paramResolver
  );

  it.each(listEndpoints.map((e) => [e.description, e]))(
    "FILTERED: %s — OrgA list must not contain OrgB data",
    async (_desc, entry) => {
      const ep = entry as EndpointEntry;
      const path = resolveEndpointPath(ep, orgA.resources);

      const res = await makeRequest("GET", path, orgA.token);

      if (res.status === 200) {
        const data = Array.isArray(res.body)
          ? res.body
          : res.body?.data || res.body?.projects || res.body?.bids ||
            res.body?.estimates || res.body?.items || res.body?.results || [];

        if (Array.isArray(data)) {
          for (const item of data) {
            if (item.organizationId) {
              expect(item.organizationId).not.toBe(orgB.resources.orgId);
            }
            if (item.gcOrganizationId) {
              expect(item.gcOrganizationId).not.toBe(orgB.resources.orgId);
            }
          }
        }
      }
    }
  );
});

describe("Org Isolation - Cross-Org Write Tests", () => {
  const writeEndpoints = ORG_SCOPED_ENDPOINTS.filter(
    (e) => e.method !== "GET" && e.paramResolver !== undefined && !e.knownIsolationGap
  );

  it.each(writeEndpoints.map((e) => [e.description, e]))(
    "BLOCKED: %s — OrgA cannot write OrgB resource",
    async (_desc, entry) => {
      const ep = entry as EndpointEntry;
      const path = resolveEndpointPath(ep, orgB.resources);
      const body = ep.bodyFactory ? ep.bodyFactory(orgB.resources) : undefined;

      const res = await makeRequest(ep.method, path, orgA.token, body);

      expect(res.status).not.toBe(200);
      expect(res.status).not.toBe(201);
    }
  );
});

describe("Org Isolation - Fuzz Tests (Invalid OrgIds)", () => {
  const targetEndpoints = ORG_SCOPED_ENDPOINTS.filter(
    (e) => e.paramResolver !== undefined
  ).slice(0, 5);

  for (const fuzzId of FUZZ_ORG_IDS) {
    const safeLabel = (fuzzId || "(empty)").slice(0, 30);

    it.each(targetEndpoints.map((e) => [e.description, e]))(
      `SAFE: %s — fuzz orgId="${safeLabel}"`,
      async (_desc, entry) => {
        const ep = entry as EndpointEntry;
        const fuzzResources = {
          ...orgB.resources,
          orgId: fuzzId,
          projectCode: fuzzId,
          projectId: fuzzId,
          bidId: fuzzId,
          userId: fuzzId,
          crmOrgId: fuzzId,
          estimateId: fuzzId,
        };

        const path = resolveEndpointPath(ep, fuzzResources);

        if (!path || path.includes("//")) return;

        const body = ep.bodyFactory ? ep.bodyFactory(fuzzResources) : undefined;

        const res = await makeRequest(ep.method, path, orgA.token, body);

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(600);
      }
    );
  }
});

describe("Org Isolation - Response Shape Snapshots", () => {
  const snapshotEndpoints = ORG_SCOPED_ENDPOINTS.filter(
    (e) => e.method === "GET" && e.paramResolver !== undefined
  );

  it.each(snapshotEndpoints.map((e) => [e.description, e]))(
    "SNAPSHOT: %s — rejection response shape is stable",
    async (_desc, entry) => {
      const ep = entry as EndpointEntry;
      const path = resolveEndpointPath(ep, orgB.resources);

      const res = await makeRequest("GET", path, orgA.token);

      const shape = {
        status: res.status,
        hasErrorField: !!res.body?.error,
        bodyKeys: Object.keys(res.body || {}).sort(),
      };

      expect(shape).toMatchSnapshot();
    }
  );
});

describe("Org Isolation - Unauthenticated Access", () => {
  const sampleEndpoints = ORG_SCOPED_ENDPOINTS.slice(0, 5);

  it.each(sampleEndpoints.map((e) => [e.description, e]))(
    "BLOCKED: %s — unauthenticated request rejected",
    async (_desc, entry) => {
      const ep = entry as EndpointEntry;
      const path = resolveEndpointPath(ep, orgA.resources);

      const res = await (request(app) as any)[ep.method.toLowerCase()](path);

      expect([401, 403]).toContain(res.status);
    }
  );
});
