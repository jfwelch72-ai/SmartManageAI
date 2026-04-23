import { useQuery } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import type { SuppressedFailuresResponse } from "@/components/integrations/types";

/**
 * Task #1402 — Mirrors the integrations-page suppressed-failures panel
 * onto the project payroll page so PMs running payroll see the same
 * real-time signal that admins see on the Davis-Bacon connection card,
 * without having to click over to the integrations page.
 *
 * The same `/api/integrations/davis-bacon/suppressed-failures` endpoint
 * powers both surfaces. This banner aggregates across all of the org's
 * Davis-Bacon connections (PMs typically don't care which connection
 * absorbed the alert — only that wage-decision refreshes are silently
 * failing for some decision they're about to certify against).
 *
 * Auto-clears as soon as the next successful sync resolves the streak
 * because the underlying query refetches every 30s and the API stops
 * returning the item once the streak ends.
 */
export function SuppressedWageDecisionsBanner() {
  const { data } = useQuery<SuppressedFailuresResponse>({
    queryKey: ["/api/integrations/davis-bacon/suppressed-failures"],
    refetchInterval: 30_000,
  });

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  const totalSuppressed = items.reduce((acc, i) => acc + i.suppressedCount, 0);
  const earliestSince = items.reduce<number | null>((acc, i) => {
    const ts = i.suppressedSince ?? i.lastNotifiedAt;
    if (!ts) return acc;
    if (acc === null || ts < acc) return ts;
    return acc;
  }, null);

  return (
    <div
      className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 px-3 py-2 text-xs space-y-1.5"
      data-testid="banner-payroll-suppressed-wage-decisions"
    >
      <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 font-medium">
        <BellRing className="h-3.5 w-3.5 shrink-0" />
        <span data-testid="text-payroll-suppressed-summary">
          {totalSuppressed === 1
            ? "1 wage-decision sync failure suppressed"
            : `${totalSuppressed} wage-decision sync failures suppressed`}
          {earliestSince ? ` since ${new Date(earliestSince).toLocaleString()}` : ""}
        </span>
      </div>
      <ul className="space-y-0.5 text-amber-700 dark:text-amber-400">
        {items.map((i) => {
          const since = i.suppressedSince ?? i.lastNotifiedAt;
          return (
            <li
              key={`${i.connectionId}-${i.decisionNumber}`}
              className="flex items-center justify-between gap-2"
              data-testid={`row-payroll-suppressed-${i.decisionNumber}`}
            >
              <span className="font-mono truncate">{i.decisionNumber}</span>
              <span className="shrink-0">
                <span data-testid={`text-payroll-suppressed-count-${i.decisionNumber}`}>
                  {i.suppressedCount}
                </span>
                {since ? (
                  <>
                    {" since "}
                    <span data-testid={`text-payroll-suppressed-since-${i.decisionNumber}`}>
                      {new Date(since).toLocaleString()}
                    </span>
                  </>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
