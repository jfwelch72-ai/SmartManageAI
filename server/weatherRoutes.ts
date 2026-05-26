import { logError } from "./utils/logger";
import { Router, type Response, NextFunction } from "express";
import { requireAuth, type AuthRequest } from "./auth";

const router = Router();

// In-memory cache for weather data (30 minute TTL)
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const weatherCache = new Map<string, CacheEntry<any>>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getCacheKey(type: string, lat: number, lng: number, extra?: string): string {
  // Round coords to 2 decimal places for cache key
  const roundedLat = Math.round(lat * 100) / 100;
  const roundedLng = Math.round(lng * 100) / 100;
  return `${type}:${roundedLat}:${roundedLng}${extra ? `:${extra}` : ''}`;
}

function getFromCache<T>(key: string): T | null {
  const entry = weatherCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    weatherCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  weatherCache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  // Clean up old entries periodically
  if (weatherCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of weatherCache.entries()) {
      if (now > v.expiresAt) weatherCache.delete(k);
    }
  }
}

interface WeatherDay {
  date: string;
  tempHigh: number;
  tempLow: number;
  precipitation: number;
  windSpeed: number;
  conditions: string;
  weatherCode: number;
}

interface WeatherResponse {
  location: { lat: number; lng: number };
  fetchedAt: string;
  dailyData: WeatherDay[];
}

const WEATHER_CODE_DESCRIPTIONS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow fall",
  73: "Moderate snow fall",
  75: "Heavy snow fall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function getConditionsFromCode(code: number): string {
  return WEATHER_CODE_DESCRIPTIONS[code] || "Unknown";
}

function generateFallbackForecast(numDays: number): WeatherDay[] {
  const today = new Date();
  const baseCodes = [0, 2, 3, 61, 1, 2, 0, 3, 80, 1, 2, 0, 61, 3, 1, 0];
  const days: WeatherDay[] = [];
  for (let i = 0; i < numDays; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const code = baseCodes[i % baseCodes.length];
    const seasonOffset = Math.sin((d.getMonth() - 3) * Math.PI / 6) * 25;
    days.push({
      date: d.toISOString().split("T")[0],
      tempHigh: Math.round(65 + seasonOffset + (Math.random() * 8 - 4)),
      tempLow: Math.round(48 + seasonOffset + (Math.random() * 6 - 3)),
      precipitation: code >= 51 ? +(Math.random() * 0.5).toFixed(2) : 0,
      windSpeed: Math.round(5 + Math.random() * 10),
      conditions: getConditionsFromCode(code),
      weatherCode: code,
    });
  }
  return days;
}

router.get("/forecast", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { lat, lng, days = "10" } = req.query;

    if (!lat || !lng) {
      res.status(400).json({ error: "Latitude and longitude are required" });
      return;
    }

    const latitude = parseFloat(lat as string);
    const longitude = parseFloat(lng as string);
    const numDays = Math.min(parseInt(days as string, 10), 16);

    if (isNaN(latitude) || isNaN(longitude)) {
      res.status(400).json({ error: "Invalid latitude or longitude" });
      return;
    }

    // Check cache first
    const cacheKey = getCacheKey('forecast', latitude, longitude, String(numDays));
    const cached = getFromCache<WeatherResponse>(cacheKey);
    if (cached) {
      res.json({ ...cached, fromCache: true });
      return;
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=${numDays}`;

    let dailyData: WeatherDay[];

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        logError("Open-Meteo API error", { status: response.status });
        dailyData = generateFallbackForecast(numDays);
      } else {
        const data = await response.json();
        dailyData = data.daily.time.map((date: string, i: number) => ({
          date,
          tempHigh: data.daily.temperature_2m_max[i],
          tempLow: data.daily.temperature_2m_min[i],
          precipitation: data.daily.precipitation_sum[i] || 0,
          windSpeed: data.daily.wind_speed_10m_max[i] || 0,
          conditions: getConditionsFromCode(data.daily.weather_code[i]),
          weatherCode: data.daily.weather_code[i],
        }));
      }
    } catch (fetchErr) {
      logError("Open-Meteo fetch failed, using fallback", {}, fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr)));
      dailyData = generateFallbackForecast(numDays);
    }

    const result: WeatherResponse = {
      location: { lat: latitude, lng: longitude },
      fetchedAt: new Date().toISOString(),
      dailyData,
    };

    setCache(cacheKey, result);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/history", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { lat, lng, startDate, endDate } = req.query;

    if (!lat || !lng || !startDate || !endDate) {
      res.status(400).json({ error: "Latitude, longitude, startDate, and endDate are required" });
      return;
    }

    const latitude = parseFloat(lat as string);
    const longitude = parseFloat(lng as string);

    if (isNaN(latitude) || isNaN(longitude)) {
      res.status(400).json({ error: "Invalid latitude or longitude" });
      return;
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      return;
    }

    const maxHistoryDate = new Date();
    maxHistoryDate.setFullYear(maxHistoryDate.getFullYear() - 2);
    if (start < maxHistoryDate) {
      res.status(400).json({ error: "Historical data only available for the past 2 years" });
      return;
    }

    const formatDate = (d: Date) => d.toISOString().split("T")[0];
    
    // Check cache first
    const cacheKey = getCacheKey('history', latitude, longitude, `${formatDate(start)}:${formatDate(end)}`);
    const cached = getFromCache<WeatherResponse>(cacheKey);
    if (cached) {
      res.json({ ...cached, fromCache: true });
      return;
    }
    
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${latitude}&longitude=${longitude}&start_date=${formatDate(start)}&end_date=${formatDate(end)}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;

    const response = await fetch(url);
    if (!response.ok) {
      logError("Open-Meteo Archive API error", { status: response.status });
      res.status(502).json({ error: "Weather history service unavailable" });
      return;
    }

    const data = await response.json();

    if (!data.daily || !data.daily.time) {
      res.json({
        location: { lat: latitude, lng: longitude },
        fetchedAt: new Date().toISOString(),
        dailyData: [],
      });
      return;
    }

    const dailyData: WeatherDay[] = data.daily.time.map((date: string, i: number) => ({
      date,
      tempHigh: data.daily.temperature_2m_max[i],
      tempLow: data.daily.temperature_2m_min[i],
      precipitation: data.daily.precipitation_sum[i] || 0,
      windSpeed: data.daily.wind_speed_10m_max[i] || 0,
      conditions: getConditionsFromCode(data.daily.weather_code[i]),
      weatherCode: data.daily.weather_code[i],
    }));

    const result: WeatherResponse = {
      location: { lat: latitude, lng: longitude },
      fetchedAt: new Date().toISOString(),
      dailyData,
    };

    // Cache the result
    setCache(cacheKey, result);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Task #3107 — Mobile site weather. Single round-trip that returns the
// current observation, the next 24 hours of hourly data, and the next 7
// days of daily data so the mobile widget + detail screen + daily-report
// snapshot capture only need one cache key per project. Backed by the
// same Open-Meteo source the existing /forecast endpoint already uses,
// so no new outbound destination is added to the threat model.
interface WeatherHour {
  time: string;
  temp: number;
  precipitation: number;
  windSpeed: number;
  conditions: string;
  weatherCode: number;
}

interface WeatherCurrent {
  observedAt: string;
  temp: number;
  windSpeed: number;
  precipitation: number;
  conditions: string;
  weatherCode: number;
  todayHigh: number | null;
  todayLow: number | null;
}

interface WeatherSiteResponse {
  location: { lat: number; lng: number };
  fetchedAt: string;
  source: string;
  current: WeatherCurrent | null;
  hourly: WeatherHour[];
  daily: WeatherDay[];
}

router.get("/site", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      res.status(400).json({ error: "Latitude and longitude are required" });
      return;
    }
    const latitude = parseFloat(lat as string);
    const longitude = parseFloat(lng as string);
    if (isNaN(latitude) || isNaN(longitude)) {
      res.status(400).json({ error: "Invalid latitude or longitude" });
      return;
    }

    const cacheKey = getCacheKey("site", latitude, longitude);
    const cached = getFromCache<WeatherSiteResponse>(cacheKey);
    if (cached) {
      res.json({ ...cached, fromCache: true });
      return;
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,weather_code,wind_speed_10m,precipitation` +
      `&hourly=temperature_2m,weather_code,wind_speed_10m,precipitation` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=7`;

    let current: WeatherCurrent | null = null;
    let hourly: WeatherHour[] = [];
    let daily: WeatherDay[] = [];
    let source = "open-meteo";

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) {
        logError("Open-Meteo /site error", { status: response.status });
        daily = generateFallbackForecast(7);
        source = "fallback";
      } else {
        const data = await response.json();
        if (data.daily?.time) {
          daily = data.daily.time.map((date: string, i: number) => ({
            date,
            tempHigh: data.daily.temperature_2m_max[i],
            tempLow: data.daily.temperature_2m_min[i],
            precipitation: data.daily.precipitation_sum[i] || 0,
            windSpeed: data.daily.wind_speed_10m_max[i] || 0,
            conditions: getConditionsFromCode(data.daily.weather_code[i]),
            weatherCode: data.daily.weather_code[i],
          }));
        }
        if (data.hourly?.time) {
          const now = Date.now();
          const all: WeatherHour[] = data.hourly.time.map((t: string, i: number) => ({
            time: t,
            temp: data.hourly.temperature_2m[i],
            precipitation: data.hourly.precipitation[i] || 0,
            windSpeed: data.hourly.wind_speed_10m[i] || 0,
            conditions: getConditionsFromCode(data.hourly.weather_code[i]),
            weatherCode: data.hourly.weather_code[i],
          }));
          hourly = all.filter((h) => new Date(h.time).getTime() >= now - 60 * 60 * 1000).slice(0, 24);
        }
        if (data.current) {
          const today = daily[0] ?? null;
          current = {
            observedAt: data.current.time ?? new Date().toISOString(),
            temp: data.current.temperature_2m,
            windSpeed: data.current.wind_speed_10m ?? 0,
            precipitation: data.current.precipitation ?? 0,
            conditions: getConditionsFromCode(data.current.weather_code),
            weatherCode: data.current.weather_code,
            todayHigh: today?.tempHigh ?? null,
            todayLow: today?.tempLow ?? null,
          };
        }
      }
    } catch (fetchErr) {
      logError("Open-Meteo /site fetch failed", {}, fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr)));
      daily = generateFallbackForecast(7);
      source = "fallback";
    }

    const result: WeatherSiteResponse = {
      location: { lat: latitude, lng: longitude },
      fetchedAt: new Date().toISOString(),
      source,
      current,
      hourly,
      daily,
    };
    setCache(cacheKey, result);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/geocode", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { address } = req.query;

    if (!address) {
      res.status(400).json({ error: "Address is required" });
      return;
    }

    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(address as string)}&count=5&language=en&format=json`;

    const response = await fetch(url);
    if (!response.ok) {
      logError("Open-Meteo Geocoding error", { status: response.status });
      res.status(502).json({ error: "Geocoding service unavailable" });
      return;
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      res.json({ results: [] });
      return;
    }

    const results = data.results.map((r: any) => ({
      name: r.name,
      admin1: r.admin1,
      country: r.country,
      lat: r.latitude,
      lng: r.longitude,
    }));

    res.json({ results });
  } catch (error) {
    next(error);
  }
});

export default router;
