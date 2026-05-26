import { api } from "./client";

// Task #3107 — Mobile site weather. Thin client over /api/weather/site
// (server endpoint added in the same task). The site endpoint returns
// current + hourly (24h) + daily (7d) in a single round-trip so the
// home widget, detail screen, and daily-report snapshot capture all
// share one cache key per project.

export interface WeatherCurrent {
  observedAt: string;
  temp: number;
  windSpeed: number;
  precipitation: number;
  conditions: string;
  weatherCode: number;
  todayHigh: number | null;
  todayLow: number | null;
}

export interface WeatherHour {
  time: string;
  temp: number;
  precipitation: number;
  windSpeed: number;
  conditions: string;
  weatherCode: number;
}

export interface WeatherDay {
  date: string;
  tempHigh: number;
  tempLow: number;
  precipitation: number;
  windSpeed: number;
  conditions: string;
  weatherCode: number;
}

export interface WeatherSiteResponse {
  location: { lat: number; lng: number };
  fetchedAt: string;
  source: string;
  current: WeatherCurrent | null;
  hourly: WeatherHour[];
  daily: WeatherDay[];
  fromCache?: boolean;
}

// Compact snapshot recorded on the daily report / delay log when the user
// hits "Save". Captures the current observation plus the originating
// source + timestamp so the synced record retains defensible context.
export interface WeatherSnapshot {
  temp: number;
  conditions: string;
  weatherCode: number;
  windSpeed: number;
  precipitation: number;
  todayHigh: number | null;
  todayLow: number | null;
  recordedAt: string;
  source: string;
}

export async function fetchSiteWeather(lat: number, lng: number): Promise<WeatherSiteResponse> {
  const qs = `lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`;
  return api<WeatherSiteResponse>(`/api/weather/site?${qs}`);
}

export function snapshotFromCurrent(current: WeatherCurrent, source: string): WeatherSnapshot {
  return {
    temp: current.temp,
    conditions: current.conditions,
    weatherCode: current.weatherCode,
    windSpeed: current.windSpeed,
    precipitation: current.precipitation,
    todayHigh: current.todayHigh,
    todayLow: current.todayLow,
    recordedAt: new Date().toISOString(),
    source,
  };
}

// Mobile sync envelope persists weather as a plain text column on
// daily_reports; serialise the snapshot to a one-liner so the office web
// app still reads something useful while the structured JSON is
// preserved verbatim.
export function snapshotToString(s: WeatherSnapshot): string {
  const hi = s.todayHigh != null ? `, H ${Math.round(s.todayHigh)}°` : "";
  const lo = s.todayLow != null ? `, L ${Math.round(s.todayLow)}°` : "";
  const precip = s.precipitation > 0 ? `, ${s.precipitation.toFixed(2)}in precip` : "";
  return `${s.conditions}, ${Math.round(s.temp)}°F${hi}${lo}, wind ${Math.round(s.windSpeed)} mph${precip} (recorded ${s.recordedAt}, source ${s.source})`;
}

export function weatherIconFor(code: number): string {
  if (code === 0) return "☀";
  if (code <= 2) return "🌤";
  if (code === 3) return "☁";
  if (code === 45 || code === 48) return "🌫";
  if (code >= 51 && code <= 57) return "🌦";
  if (code >= 61 && code <= 67) return "🌧";
  if (code >= 71 && code <= 77) return "❄";
  if (code >= 80 && code <= 82) return "🌧";
  if (code >= 85 && code <= 86) return "🌨";
  if (code >= 95) return "⛈";
  return "🌡";
}
