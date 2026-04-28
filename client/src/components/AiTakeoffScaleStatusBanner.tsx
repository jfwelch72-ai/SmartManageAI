// Task #2355 — Tiny presentation component for the AI takeoff scale-status
// banner. The AI takeoff results panel can be in one of three scale states:
//
//   1. The model's inferred scale disagrees with the user's calibrated scale
//      by >5% → amber `scaleMismatchWarning` (existing Task #2322 behavior).
//      Task #2335 — alongside that warning we also link out to the AI
//      takeoff dashboard so a lead running 30 sheets can see the org-wide
//      rollup rather than eyeballing one banner at a time.
//   2. The title block explicitly disclaims a paper-space scale ("NTS",
//      "AS SHOWN", "NOT TO SCALE"). `evaluateScaleMismatch` intentionally
//      stays silent in this case — there's no numeric scale to compare. We
//      surface a neutral footnote so estimators see the AI noticed the
//      disclaimer and is trusting their calibration.
//   3. Neither — render nothing.
//
// The two slots are mutually exclusive: the warning takes precedence so we
// never show both at once.

import { AlertTriangle, Ruler } from "lucide-react";

interface ScaleStatusBannerProps {
  scaleMismatchWarning?: string | null;
  scaleNotToScale?: { label: string } | null;
}

export function AiTakeoffScaleStatusBanner({
  scaleMismatchWarning,
  scaleNotToScale,
}: ScaleStatusBannerProps) {
  if (scaleMismatchWarning) {
    return (
      <div
        className="flex items-start gap-1.5 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 w-full"
        data-testid="banner-scale-mismatch"
      >
        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="text-xs text-amber-700 dark:text-amber-400">
            {scaleMismatchWarning}
          </span>
          <a
            href="/takeoff/ai-dashboard"
            className="text-[11px] font-medium text-amber-700 dark:text-amber-400 underline self-start"
            data-testid="link-scale-mismatch-dashboard"
          >
            View dashboard
          </a>
        </div>
      </div>
    );
  }
  if (scaleNotToScale) {
    const tag = scaleNotToScale.label === "AS SHOWN" ? "AS SHOWN" : "NTS";
    return (
      <div
        className="flex items-start gap-1.5 px-3 py-2 rounded-md bg-muted/50 border w-full"
        data-testid="banner-scale-not-to-scale"
      >
        <Ruler className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        <span className="text-xs text-muted-foreground flex-1">
          Drawing marked {tag} — using calibrated scale
        </span>
      </div>
    );
  }
  return null;
}
