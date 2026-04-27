/**
 * Shared helper for the friendlier export-failure toast.
 *
 * Every export button (estimate PDF, SOV, change orders, project vault,
 * punch list, portfolio summary, AIA G702/G703, Gantt …) gates on the
 * same role checks server-side. When that role check fails, callers
 * funnel the response through this helper so users see a tailored 403
 * toast naming the export they lost access to instead of the raw server
 * string. Other non-2xx responses and thrown network errors fall back
 * to the same generic "Couldn't generate <artifact>" wording.
 */

export interface ExportContext {
  /**
   * The artifact being produced, used in the generic toast title.
   * Examples: `"PDF"`, `"Excel workbook"`, `"PDF ZIP"`.
   */
  artifact: string;
  /**
   * The noun describing what kind of export the user lost access to.
   * Used inside the friendlier 403 toast as
   * `"Your role no longer has <subject> export access."`.
   * Examples: `"estimate"`, `"SOV"`, `"change order"`, `"project vault"`.
   */
  subject: string;
}

export interface ExportToastPayload {
  title: string;
  description: string;
  variant: "destructive";
}

const PERMISSION_TITLE = "Export access required";

function permissionToast(subject: string): ExportToastPayload {
  return {
    title: PERMISSION_TITLE,
    description: `Your role no longer has ${subject} export access. Ask an admin to grant it, then try again.`,
    variant: "destructive",
  };
}

function genericToast(artifact: string, message: string): ExportToastPayload {
  // Trim trailing punctuation so we don't end up with `"…boom.. Please try
  // again."` when the server detail already ends in a period.
  const cleaned = message.replace(/[.!?\s]+$/, "");
  return {
    title: `Couldn't generate ${artifact}`,
    description: `${cleaned}. Please try again.`,
    variant: "destructive",
  };
}

async function readJsonErrorDetail(res: Response): Promise<string | undefined> {
  try {
    const body = await res.clone().json();
    if (body && typeof body.error === "string" && body.error.trim()) {
      return body.error.trim();
    }
  } catch {
    /* non-JSON body — fall back to the status code */
  }
  return undefined;
}

/**
 * Build a toast payload for a failed export `Response` (raw `fetch` based
 * call sites). 403 → friendly permission toast naming the export;
 * everything else → the existing generic "Couldn't generate <artifact>"
 * toast with the server-provided detail when available.
 */
export async function getExportResponseErrorToast(
  res: Response,
  ctx: ExportContext,
): Promise<ExportToastPayload> {
  if (res.status === 403) return permissionToast(ctx.subject);
  const detail = await readJsonErrorDetail(res);
  return genericToast(ctx.artifact, detail || `Server responded with ${res.status}`);
}

/**
 * Build a toast payload from an unknown thrown value — typically a network
 * failure inside a catch block, or an `Error` thrown by the shared
 * `apiRequest` helper (which attaches `.status` and `.data` from the
 * response body). Mirrors {@link getExportResponseErrorToast} so callers
 * using either flavour produce the same wording.
 */
export function getExportThrownErrorToast(
  err: unknown,
  ctx: ExportContext,
): ExportToastPayload {
  if (err && typeof err === "object") {
    const e = err as { status?: unknown; message?: unknown };
    if (e.status === 403) return permissionToast(ctx.subject);
    if (typeof e.message === "string") {
      return genericToast(ctx.artifact, e.message);
    }
  }
  return genericToast(ctx.artifact, "Network error");
}
