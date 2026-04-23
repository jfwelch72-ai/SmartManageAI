/**
 * Task #1149 — companion to crm-transcript-backfill-test-alert-history-csv
 * that exercises the 100,000-row safety cap baked into the CSV exporter
 * for `GET /api/crm/calls/transcripts/backfill/test-alert/history.csv`.
 *
 * Seeding 100k real audit rows just to trip the bound would dominate the
 * suite's runtime, so we mock the underlying storage helper to return
 * fixed-size pages forever and then assert that the route stops paging
 * once `offset >= MAX_ROWS`. The auth + org-scoping behavior is covered
 * by the sibling DB-backed test.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { Express, NextFunction, Response } from "express";
import request from "supertest";

import type { AuthRequest } from "../auth";

// Mock the transcription service to keep the suite offline (mirrors the
// convention used by the other backfill tests that mount the router
// directly).
vi.mock("../services/callTranscriptionService", () => ({
  transcribeCallRecording: vi.fn(),
  queueCallTranscription: vi.fn(),
}));

// Mock just the helper the CSV route paginates over. Every other export
// is preserved so the rest of the router still wires up.
const listMock = vi.fn();
vi.mock("../storage", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    listCrmTranscriptBackfillTestAlerts: listMock,
  };
});

let app: Express;
let currentUser: {
  id: string;
  role: "ADMIN" | "SUPER_ADMIN";
  organizationId: string | null;
} | null = null;

beforeAll(async () => {
  const express = await import("express");
  const routes = await import("../crmCallsRoutes");

  app = express.default();
  app.use(express.default.json());
  app.use((req: AuthRequest, res: Response, next: NextFunction) => {
    if (!currentUser) {
      res.status(401).json({ error: "no test user configured" });
      return;
    }
    req.user = {
      id: currentUser.id,
      email: "irrelevant@test.invalid",
      firstName: "Test",
      lastName: "Caller",
      role: currentUser.role,
      organizationId: currentUser.organizationId,
      isActive: true,
    } as AuthRequest["user"];
    next();
  });
  app.use(routes.default);
  app.use(
    (err: unknown, _req: AuthRequest, res: Response, _next: NextFunction) => {
      res.status(500).json({ error: String((err as Error)?.message || err) });
    },
  );
});

beforeEach(() => {
  listMock.mockReset();
  currentUser = null;
});

function makeRow(idx: number) {
  return {
    id: `row-${idx}`,
    organizationId: "org-1",
    sentById: null,
    sentAt: new Date("2026-01-01T00:00:00.000Z"),
    operatorDisplay: `op-${idx}`,
    slackConfigured: true,
    slackOk: true,
    slackError: null,
    emailConfigured: true,
    emailOk: true,
    emailError: null,
    emailRecipients: [],
    sentByFirstName: null,
    sentByLastName: null,
    sentByEmail: null,
    organizationName: "Org One",
    organizationSlug: "org-one",
  };
}

describe("GET /test-alert/history.csv — 100k row safety cap (Task #1149)", () => {
  it("stops paginating after MAX_ROWS=100,000 even if the storage helper would keep returning full pages", async () => {
    currentUser = { id: "super-1", role: "SUPER_ADMIN", organizationId: null };

    // Each call returns a full page (PAGE = 100 in the route). The route
    // breaks once `offset >= MAX_ROWS` (100,000), so we expect at most
    // 1,000 calls. If a regression dropped the cap we'd page forever
    // and time out.
    listMock.mockImplementation(async ({ offset }: { offset: number }) => {
      const rows = Array.from({ length: 100 }, (_, i) =>
        makeRow(offset + i),
      );
      return { rows, total: Number.MAX_SAFE_INTEGER };
    });

    const res = await request(app).get(
      "/api/crm/calls/transcripts/backfill/test-alert/history.csv",
    );
    expect(res.status).toBe(200);

    // The route walks pages of 100 starting at offset 0, advancing by
    // the rows returned. With a steady 100/page it issues exactly
    // 1,000 calls (offsets 0, 100, 200, ..., 99,900) before
    // `offset >= MAX_ROWS` trips the cap.
    expect(listMock).toHaveBeenCalledTimes(1_000);
    const offsets = listMock.mock.calls.map((c) => c[0].offset);
    expect(offsets[0]).toBe(0);
    expect(offsets[offsets.length - 1]).toBe(99_900);
    // No call should ever ask for a page at or past the cap.
    expect(offsets.every((o) => o < 100_000)).toBe(true);

    // Sanity: the body has exactly one header row + 100,000 data rows.
    const lineCount = res.text.replace(/\n$/, "").split("\n").length;
    expect(lineCount).toBe(100_001);
  }, 30_000);

  it("forwards every documented filter (sender / slackOk / emailOk / anyFailed / sentAfter / sentBefore / organizationId) into the storage helper", async () => {
    currentUser = { id: "super-1", role: "SUPER_ADMIN", organizationId: null };
    listMock.mockResolvedValue({ rows: [], total: 0 });

    const sentAfter = "2026-01-01T00:00:00.000Z";
    const sentBefore = "2026-02-01T00:00:00.000Z";
    const res = await request(app)
      .get("/api/crm/calls/transcripts/backfill/test-alert/history.csv")
      .query({
        sender: "  jane  ",
        slackOk: "false",
        emailOk: "true",
        anyFailed: "true",
        sentAfter,
        sentBefore,
        organizationId: "org-xyz",
      });
    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledTimes(1);
    const arg = listMock.mock.calls[0][0];
    expect(arg.organizationId).toBe("org-xyz");
    expect(arg.sender).toBe("jane");
    expect(arg.slackOk).toBe(false);
    expect(arg.emailOk).toBe(true);
    expect(arg.anyFailed).toBe(true);
    expect(arg.sentAfter).toBeInstanceOf(Date);
    expect((arg.sentAfter as Date).toISOString()).toBe(sentAfter);
    expect(arg.sentBefore).toBeInstanceOf(Date);
    expect((arg.sentBefore as Date).toISOString()).toBe(sentBefore);
  });
});
