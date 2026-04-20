import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { db } from "../db";
import { sql, eq } from "drizzle-orm";
import {
  organizations,
  users,
  emailAccounts,
  emailThreads,
  emailMessages,
} from "@shared/schema";
import bcrypt from "bcrypt";
import { drainMessageProviderPush } from "../emailRoutes";

const TEST_PREFIX = "__email_pushback_test__";
const COOKIE_NAME = "auth_token";

interface Fixture {
  orgId: string;
  userId: string;
  authCookie: string;
  gmailAccount: typeof emailAccounts.$inferSelect;
  outlookAccount: typeof emailAccounts.$inferSelect;
  gmailMessageId: string;
  outlookMessageId: string;
  gmailExternalId: string;
  outlookExternalId: string;
}

interface ApiPatchResponse {
  success?: boolean;
  queued?: boolean;
  error?: string;
}

interface PendingPushState {
  isRead?: boolean;
  isArchived?: boolean;
  attempts?: number;
}

interface GmailModifyBody {
  addLabelIds: string[];
  removeLabelIds: string[];
}

interface OutlookPatchBody {
  isRead?: boolean;
}

interface OutlookMoveBody {
  destinationId: string;
}

let app: Express;
let server: Server;

async function setupApp(): Promise<void> {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());

  server = await registerRoutes(app);
}

async function setupFixture(label: string): Promise<Fixture> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db
    .insert(organizations)
    .values({
      name: `Push-back Test Org ${label}`,
      slug,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      email: `${slug}@test.local`,
      passwordHash,
      firstName: "Push",
      lastName: `Tester-${label}`,
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();

  const { generateToken } = await import("../auth");
  const token = generateToken(user.id, user.tokenVersion ?? 0);
  const authCookie = `${COOKIE_NAME}=${token}`;

  const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);

  const [gmailAccount] = await db
    .insert(emailAccounts)
    .values({
      organizationId: org.id,
      userId: user.id,
      provider: "GMAIL",
      emailAddress: `${slug}-gmail@test.local`,
      accessToken: "fake-gmail-access-token",
      refreshToken: "fake-gmail-refresh-token",
      expiresAt: futureExpiry,
      isActive: true,
    })
    .returning();

  const [outlookAccount] = await db
    .insert(emailAccounts)
    .values({
      organizationId: org.id,
      userId: user.id,
      provider: "OUTLOOK",
      emailAddress: `${slug}-outlook@test.local`,
      accessToken: "fake-outlook-access-token",
      refreshToken: "fake-outlook-refresh-token",
      expiresAt: futureExpiry,
      isActive: true,
    })
    .returning();

  const [gmailThread] = await db
    .insert(emailThreads)
    .values({
      organizationId: org.id,
      emailAccountId: gmailAccount.id,
      subject: "Gmail thread",
      externalThreadId: `gmail-thread-${slug}`,
    })
    .returning();

  const [outlookThread] = await db
    .insert(emailThreads)
    .values({
      organizationId: org.id,
      emailAccountId: outlookAccount.id,
      subject: "Outlook thread",
      externalThreadId: `outlook-thread-${slug}`,
    })
    .returning();

  const gmailExternalId = `gmail-msg-${slug}`;
  const outlookExternalId = `outlook-msg-${slug}`;

  const [gmailMessage] = await db
    .insert(emailMessages)
    .values({
      organizationId: org.id,
      emailAccountId: gmailAccount.id,
      threadId: gmailThread.id,
      externalId: gmailExternalId,
      fromAddress: "sender@example.com",
      subject: "Hello Gmail",
      receivedAt: new Date(),
      isRead: false,
      isArchived: false,
      folder: "INBOX",
    })
    .returning();

  const [outlookMessage] = await db
    .insert(emailMessages)
    .values({
      organizationId: org.id,
      emailAccountId: outlookAccount.id,
      threadId: outlookThread.id,
      externalId: outlookExternalId,
      fromAddress: "sender@example.com",
      subject: "Hello Outlook",
      receivedAt: new Date(),
      isRead: false,
      isArchived: false,
      folder: "INBOX",
    })
    .returning();

  return {
    orgId: org.id,
    userId: user.id,
    authCookie,
    gmailAccount,
    outlookAccount,
    gmailMessageId: gmailMessage.id,
    outlookMessageId: outlookMessage.id,
    gmailExternalId,
    outlookExternalId,
  };
}

async function cleanup(): Promise<void> {
  try {
    await db.execute(sql`
      DELETE FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}
    `);
  } catch {
    // best-effort
  }
}

async function getMessage(messageId: string) {
  const [m] = await db
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.id, messageId))
    .limit(1);
  return m;
}

async function setPendingPush(messageId: string, patch: PendingPushState): Promise<void> {
  await db
    .update(emailMessages)
    .set({ pendingProviderPush: { ...patch, attempts: 0 }, updatedAt: new Date() })
    .where(eq(emailMessages.id, messageId));
}

function okResponse(body: unknown = { ok: true }): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function failResponse(): Response {
  return new Response("Internal Server Error", { status: 500 });
}

function readRequestBody(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body === "string") return body;
  if (body == null) return "";
  return String(body);
}

function readRequestMethod(init: RequestInit | undefined): string {
  return init?.method ?? "GET";
}

async function waitForPendingPushCleared(
  messageId: string,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const m = await getMessage(messageId);
    if (m && m.pendingProviderPush == null) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`pendingProviderPush did not clear within ${timeoutMs}ms`);
}

describe("Email read/archive push-back to Gmail and Outlook", () => {
  let fx: Fixture;
  const realFetch = global.fetch;

  beforeAll(async () => {
    await setupApp();
    await cleanup();
    fx = await setupFixture("base");
  }, 60_000);

  afterAll(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await cleanup();
  }, 30_000);

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  describe("PATCH /api/email/messages/:id (route-level)", () => {
    it("archives a Gmail message: queues pendingProviderPush, calls Gmail modify, and clears the pending state", async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
      global.fetch = fetchMock;

      const res = await request(app)
        .patch(`/api/email/messages/${fx.gmailMessageId}`)
        .set("Cookie", fx.authCookie)
        .send({ isArchived: true });

      expect(res.status).toBe(200);
      const body = res.body as ApiPatchResponse;
      expect(body.success).toBe(true);
      expect(body.queued).toBe(true);

      // The route fires drainMessageProviderPush in the background — wait for it.
      await waitForPendingPushCleared(fx.gmailMessageId);

      const gmailCall = fetchMock.mock.calls.find(([url]) =>
        String(url).startsWith("https://gmail.googleapis.com/"),
      );
      expect(gmailCall).toBeDefined();
      const [url, init] = gmailCall!;
      expect(String(url)).toBe(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(fx.gmailExternalId)}/modify`,
      );
      expect(readRequestMethod(init)).toBe("POST");
      const modifyBody = JSON.parse(readRequestBody(init)) as GmailModifyBody;
      expect(modifyBody.removeLabelIds).toContain("INBOX");
      expect(modifyBody.addLabelIds).toEqual([]);

      const after = await getMessage(fx.gmailMessageId);
      expect(after?.isArchived).toBe(true);
      expect(after?.folder).toBe("ARCHIVE");
      expect(after?.pendingProviderPush).toBeNull();
    });

    it("archives an Outlook message: queues pendingProviderPush and POSTs /move with destinationId=archive", async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
      global.fetch = fetchMock;

      const res = await request(app)
        .patch(`/api/email/messages/${fx.outlookMessageId}`)
        .set("Cookie", fx.authCookie)
        .send({ isArchived: true });

      expect(res.status).toBe(200);
      await waitForPendingPushCleared(fx.outlookMessageId);

      const moveCall = fetchMock.mock.calls.find(([url]) =>
        String(url).endsWith(`/messages/${encodeURIComponent(fx.outlookExternalId)}/move`),
      );
      expect(moveCall).toBeDefined();
      const [url, init] = moveCall!;
      expect(String(url)).toBe(
        `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(fx.outlookExternalId)}/move`,
      );
      expect(readRequestMethod(init)).toBe("POST");
      const moveBody = JSON.parse(readRequestBody(init)) as OutlookMoveBody;
      expect(moveBody.destinationId).toBe("archive");

      const after = await getMessage(fx.outlookMessageId);
      expect(after?.isArchived).toBe(true);
      expect(after?.folder).toBe("ARCHIVE");
      expect(after?.pendingProviderPush).toBeNull();
    });

    it("marks a Gmail message read by removing the UNREAD label", async () => {
      // Reset Gmail message to a clean unread/INBOX state after prior archive test
      await db
        .update(emailMessages)
        .set({ isRead: false, isArchived: false, folder: "INBOX", pendingProviderPush: null })
        .where(eq(emailMessages.id, fx.gmailMessageId));

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
      global.fetch = fetchMock;

      const res = await request(app)
        .patch(`/api/email/messages/${fx.gmailMessageId}`)
        .set("Cookie", fx.authCookie)
        .send({ isRead: true });

      expect(res.status).toBe(200);
      await waitForPendingPushCleared(fx.gmailMessageId);

      const modifyCall = fetchMock.mock.calls.find(([url]) =>
        String(url).endsWith(
          `/messages/${encodeURIComponent(fx.gmailExternalId)}/modify`,
        ),
      );
      expect(modifyCall).toBeDefined();
      const modifyBody = JSON.parse(readRequestBody(modifyCall![1])) as GmailModifyBody;
      expect(modifyBody.removeLabelIds).toContain("UNREAD");
      expect(modifyBody.addLabelIds).toEqual([]);

      const after = await getMessage(fx.gmailMessageId);
      expect(after?.isRead).toBe(true);
      expect(after?.pendingProviderPush).toBeNull();
    });

    it("marks an Outlook message read via PATCH on the message resource", async () => {
      // Reset to unread + INBOX from previous archive test
      await db
        .update(emailMessages)
        .set({ isRead: false, isArchived: false, folder: "INBOX", pendingProviderPush: null })
        .where(eq(emailMessages.id, fx.outlookMessageId));

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
      global.fetch = fetchMock;

      const res = await request(app)
        .patch(`/api/email/messages/${fx.outlookMessageId}`)
        .set("Cookie", fx.authCookie)
        .send({ isRead: true });

      expect(res.status).toBe(200);
      await waitForPendingPushCleared(fx.outlookMessageId);

      const patchCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith(`/messages/${encodeURIComponent(fx.outlookExternalId)}`) &&
          readRequestMethod(init) === "PATCH",
      );
      expect(patchCall).toBeDefined();
      const patchBody = JSON.parse(readRequestBody(patchCall![1])) as OutlookPatchBody;
      expect(patchBody.isRead).toBe(true);

      const after = await getMessage(fx.outlookMessageId);
      expect(after?.isRead).toBe(true);
      expect(after?.pendingProviderPush).toBeNull();
    });

    it("rejects unauthenticated callers", async () => {
      const res = await request(app)
        .patch(`/api/email/messages/${fx.gmailMessageId}`)
        .send({ isArchived: true });
      expect(res.status).toBe(401);
    });
  });

  describe("Retry and give-up bookkeeping", () => {
    beforeEach(async () => {
      // Reset Gmail message to a clean unread/INBOX state
      await db
        .update(emailMessages)
        .set({
          isRead: false,
          isArchived: false,
          folder: "INBOX",
          pendingProviderPush: null,
        })
        .where(eq(emailMessages.id, fx.gmailMessageId));
      await db
        .update(emailMessages)
        .set({
          isRead: false,
          isArchived: false,
          folder: "INBOX",
          pendingProviderPush: null,
        })
        .where(eq(emailMessages.id, fx.outlookMessageId));
      await db
        .update(emailAccounts)
        .set({ lastSyncError: null })
        .where(eq(emailAccounts.id, fx.outlookAccount.id));
    });

    it("provider failure increments attempts and preserves pendingProviderPush; eventual success clears it", async () => {
      const fetchMock = vi.fn<typeof fetch>();
      fetchMock.mockResolvedValueOnce(failResponse());
      global.fetch = fetchMock;

      await setPendingPush(fx.gmailMessageId, { isArchived: true });

      await expect(
        drainMessageProviderPush(fx.gmailAccount, fx.gmailMessageId),
      ).rejects.toThrow(/Gmail modify failed/);

      let after = await getMessage(fx.gmailMessageId);
      expect(after?.pendingProviderPush).toMatchObject({
        isArchived: true,
        attempts: 1,
      });

      fetchMock.mockResolvedValueOnce(okResponse());
      await drainMessageProviderPush(fx.gmailAccount, fx.gmailMessageId);

      after = await getMessage(fx.gmailMessageId);
      expect(after?.pendingProviderPush).toBeNull();
    });

    it("gives up after 5 consecutive failures, clears pendingProviderPush, and records lastSyncError on the account", async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(failResponse());
      global.fetch = fetchMock;

      await setPendingPush(fx.outlookMessageId, { isArchived: true });

      for (let i = 1; i <= 5; i++) {
        await expect(
          drainMessageProviderPush(fx.outlookAccount, fx.outlookMessageId),
        ).rejects.toThrow();

        const after = await getMessage(fx.outlookMessageId);
        if (i < 5) {
          expect(after?.pendingProviderPush).toMatchObject({ attempts: i });
        } else {
          expect(after?.pendingProviderPush).toBeNull();
        }
      }

      const [acct] = await db
        .select()
        .from(emailAccounts)
        .where(eq(emailAccounts.id, fx.outlookAccount.id))
        .limit(1);
      expect(acct?.lastSyncError ?? "").toContain("Push-back gave up");
    });
  });

  // -------------------------------------------------------------------------
  // Real-mailbox sandbox tests. Skipped unless explicit sandbox credentials
  // are provided. To exercise these locally:
  //
  //   GMAIL_SANDBOX_ACCESS_TOKEN=ya29....   GMAIL_SANDBOX_MESSAGE_ID=18b... \
  //     npx vitest run server/__tests__/email-provider-pushback.test.ts
  //
  //   OUTLOOK_SANDBOX_ACCESS_TOKEN=ey...    OUTLOOK_SANDBOX_MESSAGE_ID=AAMk... \
  //     npx vitest run server/__tests__/email-provider-pushback.test.ts
  //
  // The test will archive the supplied message via the same code path the CRM
  // uses (drainMessageProviderPush) and then read mailbox state back from the
  // provider to confirm the message left INBOX / moved to the archive folder.
  // -------------------------------------------------------------------------
  describe("Scheduled push-back drain (Task #546)", () => {
    beforeEach(async () => {
      await db
        .update(emailMessages)
        .set({
          isRead: false,
          isArchived: false,
          folder: "INBOX",
          pendingProviderPush: null,
        })
        .where(eq(emailMessages.id, fx.gmailMessageId));
      await db
        .update(emailMessages)
        .set({
          isRead: false,
          isArchived: false,
          folder: "INBOX",
          pendingProviderPush: null,
        })
        .where(eq(emailMessages.id, fx.outlookMessageId));
      await db
        .update(emailAccounts)
        .set({ syncStatus: "OK", lastSyncError: null })
        .where(eq(emailAccounts.id, fx.gmailAccount.id));
      await db
        .update(emailAccounts)
        .set({ syncStatus: "OK", lastSyncError: null })
        .where(eq(emailAccounts.id, fx.outlookAccount.id));
    });

    it("drains pending Gmail and Outlook push-backs across active accounts on a single tick", async () => {
      const { processProviderPushDrain } = await import("../jobs/jobRunner");

      await setPendingPush(fx.gmailMessageId, { isArchived: true });
      await setPendingPush(fx.outlookMessageId, { isRead: true });

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
      global.fetch = fetchMock;

      await processProviderPushDrain();

      const gmailAfter = await getMessage(fx.gmailMessageId);
      const outlookAfter = await getMessage(fx.outlookMessageId);
      expect(gmailAfter?.pendingProviderPush).toBeNull();
      expect(outlookAfter?.pendingProviderPush).toBeNull();

      const gmailCall = fetchMock.mock.calls.find(([url]) =>
        String(url).startsWith("https://gmail.googleapis.com/"),
      );
      const outlookCall = fetchMock.mock.calls.find(([url]) =>
        String(url).startsWith("https://graph.microsoft.com/"),
      );
      expect(gmailCall).toBeDefined();
      expect(outlookCall).toBeDefined();
    });

    it("skips accounts marked NEEDS_RECONNECT and leaves their pending pushes in place", async () => {
      const { processProviderPushDrain } = await import("../jobs/jobRunner");

      await db
        .update(emailAccounts)
        .set({ syncStatus: "NEEDS_RECONNECT" })
        .where(eq(emailAccounts.id, fx.gmailAccount.id));
      await setPendingPush(fx.gmailMessageId, { isArchived: true });

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
      global.fetch = fetchMock;

      await processProviderPushDrain();

      const gmailCall = fetchMock.mock.calls.find(([url]) =>
        String(url).startsWith("https://gmail.googleapis.com/"),
      );
      expect(gmailCall).toBeUndefined();

      const after = await getMessage(fx.gmailMessageId);
      expect(after?.pendingProviderPush).toMatchObject({ isArchived: true });
    });

    it("is registered as a recurring job in the job registry", async () => {
      const { jobRegistry } = await import("../jobs/jobRunner");
      expect(jobRegistry.provider_push_drain).toBeDefined();
      expect(jobRegistry.provider_push_drain.schedule).toBe("*/2 * * * *");
    });
  });

  describe.skipIf(!process.env.GMAIL_SANDBOX_ACCESS_TOKEN || !process.env.GMAIL_SANDBOX_MESSAGE_ID)(
    "Gmail sandbox: archive really lands in the mailbox",
    () => {
      it("removes the INBOX label on the real Gmail message", async () => {
        const accessToken = process.env.GMAIL_SANDBOX_ACCESS_TOKEN!;
        const externalId = process.env.GMAIL_SANDBOX_MESSAGE_ID!;
        const sandbox = await setupFixture("gmail-sandbox");
        await db
          .update(emailAccounts)
          .set({
            accessToken,
            refreshToken: process.env.GMAIL_SANDBOX_REFRESH_TOKEN ?? sandbox.gmailAccount.refreshToken,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          })
          .where(eq(emailAccounts.id, sandbox.gmailAccount.id));
        await db
          .update(emailMessages)
          .set({ externalId, pendingProviderPush: { isArchived: true, attempts: 0 } })
          .where(eq(emailMessages.id, sandbox.gmailMessageId));

        const [refreshedAccount] = await db
          .select()
          .from(emailAccounts)
          .where(eq(emailAccounts.id, sandbox.gmailAccount.id))
          .limit(1);

        await drainMessageProviderPush(refreshedAccount, sandbox.gmailMessageId);

        const verifyResp = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(externalId)}?format=metadata&metadataHeaders=Subject`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        expect(verifyResp.ok).toBe(true);
        const payload = (await verifyResp.json()) as { labelIds?: string[] };
        expect(payload.labelIds ?? []).not.toContain("INBOX");

        const after = await getMessage(sandbox.gmailMessageId);
        expect(after?.pendingProviderPush).toBeNull();
      }, 30_000);
    },
  );

  describe.skipIf(!process.env.OUTLOOK_SANDBOX_ACCESS_TOKEN || !process.env.OUTLOOK_SANDBOX_MESSAGE_ID)(
    "Outlook sandbox: archive really lands in the mailbox",
    () => {
      it("moves the real Outlook message into the archive folder", async () => {
        const accessToken = process.env.OUTLOOK_SANDBOX_ACCESS_TOKEN!;
        const externalId = process.env.OUTLOOK_SANDBOX_MESSAGE_ID!;
        const sandbox = await setupFixture("outlook-sandbox");
        await db
          .update(emailAccounts)
          .set({
            accessToken,
            refreshToken:
              process.env.OUTLOOK_SANDBOX_REFRESH_TOKEN ?? sandbox.outlookAccount.refreshToken,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          })
          .where(eq(emailAccounts.id, sandbox.outlookAccount.id));
        await db
          .update(emailMessages)
          .set({ externalId, pendingProviderPush: { isArchived: true, attempts: 0 } })
          .where(eq(emailMessages.id, sandbox.outlookMessageId));

        const [refreshedAccount] = await db
          .select()
          .from(emailAccounts)
          .where(eq(emailAccounts.id, sandbox.outlookAccount.id))
          .limit(1);

        await drainMessageProviderPush(refreshedAccount, sandbox.outlookMessageId);

        const verifyResp = await fetch(
          `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(externalId)}?$select=parentFolderId`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        expect(verifyResp.ok).toBe(true);
        const payload = (await verifyResp.json()) as { parentFolderId?: string };

        const archiveResp = await fetch(
          `https://graph.microsoft.com/v1.0/me/mailFolders/archive`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const archiveFolder = (await archiveResp.json()) as { id?: string };
        expect(payload.parentFolderId).toBe(archiveFolder.id);

        const after = await getMessage(sandbox.outlookMessageId);
        expect(after?.pendingProviderPush).toBeNull();
      }, 30_000);
    },
  );
});
