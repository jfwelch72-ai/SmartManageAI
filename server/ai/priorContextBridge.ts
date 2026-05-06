/**
 * Task #2423 — OpenAI → Claude prior-context bridge.
 *
 * When the Takeoff/Estimation family of features is split across multiple
 * sequential AI calls (trade discovery → scope prediction → estimate analyze →
 * vendor pricing analysis → project health, etc.), each call site previously
 * had no awareness of what the other calls produced. With Claude becoming the
 * primary orchestrator under `AI_PROVIDER_TAKEOFF`, we want Claude to read the
 * trail of prior outputs (including responses that originated on OpenAI before
 * the flag was flipped, or fallback'd to OpenAI mid-conversation) so it can
 * stay coherent across the whole estimating session.
 *
 * This module is an in-memory ring per (orgId, scopeId). It does NOT persist —
 * the bridge is best-effort hot context, not a system of record. The audit
 * row in `ai_action_audit` remains the source of truth for what the model
 * actually saw vs. produced on a per-call basis.
 *
 * Scope key:
 *   `${orgId}|${scopeId ?? ''}`
 *
 * Lifecycle:
 *   - capture(...) is called by `routedChatCompletion` on every successful
 *     response (regardless of provider). Calls without a `priorContext`
 *     option are not captured (org-wide noise is too lossy to be useful).
 *   - buildSystemMessage(...) is called by `routedChatCompletion` BEFORE the
 *     wire call when the resolved provider is Anthropic. The returned text
 *     is prepended as a system message so Claude sees the trail.
 */

import type { TakeoffFeatureKey } from "./types";

export interface PriorContextScope {
  /** Required — multi-tenant boundary. */
  orgId: string;
  /**
   * Caller-defined extra dimension, e.g. `project:${id}` or `bid:${id}` or
   * `estimate:${id}`. Two call sites that share an orgId AND scopeId share
   * the same prior-context ring; everything else is isolated.
   */
  scopeId?: string;
}

interface PriorContextEntry {
  featureKey: TakeoffFeatureKey;
  provider: string;
  model: string;
  /** Truncated assistant content (≤PER_ENTRY_CHARS). */
  summary: string;
  at: number;
}

interface Bucket {
  entries: PriorContextEntry[];
  lastTouched: number;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES_PER_KEY = 5;
const PER_ENTRY_CHARS = 600;
const MAX_BUCKETS = 1024; // soft cap; we evict oldest when exceeded

const buckets = new Map<string, Bucket>();

function bucketKey(scope: PriorContextScope): string {
  return `${scope.orgId}|${scope.scopeId ?? ""}`;
}

function pruneExpired(now: number): void {
  for (const [k, b] of buckets) {
    if (now - b.lastTouched > TTL_MS) buckets.delete(k);
  }
  if (buckets.size > MAX_BUCKETS) {
    // Drop the oldest ~10% — cheap, bounded, doesn't need a heap.
    const sorted = [...buckets.entries()].sort(
      (a, b) => a[1].lastTouched - b[1].lastTouched,
    );
    const drop = Math.max(1, Math.floor(sorted.length / 10));
    for (let i = 0; i < drop; i++) buckets.delete(sorted[i][0]);
  }
}

/**
 * Record a successful AI response under the given scope. The summary is the
 * truncated assistant text — for JSON-mode calls this is the raw JSON, which
 * is exactly what we want Claude to be able to refer back to.
 */
export function capturePriorContext(args: {
  scope: PriorContextScope;
  featureKey: TakeoffFeatureKey;
  provider: string;
  model: string;
  responseText: string | null;
}): void {
  const text = (args.responseText || "").trim();
  if (!text) return;

  const now = Date.now();
  pruneExpired(now);

  const key = bucketKey(args.scope);
  const summary = text.length > PER_ENTRY_CHARS
    ? text.slice(0, PER_ENTRY_CHARS) + "…"
    : text;

  const bucket = buckets.get(key) ?? { entries: [], lastTouched: now };
  bucket.entries.push({
    featureKey: args.featureKey,
    provider: args.provider,
    model: args.model,
    summary,
    at: now,
  });
  // Keep only the newest MAX_ENTRIES_PER_KEY entries.
  if (bucket.entries.length > MAX_ENTRIES_PER_KEY) {
    bucket.entries.splice(0, bucket.entries.length - MAX_ENTRIES_PER_KEY);
  }
  bucket.lastTouched = now;
  buckets.set(key, bucket);
}

/**
 * Build a system-prompt section that exposes the prior-context trail so
 * Claude can orchestrate with awareness of OpenAI's earlier outputs (and its
 * own earlier outputs from sibling features). Returns null when there's no
 * prior context for the scope, so the caller can skip injection cleanly.
 */
export function buildPriorContextSystemMessage(
  scope: PriorContextScope,
): string | null {
  const now = Date.now();
  const key = bucketKey(scope);
  const bucket = buckets.get(key);
  if (!bucket) return null;
  if (now - bucket.lastTouched > TTL_MS) {
    buckets.delete(key);
    return null;
  }
  const fresh = bucket.entries.filter((e) => now - e.at <= TTL_MS);
  if (fresh.length === 0) return null;

  const blocks = fresh.map((e, i) => {
    const ageMin = Math.round((now - e.at) / 60000);
    return `[${i + 1}] ${e.featureKey} via ${e.provider}/${e.model} (${ageMin}m ago):\n${e.summary}`;
  });

  return [
    "PRIOR ESTIMATION CONTEXT (read-only; produced by sibling AI features in this session):",
    ...blocks,
    "Use the above as background. Do not repeat it verbatim — synthesize and build on it.",
  ].join("\n\n");
}

/** Test-only — clears the in-memory ring. */
export function _resetPriorContextBridgeForTests(): void {
  buckets.clear();
}

/** Test-only — peek at a scope's current entries. */
export function _peekPriorContextForTests(
  scope: PriorContextScope,
): PriorContextEntry[] {
  return buckets.get(bucketKey(scope))?.entries.slice() ?? [];
}
