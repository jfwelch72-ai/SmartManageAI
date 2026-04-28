import { useState } from "react";
import { Stage, Layer, Rect } from "react-konva";
import { DimInputCursorBadge } from "@/components/takeoff/hosts/DimInputCursorBadge";

/**
 * Task #2270 — Storybook-style preview for the locked-length cursor
 * badge that floats below the canvas cursor while a measure draw is in
 * progress (see `DimInputCursorBadge.tsx`).
 *
 * The badge is a Konva-only component, so designers cannot iterate on
 * the lock vs chain palette and copy without spinning up a real takeoff
 * session. This preview surface mounts the badge inside throwaway
 * Konva stages at the two stage scales the takeoff canvas typically
 * lands on (1x and 2x) and exposes a chain-mode toggle so the live
 * swap between the cyan "Lock" and amber "Chain" variants is
 * exercised in isolation.
 */

const STAGE_WIDTH = 280;
const STAGE_HEIGHT = 140;
const CURSOR = { x: 60, y: 50 };
const PENDING_LENGTH_FT = 12.5;

interface BadgePreviewStageProps {
  stageScale: number;
  dimInputRepeat: boolean;
  testId: string;
}

function BadgePreviewStage({
  stageScale,
  dimInputRepeat,
  testId,
}: BadgePreviewStageProps) {
  return (
    <div
      className="rounded border border-border bg-muted/30"
      style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }}
      data-testid={testId}
    >
      <Stage
        width={STAGE_WIDTH}
        height={STAGE_HEIGHT}
        scaleX={stageScale}
        scaleY={stageScale}
      >
        <Layer>
          {/* Faux cursor crosshair so the badge has a visible anchor. */}
          <Rect
            x={CURSOR.x - 1 / stageScale}
            y={CURSOR.y - 6 / stageScale}
            width={2 / stageScale}
            height={12 / stageScale}
            fill="#1f2937"
          />
          <Rect
            x={CURSOR.x - 6 / stageScale}
            y={CURSOR.y - 1 / stageScale}
            width={12 / stageScale}
            height={2 / stageScale}
            fill="#1f2937"
          />
          <DimInputCursorBadge
            isDrawing={true}
            cursorPosition={CURSOR}
            pendingDimLengthFt={PENDING_LENGTH_FT}
            dimInputRepeat={dimInputRepeat}
            stageScale={stageScale}
          />
        </Layer>
      </Stage>
    </div>
  );
}

export default function DimInputBadgePreviewPage() {
  const [liveChainMode, setLiveChainMode] = useState(false);

  return (
    <div className="p-8 space-y-8" data-testid="dim-input-badge-preview-page">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">DimInputCursorBadge preview</h1>
        <p className="text-sm text-muted-foreground">
          Cyan "Lock" vs amber "Chain" cursor badge at typical takeoff
          stage scales. Iterate on palette and copy without launching a
          real measure draw.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Side-by-side (static)</h2>
        <div className="grid grid-cols-[auto_1fr_1fr] gap-4 items-center">
          <div />
          <div className="text-sm font-medium text-muted-foreground">
            Lock (one-shot, cyan)
          </div>
          <div className="text-sm font-medium text-muted-foreground">
            Chain (sticky, amber)
          </div>

          <div className="text-sm font-medium text-muted-foreground">
            Stage scale 1×
          </div>
          <BadgePreviewStage
            stageScale={1}
            dimInputRepeat={false}
            testId="badge-preview-lock-1x"
          />
          <BadgePreviewStage
            stageScale={1}
            dimInputRepeat={true}
            testId="badge-preview-chain-1x"
          />

          <div className="text-sm font-medium text-muted-foreground">
            Stage scale 2×
          </div>
          <BadgePreviewStage
            stageScale={2}
            dimInputRepeat={false}
            testId="badge-preview-lock-2x"
          />
          <BadgePreviewStage
            stageScale={2}
            dimInputRepeat={true}
            testId="badge-preview-chain-2x"
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Live chain-mode toggle</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setLiveChainMode((v) => !v)}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover-elevate active-elevate-2"
            data-testid="button-toggle-chain-mode"
            aria-pressed={liveChainMode}
          >
            Chain mode:{" "}
            <span data-testid="text-chain-mode-state">
              {liveChainMode ? "on" : "off"}
            </span>
          </button>
          <span
            className="text-sm text-muted-foreground"
            data-testid="text-live-mode-label"
          >
            Current variant: {liveChainMode ? "Chain (amber)" : "Lock (cyan)"}
          </span>
        </div>
        <BadgePreviewStage
          stageScale={1}
          dimInputRepeat={liveChainMode}
          testId="badge-preview-live"
        />
      </section>
    </div>
  );
}
