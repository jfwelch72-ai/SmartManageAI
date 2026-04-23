import { Button } from "@/components/ui/button";
import { Check, FileText, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import type { Notification } from "@shared/schema";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDigestRange(
  relatedEntityId: string | null | undefined,
): { startDate: string; endDate: string } {
  const parts = (relatedEntityId ?? "").split("|");
  const startDate = ISO_DATE.test(parts[0] ?? "") ? parts[0] : "";
  const endDate = ISO_DATE.test(parts[1] ?? "") ? parts[1] : "";
  return { startDate, endDate };
}

export function parseDigestMessage(message: string): {
  header: string;
  rows: Array<{ project: string; variant: string; count: string }>;
} {
  const lines = message.split("\n");
  const header = lines[0] ?? "";
  const rows = lines
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => {
      const sepIdx = line.lastIndexOf(": ");
      const left = sepIdx >= 0 ? line.slice(0, sepIdx) : line;
      const count = sepIdx >= 0 ? line.slice(sepIdx + 2) : "";
      const dashIdx = left.lastIndexOf(" — ");
      const project = dashIdx >= 0 ? left.slice(0, dashIdx) : left;
      const variant = dashIdx >= 0 ? left.slice(dashIdx + 3) : "";
      return { project, variant, count };
    });
  return { header, rows };
}

export function CertifiedPayrollDigestItem({
  notification,
  onDismiss,
  isDismissing,
  onView,
  showDismiss = true,
}: {
  notification: Notification;
  onDismiss?: () => void;
  isDismissing?: boolean;
  onView?: () => void;
  showDismiss?: boolean;
}) {
  const { startDate, endDate } = parseDigestRange(notification.relatedEntityId);
  const { header, rows } = parseDigestMessage(notification.message);
  const qs = new URLSearchParams();
  if (startDate) qs.set("startDate", startDate);
  if (endDate) qs.set("endDate", endDate);
  const href = `/payroll/certified-history${qs.toString() ? `?${qs.toString()}` : ""}`;

  return (
    <div
      className="flex items-start gap-3 p-3 rounded-md bg-muted/50 border border-border"
      data-testid={`notification-item-${notification.id}`}
    >
      <FileText className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0 space-y-2">
        <div>
          <p className="text-sm font-medium" data-testid={`text-digest-title-${notification.id}`}>
            {notification.title}
          </p>
          {header && (
            <p
              className="text-xs text-muted-foreground"
              data-testid={`text-digest-header-${notification.id}`}
            >
              {header}
            </p>
          )}
        </div>
        {rows.length > 0 && (
          <div
            className="rounded border border-border overflow-hidden"
            data-testid={`table-digest-breakdown-${notification.id}`}
          >
            <table className="w-full text-xs">
              <thead className="bg-muted/60">
                <tr>
                  <th className="text-left px-2 py-1 font-medium text-muted-foreground uppercase tracking-wide">
                    Project
                  </th>
                  <th className="text-left px-2 py-1 font-medium text-muted-foreground uppercase tracking-wide">
                    Variant
                  </th>
                  <th className="text-right px-2 py-1 font-medium text-muted-foreground uppercase tracking-wide">
                    Reports
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr
                    key={`${notification.id}-row-${idx}`}
                    className="border-t border-border"
                    data-testid={`row-digest-breakdown-${notification.id}-${idx}`}
                  >
                    <td className="px-2 py-1">{r.project}</td>
                    <td className="px-2 py-1 text-muted-foreground">{r.variant}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
          </p>
          <Link href={href} onClick={() => onView?.()}>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              data-testid={`link-digest-history-${notification.id}`}
            >
              <ExternalLink className="w-3 h-3 mr-1" />
              View week
            </Button>
          </Link>
        </div>
      </div>
      {showDismiss && onDismiss && (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={onDismiss}
          disabled={isDismissing}
          data-testid={`button-dismiss-notification-${notification.id}`}
        >
          <Check className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}
