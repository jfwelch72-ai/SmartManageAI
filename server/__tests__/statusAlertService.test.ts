/**
 * Task #836 — tests for the status-page alert engine.
 *
 * Mocks the DB and email transport so we can exercise threshold,
 * recovery, dedupe, and webhook fan-out without real network calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

type Probe = { ok: boolean; error: string | null; checked_at: Date };
type AlertStateRow = {
  component_id: string;
  is_alerting: boolean;
  consecutive_failures: number;
  opened_at: Date | null;
  last_alert_sent_at: Date | null;
  last_recovery_sent_at: Date | null;
  last_error: string | null;
};

const COMPONENT = { id: "comp-web", key: "web", name: "Web application" };

let probes: Probe[];
let storedAlertState: AlertStateRow | null;
let webhookCalls: Array<{ url: string; body: any }>;

const sendEmailMock = vi.fn(async () => true);

function fragmentText(query: any): string {
  // Drizzle's sql template builds an SQL object whose internal query chunks
  // we can extract for routing. We don't need the parameter values to
  // identify which logical query is being run — only the fragment text.
  const queue: any[] = [];
  const visit = (v: any) => {
    if (!v) return;
    if (Array.isArray(v)) return v.forEach(visit);
    if (typeof v === "string") queue.push(v);
    if (typeof v === "object") {
      if (Array.isArray(v.queryChunks)) v.queryChunks.forEach(visit);
      if (typeof v.value === "string") queue.push(v.value);
      if (Array.isArray(v.value)) v.value.forEach(visit);
    }
  };
  visit(query);
  return queue.join(" ").toLowerCase();
}

function dbExecuteMock(query: any) {
  const text = fragmentText(query);

  if (text.includes('"status_components"') && text.includes("enabled = true") && text.includes("lower(key)")) {
    return Promise.resolve({ rows: [COMPONENT] });
  }
  if (text.includes('"status_probes"') && text.includes("order by checked_at desc")) {
    return Promise.resolve({ rows: probes });
  }
  if (text.includes('"status_alert_state"') && text.includes("select")) {
    return Promise.resolve({ rows: storedAlertState ? [storedAlertState] : [] });
  }
  if (text.includes('"status_alert_state"') && text.includes("insert")) {
    // Capture upsert by reading parameter values from queryChunks.
    // Drizzle wraps params as boxed primitives (String/Boolean/Number) or
    // raw values (Date/null), interleaved with StringChunk segments.
    const chunks: any[] = (query as any).queryChunks || [];
    const paramValues = chunks
      .filter((c) => c?.constructor?.name !== "StringChunk")
      .map((c) => {
        if (c == null) return null;
        if (c instanceof Date) return c;
        if (typeof c === "object" && typeof c.valueOf === "function") return c.valueOf();
        return c;
      });
    const [
      componentId,
      isAlerting,
      consecutiveFailures,
      openedAt,
      lastAlertSentAt,
      lastRecoverySentAt,
      lastError,
    ] = paramValues;
    storedAlertState = {
      component_id: componentId,
      is_alerting: !!isAlerting,
      consecutive_failures: Number(consecutiveFailures) || 0,
      opened_at: openedAt ?? null,
      last_alert_sent_at: lastAlertSentAt ?? null,
      last_recovery_sent_at: lastRecoverySentAt ?? null,
      last_error: lastError ?? null,
    };
    return Promise.resolve({ rows: [] });
  }
  return Promise.resolve({ rows: [] });
}

vi.mock("../db", () => ({
  db: { execute: vi.fn(dbExecuteMock) },
  pool: {},
}));

vi.mock("../services/emailService", () => ({
  sendEmail: (opts: unknown) => {
    const fn = sendEmailMock as (o: unknown) => unknown;
    return fn(opts);
  },
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  probes = [];
  storedAlertState = null;
  webhookCalls = [];
  sendEmailMock.mockClear();
  process.env = {
    ...ORIGINAL_ENV,
    STATUS_ALERT_EMAILS: "ops@example.com,oncall@example.com",
    STATUS_ALERT_THRESHOLD: "3",
    STATUS_ALERT_COMPONENT_KEYS: "web",
    STATUS_ALERT_DISABLED: "0",
    STATUS_ALERT_REPEAT_HOURS: "0",
    STATUS_ALERT_WEBHOOK_URL: "https://example.com/hook",
    PUBLIC_APP_URL: "https://smartmanageai.ai",
  };
  (global as any).fetch = vi.fn(async (url: string, init?: any) => {
    webhookCalls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return new Response(null, { status: 200 });
  });
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

function failingProbes(n: number, baseTime = Date.now()): Probe[] {
  return Array.from({ length: n }, (_, i) => ({
    ok: false,
    error: `unexpected status 503`,
    checked_at: new Date(baseTime - i * 60_000),
  }));
}

describe("status alert engine", () => {
  it("getAlertConfig parses env vars correctly", async () => {
    const { getAlertConfig } = await import("../statusAlertService");
    const cfg = getAlertConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.threshold).toBe(3);
    expect(cfg.componentKeys).toEqual(["web"]);
    expect(cfg.emails).toEqual(["ops@example.com", "oncall@example.com"]);
    expect(cfg.webhookUrl).toBe("https://example.com/hook");
  });

  it("does NOT alert on a single failure (below threshold)", async () => {
    probes = failingProbes(1);
    const { evaluateAlertsAfterSweep } = await import("../statusAlertService");
    const result = await evaluateAlertsAfterSweep();
    expect(result.opened).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(webhookCalls.length).toBe(0);
  });

  it("opens an alert and sends email + webhook after N consecutive failures", async () => {
    probes = failingProbes(3);
    const { evaluateAlertsAfterSweep } = await import("../statusAlertService");
    const result = await evaluateAlertsAfterSweep();
    expect(result.opened).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    const subjects = sendEmailMock.mock.calls.map((c: any) => c[0].subject);
    expect(subjects[0]).toContain("DOWN");
    expect(webhookCalls.length).toBe(1);
    expect(webhookCalls[0].body.type).toBe("status.down");
    expect(storedAlertState?.is_alerting).toBe(true);
  });

  it("does not re-alert once already alerting (dedup)", async () => {
    probes = failingProbes(3);
    storedAlertState = {
      component_id: COMPONENT.id,
      is_alerting: true,
      consecutive_failures: 5,
      opened_at: new Date(Date.now() - 600_000),
      last_alert_sent_at: new Date(Date.now() - 60_000),
      last_recovery_sent_at: null,
      last_error: "503",
    };
    const { evaluateAlertsAfterSweep } = await import("../statusAlertService");
    const result = await evaluateAlertsAfterSweep();
    expect(result.opened).toBe(0);
    expect(result.repeated).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(webhookCalls.length).toBe(0);
  });

  it("sends a recovery notification when latest probe is OK after an open alert", async () => {
    probes = [
      { ok: true, error: null, checked_at: new Date() },
      { ok: false, error: "503", checked_at: new Date(Date.now() - 60_000) },
      { ok: false, error: "503", checked_at: new Date(Date.now() - 120_000) },
    ];
    storedAlertState = {
      component_id: COMPONENT.id,
      is_alerting: true,
      consecutive_failures: 3,
      opened_at: new Date(Date.now() - 600_000),
      last_alert_sent_at: new Date(Date.now() - 300_000),
      last_recovery_sent_at: null,
      last_error: "503",
    };
    const { evaluateAlertsAfterSweep } = await import("../statusAlertService");
    const result = await evaluateAlertsAfterSweep();
    expect(result.recovered).toBe(1);
    const subjects = sendEmailMock.mock.calls.map((c: any) => c[0].subject);
    expect(subjects[0]).toContain("RECOVERED");
    expect(webhookCalls[0].body.type).toBe("status.recovered");
    expect(storedAlertState?.is_alerting).toBe(false);
  });

  it("re-notifies when STATUS_ALERT_REPEAT_HOURS has elapsed and component is still down", async () => {
    process.env.STATUS_ALERT_REPEAT_HOURS = "1";
    probes = failingProbes(3);
    storedAlertState = {
      component_id: COMPONENT.id,
      is_alerting: true,
      consecutive_failures: 10,
      opened_at: new Date(Date.now() - 7_200_000),
      last_alert_sent_at: new Date(Date.now() - 3_700_000),
      last_recovery_sent_at: null,
      last_error: "503",
    };
    const { evaluateAlertsAfterSweep } = await import("../statusAlertService");
    const result = await evaluateAlertsAfterSweep();
    expect(result.repeated).toBe(1);
    const subjects = sendEmailMock.mock.calls.map((c: any) => c[0].subject);
    expect(subjects[0]).toContain("STILL DOWN");
  });

  it("disables alerting when no recipients are configured", async () => {
    process.env.STATUS_ALERT_EMAILS = "";
    process.env.STATUS_ALERT_WEBHOOK_URL = "";
    probes = failingProbes(3);
    const { evaluateAlertsAfterSweep, getAlertConfig } = await import("../statusAlertService");
    expect(getAlertConfig().enabled).toBe(false);
    const result = await evaluateAlertsAfterSweep();
    expect(result.opened).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("sendTestAlert dispatches to all configured channels", async () => {
    const { sendTestAlert } = await import("../statusAlertService");
    const result = await sendTestAlert("web");
    expect(result.ok).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(webhookCalls[0].body.type).toBe("status.test");
  });
});
