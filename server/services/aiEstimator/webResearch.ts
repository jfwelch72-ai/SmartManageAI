import { and, eq, gt, sql } from "drizzle-orm";
import crypto from "crypto";
import { db } from "../../db";
import {
  aiEstimatorWebResearchCache,
  type AiEstimatorWebResearchCache,
} from "@shared/schema";
import { logError, logWarn } from "../../utils/logger";

/**
 * Allow-listed domains for the AI Estimator web research tool. Anything
 * not on this list is rejected before fetch. The list is intentionally
 * narrow — public construction-cost references and government data
 * sources only — so prompt-injected URLs cannot exfiltrate content from
 * arbitrary internal endpoints, partner SaaS, or paid-data sites.
 */
export const WEB_RESEARCH_ALLOWLIST: readonly string[] = [
  "bls.gov",
  "data.bls.gov",
  "www.bls.gov",
  "osha.gov",
  "www.osha.gov",
  "epa.gov",
  "www.epa.gov",
  "fhwa.dot.gov",
  "www.fhwa.dot.gov",
  "transportation.gov",
  "www.transportation.gov",
  "census.gov",
  "data.census.gov",
  "www.census.gov",
  "fred.stlouisfed.org",
  "rsmeans.com",
  "www.rsmeans.com",
  "constructionequipment.com",
  "concreteconstruction.net",
  "asphaltpavement.org",
  "www.asphaltpavement.org",
  "www.acppa.org",
];

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_FETCH_BYTES = 256 * 1024;

export class WebResearchDomainBlockedError extends Error {
  constructor(public readonly domain: string) {
    super(`Domain not on AI Estimator web research allow-list: ${domain}`);
    this.name = "WebResearchDomainBlockedError";
  }
}

function urlDomain(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isAllowedDomain(host: string): boolean {
  return WEB_RESEARCH_ALLOWLIST.includes(host.toLowerCase());
}

async function fetchCached(
  organizationId: string,
  url: string,
): Promise<AiEstimatorWebResearchCache | null> {
  const cutoff = new Date(Date.now() - CACHE_TTL_MS);
  const [row] = await db
    .select()
    .from(aiEstimatorWebResearchCache)
    .where(
      and(
        eq(aiEstimatorWebResearchCache.organizationId, organizationId),
        eq(aiEstimatorWebResearchCache.url, url),
        gt(aiEstimatorWebResearchCache.fetchedAt, cutoff),
      ),
    )
    .limit(1);
  return row ?? null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim().slice(0, 200) : null;
}

export interface WebResearchRequest {
  organizationId: string;
  userId: string | null;
  url: string;
  query?: string;
}

export interface WebResearchResult {
  url: string;
  domain: string;
  title: string | null;
  contentSnippet: string;
  fetchedAt: Date;
  cached: boolean;
}

export async function fetchAllowed(
  req: WebResearchRequest,
): Promise<WebResearchResult> {
  const domain = urlDomain(req.url);
  if (!domain) throw new Error("Invalid URL");
  if (!isAllowedDomain(domain)) throw new WebResearchDomainBlockedError(domain);

  const cached = await fetchCached(req.organizationId, req.url);
  if (cached) {
    return {
      url: cached.url,
      domain: cached.domain,
      title: cached.title,
      contentSnippet: cached.contentSnippet,
      fetchedAt: cached.fetchedAt,
      cached: true,
    };
  }

  // Server-side fetch with explicit timeout & size cap.
  let bodyText = "";
  let title: string | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch(req.url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "AI-Estimator/1.0 (+contractor research)" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const reader = resp.body?.getReader();
    if (!reader) throw new Error("No response body");
    const chunks: Uint8Array[] = [];
    let total = 0;
    // Read up to MAX_FETCH_BYTES then abort.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > MAX_FETCH_BYTES) {
          chunks.push(value.subarray(0, MAX_FETCH_BYTES - (total - value.length)));
          try { await reader.cancel(); } catch { /* ignore */ }
          break;
        }
        chunks.push(value);
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const raw = buf.toString("utf8");
    title = extractTitle(raw);
    bodyText = stripHtml(raw).slice(0, 8000);
  } catch (err) {
    logWarn("AI estimator web research fetch failed", {
      url: req.url,
      domain,
      error: String(err),
    });
    throw err;
  }

  const contentHash = crypto.createHash("sha256").update(bodyText).digest("hex");
  const fetchedAt = new Date();
  try {
    await db
      .insert(aiEstimatorWebResearchCache)
      .values({
        organizationId: req.organizationId,
        url: req.url,
        domain,
        query: req.query ?? null,
        title,
        contentSnippet: bodyText,
        contentHash,
        fetchedAt,
        expiresAt: new Date(fetchedAt.getTime() + CACHE_TTL_MS),
        fetchedByUserId: req.userId,
      })
      .onConflictDoUpdate({
        target: [aiEstimatorWebResearchCache.organizationId, aiEstimatorWebResearchCache.url],
        set: {
          domain,
          title,
          contentSnippet: bodyText,
          contentHash,
          fetchedAt,
          expiresAt: new Date(fetchedAt.getTime() + CACHE_TTL_MS),
          fetchedByUserId: req.userId,
        },
      });
  } catch (err) {
    logError("Failed to persist web research cache row", { error: String(err) });
  }
  return { url: req.url, domain, title, contentSnippet: bodyText, fetchedAt, cached: false };
}
