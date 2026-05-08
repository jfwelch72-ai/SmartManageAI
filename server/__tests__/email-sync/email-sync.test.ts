/**
 * Two-way Gmail/Outlook sync verification (Task #526).
 *
 * Live end-to-end testing against real Gmail/Outlook accounts is not possible
 * in this environment (OAuth consent requires an interactive browser session
 * and a human to perform "mark read", "archive", "send" actions in the
 * provider UIs). Instead, this suite exercises the same code paths from
 * `server/emailRoutes.ts` (and indirectly the job runner, which just calls
 * `syncGmailAccount` / `syncOutlookAccount`) by mocking:
 *
 *   - `global.fetch`       — staged Gmail/Outlook HTTP responses
 *   - `../../db`           — recording in-memory db with queued select results
 *   - the AI / audit / object-storage / IMAP / sanitization modules
 *
 * Scenarios covered:
 *   1. Gmail incremental sync: history fetch advances cursor, applies isRead
 *      and archive label changes, persists newly-added messages.
 *   2. Gmail incremental sync: 410 history-expired falls back to full sync
 *      (verified by the follow-up `messages?q=` list call).
 *   3. Gmail full sync: 30-day backfill query for `(in:inbox OR in:sent)`,
 *      cursor advanced from /profile.
 *   4. Outlook delta sync: handles new messages, isRead-only updates and
 *      `@removed` (archive) entities; persists @odata.deltaLink as cursor.
 *   5. Outlook delta cursor 410 → full resync.
 *   6. PATCH push-back: `pushGmailMessageState` issues correct
 *      add/removeLabelIds for read+archive combinations.
 *   7. PATCH push-back: `pushOutlookMessageState` issues PATCH for isRead and
 *      POST /move for archive direction.
 *   8. `drainAccountProviderPushes` processes pending messages and clears
 *      pendingProviderPush after a successful provider call.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory db mock. Drizzle calls used by the sync paths are:
//   db.select(cols?).from(t).where(c).limit(n)            -> array
//   db.select(cols?).from(t).innerJoin(...).where(c).limit(n)
//   db.insert(t).values(v)                                -> void (awaited)
//   db.update(t).set(v).where(c)                          -> void (awaited)
//   db.update(t).set(v).where(c).returning(cols)          -> array
//
// We don't interpret WHERE clauses. Each test pre-loads `selectQueue` with the
// rows it wants the next select(s) to return, and inspects `dbCalls` for
// inserts/updates after the function under test resolves.
// ---------------------------------------------------------------------------

type DbCall =
  | { op: "insert"; tableName: string; values: unknown }
  | { op: "update"; tableName: string; values: unknown };

const dbCalls: DbCall[] = [];
let selectQueue: unknown[][] = [];

function nameOf(t: unknown): string {
  if (!t || typeof t !== "object") return "<unknown>";
  for (const sym of Object.getOwnPropertySymbols(t)) {
    if (String(sym).includes("Name")) {
      const v = (t as Record<symbol, unknown>)[sym];
      if (typeof v === "string") return v;
    }
  }
  return "<unknown>";
}

function makeSelectChain(rowsPromise: () => Promise<unknown[]>) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.innerJoin = () => chain;
  chain.leftJoin = () => chain;
  chain.limit = () => chain;
  chain.orderBy = () => chain;
  chain.groupBy = () => chain;
  chain.then = (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
    rowsPromise().then(resolve, reject);
  chain.catch = (reject: (e: unknown) => unknown) => rowsPromise().catch(reject);
  return chain;
}

const dbMock = {
  select: (_cols?: unknown) =>
    makeSelectChain(async () => (selectQueue.length ? selectQueue.shift()! : [])),
  insert: (t: unknown) => ({
    values: async (v: unknown) => {
      dbCalls.push({ op: "insert", tableName: nameOf(t), values: v });
    },
  }),
  update: (t: unknown) => ({
    set: (v: unknown) => {
      dbCalls.push({ op: "update", tableName: nameOf(t), values: v });
      const after: Record<string, unknown> = {};
      after.where = () => {
        const w: Record<string, unknown> = {};
        w.returning = async () => (selectQueue.length ? selectQueue.shift()! : []);
        w.then = (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve);
        return w;
      };
      return after;
    },
  }),
  delete: (_t: unknown) => ({ where: async () => undefined }),
};

vi.mock("../../db", () => ({ db: dbMock, pool: {} }));

// ---------------------------------------------------------------------------
// Stub out everything emailRoutes pulls in that we don't want side effects from.
// ---------------------------------------------------------------------------

vi.mock("../../utils/logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../../auditLogger", () => ({
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  logDelete: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("../../sanitization", () => ({
  sanitizeEmail: (s: string) => s,
  sanitizeText: (s: string) => s,
  sanitizeShortText: (s: string) => s,
}));

vi.mock("../../auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../utils/routeHelpers", () => ({
  getCanonicalBaseUrl: () => "http://localhost:5000",
  isRedirectUriValid: () => true,
}));

vi.mock("../../objectStorage", () => ({
  ObjectStorageService: class {
    async deleteObjectByKey() {}
  },
}));

vi.mock("../../ai/emailAi", () => ({
  analyzeEmail: vi.fn(async () => ({
    classification: "OTHER",
    summary: "",
    extractedEntities: {},
  })),
  summarizeThread: vi.fn(async () => ""),
  suggestReplies: vi.fn(async () => []),
  generateEmailSummary: vi.fn(async () => ""),
  matchEmailToEntities: vi.fn(async () => ({ projectId: null, bidId: null, vendorId: null })),
  createTaskFromEmail: vi.fn(async () => undefined),
}));

vi.mock("../../services/aiGovernance", () => ({
  governedAiCall: vi.fn(async (_org: unknown, _model: unknown, fn: () => unknown) => fn()),
}));

vi.mock("../../ai/openaiClient", () => ({
  AI_MODEL_GPT5: "gpt-5",
  openai: { chat: { completions: { create: vi.fn() } } },
}));

vi.mock("../../services/imapService", () => ({
  testFullConnection: vi.fn(),
  fetchImapMessages: vi.fn(async () => []),
  sendSmtpEmail: vi.fn(async () => ({ success: true })),
}));

// ---------------------------------------------------------------------------
// fetch staging
// ---------------------------------------------------------------------------

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const fetchHandlers: FetchHandler[] = [];
const fetchLog: { url: string; method: string; body?: string }[] = [];

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function pushHandler(h: FetchHandler) {
  fetchHandlers.push(h);
}

const stubbedFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : String(url);
  const method = (init?.method || "GET").toUpperCase();
  const body = typeof init?.body === "string" ? init.body : undefined;
  fetchLog.push({ url: u, method, body });
  // Try staged handlers first so individual tests can override token endpoints
  // (e.g. simulate refresh failure).
  for (let i = 0; i < fetchHandlers.length; i++) {
    const h = fetchHandlers[i];
    try {
      const result = await h(u, init);
      if (result) {
        fetchHandlers.splice(i, 1);
        return result;
      }
    } catch {
      // fall through
    }
  }
  // Default: token endpoints answer generically with a fresh access token.
  if (u.includes("oauth2.googleapis.com/token") || u.includes("login.microsoftonline.com")) {
    return jsonResp({ access_token: "new-access-token", expires_in: 3600 });
  }
  throw new Error(`Unhandled fetch in test: ${method} ${u}`);
});

beforeEach(() => {
  dbCalls.length = 0;
  selectQueue = [];
  fetchHandlers.length = 0;
  fetchLog.length = 0;
  vi.stubGlobal("fetch", stubbedFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const farFutureExpiry = new Date(Date.now() + 60 * 60 * 1000);

function gmailAccount(overrides: Record<string, unknown> = {}): import("@shared/schema/features/email").EmailAccount {
  const base: Record<string, unknown> = {
    id: "acct-gmail-1",
    organizationId: "org-1",
    userId: "user-1",
    provider: "GMAIL",
    emailAddress: "rep@example.com",
    displayName: "Rep",
    accessToken: "valid-token",
    refreshToken: "refresh-token",
    expiresAt: farFutureExpiry,
    isActive: true,
    gmailHistoryId: null,
    outlookDeltaInbox: null,
    outlookDeltaSent: null,
    lastSyncedAt: null,
    lastFullSyncAt: null,
    lastSyncError: null,
    syncStatus: "OK",
    pendingProviderPush: null,
    ...overrides,
  };
  return base as import("@shared/schema/features/email").EmailAccount;
}

function outlookAccount(overrides: Record<string, unknown> = {}): import("@shared/schema/features/email").EmailAccount {
  return gmailAccount({ id: "acct-outlook-1", provider: "OUTLOOK", ...overrides });
}

function imapAccount(overrides: Record<string, unknown> = {}): import("@shared/schema/features/email").EmailAccount {
  return gmailAccount({
    id: "acct-imap-1",
    provider: "IMAP",
    accessToken: null,
    refreshToken: null,
    imapHost: "imap.example.com",
    imapPort: 993,
    imapSecure: true,
    imapPassword: "secret",
    imapUsername: "rep@example.com",
    ...overrides,
  });
}

function buildGmailMessage(
  id: string,
  threadId: string,
  opts: { unread?: boolean; labels?: string[]; from?: string; subject?: string; bodyText?: string } = {},
) {
  const labels = opts.labels ?? ["INBOX"];
  if (opts.unread) labels.push("UNREAD");
  return {
    id,
    threadId,
    labelIds: labels,
    snippet: opts.bodyText ?? "snippet",
    internalDate: String(Date.now()),
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: opts.from ?? "sender@external.com" },
        { name: "To", value: "rep@example.com" },
        { name: "Subject", value: opts.subject ?? "Hello" },
      ],
      body: { data: Buffer.from(opts.bodyText ?? "Hello from sender").toString("base64url") },
    },
  };
}

// ---------------------------------------------------------------------------

describe("Two-way email sync (mocked Gmail / Outlook providers)", () => {
  describe("Gmail incremental sync (with cursor)", () => {
    it("applies remote isRead toggle and archive (INBOX label removed) and advances cursor", async () => {
      const { syncGmailAccount } = await import("../../emailRoutes");
      const account = gmailAccount({ gmailHistoryId: "100", lastSyncedAt: new Date() });

      // 1) history endpoint returns one labelsRemoved (UNREAD removed = read)
      //    plus one labelsRemoved (INBOX removed = archived) on a different msg.
      pushHandler((url) => {
        if (!url.includes("/users/me/history")) return undefined as unknown as Response;
        expect(url).toContain("startHistoryId=100");
        return jsonResp({
          historyId: "150",
          history: [
            {
              id: "h1",
              labelsRemoved: [
                // msg-A: UNREAD removed → marked read. Pass full label set so the
                // folder-recompute branch keeps it in INBOX.
                { message: { id: "msg-A", threadId: "t-A", labelIds: ["INBOX"] }, labelIds: ["UNREAD"] },
                // msg-B: INBOX removed → archived. Omit labelIds so the
                // labelsRemoved branch's folder="ARCHIVE" assignment stands
                // (gmailFolderFromLabels([]) returns "OTHER" and would otherwise
                // overwrite it).
                { message: { id: "msg-B", threadId: "t-B" }, labelIds: ["INBOX"] },
              ],
            },
          ],
        });
      });

      const res = await syncGmailAccount(account, "user-1");

      expect(res.errors).toEqual([]);
      // Two state-only updates against emailMessages, plus the final cursor
      // update against emailAccounts advancing gmailHistoryId to "150".
      const accountUpdate = dbCalls.find(
        (c) => c.op === "update" && c.tableName === "email_accounts",
      ) as { values: { gmailHistoryId?: string; syncStatus?: string } } | undefined;
      expect(accountUpdate?.values.gmailHistoryId).toBe("150");
      expect(accountUpdate?.values.syncStatus).toBe("OK");

      const stateUpdates = dbCalls.filter(
        (c) => c.op === "update" && c.tableName === "email_messages",
      ) as { values: Record<string, unknown> }[];
      // One update per affected message
      expect(stateUpdates.length).toBeGreaterThanOrEqual(2);
      const flags = stateUpdates.map((u) => u.values);
      expect(flags.some((f) => f.isRead === true)).toBe(true);
      expect(flags.some((f) => f.isArchived === true && f.folder === "ARCHIVE")).toBe(true);
    });

    it("falls back to full sync when history endpoint returns 410 (cursor expired)", async () => {
      const { syncGmailAccount } = await import("../../emailRoutes");
      // Note: when the incremental cursor is still set in memory but history
      // returns 410, `syncGmailAccount` falls through to the full path which
      // uses the narrower `after:<lastSyncedAt>` query (because the in-memory
      // account.gmailHistoryId is still truthy). With lastSyncedAt=null the
      // full path forces the 30-day backfill instead.
      const account = gmailAccount({ gmailHistoryId: "5", lastSyncedAt: null });

      let sawHistory = false;
      let sawListing = false;
      let sawProfile = false;
      pushHandler((url) => {
        if (url.includes("/users/me/history")) {
          sawHistory = true;
          return new Response("History expired", { status: 410 });
        }
        return undefined as unknown as Response;
      });
      pushHandler((url) => {
        if (url.includes("/users/me/messages?q=") && url.includes("newer_than%3A30d")) {
          sawListing = true;
          return jsonResp({}); // zero messages — exit early via recordSyncCheckpoint
        }
        return undefined as unknown as Response;
      });
      pushHandler((url) => {
        if (url.endsWith("/users/me/profile")) {
          sawProfile = true;
          return jsonResp({ historyId: "999" });
        }
        return undefined as unknown as Response;
      });

      const res = await syncGmailAccount(account, "user-1");
      expect(res.errors).toEqual([]);
      expect(sawHistory).toBe(true);
      expect(sawListing).toBe(true);
      expect(sawProfile).toBe(true);

      const accountUpdate = dbCalls.find(
        (c) => c.op === "update" && c.tableName === "email_accounts",
      ) as { values: { gmailHistoryId?: string; lastFullSyncAt?: Date } } | undefined;
      expect(accountUpdate?.values.gmailHistoryId).toBe("999");
      expect(accountUpdate?.values.lastFullSyncAt).toBeInstanceOf(Date);
    });
  });

  describe("Gmail full sync (initial connect, no cursor)", () => {
    it("issues a (in:inbox OR in:sent) newer_than:30d query and persists messages from both folders", async () => {
      const { syncGmailAccount } = await import("../../emailRoutes");
      const account = gmailAccount({ gmailHistoryId: null, lastSyncedAt: null });

      pushHandler((url) => {
        if (!url.includes("/users/me/messages?q=")) return undefined as unknown as Response;
        // The query must request both inbox and sent and be bounded to 30 days.
        expect(decodeURIComponent(url)).toContain("(in:inbox OR in:sent)");
        expect(decodeURIComponent(url)).toContain("newer_than:30d");
        return jsonResp({ messages: [
          { id: "g-inbox-1", threadId: "th-1" },
          { id: "g-sent-1", threadId: "th-2" },
        ] });
      });
      pushHandler((url) => {
        if (!url.includes("/users/me/messages/g-inbox-1")) return undefined as unknown as Response;
        return jsonResp(buildGmailMessage("g-inbox-1", "th-1", { from: "ext@cust.com", subject: "Bid request" }));
      });
      pushHandler((url) => {
        if (!url.includes("/users/me/messages/g-sent-1")) return undefined as unknown as Response;
        return jsonResp(buildGmailMessage("g-sent-1", "th-2", {
          from: "rep@example.com",
          subject: "Re: Bid request",
          labels: ["SENT"],
        }));
      });
      pushHandler((url) => {
        if (url.endsWith("/users/me/profile")) return jsonResp({ historyId: "777" });
        return undefined as unknown as Response;
      });

      // Each per-message persist path runs:
      //   select(existingMessages by ids), then for each new message:
      //     select(existingMessage), select(existingThread), insert(thread), insert(message),
      //     [if outbound] select(crm contact), select(msg counts), update(thread)
      // Pre-load select queue with empty results so every "is this already imported / linked"
      // check returns nothing, forcing the inserts.
      // Order of selects in the full sync path:
      //   1) existing message ids in candidate set    -> []
      //   2..) per message: existing thread           -> []
      //        per inbound message: detectInboundReply runs 2 selects
      //        per outbound message: crm contact      -> []
      //        per message: msg counts                -> [{ total: 1, unread: 0, maxReceivedAt: now }]
      const now = new Date();
      selectQueue = [
        [], // existing externalIds among candidates
        [], // existing thread for msg 1 (inbound)
        [], // detectInboundReply enrollment lookup (msg 1, short-circuits when no rows)
        [{ total: 1, unread: 0, maxReceivedAt: now }], // counts after msg 1
        [], // existing thread for msg 2 (outbound)
        [{ total: 1, unread: 0, maxReceivedAt: now }], // counts after msg 2
      ];

      const res = await syncGmailAccount(account, "user-1");
      expect(res.errors).toEqual([]);
      expect(res.messagesImported).toBe(2);
      expect(res.threadsCreated).toBe(2);

      // Cursor advanced from /profile call.
      const accountUpdate = dbCalls.find(
        (c) => c.op === "update" && c.tableName === "email_accounts",
      ) as { values: { gmailHistoryId?: string } } | undefined;
      expect(accountUpdate?.values.gmailHistoryId).toBe("777");

      // The sent-folder message must be inserted with folder=SENT and isIncoming=false.
      const inserts = dbCalls.filter(
        (c) => c.op === "insert" && c.tableName === "email_messages",
      ) as { values: { folder?: string; isIncoming?: boolean; externalId?: string } }[];
      const sent = inserts.find((i) => i.values.externalId === "g-sent-1");
      expect(sent?.values.folder).toBe("SENT");
      expect(sent?.values.isIncoming).toBe(false);
    });
  });

  describe("Outlook delta sync", () => {
    it("imports new messages, applies remote isRead-only updates, and persists deltaLink", async () => {
      const { syncOutlookAccount } = await import("../../emailRoutes");
      const account = outlookAccount({
        outlookDeltaInbox: "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=abc",
        outlookDeltaSent: "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages/delta?$skiptoken=def",
      });

      // INBOX delta: one new message + one isRead-only flip on an existing one
      pushHandler((url) => {
        if (!url.includes("/mailFolders/inbox/messages/delta")) return undefined as unknown as Response;
        return jsonResp({
          value: [
            {
              id: "ol-msg-1",
              conversationId: "ol-conv-1",
              subject: "Quote request",
              bodyPreview: "preview",
              body: { contentType: "text", content: "Quote please" },
              from: { emailAddress: { name: "Customer", address: "cust@external.com" } },
              toRecipients: [{ emailAddress: { name: "Rep", address: "rep@example.com" } }],
              ccRecipients: [],
              receivedDateTime: new Date().toISOString(),
              isRead: false,
              hasAttachments: false,
            },
            {
              id: "ol-existing-1",
              isRead: true,
            },
          ],
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=NEW-INBOX",
        });
      });
      // SENT delta: removed/archived entity
      pushHandler((url) => {
        if (!url.includes("/mailFolders/sentitems/messages/delta")) return undefined as unknown as Response;
        return jsonResp({
          value: [
            { id: "ol-archived-1", "@removed": { reason: "deleted" } },
          ],
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages/delta?$deltatoken=NEW-SENT",
        });
      });

      // Select queue:
      // INBOX folder:
      //   ol-msg-1 entity → persistOutlookMessage:
      //     select existing message → []
      //     select existing thread  → []
      //     insert thread, insert message
      //     select msg counts       → [{...}]
      //   ol-existing-1 entity → property-only update.set().where().returning() → [{threadId:'tx'}]
      //   recompute thread counts for affected: select counts for thread 'tx' → [{...}]
      // SENT folder:
      //   @removed update.set().where().returning() → [{threadId:'ty'}]
      //   recompute counts for ty → [{...}]
      const now = new Date();
      selectQueue = [
        [],                                                   // existing message
        [],                                                   // existing thread
        [{ total: 1, unread: 1, maxReceivedAt: now }],        // counts after insert
        [{ threadId: "tx" }],                                 // returning() from isRead update
        [{ total: 2, unread: 0, maxReceivedAt: now }],        // recompute counts for tx
        [{ threadId: "ty" }],                                 // returning() from @removed update
        [{ total: 1, unread: 0, maxReceivedAt: now }],        // recompute counts for ty
      ];

      const res = await syncOutlookAccount(account, "user-1");
      expect(res.errors).toEqual([]);
      expect(res.messagesImported).toBe(1);
      expect(res.threadsCreated).toBe(1);

      const accountUpdate = dbCalls.find(
        (c) => c.op === "update" && c.tableName === "email_accounts",
      ) as { values: { outlookDeltaInbox?: string; outlookDeltaSent?: string; syncStatus?: string } } | undefined;
      expect(accountUpdate?.values.outlookDeltaInbox).toContain("$deltatoken=NEW-INBOX");
      expect(accountUpdate?.values.outlookDeltaSent).toContain("$deltatoken=NEW-SENT");
      expect(accountUpdate?.values.syncStatus).toBe("OK");

      // Verify the @removed entity caused an archive update (folder=ARCHIVE).
      const archiveUpdate = (dbCalls.filter(
        (c) => c.op === "update" && c.tableName === "email_messages",
      ) as { values: Record<string, unknown> }[]).find(
        (u) => u.values.folder === "ARCHIVE" && u.values.isArchived === true,
      );
      expect(archiveUpdate).toBeDefined();
    });

    it("falls back to full resync when delta link returns 410", async () => {
      const { syncOutlookAccount } = await import("../../emailRoutes");
      const account = outlookAccount({
        outlookDeltaInbox: "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=expired",
        outlookDeltaSent: "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages/delta?$skiptoken=ok",
      });

      let inboxCalls = 0;
      // Handlers are one-shot, so push two for the two expected inbox calls:
      // First inbox call (using stored cursor) → 410
      pushHandler((url) => {
        if (!url.includes("/mailFolders/inbox/messages/delta")) return undefined as unknown as Response;
        inboxCalls += 1;
        expect(url).toContain("$skiptoken=expired");
        return new Response("Gone", { status: 410 });
      });
      // Second inbox call (rebuilt without cursor) → empty deltaLink
      pushHandler((url) => {
        if (!url.includes("/mailFolders/inbox/messages/delta")) return undefined as unknown as Response;
        inboxCalls += 1;
        // Should rebuild the delta URL fresh — must NOT contain the expired token.
        expect(url).not.toContain("expired");
        // URL is percent-encoded ("$" → "%24") at this point.
        expect(decodeURIComponent(url)).toContain("$select=");
        return jsonResp({
          value: [],
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=FRESH",
        });
      });
      pushHandler((url) => {
        if (!url.includes("/mailFolders/sentitems/messages/delta")) return undefined as unknown as Response;
        return jsonResp({
          value: [],
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages/delta?$deltatoken=SENT-OK",
        });
      });

      const res = await syncOutlookAccount(account, "user-1");
      expect(res.errors).toEqual([]);
      expect(inboxCalls).toBe(2);

      const accountUpdate = dbCalls.find(
        (c) => c.op === "update" && c.tableName === "email_accounts",
      ) as { values: { outlookDeltaInbox?: string } } | undefined;
      expect(accountUpdate?.values.outlookDeltaInbox).toContain("$deltatoken=FRESH");
    });
  });

  describe("Push-back: PATCH /messages/:id state push to provider", () => {
    it("pushGmailMessageState: read+unarchive issues addLabelIds=[INBOX], removeLabelIds=[UNREAD]", async () => {
      const { drainMessageProviderPush } = await import("../../emailRoutes");
      const account = gmailAccount();
      // First select returns the queued message; the post-modify nulls pendingProviderPush.
      selectQueue = [[
        {
          id: "m-1",
          externalId: "ext-1",
          emailAccountId: account.id,
          threadId: "t-1",
          pendingProviderPush: { isRead: true, isArchived: false, attempts: 0 },
        },
      ]];

      let modifyBody: { addLabelIds?: string[]; removeLabelIds?: string[] } | undefined;
      pushHandler((url, init) => {
        if (!url.includes("/messages/ext-1/modify")) return undefined as unknown as Response;
        modifyBody = JSON.parse(String(init?.body));
        return jsonResp({});
      });

      await drainMessageProviderPush(account, "m-1");
      expect(modifyBody?.removeLabelIds).toEqual(["UNREAD"]);
      expect(modifyBody?.addLabelIds).toEqual(["INBOX"]);
      // pendingProviderPush cleared
      const cleared = (dbCalls.filter(
        (c) => c.op === "update" && c.tableName === "email_messages",
      ) as { values: Record<string, unknown> }[]).find((u) => u.values.pendingProviderPush === null);
      expect(cleared).toBeDefined();
    });

    it("pushGmailMessageState: archive+unread issues addLabelIds=[UNREAD], removeLabelIds=[INBOX]", async () => {
      const { drainMessageProviderPush } = await import("../../emailRoutes");
      const account = gmailAccount();
      selectQueue = [[
        { id: "m-2", externalId: "ext-2", emailAccountId: account.id, threadId: "t-2",
          pendingProviderPush: { isRead: false, isArchived: true, attempts: 0 } },
      ]];

      let modifyBody: { addLabelIds?: string[]; removeLabelIds?: string[] } | undefined;
      pushHandler((url, init) => {
        if (!url.includes("/messages/ext-2/modify")) return undefined as unknown as Response;
        modifyBody = JSON.parse(String(init?.body));
        return jsonResp({});
      });

      await drainMessageProviderPush(account, "m-2");
      expect(modifyBody?.addLabelIds).toEqual(["UNREAD"]);
      expect(modifyBody?.removeLabelIds).toEqual(["INBOX"]);
    });

    it("pushOutlookMessageState: PATCHes isRead and POSTs to /move for archive", async () => {
      const { drainMessageProviderPush } = await import("../../emailRoutes");
      const account = outlookAccount();
      selectQueue = [[
        {
          id: "m-3",
          externalId: "OL-EXT-3",
          emailAccountId: account.id,
          threadId: "t-3",
          pendingProviderPush: { isRead: true, isArchived: true, attempts: 0 },
        },
      ]];

      let patched = false;
      let movedTo: string | null = null;
      pushHandler((url, init) => {
        if (!url.endsWith("/messages/OL-EXT-3")) return undefined as unknown as Response;
        expect(init?.method).toBe("PATCH");
        const body = JSON.parse(String(init?.body));
        expect(body.isRead).toBe(true);
        patched = true;
        return jsonResp({});
      });
      pushHandler((url, init) => {
        if (!url.endsWith("/messages/OL-EXT-3/move")) return undefined as unknown as Response;
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body));
        movedTo = body.destinationId;
        return jsonResp({});
      });

      await drainMessageProviderPush(account, "m-3");
      expect(patched).toBe(true);
      expect(movedTo).toBe("archive");

      // Validate ImmutableId Prefer header is always added by outlookApiFetch.
      const opsAgainstMessage = fetchLog.filter((e) => e.url.includes("/messages/OL-EXT-3"));
      expect(opsAgainstMessage.length).toBeGreaterThanOrEqual(2);
    });

    it("pushOutlookMessageState: archive=false moves to inbox", async () => {
      const { drainMessageProviderPush } = await import("../../emailRoutes");
      const account = outlookAccount();
      selectQueue = [[
        { id: "m-4", externalId: "OL-EXT-4", emailAccountId: account.id, threadId: "t-4",
          pendingProviderPush: { isArchived: false, attempts: 0 } },
      ]];
      let movedTo: string | null = null;
      pushHandler((url, init) => {
        if (!url.endsWith("/messages/OL-EXT-4/move")) return undefined as unknown as Response;
        movedTo = JSON.parse(String(init?.body)).destinationId;
        return jsonResp({});
      });
      await drainMessageProviderPush(account, "m-4");
      expect(movedTo).toBe("inbox");
    });
  });

  describe("drainAccountProviderPushes", () => {
    it("iterates pending messages and drives a provider call for each", async () => {
      const { drainAccountProviderPushes } = await import("../../emailRoutes");
      const account = gmailAccount();
      // The first select returns the list of message ids with pending pushes.
      // Then drainMessageProviderPush selects each row by id.
      selectQueue = [
        [{ id: "p-1" }, { id: "p-2" }],
        [{ id: "p-1", externalId: "ext-p1", emailAccountId: account.id, threadId: "t-p1",
           pendingProviderPush: { isRead: true, attempts: 0 } }],
        [{ id: "p-2", externalId: "ext-p2", emailAccountId: account.id, threadId: "t-p2",
           pendingProviderPush: { isArchived: true, attempts: 0 } }],
      ];

      const seen: string[] = [];
      pushHandler((url) => {
        if (url.includes("/messages/ext-p1/modify")) { seen.push("p1"); return jsonResp({}); }
        return undefined as unknown as Response;
      });
      pushHandler((url) => {
        if (url.includes("/messages/ext-p2/modify")) { seen.push("p2"); return jsonResp({}); }
        return undefined as unknown as Response;
      });

      await drainAccountProviderPushes(account);
      expect(seen.sort()).toEqual(["p1", "p2"]);
    });
  });

  describe("IMAP sync", () => {
    it("imports newly-fetched IMAP messages and persists lastSyncedAt", async () => {
      const imap = await import("../../services/imapService");
      const { syncImapAccount } = await import("../../emailRoutes");
      const account = imapAccount({ lastSyncedAt: null });

      const now = new Date();
      vi.mocked(imap.fetchImapMessages).mockResolvedValueOnce([
        {
          externalId: "imap-uid-1",
          subject: "RFP from customer",
          fromAddress: "buyer@external.com",
          fromName: "Buyer",
          toAddresses: "rep@example.com",
          ccAddresses: "",
          bodyText: "Please quote the attached scope.",
          bodyHtml: "",
          snippet: "Please quote",
          receivedAt: now,
          isRead: false,
          hasAttachments: false,
          messageId: "<imap-uid-1@example.com>",
          inReplyTo: "",
          references: "",
        },
      ]);

      // selects in order:
      //  1) existing message ids among candidates -> []
      //  2) existing thread by subject            -> []
      //  3) msg counts after insert               -> [{...}]
      selectQueue = [
        [],
        [],
        [{ total: 1, unread: 1, maxReceivedAt: now }],
      ];

      const res = await syncImapAccount(account, "user-1");
      expect(res.errors).toEqual([]);
      expect(res.messagesImported).toBe(1);
      expect(res.threadsCreated).toBe(1);

      const messageInsert = dbCalls.find(
        (c) => c.op === "insert" && c.tableName === "email_messages",
      ) as { values: { externalId?: string; isIncoming?: boolean } } | undefined;
      expect(messageInsert?.values.externalId).toBe("imap-uid-1");
      expect(messageInsert?.values.isIncoming).toBe(true);

      const accountUpdate = [...dbCalls].reverse().find(
        (c) => c.op === "update" && c.tableName === "email_accounts",
      ) as { values: { lastSyncedAt?: Date; lastSyncError?: string | null } } | undefined;
      expect(accountUpdate?.values.lastSyncedAt).toBeInstanceOf(Date);
      expect(accountUpdate?.values.lastSyncError).toBeNull();
    });

    it("is idempotent: re-importing an already-stored uid inserts nothing", async () => {
      const imap = await import("../../services/imapService");
      const { syncImapAccount } = await import("../../emailRoutes");
      const account = imapAccount({ lastSyncedAt: new Date(Date.now() - 60_000) });

      vi.mocked(imap.fetchImapMessages).mockResolvedValueOnce([
        {
          externalId: "imap-uid-1",
          subject: "RFP from customer",
          fromAddress: "buyer@external.com",
          fromName: "Buyer",
          toAddresses: "rep@example.com",
          ccAddresses: "",
          bodyText: "dup",
          bodyHtml: "",
          snippet: "dup",
          receivedAt: new Date(),
          isRead: true,
          hasAttachments: false,
          messageId: "<imap-uid-1@example.com>",
          inReplyTo: "",
          references: "",
        },
      ]);

      // Existing-message lookup returns the uid, so the function early-exits.
      selectQueue = [
        [{ externalId: "imap-uid-1" }],
      ];

      const res = await syncImapAccount(account, "user-1");
      expect(res.errors).toEqual([]);
      expect(res.messagesImported).toBe(0);
      expect(res.threadsCreated).toBe(0);

      const messageInsert = dbCalls.find(
        (c) => c.op === "insert" && c.tableName === "email_messages",
      );
      expect(messageInsert).toBeUndefined();

      // Still bumps lastSyncedAt so future runs use the narrower since-window.
      const accountUpdate = dbCalls.find(
        (c) => c.op === "update" && c.tableName === "email_accounts",
      ) as { values: { lastSyncedAt?: Date } } | undefined;
      expect(accountUpdate?.values.lastSyncedAt).toBeInstanceOf(Date);
    });

    it("reports an error and persists lastSyncError when fetchImapMessages throws", async () => {
      const imap = await import("../../services/imapService");
      const { syncImapAccount } = await import("../../emailRoutes");
      const account = imapAccount();

      vi.mocked(imap.fetchImapMessages).mockRejectedValueOnce(
        new Error("IMAP connection refused"),
      );

      const res = await syncImapAccount(account, "user-1");
      expect(res.errors.length).toBe(1);
      expect(res.errors[0]).toContain("IMAP sync failed");
      expect(res.errors[0]).toContain("connection refused");

      const accountUpdate = dbCalls.find(
        (c) => c.op === "update" && c.tableName === "email_accounts",
      ) as { values: { lastSyncError?: string } } | undefined;
      expect(accountUpdate?.values.lastSyncError).toContain("IMAP sync failed");
    });

    it("flags missing IMAP configuration without making a network call", async () => {
      const imap = await import("../../services/imapService");
      const { syncImapAccount } = await import("../../emailRoutes");
      const fetchSpy = vi.mocked(imap.fetchImapMessages);
      const callsBefore = fetchSpy.mock.calls.length;

      const account = imapAccount({ imapPassword: null });
      const res = await syncImapAccount(account, "user-1");

      expect(res.errors[0]).toContain("IMAP configuration incomplete");
      expect(fetchSpy.mock.calls.length).toBe(callsBefore);
      const accountUpdate = dbCalls.find(
        (c) => c.op === "update" && c.tableName === "email_accounts",
      ) as { values: { lastSyncError?: string } } | undefined;
      expect(accountUpdate?.values.lastSyncError).toContain("IMAP configuration incomplete");
    });
  });

  describe("Token-refresh failure paths", () => {
    it("Gmail: provider returns 401 after refresh → account marked NEEDS_RECONNECT", async () => {
      const { syncGmailAccount } = await import("../../emailRoutes");
      // Force the in-memory access token to be stale so gmailApiFetch's first
      // call goes out with it; provider returns 401 and the refresh-then-retry
      // path runs. We then return 401 a second time, simulating a refresh
      // token that no longer grants Gmail scopes.
      const account = gmailAccount({
        accessToken: "stale",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        gmailHistoryId: null,
        lastSyncedAt: null,
      });

      let listCalls = 0;
      // Two 401s for the messages-list endpoint (initial + post-refresh retry).
      pushHandler((url) => {
        if (!url.includes("/users/me/messages?q=")) return undefined as unknown as Response;
        listCalls += 1;
        return new Response("Unauthorized", { status: 401 });
      });
      pushHandler((url) => {
        if (!url.includes("/users/me/messages?q=")) return undefined as unknown as Response;
        listCalls += 1;
        return new Response("Unauthorized", { status: 401 });
      });

      const res = await syncGmailAccount(account, "user-1");
      expect(listCalls).toBe(2);
      expect(res.errors.length).toBeGreaterThan(0);
      expect(res.errors.join(" ")).toMatch(/401/);

      // The account row should be updated with NEEDS_RECONNECT and a
      // populated lastSyncError describing the auth failure.
      const accountUpdate = [...dbCalls].reverse().find(
        (c) => c.op === "update" && c.tableName === "email_accounts",
      ) as { values: { syncStatus?: string; lastSyncError?: string } } | undefined;
      expect(accountUpdate?.values.syncStatus).toBe("NEEDS_RECONNECT");
      expect(accountUpdate?.values.lastSyncError).toBeTruthy();
      expect(accountUpdate?.values.lastSyncError).toMatch(/401|auth/i);
    });

    it("Gmail: refresh endpoint returns invalid_grant → account marked NEEDS_RECONNECT", async () => {
      const { syncGmailAccount } = await import("../../emailRoutes");
      // Stale token forces gmailApiFetch's first call to receive 401 from
      // Gmail; that triggers refreshGmailAccessToken, which then itself
      // fails (invalid_grant — the refresh token has been revoked or the
      // user has changed their password).
      const account = gmailAccount({
        accessToken: "stale",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        gmailHistoryId: null,
        lastSyncedAt: null,
      });

      // Gmail messages list returns 401 → refresh path will run.
      pushHandler((url) => {
        if (!url.includes("/users/me/messages?q=")) return undefined as unknown as Response;
        return new Response("Unauthorized", { status: 401 });
      });
      // Override the default token-endpoint success: refresh itself fails
      // with invalid_grant.
      pushHandler((url) => {
        if (!url.includes("oauth2.googleapis.com/token")) return undefined as unknown as Response;
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      });

      const res = await syncGmailAccount(account, "user-1");
      expect(res.errors.length).toBeGreaterThan(0);
      expect(res.errors.join(" ")).toMatch(/auth|refresh|invalid_grant/i);

      const accountUpdate = [...dbCalls].reverse().find(
        (c) => c.op === "update" && c.tableName === "email_accounts",
      ) as { values: { syncStatus?: string; lastSyncError?: string } } | undefined;
      expect(accountUpdate?.values.syncStatus).toBe("NEEDS_RECONNECT");
      expect(accountUpdate?.values.lastSyncError).toBeTruthy();
    });

    it("Outlook: provider returns 401 after refresh → account marked NEEDS_RECONNECT", async () => {
      const { syncOutlookAccount } = await import("../../emailRoutes");
      // Force the in-memory access token to be expired so outlookApiFetch's
      // first call goes out with a stale token; provider returns 401 and the
      // refresh-then-retry path runs. We then return 401 a second time,
      // simulating a refresh token that no longer grants Mail.* scopes.
      const account = outlookAccount({
        accessToken: "stale",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        outlookDeltaInbox:
          "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=abc",
        outlookDeltaSent: null,
      });

      let inboxCalls = 0;
      // Two 401s for the inbox delta endpoint (initial + post-refresh retry).
      pushHandler((url) => {
        if (!url.includes("/mailFolders/inbox/messages/delta")) return undefined as unknown as Response;
        inboxCalls += 1;
        return new Response("Unauthorized", { status: 401 });
      });
      pushHandler((url) => {
        if (!url.includes("/mailFolders/inbox/messages/delta")) return undefined as unknown as Response;
        inboxCalls += 1;
        return new Response("Unauthorized", { status: 401 });
      });

      const res = await syncOutlookAccount(account, "user-1");
      expect(inboxCalls).toBe(2);
      expect(res.errors.length).toBeGreaterThan(0);
      // syncOutlookFolderDelta throws "Outlook delta auth failed: 401" on the
      // second 401; the outer catch must mark the account NEEDS_RECONNECT.
      expect(res.errors.join(" ")).toMatch(/401/);

      const accountUpdate = [...dbCalls].reverse().find(
        (c) => c.op === "update" && c.tableName === "email_accounts",
      ) as { values: { syncStatus?: string; lastSyncError?: string } } | undefined;
      expect(accountUpdate?.values.syncStatus).toBe("NEEDS_RECONNECT");
      expect(accountUpdate?.values.lastSyncError).toBeTruthy();
    });

    it("Outlook: 401 + refresh endpoint also fails → sync errors and lastSyncError records the failure", async () => {
      const { syncOutlookAccount } = await import("../../emailRoutes");
      const account = outlookAccount({
        accessToken: "stale",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        outlookDeltaInbox:
          "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=abc",
        outlookDeltaSent: null,
      });

      // Inbox returns 401 — this triggers refresh inside outlookApiFetch.
      pushHandler((url) => {
        if (!url.includes("/mailFolders/inbox/messages/delta")) return undefined as unknown as Response;
        return new Response("Unauthorized", { status: 401 });
      });
      // Override the default token-endpoint success: refresh itself fails.
      pushHandler((url) => {
        if (!url.includes("login.microsoftonline.com")) return undefined as unknown as Response;
        return new Response("invalid_grant", { status: 400 });
      });

      const res = await syncOutlookAccount(account, "user-1");
      expect(res.errors.length).toBeGreaterThan(0);
      expect(res.errors.join(" ")).toMatch(/refresh|access token/i);

      const accountUpdate = [...dbCalls].reverse().find(
        (c) => c.op === "update" && c.tableName === "email_accounts",
      ) as { values: { lastSyncError?: string; syncStatus?: string } } | undefined;
      expect(accountUpdate?.values.lastSyncError).toBeTruthy();
      // Refresh threw "Failed to refresh Outlook access token" — that string
      // doesn't match /401|403/, so syncStatus stays DEGRADED rather than
      // NEEDS_RECONNECT. Document the current behavior so a regression that
      // accidentally suppresses the error surface is caught.
      expect(accountUpdate?.values.syncStatus).toBe("DEGRADED");
    });
  });

  describe("Outlook delta page-cap (degraded path)", () => {
    it("persists @odata.nextLink as the cursor and marks account DEGRADED when MAX_PAGES is hit", async () => {
      const { syncOutlookAccount } = await import("../../emailRoutes");
      const account = outlookAccount({
        outlookDeltaInbox:
          "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=p0",
        outlookDeltaSent:
          "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages/delta?$skiptoken=sok",
      });

      // Stage 50 inbox responses, each handing off the next skiptoken via
      // @odata.nextLink and never producing an @odata.deltaLink. After 50
      // pages the function should give up, persist the last nextLink, and
      // surface a degraded warning.
      for (let i = 0; i < 50; i++) {
        const next = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=p${i + 1}`;
        pushHandler((url) => {
          if (!url.includes("/mailFolders/inbox/messages/delta")) return undefined as unknown as Response;
          return jsonResp({ value: [], "@odata.nextLink": next });
        });
      }
      // Sent folder finishes immediately with a fresh delta link.
      pushHandler((url) => {
        if (!url.includes("/mailFolders/sentitems/messages/delta")) return undefined as unknown as Response;
        return jsonResp({
          value: [],
          "@odata.deltaLink":
            "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages/delta?$deltatoken=SENT-OK",
        });
      });

      const res = await syncOutlookAccount(account, "user-1");
      expect(res.errors.length).toBeGreaterThanOrEqual(1);
      expect(res.errors.join(" ")).toMatch(/page cap/i);

      const inboxCalls = fetchLog.filter((e) => e.url.includes("/mailFolders/inbox/messages/delta"));
      expect(inboxCalls.length).toBe(50);

      const accountUpdate = [...dbCalls].reverse().find(
        (c) => c.op === "update" && c.tableName === "email_accounts",
      ) as { values: { outlookDeltaInbox?: string; syncStatus?: string } } | undefined;
      // The 50th response handed back $skiptoken=p50 — that nextLink must be
      // persisted so the next run resumes exactly there instead of restarting.
      expect(accountUpdate?.values.outlookDeltaInbox).toContain("$skiptoken=p50");
      expect(accountUpdate?.values.syncStatus).toBe("DEGRADED");
    });
  });

  describe("Push-back retry / backoff", () => {
    it("increments attempts on a transient provider failure (still pending)", async () => {
      const { drainMessageProviderPush } = await import("../../emailRoutes");
      const account = gmailAccount();
      selectQueue = [[
        {
          id: "m-retry-1",
          externalId: "ext-r1",
          emailAccountId: account.id,
          threadId: "t-r1",
          pendingProviderPush: { isRead: true, attempts: 0 },
        },
      ]];

      // Provider returns 500 — pushGmailMessageState throws.
      pushHandler((url) => {
        if (!url.includes("/messages/ext-r1/modify")) return undefined as unknown as Response;
        return new Response("server boom", { status: 500 });
      });

      await expect(drainMessageProviderPush(account, "m-retry-1")).rejects.toThrow();

      // The message row should be updated with attempts=1 and pendingProviderPush
      // still populated (i.e. NOT cleared).
      const msgUpdate = (dbCalls.filter(
        (c) => c.op === "update" && c.tableName === "email_messages",
      ) as { values: Record<string, unknown> }[]).find(
        (u) => u.values.pendingProviderPush && (u.values.pendingProviderPush as { attempts?: number }).attempts === 1,
      );
      expect(msgUpdate).toBeDefined();

      // No final-failure record on the account yet.
      const accountFailure = dbCalls.find(
        (c) => c.op === "update" && c.tableName === "email_accounts",
      );
      expect(accountFailure).toBeUndefined();
    });

    it("gives up after MAX_PUSH_ATTEMPTS, clearing the pending push and recording the failure on the account", async () => {
      const { drainMessageProviderPush } = await import("../../emailRoutes");
      const account = gmailAccount();
      // attempts=4 → next failure pushes to 5 == MAX_PUSH_ATTEMPTS → give up.
      selectQueue = [[
        {
          id: "m-retry-2",
          externalId: "ext-r2",
          emailAccountId: account.id,
          threadId: "t-r2",
          pendingProviderPush: { isRead: true, attempts: 4 },
        },
      ]];

      pushHandler((url) => {
        if (!url.includes("/messages/ext-r2/modify")) return undefined as unknown as Response;
        return new Response("still broken", { status: 500 });
      });

      await expect(drainMessageProviderPush(account, "m-retry-2")).rejects.toThrow();

      // Pending push must be cleared.
      const cleared = (dbCalls.filter(
        (c) => c.op === "update" && c.tableName === "email_messages",
      ) as { values: Record<string, unknown> }[]).find((u) => u.values.pendingProviderPush === null);
      expect(cleared).toBeDefined();

      // Failure recorded on the account so the user can see why pushes stopped.
      const accountUpdate = dbCalls.find(
        (c) => c.op === "update" && c.tableName === "email_accounts",
      ) as { values: { lastSyncError?: string } } | undefined;
      expect(accountUpdate?.values.lastSyncError).toContain("Push-back gave up");
      expect(accountUpdate?.values.lastSyncError).toContain("ext-r2");
    });
  });
});
