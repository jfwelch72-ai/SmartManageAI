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
