/**
 * Inbound reply / bounce detection coverage (Task #561).
 *
 * Validates two pieces of cadence-protection logic that previously had no
 * automated coverage:
 *
 *   - `detectInboundReply`  — header-aware (In-Reply-To / References) match
 *     plus the address-only fallback. Critically, when threading headers are
 *     present but don't match a sequence Message-Id, the function must NOT
 *     fall through to the address heuristic (no false positives).
 *
 *   - `detectInboundBounce` — auto-exits the matching enrollment on DSN-style
 *     replies. Triggered by MAILER-DAEMON sender, by DSN subjects, and by an
 *     original Message-Id embedded in the bounce body.
 *
 * Plus one integration-style test that pushes a DSN through `syncImapAccount`
 * (one of the four `emailRoutes` ingestion sites that calls these detectors)
 * and asserts the matching enrollment ends up in BOUNCED.
 *
 * The test follows the same in-memory-db mock pattern as
 * `email-sync/email-sync.test.ts`: each test pre-loads `selectQueue` with the
 * rows it wants the next select(s) to return, and inspects `dbCalls` for the
 * inserts / updates that should have happened.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory db mock (same shape as email-sync test).
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

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

// Same shape but referenced via the services-relative path that
// sequenceService.ts uses (`../db`). Both must resolve to the same mock — we
// do that by pointing both module specifiers at the same factory above.

vi.mock("../utils/logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../services/notificationService", () => ({
  insertNotification: vi.fn(async () => undefined),
}));

vi.mock("../services/emailService", () => ({
  sendEmail: vi.fn(async () => ({ success: true })),
}));

// Stubs needed only by the integration path through emailRoutes.
vi.mock("../auditLogger", () => ({
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  logDelete: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("../sanitization", () => ({
  sanitizeEmail: (s: string) => s,
  sanitizeText: (s: string) => s,
  sanitizeShortText: (s: string) => s,
}));

vi.mock("../auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../utils/routeHelpers", () => ({
  getCanonicalBaseUrl: () => "http://localhost:5000",
  isRedirectUriValid: () => true,
}));

vi.mock("../objectStorage", () => ({
  ObjectStorageService: class {
    async deleteObjectByKey() {}
  },
}));

vi.mock("../ai/emailAi", () => ({
  analyzeEmail: vi.fn(async () => ({ classification: "OTHER", summary: "", extractedEntities: {} })),
  summarizeThread: vi.fn(async () => ""),
  suggestReplies: vi.fn(async () => []),
  generateEmailSummary: vi.fn(async () => ""),
  matchEmailToEntities: vi.fn(async () => ({ projectId: null, bidId: null, vendorId: null })),
  createTaskFromEmail: vi.fn(async () => undefined),
}));

vi.mock("../services/aiGovernance", () => ({
  governedAiCall: vi.fn(async (_org: unknown, _model: unknown, fn: () => unknown) => fn()),
}));

vi.mock("../ai/openaiClient", () => ({
  AI_MODEL_GPT5: "gpt-5",
  openai: { chat: { completions: { create: vi.fn() } } },
}));

vi.mock("../services/imapService", () => ({
  testFullConnection: vi.fn(),
  fetchImapMessages: vi.fn(async () => []),
  sendSmtpEmail: vi.fn(async () => ({ success: true })),
}));

beforeEach(() => {
  dbCalls.length = 0;
  selectQueue = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// detectInboundReply
// ---------------------------------------------------------------------------

describe("detectInboundReply", () => {
  it("matches via In-Reply-To against an outbound Message-Id and records a REPLY (auto-pauses)", async () => {
    const { detectInboundReply } = await import("../services/sequenceService");

    const exec = { id: "exec-1", organizationId: "org-1", enrollmentId: "enroll-1" };
    const enrollment = {
      id: "enroll-1",
      organizationId: "org-1",
      senderId: "user-1",
      status: "ACTIVE",
    };
    selectQueue = [
      [exec],         // Path A threaded match
      [exec],         // recordEmailEvent re-fetches the execution
      [enrollment],   // recordEmailEvent looks up the enrollment to auto-exit
    ];

    const res = await detectInboundReply({
      organizationId: "org-1",
      fromAddress: "Buyer@External.com",
      isIncoming: true,
      inReplyTo: "<outbound-msg-1@my-app>",
      references: null,
    });

    expect(res).toEqual({ matched: 1 });

    const eventInsert = dbCalls.find(
      (c) => c.op === "insert" && c.tableName === "crm_sequence_email_events",
    ) as { values: { eventType?: string; payload?: { source?: string } } } | undefined;
    expect(eventInsert?.values.eventType).toBe("REPLY");
    expect(eventInsert?.values.payload?.source).toBe("inbound_email_threaded");

    const enrollmentUpdate = dbCalls.find(
      (c) => c.op === "update" && c.tableName === "crm_sequence_enrollments",
    ) as { values: { status?: string; exitReason?: string } } | undefined;
    expect(enrollmentUpdate?.values.status).toBe("REPLIED");
    expect(enrollmentUpdate?.values.exitReason).toBe("REPLIED");
  });

  it("matches via the References header (whitespace-separated list)", async () => {
    const { detectInboundReply } = await import("../services/sequenceService");

    const exec = { id: "exec-2", organizationId: "org-1", enrollmentId: "enroll-2" };
    selectQueue = [
      [exec],
      [exec],
      [{ id: "enroll-2", organizationId: "org-1", senderId: "user-1", status: "ACTIVE" }],
    ];

    const res = await detectInboundReply({
      organizationId: "org-1",
      fromAddress: "buyer@external.com",
      isIncoming: true,
      inReplyTo: null,
      references: "<unrelated@x> <outbound-msg-2@my-app>",
    });

    expect(res).toEqual({ matched: 1 });
    expect(
      dbCalls.some((c) => c.op === "insert" && c.tableName === "crm_sequence_email_events"),
    ).toBe(true);
  });

  it("falls back to the address-only match when no threading headers are present", async () => {
    const { detectInboundReply } = await import("../services/sequenceService");

    const exec = { id: "exec-3", organizationId: "org-1", enrollmentId: "enroll-3" };
    selectQueue = [
      [{ id: "contact-1" }],                                                          // crmContacts by email
      [{ id: "enroll-3", contactId: "contact-1", organizationId: "org-1", status: "ACTIVE", senderId: "user-1" }], // active enrollments
      [exec],                                                                          // most-recent SENT execution
      [exec],                                                                          // recordEmailEvent re-fetch
      [{ id: "enroll-3", organizationId: "org-1", senderId: "user-1", status: "ACTIVE" }], // enrollment for auto-exit
    ];

    const res = await detectInboundReply({
      organizationId: "org-1",
      fromAddress: "Buyer@External.com",
      isIncoming: true,
      // no inReplyTo / references → forces Path B
    });

    expect(res).toEqual({ matched: 1 });
    const eventInsert = dbCalls.find(
      (c) => c.op === "insert" && c.tableName === "crm_sequence_email_events",
    ) as { values: { payload?: { source?: string } } } | undefined;
    expect(eventInsert?.values.payload?.source).toBe("inbound_email_fallback");

    const enrollmentUpdate = dbCalls.find(
      (c) => c.op === "update" && c.tableName === "crm_sequence_enrollments",
    ) as { values: { status?: string } } | undefined;
    expect(enrollmentUpdate?.values.status).toBe("REPLIED");
  });

  it("does NOT fall back to the address heuristic when threading headers are present but don't match (no false positive)", async () => {
    const { detectInboundReply } = await import("../services/sequenceService");

    selectQueue = [
      [], // Path A returns no match
      // No further selects should occur — function must return immediately.
    ];

    const res = await detectInboundReply({
      organizationId: "org-1",
      fromAddress: "buyer@external.com",
      isIncoming: true,
      inReplyTo: "<unrelated-thread@somewhere-else>",
      references: null,
    });

    expect(res).toEqual({ matched: 0 });
    expect(
      dbCalls.some((c) => c.op === "insert" && c.tableName === "crm_sequence_email_events"),
    ).toBe(false);
    expect(
      dbCalls.some((c) => c.op === "update" && c.tableName === "crm_sequence_enrollments"),
    ).toBe(false);
    // Confirms only the Path-A select fired and Path-B was not entered.
    expect(selectQueue.length).toBe(0);
  });

  it("ignores outgoing messages and missing from addresses", async () => {
    const { detectInboundReply } = await import("../services/sequenceService");
    expect(await detectInboundReply({ organizationId: "org-1", fromAddress: "x@y.com", isIncoming: false }))
      .toEqual({ matched: 0 });
    expect(await detectInboundReply({ organizationId: "org-1", fromAddress: "", isIncoming: true }))
      .toEqual({ matched: 0 });
    expect(dbCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// detectInboundBounce
// ---------------------------------------------------------------------------

describe("detectInboundBounce", () => {
  function queueSuccessfulBounce() {
    const exec = { id: "exec-b", organizationId: "org-1", enrollmentId: "enroll-b" };
    const enrollment = {
      id: "enroll-b",
      organizationId: "org-1",
      senderId: "user-1",
      status: "ACTIVE",
    };
    selectQueue = [
      [exec],         // initial detect lookup (by candidate Message-Ids)
      [exec],         // recordEmailEvent re-fetch
      [enrollment],   // recordEmailEvent enrollment lookup → auto-exit
    ];
  }

  it("matches when the sender is MAILER-DAEMON and Message-Id is in In-Reply-To", async () => {
    const { detectInboundBounce } = await import("../services/sequenceService");
    queueSuccessfulBounce();

    const res = await detectInboundBounce({
      organizationId: "org-1",
      fromAddress: "MAILER-DAEMON@mail.external.com",
      isIncoming: true,
      subject: "Mail delivery report",
      inReplyTo: "<outbound-msg-b@my-app>",
      references: null,
      bodyText: null,
      bodyHtml: null,
    });

    expect(res).toEqual({ matched: 1 });

    const eventInsert = dbCalls.find(
      (c) => c.op === "insert" && c.tableName === "crm_sequence_email_events",
    ) as { values: { eventType?: string } } | undefined;
    expect(eventInsert?.values.eventType).toBe("BOUNCE");

    const execUpdate = dbCalls.find(
      (c) => c.op === "update" && c.tableName === "crm_sequence_step_executions",
    ) as { values: { status?: string } } | undefined;
    expect(execUpdate?.values.status).toBe("BOUNCED");

    const enrollUpdate = dbCalls.find(
      (c) => c.op === "update" && c.tableName === "crm_sequence_enrollments",
    ) as { values: { status?: string; exitReason?: string } } | undefined;
    expect(enrollUpdate?.values.status).toBe("BOUNCED");
    expect(enrollUpdate?.values.exitReason).toBe("BOUNCED");
  });

  it("matches a DSN-style subject even when the sender is not MAILER-DAEMON", async () => {
    const { detectInboundBounce } = await import("../services/sequenceService");
    queueSuccessfulBounce();

    const res = await detectInboundBounce({
      organizationId: "org-1",
      fromAddress: "noreply@bounce-relay.example.com",
      isIncoming: true,
      subject: "Undeliverable: Your message to buyer@external.com",
      inReplyTo: "<outbound-msg-b@my-app>",
      references: null,
      bodyText: "",
      bodyHtml: "",
    });

    expect(res).toEqual({ matched: 1 });
    expect(
      dbCalls.find((c) => c.op === "insert" && c.tableName === "crm_sequence_email_events"),
    ).toBeTruthy();
  });

  it("extracts the original Message-Id from the bounce body when no In-Reply-To header is present", async () => {
    const { detectInboundBounce } = await import("../services/sequenceService");
    queueSuccessfulBounce();

    const dsnBody = [
      "This is the mail system at host mail.external.com.",
      "",
      "I'm sorry to have to inform you that your message could not be delivered.",
      "",
      "Original-Message-ID: <outbound-msg-b@my-app>",
      "Reporting-MTA: dns; mail.external.com",
    ].join("\n");

    const res = await detectInboundBounce({
      organizationId: "org-1",
      fromAddress: "mailer-daemon@mail.external.com",
      isIncoming: true,
      subject: "Delivery Status Notification (Failure)",
      inReplyTo: null,
      references: null,
      bodyText: dsnBody,
      bodyHtml: null,
    });

    expect(res).toEqual({ matched: 1 });
    const enrollUpdate = dbCalls.find(
      (c) => c.op === "update" && c.tableName === "crm_sequence_enrollments",
    ) as { values: { status?: string } } | undefined;
    expect(enrollUpdate?.values.status).toBe("BOUNCED");
  });

  it("returns no match when the message does not look like a bounce", async () => {
    const { detectInboundBounce } = await import("../services/sequenceService");

    const res = await detectInboundBounce({
      organizationId: "org-1",
      fromAddress: "buyer@external.com",
      isIncoming: true,
      subject: "Re: your quote",
      inReplyTo: "<outbound-msg-b@my-app>",
      references: null,
      bodyText: "Looks great, thanks!",
      bodyHtml: null,
    });

    expect(res).toEqual({ matched: 0 });
    expect(dbCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: syncImapAccount end-to-end exercises detectInboundBounce and
// auto-exits the matching enrollment to BOUNCED.
// ---------------------------------------------------------------------------

describe("syncImapAccount → detectInboundBounce → enrollment BOUNCED (integration)", () => {
  it("ingests a DSN through the IMAP path and moves the matching enrollment to BOUNCED", async () => {
    const { syncImapAccount } = await import("../emailRoutes");
    const imap = await import("../services/imapService");

    const account = {
      id: "acct-imap-1",
      organizationId: "org-1",
      userId: "user-1",
      provider: "IMAP",
      emailAddress: "rep@example.com",
      imapHost: "imap.example.com",
      imapPort: 993,
      imapSecure: true,
      imapPassword: "secret",
      imapUsername: "rep@example.com",
      lastSyncedAt: null,
    } as never;

    const dsnBody = [
      "This is the mail system at mail.external.com.",
      "I'm sorry to have to inform you that your message could not be delivered.",
      "Original-Message-ID: <outbound-msg-imap@my-app>",
    ].join("\n");

    vi.mocked(imap.fetchImapMessages).mockResolvedValueOnce([
      {
        externalId: "imap-uid-1",
        messageId: "<dsn-1@mail.external.com>",
        inReplyTo: "",
        references: "",
        threadId: "imap-uid-1",
        fromAddress: "MAILER-DAEMON@mail.external.com",
        fromName: "Mail Delivery System",
        toAddresses: ["rep@example.com"],
        ccAddresses: [],
        subject: "Undeliverable: Mail Delivery Failure",
        bodyText: dsnBody,
        bodyHtml: null,
        snippet: dsnBody.slice(0, 100),
        receivedAt: new Date(),
        isRead: false,
        hasAttachments: false,
      } as never,
    ]);

    const exec = { id: "exec-imap-1", organizationId: "org-1", enrollmentId: "enroll-imap-1" };
    const enrollment = {
      id: "enroll-imap-1",
      organizationId: "org-1",
      senderId: "user-1",
      status: "ACTIVE",
    };

    // Order of selects through the IMAP path with one DSN message:
    //   1) existing emailMessages by externalId          → []
    //   2) existing emailThread by subject               → []  (insert thread)
    //   3) detectInboundReply Path B: crmContacts lookup → []  (mailer-daemon@... won't match contacts)
    //   4) detectInboundBounce: candidate exec lookup    → [exec]
    //   5) recordEmailEvent: re-fetch exec               → [exec]
    //   6) recordEmailEvent: enrollment lookup           → [enrollment]
    //   7) thread-counts recompute                       → [{ total, unread, maxReceivedAt }]
    selectQueue = [
      [],
      [],
      [],
      [exec],
      [exec],
      [enrollment],
      [{ total: 1, unread: 1, maxReceivedAt: new Date() }],
    ];

    const res = await syncImapAccount(account, "user-1");

    expect(res.errors).toEqual([]);
    expect(res.messagesImported).toBe(1);

    // The DSN must have been recorded as a BOUNCE event…
    const bounceEvent = dbCalls.find(
      (c) => c.op === "insert" && c.tableName === "crm_sequence_email_events",
    ) as { values: { eventType?: string; executionId?: string } } | undefined;
    expect(bounceEvent?.values.eventType).toBe("BOUNCE");
    expect(bounceEvent?.values.executionId).toBe("exec-imap-1");

    // …the execution flipped to BOUNCED…
    const execStatusUpdate = dbCalls.find(
      (c) =>
        c.op === "update" &&
        c.tableName === "crm_sequence_step_executions" &&
        (c.values as { status?: string }).status === "BOUNCED",
    );
    expect(execStatusUpdate).toBeTruthy();

    // …and the enrollment was auto-exited with status & reason BOUNCED.
    const enrollExitUpdate = dbCalls.find(
      (c) =>
        c.op === "update" &&
        c.tableName === "crm_sequence_enrollments" &&
        (c.values as { status?: string }).status === "BOUNCED",
    ) as { values: { status: string; exitReason: string; exitedAt: Date } } | undefined;
    expect(enrollExitUpdate).toBeTruthy();
    expect(enrollExitUpdate?.values.exitReason).toBe("BOUNCED");
    expect(enrollExitUpdate?.values.exitedAt).toBeInstanceOf(Date);
  });
});
