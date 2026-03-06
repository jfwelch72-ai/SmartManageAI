import { Badge } from "@/components/ui/badge";

function getStatusBadgeClass(status: string) {
  const s = (status || "").toUpperCase().replace(/\s+/g, "_");
  if (s === "DRAFT") return "";
  if (["OPEN", "SUBMITTED", "SENT"].includes(s))
    return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
  if (["IN_REVIEW", "UNDER_REVIEW"].includes(s))
    return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
  if (["ANSWERED", "APPROVED", "ACKNOWLEDGED"].includes(s))
    return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  if (["CLOSED", "SUPERSEDED"].includes(s))
    return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
  if (s === "REJECTED")
    return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
  return "";
}

export function StatusBadge({ status }: { status: string }) {
  const cls = getStatusBadgeClass(status);
  return (
    <Badge
      variant={cls ? "outline" : "default"}
      className={cls}
      data-testid={`badge-status-${status}`}
    >
      {(status || "").replace(/_/g, " ")}
    </Badge>
  );
}

export function formatDate(d: string | null | undefined) {
  if (!d) return "N/A";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}

export function parseAttachments(json: unknown): Array<{ name: string; url: string; size?: number }> {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (typeof json === "string") {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
