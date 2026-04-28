// Snap primitives live in `shared/utils/geometry.ts` so the canvas controller,
// the worker hit-tester, and any future server-side geometry consumer share a
// single source of truth (Task #2065 — Step 4). This file is a thin re-export
// shim that preserves the existing `@/utils/snapping` import paths.
export {
  type SnapMode,
  type SnapTarget,
  type SnapModeConfig,
  type GridSnapConfig,
  type SnapResult,
  findSnapTargets,
  snapToGrid,
  perpendicularFoot,
  findPerpendicularSnap,
  findNearestSnapOnLine,
  findNearestSnap,
  applyOrthoLock,
  applyAngleConstraint,
  applyFixedLength,
} from "@shared/utils/geometry";
