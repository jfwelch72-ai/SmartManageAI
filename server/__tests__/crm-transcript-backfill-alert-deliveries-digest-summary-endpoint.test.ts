/**
 * Task #1151 — pin the route → JSON contract for the digest fallback rollup
 * surfaced by `GET /api/crm/calls/transcripts/backfill/alert-deliveries`.
 *
 * Task #1100 added an org-wide `fallbackMuteSummary.digest` block to the
 * response that the admin UI uses to badge "the daily digest fallback is
 * silenced too" alongside the realtime per-channel mute counts. Storage
 * (`summarizeOrgAdminAlertFailureFallbackMutes`) and the React side are
 * already covered, but no test pins the route serializer or the
 * `Promise.all` plumbing in `server/crmCallsRoutes.ts` — a regression
 * dropping `digest.eligibleRecipientCount` / `digest.streamMutedAdminCount`
 * (or the whole `fallbackMuteSummary`) from the JSON would not be caught
 * today.
 *
 * Strategy: stub the two storage helpers the route awaits with `vi.mock`
 * so we can assert the route forwards the digest fields verbatim without
 * having to seed admins / mute preferences in the DB.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

const { mockListDeliveries, mockSummarizeFallback } = vi.hoisted(() => ({
  mockListDeliveries: vi.fn(),
  mockSummarizeFallback: vi.fn(),
}));

vi.mock("../crm/transcriptBackfillStorage", async () => {
  const actual = await vi.importActual<
    typeof import("../crm/transcriptBackfillStorage")
  >("../crm/transcriptBackfillStorage");
  return {
    ...actual,
    listCrmTranscriptBackfillAlertDeliveries: mockListDeliveries,
    summarizeOrgAdminAlertFailureFallbackMutes: mockSummarizeFallback,
  };
});

import { db } from "../db";
import { organizations, users } from "@shared/schema";
import { generateToken } from "../auth";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_EMAIL_DOMAIN = `alert-deliveries-digest-${SUFFIX}.test.invalid`;
const TEST_ORG_PREFIX = `__alert_deliveries_digest_${SUFFIX}__`;
const ENDPOINT = "/api/crm/calls/transcripts/backfill/alert-deliveries";

let app: Express;
let server: Server;
let orgId: string;
let adminId: string;
let adminCookie: string;

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  const [org] = await db
    .insert(organizations)
    .values({
      name: `${TEST_ORG_PREFIX}org`,
      slug: `${TEST_ORG_PREFIX}org`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-"),
    })
    .returning();
  orgId = org.id;

  const [admin] = await db
    .insert(users)
    .values({
      email: `admin-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "x",
      firstName: "Digest",
      lastName: "Admin",
      organizationId: orgId,
      role: "ADMIN",
    })
    .returning();
  adminId = admin.id;
  adminCookie = `auth_token=${generateToken(admin.id, admin.tokenVersion)}`;
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(users).where(inArray(users.id, [adminId])).catch(() => {});
    await db
      .delete(organizations)
      .where(eq(organizations.id, orgId))
      .catch(() => {});
  } catch {
    /* non-fatal */
  }
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

beforeEach(() => {
  mockListDeliveries.mockReset();
  mockSummarizeFallback.mockReset();
});

describe("GET /api/crm/calls/transcripts/backfill/alert-deliveries — fallbackMuteSummary.digest", () => {
  it("forwards digest.eligibleRecipientCount and digest.streamMutedAdminCount end-to-end", async () => {
    mockListDeliveries.mockResolvedValueOnce([]);
    mockSummarizeFallback.mockResolvedValueOnce({
      slack: { totalAdminCount: 7, channelMutedAdminCount: 2 },
      email: { totalAdminCount: 7, channelMutedAdminCount: 1 },
      digest: {
        eligibleRecipientCount: 5,
        streamMutedAdminCount: 3,
      },
    });

    const res = await request(app).get(ENDPOINT).set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(mockListDeliveries).toHaveBeenCalledTimes(1);
    expect((mockListDeliveries.mock.calls[0] as unknown[])[0]).toBe(orgId);
    expect(mockSummarizeFallback).toHaveBeenCalledTimes(1);
    expect((mockSummarizeFallback.mock.calls[0] as unknown[])[0]).toBe(orgId);

    expect(res.body.fallbackMuteSummary).toBeDefined();
    expect(res.body.fallbackMuteSummary.digest).toEqual({
      eligibleRecipientCount: 5,
      streamMutedAdminCount: 3,
    });
    // Sibling per-channel rollups must keep flowing through too so a
    // future serializer rewrite can't drop them while keeping `digest`.
    expect(res.body.fallbackMuteSummary.slack).toEqual({
      totalAdminCount: 7,
      channelMutedAdminCount: 2,
    });
    expect(res.body.fallbackMuteSummary.email).toEqual({
      totalAdminCount: 7,
      channelMutedAdminCount: 1,
    });
  });

  it("forwards a zeroed digest summary verbatim (no implicit defaulting)", async () => {
    // Pin that the route does not coerce / drop a fully-zero digest block.
    // The UI relies on receiving the field even when nobody is eligible
    // so it can render "no daily digest recipients configured" instead of
    // hiding the badge.
    mockListDeliveries.mockResolvedValueOnce([]);
    mockSummarizeFallback.mockResolvedValueOnce({
      slack: { totalAdminCount: 0, channelMutedAdminCount: 0 },
      email: { totalAdminCount: 0, channelMutedAdminCount: 0 },
      digest: {
        eligibleRecipientCount: 0,
        streamMutedAdminCount: 0,
      },
    });

    const res = await request(app).get(ENDPOINT).set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.fallbackMuteSummary.digest).toEqual({
      eligibleRecipientCount: 0,
      streamMutedAdminCount: 0,
    });
  });
});
