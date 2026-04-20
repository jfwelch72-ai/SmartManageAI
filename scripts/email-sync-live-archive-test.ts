/**
 * Live archive push-back verification script
 *
 * Purpose: complete the manual confidence step from Task #545. The mocked unit
 * suite at `server/__tests__/email-provider-pushback.test.ts` proves the
 * shapes of the Gmail / Microsoft Graph requests our push-back code makes.
 * This script proves the same code path against a real sandbox mailbox by:
 *
 *   1. Calling PATCH /api/email/messages/:id with `{ isArchived: true }`
 *      against a running CRM instance (which queues a provider push and
 *      synchronously kicks off `drainMessageProviderPush`).
 *   2. Polling the live Gmail / Microsoft Graph API for the same message
 *      until the INBOX label is removed (Gmail) or the message no longer
 *      lives in the Inbox folder (Outlook), or until a timeout elapses.
 *
 * The script is intentionally read-only against the provider — the only
 * mutation is the PATCH the CRM itself performs.
 *
 * Run:
 *   npx tsx scripts/email-sync-live-archive-test.ts
 *
 * Required environment variables:
 *   PROVIDER                  "gmail" | "outlook"
 *   CRM_BASE_URL              e.g. https://your-crm.example.com (no trailing /)
 *   CRM_SESSION_COOKIE        Full Cookie header value for an authenticated
 *                             CRM session that owns the email account
 *                             (e.g. "connect.sid=s%3A...").
 *   CRM_MESSAGE_ID            UUID of the email_messages row to archive
 *   PROVIDER_ACCESS_TOKEN     OAuth access token for the same mailbox, with
 *                             gmail.modify (Gmail) or Mail.Read (Outlook)
 *                             scope. Used only to verify state.
 *   PROVIDER_MESSAGE_ID       The provider-side id of the same message
 *                             (Gmail message id / Graph message id). This is
 *                             the value stored in `email_messages.external_id`
 *                             (Drizzle column: `externalId`).
 *
 * Optional:
 *   POLL_TIMEOUT_MS           Default 120000 (2 min — matches the cron tick).
 *   POLL_INTERVAL_MS          Default 5000.
 *   CSRF_TOKEN                If your CRM session enforces CSRF on PATCH,
 *                             pass the token; sent as `x-csrf-token` header.
 *
 * Exit code 0 on success (provider confirms message is no longer in INBOX),
 * non-zero on any failure. All steps are logged to stdout so the run can be
 * captured (`npx tsx ... | tee live-archive-<provider>-<date>.log`).
 */

type Provider = "gmail" | "outlook";

interface Config {
  provider: Provider;
  crmBaseUrl: string;
  crmCookie: string;
  crmMessageId: string;
  providerToken: string;
  providerMessageId: string;
  pollTimeoutMs: number;
  pollIntervalMs: number;
  csrfToken?: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    console.error(`Missing required env var: ${name}`);
    process.exit(2);
  }
  return v;
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    console.error(`${name} must be a positive integer (ms), got: ${raw}`);
    process.exit(2);
  }
  return n;
}

function loadConfig(): Config {
  const providerRaw = requireEnv("PROVIDER").toLowerCase();
  if (providerRaw !== "gmail" && providerRaw !== "outlook") {
    console.error(`PROVIDER must be "gmail" or "outlook", got: ${providerRaw}`);
    process.exit(2);
  }
  return {
    provider: providerRaw,
    crmBaseUrl: requireEnv("CRM_BASE_URL").replace(/\/+$/, ""),
    crmCookie: requireEnv("CRM_SESSION_COOKIE"),
    crmMessageId: requireEnv("CRM_MESSAGE_ID"),
    providerToken: requireEnv("PROVIDER_ACCESS_TOKEN"),
    providerMessageId: requireEnv("PROVIDER_MESSAGE_ID"),
    pollTimeoutMs: parsePositiveIntEnv("POLL_TIMEOUT_MS", 120_000),
    pollIntervalMs: parsePositiveIntEnv("POLL_INTERVAL_MS", 5_000),
    csrfToken: process.env.CSRF_TOKEN,
  };
}

function ts(): string {
  return new Date().toISOString();
}

function log(line: string): void {
  console.log(`[${ts()}] ${line}`);
}

async function fetchJson(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  const resp = await fetch(url, init);
  let body: unknown;
  const text = await resp.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: resp.status, body };
}

async function getGmailLabels(cfg: Config): Promise<string[]> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
    cfg.providerMessageId,
  )}?format=minimal`;
  const { status, body } = await fetchJson(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${cfg.providerToken}` },
  });
  if (status !== 200) {
    throw new Error(`Gmail GET message failed: ${status} ${JSON.stringify(body)}`);
  }
  const labels = (body as { labelIds?: string[] }).labelIds ?? [];
  return labels;
}

async function getOutlookFolder(cfg: Config): Promise<string> {
  const url = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(
    cfg.providerMessageId,
  )}?$select=id,parentFolderId,subject`;
  const { status, body } = await fetchJson(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${cfg.providerToken}` },
  });
  if (status !== 200) {
    throw new Error(`Graph GET message failed: ${status} ${JSON.stringify(body)}`);
  }
  return (body as { parentFolderId?: string }).parentFolderId ?? "";
}

async function getOutlookInboxFolderId(cfg: Config): Promise<string> {
  const url = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id`;
  const { status, body } = await fetchJson(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${cfg.providerToken}` },
  });
  if (status !== 200) {
    throw new Error(`Graph GET inbox folder failed: ${status} ${JSON.stringify(body)}`);
  }
  return (body as { id: string }).id;
}

async function patchArchiveInCrm(cfg: Config): Promise<void> {
  const url = `${cfg.crmBaseUrl}/api/email/messages/${encodeURIComponent(cfg.crmMessageId)}`;
  log(`PATCH ${url} { isArchived: true }`);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Cookie: cfg.crmCookie,
  };
  if (cfg.csrfToken) headers["x-csrf-token"] = cfg.csrfToken;
  const { status, body } = await fetchJson(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ isArchived: true }),
  });
  log(`CRM responded status=${status} body=${JSON.stringify(body)}`);
  if (status < 200 || status >= 300) {
    throw new Error(`CRM PATCH did not succeed (status ${status})`);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function verifyGmailArchived(cfg: Config): Promise<void> {
  const before = await getGmailLabels(cfg);
  log(`Gmail labels BEFORE archive: ${JSON.stringify(before)}`);
  if (!before.includes("INBOX")) {
    throw new Error("Pre-condition failed: message is not in INBOX before archive. Pick a fresh INBOX message.");
  }

  await patchArchiveInCrm(cfg);

  const deadline = Date.now() + cfg.pollTimeoutMs;
  let lastLabels: string[] = before;
  while (Date.now() < deadline) {
    await sleep(cfg.pollIntervalMs);
    lastLabels = await getGmailLabels(cfg);
    log(`Gmail labels (poll): ${JSON.stringify(lastLabels)}`);
    if (!lastLabels.includes("INBOX")) {
      log("SUCCESS: Gmail message no longer carries INBOX label.");
      return;
    }
  }
  throw new Error(
    `Timed out after ${cfg.pollTimeoutMs}ms — Gmail still shows INBOX label. Last labels: ${JSON.stringify(lastLabels)}`,
  );
}

async function verifyOutlookArchived(cfg: Config): Promise<void> {
  const inboxId = await getOutlookInboxFolderId(cfg);
  log(`Outlook Inbox folderId: ${inboxId}`);
  const before = await getOutlookFolder(cfg);
  log(`Outlook parentFolderId BEFORE archive: ${before}`);
  if (before !== inboxId) {
    throw new Error("Pre-condition failed: message is not in Inbox before archive. Pick a fresh Inbox message.");
  }

  await patchArchiveInCrm(cfg);

  const deadline = Date.now() + cfg.pollTimeoutMs;
  let lastFolder = before;
  while (Date.now() < deadline) {
    await sleep(cfg.pollIntervalMs);
    lastFolder = await getOutlookFolder(cfg);
    log(`Outlook parentFolderId (poll): ${lastFolder}`);
    if (lastFolder !== inboxId) {
      log("SUCCESS: Outlook message moved out of Inbox.");
      return;
    }
  }
  throw new Error(
    `Timed out after ${cfg.pollTimeoutMs}ms — Outlook message still in Inbox folder ${inboxId}. Last folder: ${lastFolder}`,
  );
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  log(`provider=${cfg.provider} crm=${cfg.crmBaseUrl} crmMessageId=${cfg.crmMessageId} providerMessageId=${cfg.providerMessageId}`);
  if (cfg.provider === "gmail") {
    await verifyGmailArchived(cfg);
  } else {
    await verifyOutlookArchived(cfg);
  }
  log("DONE — archive push-back verified end-to-end against live provider.");
}

main().catch((err) => {
  console.error(`[${ts()}] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
