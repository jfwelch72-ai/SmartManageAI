export const GEOFENCE_RADIUS = 200;

export const GPS_ACCURACY_THRESHOLD = 50;

export const MAX_REASONABLE_SPEED_MPS = 45;

export const LOCATION_PING_INTERVAL_MS = 15 * 60 * 1000;

export const BLOCK_OVERRIDE_MAX_ATTEMPTS = 3;

export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function isAccuracyAcceptable(accuracyMeters: number | null | undefined, threshold?: number): boolean {
  if (accuracyMeters == null) return false;
  return accuracyMeters <= (threshold ?? GPS_ACCURACY_THRESHOLD);
}

export interface SpoofingCheckResult {
  isSuspicious: boolean;
  reason: string | null;
}

export function checkForSpoofing(
  currentLat: number,
  currentLon: number,
  currentTime: Date,
  previousLat: number | null,
  previousLon: number | null,
  previousTime: Date | null,
  accuracy?: number | null,
): SpoofingCheckResult {
  if (previousLat == null || previousLon == null || previousTime == null) {
    return { isSuspicious: false, reason: null };
  }

  const distance = calculateDistance(currentLat, currentLon, previousLat, previousLon);
  const timeDiffSeconds = (currentTime.getTime() - previousTime.getTime()) / 1000;

  if (timeDiffSeconds <= 0) {
    return { isSuspicious: false, reason: null };
  }

  const speed = distance / timeDiffSeconds;

  if (speed > MAX_REASONABLE_SPEED_MPS) {
    return {
      isSuspicious: true,
      reason: `Impossible speed detected: ${Math.round(speed * 3.6)} km/h over ${Math.round(distance)}m in ${Math.round(timeDiffSeconds)}s`,
    };
  }

  if (accuracy != null && accuracy < 1) {
    return {
      isSuspicious: true,
      reason: `Implausibly precise GPS accuracy: ${accuracy}m (likely spoofed)`,
    };
  }

  return { isSuspicious: false, reason: null };
}

export interface GeofenceZone {
  id: string;
  name: string;
  type: "circle" | "polygon";
  latitude?: number;
  longitude?: number;
  radius?: number;
  polygon?: Array<{ lat: number; lng: number }>;
}

export function isPointInZone(lat: number, lon: number, zone: GeofenceZone): boolean {
  if (zone.type === "circle" && zone.latitude != null && zone.longitude != null && zone.radius != null) {
    const distance = calculateDistance(lat, lon, zone.latitude, zone.longitude);
    return distance <= zone.radius;
  }

  if (zone.type === "polygon" && zone.polygon && zone.polygon.length >= 3) {
    return isPointInPolygon(lat, lon, zone.polygon);
  }

  return false;
}

export function isPointInAnyZone(lat: number, lon: number, zones: GeofenceZone[]): { inRange: boolean; matchedZone: GeofenceZone | null; nearestDistance: number | null } {
  let nearestDistance: number | null = null;

  for (const zone of zones) {
    if (isPointInZone(lat, lon, zone)) {
      return { inRange: true, matchedZone: zone, nearestDistance: 0 };
    }

    if (zone.type === "circle" && zone.latitude != null && zone.longitude != null) {
      const dist = calculateDistance(lat, lon, zone.latitude, zone.longitude) - (zone.radius || 0);
      if (nearestDistance === null || dist < nearestDistance) {
        nearestDistance = dist;
      }
    }
  }

  return { inRange: false, matchedZone: null, nearestDistance };
}

function isPointInPolygon(lat: number, lon: number, polygon: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = polygon[i].lat;
    const xi = polygon[i].lng;
    const yj = polygon[j].lat;
    const xj = polygon[j].lng;

    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
}
