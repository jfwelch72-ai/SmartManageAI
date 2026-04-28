/**
 * Geometry Utilities for TFR Takeoff Engine
 * 
 * Provides robust, production-grade geometric calculations for:
 * - Distance measurements (linear feet)
 * - Polygon area calculations (square feet)
 * - Volume calculations (cubic yards)
 * - Arc and circle geometry
 * - Coordinate transformations
 * 
 * All calculations account for scale (pixels per foot) and return
 * values in real-world construction units.
 */

export interface Point {
  x: number;
  y: number;
}

export interface ArcSegment {
  startPoint: Point;
  endPoint: Point;
  controlPoint: Point;
  radius: number;
  centerPoint: Point;
  arcLength: number;
}

/**
 * Compute Euclidean distance between two points in pixels
 */
export function computePixelDistance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute linear distance in feet given pixel distance and scale
 * 
 * @param pixelDistance - Distance in pixels
 * @param scalePxPerFoot - Scale factor (pixels per foot)
 * @returns Distance in feet
 */
export function pixelsToFeet(pixelDistance: number, scalePxPerFoot: number): number {
  if (scalePxPerFoot <= 0) {
    throw new Error('Scale must be positive');
  }
  return pixelDistance / scalePxPerFoot;
}

/**
 * Compute total linear distance in feet for a polyline
 * 
 * @param points - Array of points defining the polyline
 * @param scalePxPerFoot - Scale factor (pixels per foot)
 * @returns Total distance in linear feet (LF)
 */
export function computeDistanceInFeet(points: Point[], scalePxPerFoot: number): number {
  if (points.length < 2) {
    return 0;
  }

  let totalPixelDistance = 0;
  for (let i = 0; i < points.length - 1; i++) {
    totalPixelDistance += computePixelDistance(points[i], points[i + 1]);
  }

  return pixelsToFeet(totalPixelDistance, scalePxPerFoot);
}

/**
 * Compute polygon area using the Shoelace Formula (Surveyor's Formula)
 * Returns area in square pixels
 * 
 * Formula: A = 0.5 * |Σ(x_i * y_{i+1} - x_{i+1} * y_i)|
 * 
 * @param points - Array of points defining the polygon (must be closed or will auto-close)
 * @returns Area in square pixels
 */
export function computePolygonAreaInPixels(points: Point[]): number {
  if (points.length < 3) {
    return 0;
  }

  // Ensure polygon is closed by checking if first and last points are the same
  const isClosed = points[0].x === points[points.length - 1].x && 
                   points[0].y === points[points.length - 1].y;
  
  const vertices = isClosed ? points : [...points, points[0]];

  let area = 0;
  for (let i = 0; i < vertices.length - 1; i++) {
    area += vertices[i].x * vertices[i + 1].y;
    area -= vertices[i + 1].x * vertices[i].y;
  }

  return Math.abs(area) / 2;
}

/**
 * Compute polygon area in square feet
 * 
 * @param points - Array of points defining the polygon
 * @param scalePxPerFoot - Scale factor (pixels per foot)
 * @returns Area in square feet (SF)
 */
export function computePolygonAreaInFt2(points: Point[], scalePxPerFoot: number): number {
  if (scalePxPerFoot <= 0) {
    throw new Error('Scale must be positive');
  }

  const areaInSquarePixels = computePolygonAreaInPixels(points);
  
  // Convert from square pixels to square feet
  // 1 square foot = (scalePxPerFoot)^2 square pixels
  const areaInSquareFeet = areaInSquarePixels / (scalePxPerFoot * scalePxPerFoot);
  
  return areaInSquareFeet;
}

/**
 * Compute volume in cubic yards given area and depth
 * 
 * Formula: Volume (CY) = (Area in SF × Depth in feet) ÷ 27
 * 
 * @param areaFt2 - Area in square feet
 * @param depthFt - Depth in feet
 * @returns Volume in cubic yards (CY)
 */
export function computeVolumeInCY(areaFt2: number, depthFt: number): number {
  if (depthFt < 0) {
    throw new Error('Depth cannot be negative');
  }
  
  const volumeInCubicFeet = areaFt2 * depthFt;
  const volumeInCubicYards = volumeInCubicFeet / 27;
  
  return volumeInCubicYards;
}

/**
 * Convert depth from inches to feet
 */
export function inchesToFeet(inches: number): number {
  return inches / 12;
}

/**
 * Compute circle center and radius from three points
 * Uses the circumcenter formula
 * 
 * @param p1 - First point on circle
 * @param p2 - Second point on circle
 * @param p3 - Third point on circle
 * @returns Object with center point and radius, or null if points are collinear
 */
export function computeCircleFromThreePoints(
  p1: Point,
  p2: Point,
  p3: Point
): { center: Point; radius: number } | null {
  // Check if points are collinear
  const area = Math.abs(
    p1.x * (p2.y - p3.y) + 
    p2.x * (p3.y - p1.y) + 
    p3.x * (p1.y - p2.y)
  );
  
  if (area < 0.0001) {
    return null; // Points are collinear
  }

  // Compute perpendicular bisectors
  const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
  
  if (Math.abs(d) < 0.0001) {
    return null;
  }

  const ux = ((p1.x * p1.x + p1.y * p1.y) * (p2.y - p3.y) +
              (p2.x * p2.x + p2.y * p2.y) * (p3.y - p1.y) +
              (p3.x * p3.x + p3.y * p3.y) * (p1.y - p2.y)) / d;

  const uy = ((p1.x * p1.x + p1.y * p1.y) * (p3.x - p2.x) +
              (p2.x * p2.x + p2.y * p2.y) * (p1.x - p3.x) +
              (p3.x * p3.x + p3.y * p3.y) * (p2.x - p1.x)) / d;

  const center = { x: ux, y: uy };
  const radius = computePixelDistance(center, p1);

  return { center, radius };
}

/**
 * Compute arc length given radius and angle (in radians)
 * 
 * @param radius - Radius in pixels
 * @param angleRadians - Angle subtended by arc in radians
 * @returns Arc length in pixels
 */
export function computeArcLength(radius: number, angleRadians: number): number {
  return radius * angleRadians;
}

/**
 * Compute the angle between two vectors in radians
 */
export function computeAngleBetweenVectors(v1: Point, v2: Point): number {
  const dotProduct = v1.x * v2.x + v1.y * v2.y;
  const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
  const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
  
  if (mag1 === 0 || mag2 === 0) {
    return 0;
  }
  
  const cosTheta = dotProduct / (mag1 * mag2);
  return Math.acos(Math.max(-1, Math.min(1, cosTheta))); // Clamp to avoid numerical errors
}

/**
 * Create an arc segment from three points (start, end, control)
 * The control point defines the curvature
 * 
 * @param startPoint - Arc start point
 * @param endPoint - Arc end point  
 * @param controlPoint - Point defining the arc curvature
 * @param scalePxPerFoot - Scale factor for converting to feet
 * @returns Arc segment with computed properties
 */
export function createArcSegment(
  startPoint: Point,
  endPoint: Point,
  controlPoint: Point,
  scalePxPerFoot: number
): ArcSegment | null {
  const circleData = computeCircleFromThreePoints(startPoint, controlPoint, endPoint);
  
  if (!circleData) {
    return null; // Points are collinear, cannot form arc
  }

  const { center, radius } = circleData;

  // Compute vectors from center to start and end points
  const v1 = { x: startPoint.x - center.x, y: startPoint.y - center.y };
  const v2 = { x: endPoint.x - center.x, y: endPoint.y - center.y };

  // Compute angle subtended by arc
  const angleRadians = computeAngleBetweenVectors(v1, v2);

  // Compute arc length in pixels then convert to feet
  const arcLengthPixels = computeArcLength(radius, angleRadians);
  const arcLengthFeet = pixelsToFeet(arcLengthPixels, scalePxPerFoot);

  return {
    startPoint,
    endPoint,
    controlPoint,
    radius,
    centerPoint: center,
    arcLength: arcLengthFeet
  };
}

/**
 * Sample points along an arc for rendering or area calculation
 * 
 * @param arc - Arc segment
 * @param numSamples - Number of sample points (default 20)
 * @returns Array of points along the arc
 */
export function sampleArcPoints(arc: ArcSegment, numSamples: number = 20): Point[] {
  const { centerPoint, radius, startPoint, endPoint } = arc;

  // Compute start and end angles
  const startAngle = Math.atan2(startPoint.y - centerPoint.y, startPoint.x - centerPoint.x);
  const endAngle = Math.atan2(endPoint.y - centerPoint.y, endPoint.x - centerPoint.x);

  // Determine sweep direction (need to check which direction is shorter)
  let deltaAngle = endAngle - startAngle;
  
  // Normalize to [-π, π]
  while (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
  while (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;

  const points: Point[] = [];
  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples;
    const angle = startAngle + t * deltaAngle;
    points.push({
      x: centerPoint.x + radius * Math.cos(angle),
      y: centerPoint.y + radius * Math.sin(angle)
    });
  }

  return points;
}

/**
 * Compute polygon area including arc segments
 * For polygons with curved edges, arc segments are approximated with sample points
 * 
 * @param linearSegments - Straight line segments as point arrays
 * @param arcSegments - Arc segments
 * @param scalePxPerFoot - Scale factor
 * @returns Total area in square feet
 */
export function computeAreaWithArcs(
  linearSegments: Point[][],
  arcSegments: ArcSegment[],
  scalePxPerFoot: number
): number {
  // Combine all points: linear segments + sampled arc points
  const allPoints: Point[] = [];

  for (const segment of linearSegments) {
    allPoints.push(...segment);
  }

  for (const arc of arcSegments) {
    const arcPoints = sampleArcPoints(arc, 30); // High sample count for accuracy
    allPoints.push(...arcPoints);
  }

  if (allPoints.length < 3) {
    return 0;
  }

  return computePolygonAreaInFt2(allPoints, scalePxPerFoot);
}

/**
 * Parse a pitch ratio string (e.g., "6:12") and return the pitch multiplier
 * Pitch multiplier = sqrt(1 + (rise/run)^2) for converting horizontal to slope distance
 */
export function parsePitchRatio(pitchRatio: string): { rise: number; run: number; multiplier: number } {
  const parts = pitchRatio.split(":");
  const rise = parseFloat(parts[0]) || 0;
  const run = parseFloat(parts[1]) || 12;
  const multiplier = Math.sqrt(1 + (rise / run) * (rise / run));
  return { rise, run, multiplier };
}

/**
 * Compute pitched linear distance (slope distance from horizontal measurement)
 */
export function computePitchedLinearFt(horizontalFt: number, pitchRatio: string): number {
  const { multiplier } = parsePitchRatio(pitchRatio);
  return horizontalFt * multiplier;
}

/**
 * Compute pitched area (actual surface area from flat/plan area)
 */
export function computePitchedAreaFt2(flatAreaFt2: number, pitchRatio: string): number {
  const { multiplier } = parsePitchRatio(pitchRatio);
  return flatAreaFt2 * multiplier;
}

/**
 * Compute linear-with-drop total distance
 * Combines horizontal run with vertical drop
 */
export function computeLinearWithDropFt(horizontalFt: number, dropFt: number): number {
  return Math.sqrt(horizontalFt * horizontalFt + dropFt * dropFt);
}

/**
 * Compute net polygon area after subtracting deduction polygons (openings/cutouts)
 * 
 * @param mainPoints - Points defining the main polygon
 * @param deductionPolygons - Array of point arrays defining holes/openings to subtract
 * @param scalePxPerFoot - Scale factor (pixels per foot)
 * @returns Net area in square feet (main area minus all deductions)
 */
export function computeNetAreaInFt2(
  mainPoints: Point[],
  deductionPolygons: Point[][],
  scalePxPerFoot: number
): { grossArea: number; deductionArea: number; netArea: number } {
  const grossArea = computePolygonAreaInFt2(mainPoints, scalePxPerFoot);
  
  let deductionArea = 0;
  for (const deductionPoints of deductionPolygons) {
    if (deductionPoints.length >= 3) {
      deductionArea += computePolygonAreaInFt2(deductionPoints, scalePxPerFoot);
    }
  }
  
  const netArea = Math.max(0, grossArea - deductionArea);
  return { grossArea, deductionArea, netArea };
}

/**
 * Compute polygon perimeter in feet
 * 
 * @param points - Array of points defining the polygon
 * @param scalePxPerFoot - Scale factor (pixels per foot)
 * @returns Perimeter in linear feet (LF)
 */
export function computePolygonPerimeterInFt(points: Point[], scalePxPerFoot: number): number {
  if (points.length < 2 || scalePxPerFoot <= 0) return 0;

  let totalPx = 0;
  for (let i = 0; i < points.length; i++) {
    const next = (i + 1) % points.length;
    totalPx += computePixelDistance(points[i], points[next]);
  }
  return totalPx / scalePxPerFoot;
}

/**
 * Ray-casting point-in-polygon test
 * 
 * @param point - The point to test
 * @param polygon - Array of points defining the polygon
 * @returns true if the point is inside the polygon
 */
export function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > point.y) !== (yj > point.y) && point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Format a measurement value for display
 * 
 * @param value - Numeric value
 * @param unit - Unit string (e.g., "LF", "SF", "CY")
 * @param decimals - Number of decimal places (default 2)
 * @returns Formatted string
 */
export function formatMeasurement(value: number, unit: string, decimals: number = 2): string {
  return `${value.toFixed(decimals)} ${unit}`;
}

/**
 * Validate that points form a valid polygon
 * 
 * @param points - Array of points
 * @returns True if valid polygon (at least 3 points, not all collinear)
 */
export function isValidPolygon(points: Point[]): boolean {
  if (points.length < 3) {
    return false;
  }

  // Check if all points are collinear
  const area = computePolygonAreaInPixels(points);
  return area > 0.0001; // Threshold to account for floating point errors
}

/**
 * Compute polygon centroid (center of mass)
 * Useful for placing labels or measurement displays
 * 
 * @param points - Array of points defining the polygon
 * @returns Centroid point
 */
export function computePolygonCentroid(points: Point[]): Point {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }

  let sumX = 0;
  let sumY = 0;

  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }

  return {
    x: sumX / points.length,
    y: sumY / points.length
  };
}

// ---------------------------------------------------------------------------
// Task #2065 — typed dimension input + ortho-angle constraints (Step 5)
//
// These helpers are pure so the canvas controller, the worker, and the
// keyboard HUD can all share a single source of truth. See
// docs/takeoff-interaction-map.md for the full grammar.
// ---------------------------------------------------------------------------

/** Canonical ortho preset angles, in degrees, ordered for `Shift+O` cycling. */
export const ORTHO_PRESET_ANGLES: ReadonlyArray<number> = [15, 30, 45, 90];

/** Result of parsing a typed dimension token. */
export interface ParsedTypedLength {
  /** Length in feet. Always > 0 if `ok`. */
  feet: number;
  /** Whether the input was syntactically valid. */
  ok: boolean;
  /** Original input, lowercased and trimmed; useful for error display. */
  raw: string;
}

/**
 * Parse a length token. Accepts:
 *   - `12`            (defaults to feet)
 *   - `12ft`, `12'`, `12 ft`
 *   - `12'6"`, `12' 6"`, `12'6`
 *   - `12.5`
 *   - `144in`, `144"`
 *   - `5m`, `50cm`, `500mm`
 *
 * Returns feet (1 ft = 12 in = 0.3048 m). Negative inputs are rejected.
 */
export function parseTypedLength(input: string): ParsedTypedLength {
  const raw = (input ?? "").trim().toLowerCase();
  const fail: ParsedTypedLength = { feet: 0, ok: false, raw };
  if (!raw) return fail;

  // 12'6" or 12' 6" or 12'6
  const ftIn = raw.match(/^(\d+(?:\.\d+)?)'\s*(\d+(?:\.\d+)?)?\s*"?$/);
  if (ftIn) {
    const ft = parseFloat(ftIn[1]);
    const inch = ftIn[2] ? parseFloat(ftIn[2]) : 0;
    if (!isFinite(ft) || !isFinite(inch) || ft < 0 || inch < 0 || inch >= 12) {
      return fail;
    }
    return { feet: ft + inch / 12, ok: true, raw };
  }

  const m = raw.match(/^(-?\d+(?:\.\d+)?)\s*(ft|in|m|cm|mm|"|')?$/);
  if (!m) return fail;
  const value = parseFloat(m[1]);
  if (!isFinite(value) || value <= 0) return fail;
  const unit = m[2] ?? "ft";
  switch (unit) {
    case "ft":
    case "'":
      return { feet: value, ok: true, raw };
    case "in":
    case '"':
      return { feet: value / 12, ok: true, raw };
    case "m":
      return { feet: value / 0.3048, ok: true, raw };
    case "cm":
      return { feet: value / 30.48, ok: true, raw };
    case "mm":
      return { feet: value / 304.8, ok: true, raw };
    default:
      return fail;
  }
}

/** Result of parsing the full typed-input grammar. */
export interface ParsedTypedInput {
  /** Lengths in feet. May be 1 (length) or 2 (Δx,Δy). Empty when `ok=false`. */
  lengths: number[];
  /** Optional angle override (degrees, measured CCW from +X). */
  angleDeg: number | null;
  ok: boolean;
  raw: string;
}

/**
 * Parse the typed-input grammar from §4 of the interaction map. Examples:
 *   "12"        → lengths=[12], angle=null
 *   "12'6\""    → lengths=[12.5], angle=null
 *   "12<30"     → lengths=[12], angle=30
 *   "12,6"      → lengths=[12, 6], angle=null
 */
export function parseTypedInput(input: string): ParsedTypedInput {
  const raw = (input ?? "").trim();
  const fail: ParsedTypedInput = { lengths: [], angleDeg: null, ok: false, raw };
  if (!raw) return fail;

  // Split off optional angle suffix.
  let angleDeg: number | null = null;
  let body = raw;
  const angleMatch = raw.match(/^(.*?)<\s*(-?\d+(?:\.\d+)?)\s*°?\s*$/);
  if (angleMatch) {
    body = angleMatch[1].trim();
    const a = parseFloat(angleMatch[2]);
    if (!isFinite(a)) return fail;
    angleDeg = a;
    if (!body) {
      return fail; // "<45" alone is not a valid typed dimension.
    }
  }

  const parts = body.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return fail;
  const lengths: number[] = [];
  for (const part of parts) {
    const parsed = parseTypedLength(part);
    if (!parsed.ok) return fail;
    lengths.push(parsed.feet);
  }

  return { lengths, angleDeg, ok: true, raw };
}

/**
 * Snap an angle (in radians) to the nearest multiple of `stepDeg`. Returns
 * the snapped angle in radians.
 */
export function snapAngleToStep(angleRad: number, stepDeg: number): number {
  if (stepDeg <= 0) return angleRad;
  const stepRad = (stepDeg * Math.PI) / 180;
  return Math.round(angleRad / stepRad) * stepRad;
}

/**
 * Apply an ortho-angle lock: rotate the cursor around the anchor so that
 * the angle from anchor → cursor lies on the nearest multiple of `stepDeg`.
 * Length is preserved.
 */
export function applyOrthoAngleLock(
  cursor: Point,
  anchor: Point | null,
  stepDeg: number
): Point {
  if (!anchor) return cursor;
  const dx = cursor.x - anchor.x;
  const dy = cursor.y - anchor.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-10) return cursor;
  const angle = Math.atan2(dy, dx);
  const snapped = snapAngleToStep(angle, stepDeg);
  return {
    x: anchor.x + Math.cos(snapped) * len,
    y: anchor.y + Math.sin(snapped) * len,
  };
}

/**
 * Project the cursor along the anchor → cursor direction, but force the
 * length to `lengthFeet`. Useful when the user types a length while
 * dragging the second point of a segment.
 */
export function applyTypedLength(
  cursor: Point,
  anchor: Point,
  lengthFeet: number,
  scalePxPerFoot: number
): Point {
  if (scalePxPerFoot <= 0 || lengthFeet <= 0) return cursor;
  const dx = cursor.x - anchor.x;
  const dy = cursor.y - anchor.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const targetPx = lengthFeet * scalePxPerFoot;
  if (len < 1e-10) {
    // No direction yet — default to +X so the user still gets a visible
    // segment to anchor the next click.
    return { x: anchor.x + targetPx, y: anchor.y };
  }
  return {
    x: anchor.x + (dx / len) * targetPx,
    y: anchor.y + (dy / len) * targetPx,
  };
}

/**
 * Place the new point at exactly `lengthFeet` from `anchor` along the
 * specified angle. If `angleDeg` is null the cursor's current angle is
 * used.
 */
export function applyTypedLengthAndAngle(
  cursor: Point,
  anchor: Point,
  lengthFeet: number,
  angleDeg: number | null,
  scalePxPerFoot: number
): Point {
  if (scalePxPerFoot <= 0 || lengthFeet <= 0) return cursor;
  const targetPx = lengthFeet * scalePxPerFoot;
  let angleRad: number;
  if (angleDeg !== null) {
    angleRad = (angleDeg * Math.PI) / 180;
  } else {
    const dx = cursor.x - anchor.x;
    const dy = cursor.y - anchor.y;
    if (Math.abs(dx) < 1e-10 && Math.abs(dy) < 1e-10) {
      angleRad = 0;
    } else {
      angleRad = Math.atan2(dy, dx);
    }
  }
  return {
    x: anchor.x + Math.cos(angleRad) * targetPx,
    y: anchor.y + Math.sin(angleRad) * targetPx,
  };
}

/**
 * Apply a Δx,Δy offset (both in feet) from the anchor. Signs follow the
 * canvas convention: +x → right, +y → down.
 */
export function applyTypedOffset(
  anchor: Point,
  dxFeet: number,
  dyFeet: number,
  scalePxPerFoot: number
): Point {
  if (scalePxPerFoot <= 0) return anchor;
  return {
    x: anchor.x + dxFeet * scalePxPerFoot,
    y: anchor.y + dyFeet * scalePxPerFoot,
  };
}

/**
 * High-level orchestrator: given a parsed typed input and the current
 * (anchor, cursor) pair, return the new cursor point. Returns `null` when
 * the parsed input cannot be applied (e.g. zero-length segment with no
 * direction yet).
 */
export function applyParsedTypedInput(
  parsed: ParsedTypedInput,
  cursor: Point,
  anchor: Point,
  scalePxPerFoot: number
): Point | null {
  if (!parsed.ok || scalePxPerFoot <= 0) return null;
  if (parsed.lengths.length === 2) {
    // Δx, Δy form. Angle suffix (if any) is ignored — the offset is
    // already an explicit vector.
    return applyTypedOffset(
      anchor,
      parsed.lengths[0],
      parsed.lengths[1],
      scalePxPerFoot
    );
  }
  if (parsed.lengths.length === 1) {
    return applyTypedLengthAndAngle(
      cursor,
      anchor,
      parsed.lengths[0],
      parsed.angleDeg,
      scalePxPerFoot
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Snap primitives (Task #2065 — Step 4)
//
// Shared so the canvas controller, the worker hit-tester, and any future
// server-side geometry consumer all use one source of truth.
// ---------------------------------------------------------------------------

export type SnapMode =
  | "endpoint"
  | "midpoint"
  | "intersection"
  | "perpendicular"
  | "center"
  | "nearest"
  | "grid";

export interface SnapTarget {
  point: Point;
  type: SnapMode;
  sourceId?: string;
}

export interface SnapModeConfig {
  endpoint?: boolean;
  midpoint?: boolean;
  intersection?: boolean;
  perpendicular?: boolean;
  center?: boolean;
  nearest?: boolean;
  grid?: boolean;
}

export interface GridSnapConfig {
  /** Grid spacing in pixels at 1× zoom. */
  spacingPx: number;
  /** Optional grid origin; defaults to (0, 0). */
  origin?: Point;
}

export interface SnapResult {
  snappedPoint: Point;
  snapTarget: SnapTarget | null;
  isSnapped: boolean;
}

const DEFAULT_SNAP_DISTANCE = 12;

function lineSegmentIntersection(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
): Point | null {
  const dx1 = a2.x - a1.x, dy1 = a2.y - a1.y;
  const dx2 = b2.x - b1.x, dy2 = b2.y - b1.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((b1.x - a1.x) * dy2 - (b1.y - a1.y) * dx2) / denom;
  const u = ((b1.x - a1.x) * dy1 - (b1.y - a1.y) * dx1) / denom;
  if (t >= -0.01 && t <= 1.01 && u >= -0.01 && u <= 1.01) {
    return { x: a1.x + t * dx1, y: a1.y + t * dy1 };
  }
  return null;
}

function nearestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-10) return a;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

interface SnapSegmentData {
  a: Point;
  b: Point;
  sourceId: string;
}

function isClosedPolygonType(type: string): boolean {
  return (
    type === "AREA" ||
    type === "POLYGON" ||
    type === "POLYGON_AREA" ||
    type === "AREA_POLYGON" ||
    type === "VOLUME" ||
    type === "VOLUME_AREA"
  );
}

export function findSnapTargets(
  measurements: Array<{
    id: string;
    points: string | Point[];
    type: string;
  }>,
  modes?: SnapModeConfig,
): SnapTarget[] {
  const targets: SnapTarget[] = [];
  const segments: SnapSegmentData[] = [];
  const wantEndpoint = modes?.endpoint !== false;
  const wantMidpoint = modes?.midpoint !== false;
  const wantIntersection = modes?.intersection !== false;
  const wantCenter = modes?.center !== false;

  for (const m of measurements) {
    if (m.type === "NOTE") continue;

    const pts: Point[] =
      typeof m.points === "string" ? JSON.parse(m.points) : m.points;

    if (!Array.isArray(pts) || pts.length === 0) continue;

    if (wantEndpoint) {
      for (const pt of pts) {
        targets.push({ point: pt, type: "endpoint", sourceId: m.id });
      }
    }

    if (pts.length === 2) {
      if (wantMidpoint) {
        targets.push({
          point: {
            x: (pts[0].x + pts[1].x) / 2,
            y: (pts[0].y + pts[1].y) / 2,
          },
          type: "midpoint",
          sourceId: m.id,
        });
      }
      segments.push({ a: pts[0], b: pts[1], sourceId: m.id });
    }

    if (pts.length >= 3 && m.type !== "COUNT") {
      for (let i = 0; i < pts.length - 1; i++) {
        if (wantMidpoint) {
          const mid = {
            x: (pts[i].x + pts[i + 1].x) / 2,
            y: (pts[i].y + pts[i + 1].y) / 2,
          };
          targets.push({ point: mid, type: "midpoint", sourceId: m.id });
        }
        segments.push({ a: pts[i], b: pts[i + 1], sourceId: m.id });
      }

      if (isClosedPolygonType(m.type)) {
        const first = pts[0];
        const last = pts[pts.length - 1];
        const closesAlready =
          Math.abs(first.x - last.x) < 1e-6 &&
          Math.abs(first.y - last.y) < 1e-6;
        if (!closesAlready) {
          if (wantMidpoint) {
            targets.push({
              point: { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 },
              type: "midpoint",
              sourceId: m.id,
            });
          }
          segments.push({ a: last, b: first, sourceId: m.id });
        }
        if (wantCenter) {
          targets.push({
            point: computePolygonCentroid(pts),
            type: "center",
            sourceId: m.id,
          });
        }
      }
    }
  }

  if (wantIntersection) {
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        if (segments[i].sourceId === segments[j].sourceId) continue;
        const ix = lineSegmentIntersection(
          segments[i].a,
          segments[i].b,
          segments[j].a,
          segments[j].b,
        );
        if (ix) {
          targets.push({ point: ix, type: "intersection" });
        }
      }
    }
  }

  return targets;
}

/** Snap a point to the nearest grid intersection. */
export function snapToGrid(point: Point, config: GridSnapConfig): Point {
  if (!config.spacingPx || config.spacingPx <= 0) return point;
  const ox = config.origin?.x ?? 0;
  const oy = config.origin?.y ?? 0;
  return {
    x: ox + Math.round((point.x - ox) / config.spacingPx) * config.spacingPx,
    y: oy + Math.round((point.y - oy) / config.spacingPx) * config.spacingPx,
  };
}

/**
 * Foot of the perpendicular from `anchor` to the segment a→b. Does NOT clamp
 * to segment ends, so the returned point may lie past `a` or `b`.
 */
export function perpendicularFoot(anchor: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-10) return a;
  const t = ((anchor.x - a.x) * dx + (anchor.y - a.y) * dy) / len2;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * Find the perpendicular-snap target nearest to the cursor. Requires an
 * `anchor` (the in-progress draw start point); returns no snap without one.
 */
export function findPerpendicularSnap(
  cursorPoint: Point,
  anchor: Point | null,
  measurements: Array<{ id: string; points: string | Point[]; type: string }>,
  snapDistance: number = DEFAULT_SNAP_DISTANCE,
  stageScale: number = 1,
): SnapResult {
  if (!anchor) {
    return { snappedPoint: cursorPoint, snapTarget: null, isSnapped: false };
  }
  const adjustedDist = snapDistance / stageScale;
  let nearest: SnapTarget | null = null;
  let nearestDist = Infinity;

  for (const m of measurements) {
    if (m.type === "NOTE" || m.type === "COUNT") continue;
    const pts: Point[] =
      typeof m.points === "string" ? JSON.parse(m.points) : m.points;
    if (!Array.isArray(pts) || pts.length < 2) continue;

    for (let i = 0; i < pts.length - 1; i++) {
      const foot = perpendicularFoot(anchor, pts[i], pts[i + 1]);
      const dx = cursorPoint.x - foot.x;
      const dy = cursorPoint.y - foot.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < adjustedDist && dist < nearestDist) {
        nearestDist = dist;
        nearest = { point: foot, type: "perpendicular", sourceId: m.id };
      }
    }
  }

  if (nearest) {
    return { snappedPoint: nearest.point, snapTarget: nearest, isSnapped: true };
  }
  return { snappedPoint: cursorPoint, snapTarget: null, isSnapped: false };
}

export function findNearestSnapOnLine(
  cursorPoint: Point,
  measurements: Array<{ id: string; points: string | Point[]; type: string }>,
  snapDistance: number = DEFAULT_SNAP_DISTANCE,
  stageScale: number = 1,
): SnapResult {
  const adjustedDist = snapDistance / stageScale;
  let nearest: SnapTarget | null = null;
  let nearestDist = Infinity;

  for (const m of measurements) {
    if (m.type === "NOTE" || m.type === "COUNT") continue;
    const pts: Point[] =
      typeof m.points === "string" ? JSON.parse(m.points) : m.points;
    if (!Array.isArray(pts) || pts.length < 2) continue;

    for (let i = 0; i < pts.length - 1; i++) {
      const np = nearestPointOnSegment(cursorPoint, pts[i], pts[i + 1]);
      const dx = cursorPoint.x - np.x, dy = cursorPoint.y - np.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < adjustedDist && dist < nearestDist) {
        nearestDist = dist;
        nearest = { point: np, type: "nearest", sourceId: m.id };
      }
    }
  }

  if (nearest)
    return { snappedPoint: nearest.point, snapTarget: nearest, isSnapped: true };
  return { snappedPoint: cursorPoint, snapTarget: null, isSnapped: false };
}

export function findNearestSnap(
  cursorPoint: Point,
  targets: SnapTarget[],
  snapDistance: number = DEFAULT_SNAP_DISTANCE,
  stageScale: number = 1,
): SnapResult {
  const adjustedDist = snapDistance / stageScale;
  let nearest: SnapTarget | null = null;
  let nearestDist = Infinity;

  for (const t of targets) {
    const dx = cursorPoint.x - t.point.x;
    const dy = cursorPoint.y - t.point.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < adjustedDist && dist < nearestDist) {
      nearestDist = dist;
      nearest = t;
    }
  }

  if (nearest) {
    return { snappedPoint: nearest.point, snapTarget: nearest, isSnapped: true };
  }
  return { snappedPoint: cursorPoint, snapTarget: null, isSnapped: false };
}

/** Axis-aligned ortho lock: clamp to the dominant axis through `anchor`. */
export function applyOrthoLock(point: Point, anchor: Point | null): Point {
  if (!anchor) return point;
  const dx = Math.abs(point.x - anchor.x);
  const dy = Math.abs(point.y - anchor.y);
  if (dx > dy) {
    return { x: point.x, y: anchor.y };
  }
  return { x: anchor.x, y: point.y };
}

/**
 * Polar/angle constraint (Task #2192).
 *
 * Rotates the cursor around `anchor` so the segment `anchor → point`
 * lies on the nearest multiple of `stepDeg` degrees, while preserving
 * the radial distance. `stepDeg = 90` reproduces the axis-aligned
 * ortho cardinal directions but **without** snapping the off-axis
 * coordinate to the anchor — it preserves the cursor's reach so the
 * line follows the mouse's distance, just along a constrained bearing.
 *
 * Used by the unified-ribbon `ortho-angle` constraint mode, which
 * cycles through 15° / 30° / 45° / 90° presets via `Shift+O`.
 *
 * Returns the input unchanged when `anchor` is null, when the cursor
 * sits on top of the anchor (no defined bearing), or when `stepDeg`
 * is not a positive finite number.
 */
export function applyAngleConstraint(
  point: Point,
  anchor: Point | null,
  stepDeg: number,
): Point {
  if (!anchor) return point;
  if (!Number.isFinite(stepDeg) || stepDeg <= 0) return point;
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1e-10) return point;
  const stepRad = (stepDeg * Math.PI) / 180;
  const theta = Math.atan2(dy, dx);
  const snapped = Math.round(theta / stepRad) * stepRad;
  return {
    x: anchor.x + Math.cos(snapped) * dist,
    y: anchor.y + Math.sin(snapped) * dist,
  };
}
