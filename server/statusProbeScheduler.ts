import cron from "node-cron";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { logInfo, logError } from "./utils/logger";
import { evaluateAlertsAfterSweep } from "./statusAlertService";

type ComponentRow = {
  id: string;
  key: string;
  probe_kind: string;
  probe_url: string | null;
  probe_expect_status: number;
  probe_timeout_ms: number;
};

type ProbeResult = { ok: boolean; statusCode: number | null; responseMs: number; error: string | null };

function selfBaseUrl(): string {
  const explicit = process.env.STATUS_SELF_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const port = process.env.PORT || "5000";
  return `http://127.0.0.1:${port}`;
}

const DEFAULT_PUBLIC_WEB_URL = "https://smartmanageai.ai";

function publicWebUrl(): string {
  const explicit = process.env.STATUS_PUBLIC_WEB_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return DEFAULT_PUBLIC_WEB_URL;
}

function publicWebProbeDisabled(): boolean {
  const v = process.env.STATUS_DISABLE_PUBLIC_WEB_PROBE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function strictHttpProbe(url: string, timeoutMs: number): Promise<ProbeResult> {
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal, redirect: "follow" });
    const ms = Date.now() - start;
    const ok = res.status >= 200 && res.status < 300;
    return {
      ok,
      statusCode: res.status,
      responseMs: ms,
      error: ok ? null : `unexpected status ${res.status}`,
    };
  } catch (err: any) {
    const ms = Date.now() - start;
    const name = err?.name === "AbortError" ? `timeout after ${timeoutMs}ms` : String(err?.message || err);
    return { ok: false, statusCode: null, responseMs: ms, error: name };
  } finally {
    clearTimeout(t);
  }
}

async function publicWebProbe(timeoutMs: number): Promise<ProbeResult> {
  if (publicWebProbeDisabled()) {
    return { ok: true, statusCode: null, responseMs: 0, error: "public web probe disabled via STATUS_DISABLE_PUBLIC_WEB_PROBE" };
  }
  return strictHttpProbe(publicWebUrl(), timeoutMs);
}

async function httpProbe(url: string, expectStatus: number, timeoutMs: number): Promise<ProbeResult> {
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal, redirect: "follow" });
    const ms = Date.now() - start;
    return { ok: res.status === expectStatus || (expectStatus === 200 && res.status >= 200 && res.status < 400), statusCode: res.status, responseMs: ms, error: null };
  } catch (err: any) {
    const ms = Date.now() - start;
    return { ok: false, statusCode: null, responseMs: ms, error: err?.name === "AbortError" ? `timeout after ${timeoutMs}ms` : String(err?.message || err) };
  } finally {
    clearTimeout(t);
  }
}

async function dbPingProbe(): Promise<ProbeResult> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { ok: true, statusCode: null, responseMs: Date.now() - start, error: null };
  } catch (err: any) {
    return { ok: false, statusCode: null, responseMs: Date.now() - start, error: String(err?.message || err) };
  }
}

function configProbe(component: ComponentRow): ProbeResult {
  const start = Date.now();
  let ok = false;
  let error: string | null = null;
  if (component.key === "email") {
    ok = !!process.env.RESEND_API_KEY;
    if (!ok) error = "RESEND_API_KEY not configured";
  } else if (component.key === "ai") {
    // OpenAI is configured via Replit AI Integrations OR explicit key
    ok = !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
    if (!ok) error = "OpenAI integration not detected";
  } else {
    ok = true;
  }
  return { ok, statusCode: null, responseMs: Date.now() - start, error };
}

async function objectStorageProbe(): Promise<ProbeResult> {
  const start = Date.now();
  const configured = !!(process.env.PUBLIC_OBJECT_SEARCH_PATHS || process.env.PRIVATE_OBJECT_DIR || process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID);
  return { ok: configured, statusCode: null, responseMs: Date.now() - start, error: configured ? null : "object storage not configured" };
}

async function probeComponent(c: ComponentRow): Promise<ProbeResult> {
  switch (c.probe_kind) {
    case "http_get":
      if (!c.probe_url) return { ok: false, statusCode: null, responseMs: 0, error: "probe_url not set" };
      return httpProbe(c.probe_url, c.probe_expect_status, c.probe_timeout_ms);
    case "http_self":
      return httpProbe(selfBaseUrl() + "/healthz", 200, c.probe_timeout_ms);
    case "http_public":
      return publicWebProbe(c.probe_timeout_ms);
    case "http_self_health":
      return httpProbe(selfBaseUrl() + "/readyz", 200, c.probe_timeout_ms);
    case "db_ping":
      return dbPingProbe();
    case "object_storage":
      return objectStorageProbe();
    case "config_present":
      return configProbe(c);
    default:
      return { ok: false, statusCode: null, responseMs: 0, error: `unknown probe_kind: ${c.probe_kind}` };
  }
}

export async function runProbeSweep(): Promise<{ probed: number; failures: number }> {
  const rows = await db.execute(sql`
    SELECT id, key, probe_kind, probe_url, probe_expect_status, probe_timeout_ms
    FROM "status_components"
    WHERE enabled = true
    ORDER BY sort_order
  `);
  const components = rows.rows as ComponentRow[];
  let failures = 0;
  for (const c of components) {
    try {
      const result = await probeComponent(c);
      if (!result.ok) failures++;
      await db.execute(sql`
        INSERT INTO "status_probes" (component_id, ok, status_code, response_ms, error)
        VALUES (${c.id}, ${result.ok}, ${result.statusCode}, ${result.responseMs}, ${result.error})
      `);
    } catch (err) {
      failures++;
      logError("Status probe failed", { component: c.key }, err instanceof Error ? err : new Error(String(err)));
    }
  }

  // Prune probe rows older than 35 days to keep table bounded
  await db.execute(sql`DELETE FROM "status_probes" WHERE checked_at < NOW() - INTERVAL '35 days'`);

  // Evaluate alert thresholds and dispatch notifications for any
  // newly-failing or newly-recovered alertable components.
  try {
    await evaluateAlertsAfterSweep();
  } catch (err) {
    logError("Status alert evaluation failed", {}, err instanceof Error ? err : new Error(String(err)));
  }

  return { probed: components.length, failures };
}

let probeTask: ReturnType<typeof cron.schedule> | null = null;

export function startStatusProbeScheduler() {
  if (probeTask) return;
  // Run every minute
  probeTask = cron.schedule("* * * * *", async () => {
    try {
      await runProbeSweep();
    } catch (err) {
      logError("Status probe sweep failed", {}, err instanceof Error ? err : new Error(String(err)));
    }
  });
  // Kick off an initial sweep shortly after startup so the page has data immediately
  setTimeout(() => {
    runProbeSweep().catch((err) => logError("Initial status probe sweep failed", {}, err instanceof Error ? err : new Error(String(err))));
  }, 5_000).unref?.();
  logInfo("Status page probe scheduler started (every 60s)");
}

export function stopStatusProbeScheduler() {
  if (probeTask) {
    probeTask.stop();
    probeTask = null;
  }
}
