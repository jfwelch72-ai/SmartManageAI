/**
 * Task #1768 — Helpers for translating a failed markup-move PATCH
 * response into a user-facing toast description plus the set of markup
 * ids that should be flashed on the canvas.
 *
 * Background:
 *   Task #1759 made batched markup drags fail atomically — if any
 *   sibling PATCH rejects, the whole gesture rolls back and a single
 *   generic toast appears. That toast didn't tell the user *which*
 *   markup or *why*, so a 50-markup selection turned into a black-box
 *   retry: drag again and hope.
 *
 *   #1768 adds structured error responses on the server
 *   (`reason` + `failedMarkupIds`) and these helpers turn those into
 *   short, sentence-cased descriptions like
 *   `"Note: Header" can no longer be moved (it was deleted).`
 *
 * The helpers are intentionally pure so they can be unit-tested without
 * standing up React Query or the workspace.
 */

export type MarkupFailureReason =
  | "not_found"
  | "cross_sheet"
  | "access_denied"
  | "not_owner"
  | "validation"
  | "unknown";

export interface MarkupFailureErrorBody {
  error?: string;
  reason?: string;
  failedMarkupIds?: unknown;
  details?: unknown;
  /**
   * Task #1768 — When a single bulk PATCH trips multiple distinct
   * causes (e.g. some markups belong to a different sheet AND another
   * was authored by someone else), the server returns one entry per
   * reason here so the client can name each cause separately. The
   * legacy single-`reason` + flat `failedMarkupIds` fields remain
   * populated as a backward-compatible union for older clients and
   * for the simple single-reason case.
   */
  failuresByReason?: unknown;
}

export interface MarkupForFailureLabel {
  id: string;
  tool?: string | null;
  text?: string | null;
}

export interface MarkupFailureGroupSummary {
  reason: MarkupFailureReason;
  failedMarkupIds: string[];
  /**
   * The portion of the toast description for this reason — already
   * includes the named markups + the per-reason wording. Joined with
   * the others to form the full toast body.
   */
  sentence: string;
}

export interface MarkupFailureSummary {
  /** Set of markup ids the canvas should flash. May be empty. */
  failedMarkupIds: string[];
  /** Multi-line human-friendly description for the toast body. */
  description: string;
  /** Title for the toast (single short string). */
  title: string;
  /**
   * Dominant reason — the group with the most failed ids, used as a
   * compact single-value label in tests, telemetry, and existing
   * callers that expect a single reason. Multi-reason batches set
   * `groups.length > 1` instead of folding everything into one
   * reason.
   */
  reason: MarkupFailureReason;
  /**
   * One entry per distinct failure reason in the response. A simple
   * single-reason failure produces a length-1 array; a mixed batch
   * (e.g. cross_sheet + not_owner) produces one entry per cause so
   * each can be surfaced separately.
   */
  groups: MarkupFailureGroupSummary[];
}

const TOOL_LABELS: Record<string, string> = {
  ARROW: "Arrow",
  RECTANGLE: "Rectangle",
  CLOUD: "Cloud",
  HIGHLIGHT: "Highlight",
  FREEHAND: "Freehand",
  TEXT: "Text",
};

/**
 * Build a short user-friendly label for a single markup. Prefers the
 * markup's `text` (the only display attribute it carries) and falls
 * back to `<Tool> <id-prefix>` so two RECTANGLE markups with no text
 * can still be distinguished in the toast.
 */
export function describeMarkup(m: MarkupForFailureLabel): string {
  const text = (m.text ?? "").trim();
  if (text) {
    const truncated = text.length > 32 ? `${text.slice(0, 29)}…` : text;
    return `"${truncated}"`;
  }
  const tool = m.tool ? TOOL_LABELS[m.tool] || m.tool : "Markup";
  const idPrefix = (m.id || "").slice(0, 6) || "?";
  return `${tool} ${idPrefix}`;
}

function sanitizeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v === "string" && v.length > 0 && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function reasonPhrase(reason: MarkupFailureReason): string {
  switch (reason) {
    case "not_found":
      return "no longer exists (it was deleted)";
    case "cross_sheet":
      return "belongs to a different sheet";
    case "access_denied":
      return "belongs to another organization";
    case "not_owner":
      return "was created by another user — only its author or a manager can move it";
    case "validation":
      return "could not be saved (the move was rejected by the server's validator)";
    case "unknown":
    default:
      return "could not be moved";
  }
}

function normalizeReason(raw: unknown): MarkupFailureReason {
  if (typeof raw !== "string") return "unknown";
  switch (raw) {
    case "not_found":
    case "cross_sheet":
    case "access_denied":
    case "not_owner":
    case "validation":
      return raw;
    default:
      return "unknown";
  }
}

export interface BuildMarkupFailureSummaryArgs {
  /**
   * The Error thrown by `apiRequest`. Task #1768 attaches the parsed
   * JSON body to `error.data` and the HTTP status to `error.status`;
   * the helper falls back gracefully when either is missing (older
   * responses, network failures, etc.).
   */
  error: unknown;
  /**
   * The markup ids the user *attempted* to move. Used as a fallback
   * `failedMarkupIds` set when the server response doesn't enumerate
   * one (e.g. a 500 with no body) so the toast can still tell the user
   * how big the failed batch was.
   */
  attemptedMarkupIds: string[];
  /**
   * The markups currently in the cache. Used to render human labels
   * like `"Note: Header"` instead of a raw uuid.
   */
  markups: MarkupForFailureLabel[];
}

const MAX_NAMED_PER_REASON = 3;

interface ParsedFailureGroup {
  reason: MarkupFailureReason;
  failedMarkupIds: string[];
}

/**
 * Pull the per-reason failure groups out of a server response. The
 * server may send either:
 *   - the multi-reason shape (`failuresByReason: [{ reason, failedMarkupIds }]`),
 *   - or the legacy single-reason shape (`reason` + flat
 *     `failedMarkupIds`),
 *   - or nothing structured at all (network failure / 500).
 * Returns `[]` when no structured reason is present so the caller
 * can take the unknown-reason fallback path.
 */
function parseFailureGroups(
  data: MarkupFailureErrorBody | undefined,
): ParsedFailureGroup[] {
  const raw = data?.failuresByReason;
  if (Array.isArray(raw)) {
    const out: ParsedFailureGroup[] = [];
    const seen = new Set<MarkupFailureReason>();
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const reason = normalizeReason((entry as { reason?: unknown }).reason);
      if (reason === "unknown") continue;
      const ids = sanitizeIds((entry as { failedMarkupIds?: unknown }).failedMarkupIds);
      if (ids.length === 0) continue;
      if (seen.has(reason)) {
        // Defensive: if the server sends the same reason twice,
        // merge the id lists rather than rendering a duplicate
        // sentence.
        const existing = out.find((g) => g.reason === reason)!;
        for (const id of ids) {
          if (!existing.failedMarkupIds.includes(id)) {
            existing.failedMarkupIds.push(id);
          }
        }
        continue;
      }
      seen.add(reason);
      out.push({ reason, failedMarkupIds: ids });
    }
    if (out.length > 0) return out;
  }
  // Legacy single-reason shape.
  const reason = normalizeReason(data?.reason);
  if (reason === "unknown") return [];
  const ids = sanitizeIds(data?.failedMarkupIds);
  if (ids.length === 0) return [];
  return [{ reason, failedMarkupIds: ids }];
}

function buildGroupSentence(
  group: ParsedFailureGroup,
  byId: Map<string, MarkupForFailureLabel>,
): MarkupFailureGroupSummary {
  const named: string[] = [];
  for (const id of group.failedMarkupIds.slice(0, MAX_NAMED_PER_REASON)) {
    const m = byId.get(id);
    named.push(m ? describeMarkup(m) : `markup ${id.slice(0, 6)}`);
  }
  const overflow = group.failedMarkupIds.length - named.length;
  const subjectVerb = group.failedMarkupIds.length > 1 ? "markups" : "markup";
  const namedClause = named.length > 0
    ? `${named.join(", ")}${overflow > 0 ? ` and ${overflow} more` : ""}`
    : `${group.failedMarkupIds.length} ${subjectVerb}`;
  const phrase = reasonPhrase(group.reason);
  return {
    reason: group.reason,
    failedMarkupIds: group.failedMarkupIds,
    sentence: `${namedClause} ${phrase}.`,
  };
}

/**
 * Translate a failed-move error response into the toast title +
 * description plus the set of markup ids the canvas should flash.
 *
 * Naming budget: at most `MAX_NAMED_PER_REASON` markups are named in
 * the toast per failure reason; everything beyond that collapses into
 * `"and N more"` so a 50-markup batch doesn't paste a wall of text
 * into the toast.
 *
 * Mixed-reason batches (Task #1768): when the server returns
 * `failuresByReason` with several entries, each entry contributes its
 * own sentence to the toast description so the user sees every cause
 * (e.g. "Rectangle abc1 belongs to a different sheet. Arrow def2 was
 * created by another user…") instead of only the first one.
 */
export function buildMarkupFailureSummary(
  args: BuildMarkupFailureSummaryArgs,
): MarkupFailureSummary {
  const { error, attemptedMarkupIds, markups } = args;
  const data: MarkupFailureErrorBody | undefined =
    error && typeof error === "object" && "data" in error
      ? ((error as { data?: MarkupFailureErrorBody }).data ?? undefined)
      : undefined;
  const status = error && typeof error === "object" && "status" in error
    ? (error as { status?: number }).status
    : undefined;
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");

  const byId = new Map(markups.map((m) => [m.id, m]));
  const parsedGroups = parseFailureGroups(data);

  // No structured reason → fall back to the server's raw message so
  // network/500 errors still surface something useful instead of the
  // old generic "Failed to update markups".
  if (parsedGroups.length === 0) {
    const reportedIds = sanitizeIds(data?.failedMarkupIds);
    const failedIds = reportedIds.length > 0 ? reportedIds : attemptedMarkupIds.slice();
    const named: string[] = [];
    for (const id of failedIds.slice(0, MAX_NAMED_PER_REASON)) {
      const m = byId.get(id);
      named.push(m ? describeMarkup(m) : `markup ${id.slice(0, 6)}`);
    }
    const overflow = failedIds.length - named.length;
    const baseMessage = data?.error || message || "The move was rejected by the server.";
    const namedSuffix = named.length > 0
      ? ` Affected: ${named.join(", ")}${overflow > 0 ? ` and ${overflow} more` : ""}.`
      : "";
    const title = failedIds.length > 1
      ? `${failedIds.length} markups could not be moved`
      : "Markup could not be moved";
    return {
      failedMarkupIds: failedIds,
      title,
      description: `${baseMessage}${namedSuffix} Your changes were rolled back${
        typeof status === "number" ? ` (HTTP ${status})` : ""
      }.`,
      reason: "unknown",
      groups: [],
    };
  }

  const groups = parsedGroups.map((g) => buildGroupSentence(g, byId));

  // Union of every failed id across reasons — used to flash the
  // canvas and as the legacy flat `failedMarkupIds` field. A single
  // markup that hit multiple reasons is only flashed once.
  const failedIdsSet = new Set<string>();
  for (const g of groups) {
    for (const id of g.failedMarkupIds) failedIdsSet.add(id);
  }
  const failedIds = Array.from(failedIdsSet);

  const title = failedIds.length > 1
    ? `${failedIds.length} markups could not be moved`
    : "Markup could not be moved";

  // Dominant reason for callers that still expect a single value
  // (the group with the most failed ids; ties favour the earlier
  // group, which is the order the server emits).
  const dominant = groups.reduce((acc, g) =>
    g.failedMarkupIds.length > acc.failedMarkupIds.length ? g : acc,
  );

  // Multi-reason batches join sentences with a space; single-reason
  // batches keep the original phrasing for backward compatibility
  // with existing toast wording.
  const description = groups.length > 1
    ? `${groups.map((g) => g.sentence).join(" ")} Your changes were rolled back — try moving the remaining markups separately.`
    : `${groups[0].sentence.replace(/\.$/, "")}. Your changes were rolled back — try moving the remaining markups separately.`;

  return {
    failedMarkupIds: failedIds,
    title,
    description,
    reason: dominant.reason,
    groups,
  };
}
