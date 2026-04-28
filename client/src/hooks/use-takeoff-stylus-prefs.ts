import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_ALLOW_TWO_FINGER_ROTATE,
  DEFAULT_PALM_REJECTION_BAND_PX,
  DEFAULT_STYLUS_LONG_PRESS_MS,
  PALM_REJECTION_BAND_MAX_PX,
  PALM_REJECTION_BAND_MIN_PX,
  STYLUS_LONG_PRESS_MAX_MS,
  STYLUS_LONG_PRESS_MIN_MS,
} from "@shared/schema";

/**
 * Task #2142 — Single hook that exposes the takeoff mobile/stylus
 * precision prefs to every consumer in the takeoff workspace.
 *
 * The values flow through `/api/user-settings`. Anything that hasn't
 * yet been migrated server-side falls back to the defaults declared in
 * the shared schema, so the workspace is always renderable even before
 * the startup migration runs.
 */
export interface TakeoffStylusPrefs {
  allowTwoFingerRotate: boolean;
  palmRejectionBandPx: number;
  stylusLongPressMs: number;
}

interface UserSettingsPayload {
  allowTwoFingerRotate?: boolean | null;
  palmRejectionBandPx?: number | null;
  stylusLongPressMs?: number | null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function useTakeoffStylusPrefs(): TakeoffStylusPrefs {
  const { data } = useQuery<UserSettingsPayload>({
    queryKey: ["/api/user-settings"],
    // No queryFn — the default fetcher already handles JSON.
    staleTime: 60_000,
  });

  const allowTwoFingerRotate =
    typeof data?.allowTwoFingerRotate === "boolean"
      ? data.allowTwoFingerRotate
      : DEFAULT_ALLOW_TWO_FINGER_ROTATE;

  const palmRejectionBandPx = clamp(
    typeof data?.palmRejectionBandPx === "number"
      ? data.palmRejectionBandPx
      : DEFAULT_PALM_REJECTION_BAND_PX,
    PALM_REJECTION_BAND_MIN_PX,
    PALM_REJECTION_BAND_MAX_PX,
  );

  const stylusLongPressMs = clamp(
    typeof data?.stylusLongPressMs === "number"
      ? data.stylusLongPressMs
      : DEFAULT_STYLUS_LONG_PRESS_MS,
    STYLUS_LONG_PRESS_MIN_MS,
    STYLUS_LONG_PRESS_MAX_MS,
  );

  return { allowTwoFingerRotate, palmRejectionBandPx, stylusLongPressMs };
}
