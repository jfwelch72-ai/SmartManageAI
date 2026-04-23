import { Badge } from "@/components/ui/badge";
import { PayItemMatchReasonChips } from "@/components/dot/PayItemMatchReasonChips";
import { CheckCircle2, History, Tag, Building2, Sparkles, ThumbsDown } from "lucide-react";

export interface MatchExplainSuggestion {
  payItem: {
    id: string;
    itemNumber: string;
    description: string;
    unit: string;
    specSection: string | null;
    category: string | null;
  };
  agency: { id: string; code: string; name: string };
  specBook: { id: string; edition: string };
  score: number;
  matchReason: "alias" | "history" | "fuzzy";
  aliasText: string | null;
  matchedTokens: string[];
  historyAccepts?: number;
  historyRejects?: number;
  agencyAccepts?: number;
  orgAffinityAccepts?: number;
}

interface Props {
  suggestion: MatchExplainSuggestion;
  seedDescription: string;
  seedUnit?: string | null;
  testIdPrefix: string;
}

/**
 * Detailed breakdown of every signal that contributed to a pay-item suggestion.
 * Designed to live inside a HoverCard or Popover so estimators can audit a
 * surprising suggestion without leaving the import dialog.
 */
export function PayItemMatchExplain({
  suggestion,
  seedDescription,
  seedUnit,
  testIdPrefix,
}: Props) {
  const accepts = suggestion.historyAccepts ?? 0;
  const rejects = suggestion.historyRejects ?? 0;
  const agencyAccepts = suggestion.agencyAccepts ?? 0;
  const orgAccepts = suggestion.orgAffinityAccepts ?? 0;
  const reason = suggestion.matchReason;
  const reasonLabel =
    reason === "alias"
      ? "Alias override"
      : reason === "history"
        ? "Learned from your team's prior accepts"
        : "Fuzzy text similarity";

  return (
    <div
      className="space-y-3 text-sm"
      data-testid={`explain-${testIdPrefix}`}
    >
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="font-mono text-xs font-semibold"
            data-testid={`explain-item-number-${testIdPrefix}`}
          >
            {suggestion.payItem.itemNumber}
          </span>
          <Badge variant="outline" className="text-[10px]">
            {suggestion.payItem.unit}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            {suggestion.agency.code} · {suggestion.specBook.edition}
          </Badge>
          <span className="ml-auto flex items-center gap-1 text-xs">
            <CheckCircle2
              className={
                suggestion.score >= 0.7
                  ? "h-3.5 w-3.5 text-green-600"
                  : suggestion.score >= 0.4
                    ? "h-3.5 w-3.5 text-amber-500"
                    : "h-3.5 w-3.5 text-muted-foreground"
              }
            />
            <span
              className="tabular-nums"
              data-testid={`explain-score-${testIdPrefix}`}
            >
              {(suggestion.score * 100).toFixed(0)}%
            </span>
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
          {suggestion.payItem.description}
        </div>
      </div>

      <div>
        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
          Why we suggested this
        </div>
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span
            className="text-xs"
            data-testid={`explain-reason-${testIdPrefix}`}
          >
            {reasonLabel}
          </span>
        </div>
        <PayItemMatchReasonChips
          matchReason={reason === "history" ? "fuzzy" : reason}
          aliasText={suggestion.aliasText}
          matchedTokens={suggestion.matchedTokens}
          payItem={suggestion.payItem}
          seedDescription={seedDescription}
          seedUnit={seedUnit ?? null}
          seedCategory={null}
          testIdPrefix={`explain-${testIdPrefix}`}
          size="xs"
          maxKeywordChips={6}
        />
      </div>

      {reason === "alias" && suggestion.aliasText && (
        <div className="rounded-md border bg-muted/30 p-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-1">
            <Tag className="h-3 w-3" />
            Org alias mapping
          </div>
          <div
            className="text-xs"
            data-testid={`explain-alias-text-${testIdPrefix}`}
          >
            "{suggestion.aliasText}"
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border p-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-1">
            <History className="h-3 w-3" />
            Same description
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span
              className="flex items-center gap-1 text-green-700 dark:text-green-400"
              data-testid={`explain-accepts-${testIdPrefix}`}
            >
              <CheckCircle2 className="h-3 w-3" />
              {accepts} accept{accepts === 1 ? "" : "s"}
            </span>
            <span
              className="flex items-center gap-1 text-muted-foreground"
              data-testid={`explain-rejects-${testIdPrefix}`}
            >
              <ThumbsDown className="h-3 w-3" />
              {rejects} reject{rejects === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="rounded-md border p-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-1">
            <Building2 className="h-3 w-3" />
            From {suggestion.agency.code}
          </div>
          <div
            className="text-xs"
            data-testid={`explain-agency-accepts-${testIdPrefix}`}
          >
            {agencyAccepts} accept{agencyAccepts === 1 ? "" : "s"} for this
            description
          </div>
        </div>
      </div>

      {orgAccepts > 0 && (
        <div
          className="text-[11px] text-muted-foreground"
          data-testid={`explain-org-affinity-${testIdPrefix}`}
        >
          Your org has accepted this pay item {orgAccepts} time
          {orgAccepts === 1 ? "" : "s"} across all descriptions.
        </div>
      )}
    </div>
  );
}
