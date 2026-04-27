import { Link } from "wouter";
import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Task #2090 — Shared CTA pane that replaces the embedded
 * `<TakeoffWorkspace>` inside both the bid and project Plans tabs and
 * points users at the standalone, full-page Takeoff workspace at
 * `/takeoff/:bidCode` or `/takeoff/project/:projectCode`. When a sheet
 * is selected on the left, we forward it via `?sheet=<id>` so the
 * full-screen workspace jumps straight to it.
 *
 * Replaces the previously duplicated `TakeoffCtaPane` (Task #2067) and
 * `ProjectTakeoffCtaPane` (Task #2080) so copy/styling/behavior stay in
 * lockstep across both surfaces. Existing `data-testid` values are
 * preserved per surface so downstream e2e tests keep working.
 */
export type TakeoffCtaPaneProps = {
  kind: "bid" | "project";
  code: string;
  selectedSheetId: string | null;
};

export function TakeoffCtaPane({
  kind,
  code,
  selectedSheetId,
}: TakeoffCtaPaneProps) {
  const basePath =
    kind === "bid" ? `/takeoff/${code}` : `/takeoff/project/${code}`;
  const href = selectedSheetId
    ? `${basePath}?sheet=${selectedSheetId}`
    : basePath;
  const paneTestId =
    kind === "bid" ? "takeoff-cta-pane" : "project-takeoff-cta-pane";
  const buttonTestId =
    kind === "bid"
      ? "button-open-takeoff-workspace"
      : "button-open-project-takeoff-workspace";

  return (
    <div
      className="flex flex-col items-center justify-center h-full text-center px-6 py-10 gap-5"
      data-testid={paneTestId}
    >
      <div className="rounded-full bg-primary/10 p-4">
        <Maximize2 className="w-8 h-8 text-primary" />
      </div>
      <div className="max-w-md space-y-2">
        <h3 className="text-lg font-semibold tracking-tight">
          Open Takeoff in its own workspace
        </h3>
        <p className="text-sm text-muted-foreground">
          Takeoff now runs as a dedicated, full-screen tool with collapsible
          sidebars, scale calibration, and markups — all of your existing
          measurements move with you.
        </p>
      </div>
      <Button asChild size="lg" data-testid={buttonTestId}>
        <Link href={href}>
          <Maximize2 className="w-4 h-4 mr-2" />
          Open Full-Screen Takeoff
        </Link>
      </Button>
      <p className="text-xs text-muted-foreground">
        Tip: select a sheet on the left and we'll jump straight to it.
      </p>
    </div>
  );
}
