import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const STREAM_URL = `${BASE_URL}/api/admin/dev/email-outbox/stream`;

export interface CapturedEmail {
  to: string[];
  from: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  source: "sendgrid" | "smtp";
  capturedAt: string;
}

export type EmailMatcher = (email: CapturedEmail) => boolean;

interface WaitOptions {
  /** Hard timeout in ms; defaults to 15s. */
  timeoutMs?: number;
  /**
   * If true (default) the snapshot delivered on connection is searched
   * before waiting for new captures. Set false to only match emails
   * captured AFTER the subscription opened.
   */
  includeSnapshot?: boolean;
}

/**
 * Subscribe to the test email outbox SSE stream and resolve with the
 * first captured email matching `matcher`. Cookies from the supplied
 * Page or BrowserContext are forwarded so the SUPER_ADMIN session is
 * preserved through the request.
 *
 * Intended for e2e tests running against `EMAIL_TRANSPORT=noop`. The
 * function rejects if no match arrives before `timeoutMs`. Uses the
 * Node global fetch (Node 18+) so the response body can be consumed as
 * a stream — Playwright's APIRequestContext buffers responses and so
 * cannot tail an open SSE connection.
 */
export async function waitForCapturedEmail(
  source: Page | BrowserContext | APIRequestContext,
  matcher: EmailMatcher,
  options: WaitOptions = {},
): Promise<CapturedEmail> {
  const { timeoutMs = 15_000, includeSnapshot = true } = options;
  const cookieHeader = await buildCookieHeader(source);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(STREAM_URL, {
      method: "GET",
      headers: {
        accept: "text/event-stream",
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(
      `waitForCapturedEmail: failed to open stream — ${(err as Error).message}`,
    );
  }

  if (!response.ok || !response.body) {
    clearTimeout(timer);
    throw new Error(
      `waitForCapturedEmail: stream request failed (${response.status})`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separatorIdx: number;
      while ((separatorIdx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, separatorIdx);
        buffer = buffer.slice(separatorIdx + 2);
        const parsed = parseSseBlock(block);
        if (!parsed) continue;
        const hit = matchBlock(parsed.event, parsed.data, includeSnapshot, matcher);
        if (hit) {
          clearTimeout(timer);
          controller.abort();
          return hit;
        }
      }
    }
    throw new Error("waitForCapturedEmail: stream closed before a match arrived");
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(
        `waitForCapturedEmail: no matching email within ${timeoutMs}ms`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  if (!block.trim() || block.startsWith(":")) return null;
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

function matchBlock(
  event: string,
  data: string,
  includeSnapshot: boolean,
  matcher: EmailMatcher,
): CapturedEmail | null {
  if (event === "snapshot" && includeSnapshot) {
    try {
      const payload = JSON.parse(data) as { messages: CapturedEmail[] };
      return payload.messages.find(matcher) ?? null;
    } catch {
      return null;
    }
  }
  if (event === "captured") {
    try {
      const email = JSON.parse(data) as CapturedEmail;
      return matcher(email) ? email : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function buildCookieHeader(
  source: Page | BrowserContext | APIRequestContext,
): Promise<string | undefined> {
  if ("context" in source && typeof (source as Page).context === "function") {
    const cookies = await (source as Page).context().cookies();
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ") || undefined;
  }
  if ("cookies" in source && typeof (source as BrowserContext).cookies === "function") {
    const cookies = await (source as BrowserContext).cookies();
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ") || undefined;
  }
  const state = await (source as APIRequestContext).storageState();
  return state.cookies.map((c) => `${c.name}=${c.value}`).join("; ") || undefined;
}
