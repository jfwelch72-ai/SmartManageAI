/**
 * Task #1599: tests for the EXTERNAL_DOC_EMAIL gate and CRM-contact
 * resolution in `server/services/externalDocEmailService.ts`.
 *
 * The intent is to lock in two regression-critical contracts:
 *   1. When the per-org `EXTERNAL_DOC_EMAIL` flag is OFF (default),
 *      `sendExternalDocEmail` is a noop — no portal token is minted
 *      and no email is sent. Callers can therefore call it
 *      unconditionally.
 *   2. When the flag is ON but the recipient email isn't a known CRM
 *      contact in this tenant, the service refuses to email a
 *      stranger and still does not mint a token.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = Record<string, unknown>;

const selectQueueByTable: Record<string, Row[][]> = {};
const insertCalls: Array<{ table: string; values: Record<string, unknown> }> = [];

function tableName(t: unknown): string {
  if (!t || typeof t !== "object") return "<unknown>";
  for (const sym of Object.getOwnPropertySymbols(t)) {
    if (String(sym).includes("Name")) {
      const v = (t as Record<symbol, unknown>)[sym];
      if (typeof v === "string") return v;
    }
  }
  return "<unknown>";
}

function makeSelectChain() {
  let resolvedTable = "<unknown>";
  const chain: Record<string, unknown> = {};
  chain.from = (t: unknown) => { resolvedTable = tableName(t); return chain; };
  chain.where = () => chain;
  chain.innerJoin = () => chain;
  chain.leftJoin = () => chain;
  chain.limit = () => chain;
  chain.orderBy = () => chain;
  const settle = (resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) => {
    try {
      const queue = selectQueueByTable[resolvedTable] ?? [];
      const next = queue.length ? queue.shift()! : [];
      return Promise.resolve(next).then(resolve, reject);
    } catch (err) {
      return reject ? reject(err) : Promise.reject(err);
    }
  };
  chain.then = settle;
  chain.catch = (reject: (e: unknown) => unknown) => settle((v) => v, reject);
  return chain;
}

const dbMock = {
  execute: async () => ({ rows: [] }),
  select: () => makeSelectChain(),
  insert: (t: unknown) => ({
    values: (values: Record<string, unknown>) => ({
      returning: async () => {
        insertCalls.push({ table: tableName(t), values });
        return [{ id: "tok-test" }];
      },
    }),
  }),
  update: () => ({ set: () => ({ where: async () => undefined }) }),
  delete: () => ({ where: async () => undefined }),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

const isFeatureEnabledMock = vi.fn();
vi.mock("../services/featureFlagService", () => ({
  isFeatureEnabled: isFeatureEnabledMock,
}));

const sendEmailMock = vi.fn(async () => undefined);
vi.mock("../services/emailService", () => ({
  sendEmail: sendEmailMock,
}));

vi.mock("../portalAuth", () => ({
  generatePortalToken: () => "raw-token",
  hashPortalToken: async () => "hashed-token",
  // Task #1614 — service now also stamps an indexed lookup hash so
  // requirePortalAuth can resolve tokens in O(1). The unit test mock
  // returns a deterministic stub since these tests don't exercise auth.
  computePortalTokenLookupHash: () => "lookup-hash",
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

let sendExternalDocEmail: typeof import("../services/externalDocEmailService")["sendExternalDocEmail"];

beforeEach(async () => {
  for (const k of Object.keys(selectQueueByTable)) delete selectQueueByTable[k];
  insertCalls.length = 0;
  isFeatureEnabledMock.mockReset();
  sendEmailMock.mockClear();
  ({ sendExternalDocEmail } = await import("../services/externalDocEmailService"));
});

describe("sendExternalDocEmail — EXTERNAL_DOC_EMAIL gating", () => {
  it("is a no-op when the per-org feature flag is OFF", async () => {
    isFeatureEnabledMock.mockResolvedValueOnce(false);

    const result = await sendExternalDocEmail({
      organizationId: "org-1",
      projectId: "proj-1",
      recipientEmail: "ae@example.com",
      documentNumber: "RFI-0001",
      documentSubject: "Conduit routing",
      kind: "RFI_FORWARD",
      inviterId: "user-1",
      inviterName: "PM",
    });

    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("feature_flag_off");
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
  });

  it("refuses to email a stranger (no CRM contact match) even with the flag ON", async () => {
    isFeatureEnabledMock.mockResolvedValueOnce(true);
    // No rows queued for crm_contacts → resolution returns empty.

    const result = await sendExternalDocEmail({
      organizationId: "org-1",
      projectId: "proj-1",
      recipientEmail: "stranger@example.com",
      documentNumber: "RFI-0001",
      documentSubject: "Conduit routing",
      kind: "RFI_FORWARD",
      inviterId: "user-1",
      inviterName: "PM",
    });

    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("no_crm_contact_match");
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
  });

  it("returns missing_email when the recipient is blank", async () => {
    isFeatureEnabledMock.mockResolvedValueOnce(true);

    const result = await sendExternalDocEmail({
      organizationId: "org-1",
      projectId: "proj-1",
      recipientEmail: "",
      documentNumber: "SUB-0001",
      documentSubject: "Liner shop drawings",
      kind: "SUBMITTAL_REVIEW",
      inviterId: null,
      inviterName: null,
    });

    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("missing_email");
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
  });

  it("delivers when flag is ON and CRM contact resolves: mints a token and sends the email", async () => {
    isFeatureEnabledMock.mockResolvedValueOnce(true);
    (selectQueueByTable["crm_contacts"] ??= []).push([
      {
        contactId: "ctc-1",
        contactName: "Pat AE",
        crmOrganisationId: "crm-org-1",
        crmOrgName: "AE Firm",
        crmOrgOrganizationId: "org-1",
      },
    ]);
    (selectQueueByTable["projects"] ??= []).push([{ name: "I-95 Widening" }]);

    const result = await sendExternalDocEmail({
      organizationId: "org-1",
      projectId: "proj-1",
      recipientEmail: "ae@example.com",
      documentNumber: "SUB-0001",
      documentSubject: "Liner shop drawings",
      kind: "SUBMITTAL_REVIEW",
      inviterId: "user-1",
      inviterName: "PM",
    });

    expect(result.delivered).toBe(true);
    expect(result.portalTokenId).toBe("tok-test");
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe("subcontractor_portal_tokens");
    expect(insertCalls[0].values.crmOrganisationId).toBe("crm-org-1");
    expect(insertCalls[0].values.contactEmail).toBe("ae@example.com");
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const arg = (sendEmailMock.mock.calls[0] as unknown[])[0] as { to: string; subject: string; html: string; text: string };
    expect(arg.to).toBe("ae@example.com");
    expect(arg.subject).toContain("SUB-0001");
    expect(arg.subject).toContain("I-95 Widening");
    expect(arg.html).toContain("/sub-portal?token=raw-token");
    expect(arg.text).toContain("/sub-portal?token=raw-token");
  });
});
