import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";

interface ReviewSummary {
  totalRows: number;
  approvedRows: number;
  pendingRows: number;
  totalDollars: number;
  approvedDollars: number;
  approvedDollarPct: number;
}

interface BidReviewSummaryChipProps {
  bidId: string;
  bidCode: string;
}

/**
 * Task #2321 — "Reviewed: X/Y" chip rendered next to the bid code in
 * the bid-detail header. Clicks navigate to the org-wide review queue
 * (the focused-on-this-bid filter happens client-side on that page).
 *
 * The chip stays visible at "Reviewed: 0/0" for fresh bids so the
 * affordance is always present — clicking it still surfaces the
 * (org-wide) queue, which is useful when an estimator wants to jump
 * to the queue from the bid context.
 */
export function BidReviewSummaryChip({ bidId, bidCode }: BidReviewSummaryChipProps) {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery<ReviewSummary>({
    queryKey: ["/api/bids", bidId, "takeoff/review-summary"],
    enabled: !!bidId,
  });

  if (isLoading || !data) return null;

  // Tone the chip based on completion state: amber while anything is
  // still pending, green once everyone's signed off, neutral grey for
  // bids that have no measurements yet OR have measurements but no
  // one has requested any review.
  const allApproved = data.totalRows > 0 && data.approvedRows === data.totalRows;
  const hasPending = data.pendingRows > 0;
  const tone = allApproved
    ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200"
    : hasPending
    ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
    : "bg-muted text-muted-foreground";

  return (
    <Badge
      variant="secondary"
      className={`${tone} text-xs cursor-pointer`}
      onClick={() => setLocation(`/takeoff/review-queue?bid=${bidCode}`)}
      data-testid="chip-review-summary"
      title={`${data.approvedRows} of ${data.totalRows} measurements reviewed${data.totalDollars > 0 ? ` (${Math.round(data.approvedDollarPct)}% by dollar value)` : ""}`}
    >
      <ShieldCheck className="w-3 h-3 mr-1" />
      Reviewed: {data.approvedRows}/{data.totalRows}
    </Badge>
  );
}
