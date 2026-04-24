/**
 * Task #1610 — Helpers for detecting that a freshly-uploaded plan PDF is a
 * revision of an existing plan_documents row. Used by the PlansTab upload
 * flow to auto-prompt the user to carry pins / markups forward via the
 * existing `POST /api/plan-documents/:id/carryover-annotations` endpoint.
 *
 * Kept in a separate module so the matching logic is unit-testable without
 * mounting the (very large) PlansTab component.
 */

export interface PdfDocCandidate {
  id: string;
  title?: string | null;
  fileName?: string | null;
  uploadedAt?: string | null;
}

/**
 * Normalize a document title or file name for revision matching. Strips
 * the file extension, trailing revision-style suffixes (rev2, _v3,
 * "(1)", " - 2024-01-15", etc.), and collapses separators so that
 * "Plan A_Rev1" and "plan-a rev 2" both reduce to "plan a".
 */
export function normalizeDocBaseName(value: string): string {
  let s = value.toLowerCase().trim();
  s = s.replace(/\.[a-z0-9]{1,5}$/i, "");
  // Strip up to 3 trailing revision-like tokens iteratively (handles
  // "PlanA_Rev2 (1)" or "PlanA r3 v4").
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s
      .replace(/[\s._\-(\[]+(?:revision|rev|ver|v|r)[\s._\-]*\d+[\s._\-)\]]*$/i, "")
      .replace(/[\s._\-]+\(?\d{1,4}\)?$/i, "")
      .replace(/[\s._\-]+\d{4}-\d{2}-\d{2}$/i, "")
      .trim();
    if (s === before) break;
  }
  return s.replace(/[\s._\-]+/g, " ").trim();
}

/**
 * Task #1610 — Decide which user-facing toast to show after a batch of
 * `/api/documents` saves completes, given how many succeeded vs failed.
 * Returning `null` means "no toast" (e.g. nothing happened, caller already
 * handled it). Extracted as a pure function so the success / partial-fail /
 * total-fail branches can be unit-tested without mounting PlansTab.
 */
export interface UploadOutcomeToast {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}
export function uploadOutcomeToast(
  savedCount: number,
  failedCount: number,
): UploadOutcomeToast | null {
  if (savedCount === 0 && failedCount === 0) return null;
  if (savedCount === 0) {
    return {
      title: "Error",
      description:
        failedCount === 1
          ? "Failed to save document"
          : `Failed to save ${failedCount} documents`,
      variant: "destructive",
    };
  }
  if (failedCount === 0) {
    if (savedCount === 1) return { title: "Document uploaded" };
    return {
      title: `${savedCount} files uploaded`,
      description: "All documents have been added.",
    };
  }
  return {
    title: `${savedCount} of ${savedCount + failedCount} files uploaded`,
    description: `${failedCount} failed to save.`,
    variant: "destructive",
  };
}

/**
 * Find the most recent existing PDF that the new upload likely supersedes.
 * Matches by normalized title or file name so incidental rev-suffix
 * differences don't prevent the carryover prompt. Returns null when there's
 * no plausible candidate so the prompt stays out of the user's way.
 */
export function findSupersededPdfDoc(
  uploaded: { title: string; fileName: string },
  existingPdfDocs: readonly PdfDocCandidate[],
): PdfDocCandidate | null {
  const normNewTitle = normalizeDocBaseName(uploaded.title || "");
  const normNewFile = normalizeDocBaseName(uploaded.fileName || "");
  if (!normNewTitle && !normNewFile) return null;

  const matches = existingPdfDocs.filter((d) => {
    const t = normalizeDocBaseName(d.title || "");
    const f = normalizeDocBaseName(d.fileName || "");
    if (!t && !f) return false;
    return (
      (normNewTitle && (t === normNewTitle || f === normNewTitle)) ||
      (normNewFile && (t === normNewFile || f === normNewFile))
    );
  });

  if (matches.length === 0) return null;

  // Prefer the most recently uploaded match — that is the most likely
  // "previous revision" the user is replacing.
  const sorted = [...matches].sort((a, b) => {
    const at = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
    const bt = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
    return bt - at;
  });
  return sorted[0];
}
