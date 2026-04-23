import { Badge } from "@/components/ui/badge";
import { Tag } from "lucide-react";

interface PayItemForChips {
  itemNumber: string;
  unit: string;
  category: string | null;
}

interface Props {
  matchReason: "alias" | "fuzzy";
  aliasText: string | null;
  matchedTokens: string[];
  payItem: PayItemForChips;
  seedDescription?: string | null;
  seedUnit?: string | null;
  seedCategory?: string | null;
  /** Stable id used to build deterministic data-testid values. */
  testIdPrefix: string;
  /** Cap how many keyword chips to render. Defaults to 3. */
  maxKeywordChips?: number;
  /** Cap how long the alias label can grow before truncation. Defaults to 60. */
  aliasMaxChars?: number;
  /** Visual size variant. Suggestions panel uses xs; review tables use 2xs. */
  size?: "xs" | "2xs";
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Renders a row of short, human-readable chips that explain why a DOT pay item
 * was suggested for a given line description. The match endpoint already
 * returns matchReason / aliasText / matchedTokens — this component decides
 * which chips to surface (alias, item # match, unit/category match, matched
 * keywords) and labels them so estimators can trust or override the top pick.
 */
export function PayItemMatchReasonChips({
  matchReason,
  aliasText,
  matchedTokens,
  payItem,
  seedDescription,
  seedUnit,
  seedCategory,
  testIdPrefix,
  maxKeywordChips = 3,
  aliasMaxChars = 60,
  size = "xs",
}: Props) {
  const chips: Array<{ key: string; node: JSX.Element }> = [];
  const textSize = size === "xs" ? "text-xs" : "text-[10px]";
  const gapClass = size === "xs" ? "gap-1" : "gap-0.5";
  const iconSize = size === "xs" ? "h-3 w-3" : "h-2.5 w-2.5";

  const desc = (seedDescription ?? "").toLowerCase();
  const itemNum = (payItem.itemNumber ?? "").toLowerCase().trim();
  const unitSeed = (seedUnit ?? "").toLowerCase().trim();
  const catSeed = (seedCategory ?? "").toLowerCase().trim();
  const itemUnit = (payItem.unit ?? "").toLowerCase().trim();
  const itemCat = (payItem.category ?? "").toLowerCase().trim();

  if (matchReason === "alias" && aliasText && aliasText.trim().length > 0) {
    const label = truncate(aliasText.trim(), aliasMaxChars);
    chips.push({
      key: "alias",
      node: (
        <Badge
          variant="secondary"
          className={`${textSize} ${gapClass} max-w-[14rem]`}
          title={`Org alias: ${aliasText}`}
          data-testid={`badge-match-reason-alias-${testIdPrefix}`}
        >
          <Tag className={iconSize} />
          <span className="truncate">Alias: "{label}"</span>
        </Badge>
      ),
    });
  }

  if (itemNum && desc && desc.includes(itemNum)) {
    chips.push({
      key: "item-number",
      node: (
        <Badge
          variant="outline"
          className={textSize}
          title={`Your description references item number ${payItem.itemNumber}`}
          data-testid={`badge-match-reason-item-number-${testIdPrefix}`}
        >
          Item # match
        </Badge>
      ),
    });
  }

  const unitMatch = unitSeed.length > 0 && itemUnit === unitSeed;
  const categoryMatch =
    catSeed.length > 0 && itemCat.length > 0 && itemCat.includes(catSeed);
  if (unitMatch && categoryMatch) {
    chips.push({
      key: "unit-category",
      node: (
        <Badge
          variant="outline"
          className={textSize}
          title={`Same unit (${payItem.unit}) and category (${payItem.category})`}
          data-testid={`badge-match-reason-unit-category-${testIdPrefix}`}
        >
          Unit + category match
        </Badge>
      ),
    });
  } else if (unitMatch) {
    chips.push({
      key: "unit",
      node: (
        <Badge
          variant="outline"
          className={textSize}
          title={`Same unit of measure (${payItem.unit})`}
          data-testid={`badge-match-reason-unit-${testIdPrefix}`}
        >
          Unit match
        </Badge>
      ),
    });
  } else if (categoryMatch) {
    chips.push({
      key: "category",
      node: (
        <Badge
          variant="outline"
          className={textSize}
          title={`Same category (${payItem.category})`}
          data-testid={`badge-match-reason-category-${testIdPrefix}`}
        >
          Category match
        </Badge>
      ),
    });
  }

  if (matchReason !== "alias" && matchedTokens.length > 0) {
    const shown = matchedTokens.slice(0, maxKeywordChips);
    const extra = matchedTokens.length - shown.length;
    const label = `Keywords: ${shown.join(", ")}${extra > 0 ? ` +${extra}` : ""}`;
    chips.push({
      key: "keywords",
      node: (
        <Badge
          variant="outline"
          className={`${textSize} max-w-[18rem]`}
          title={`Matched keywords from your description: ${matchedTokens.join(", ")}`}
          data-testid={`badge-match-reason-keywords-${testIdPrefix}`}
        >
          <span className="truncate">{label}</span>
        </Badge>
      ),
    });
  }

  if (chips.length === 0) {
    return (
      <Badge
        variant="outline"
        className={`${textSize} text-muted-foreground`}
        title="Ranked by overall description similarity"
        data-testid={`badge-match-reason-similarity-${testIdPrefix}`}
      >
        Similarity match
      </Badge>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center ${gapClass}`}
      data-testid={`group-match-reasons-${testIdPrefix}`}
    >
      {chips.map((c) => (
        <span key={c.key}>{c.node}</span>
      ))}
    </div>
  );
}
