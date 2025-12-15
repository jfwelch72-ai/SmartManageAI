import { Router, type Response } from "express";
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

router.get("/forecast", requireAuth, async (req: AuthRequest, res: Response) => {
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

    const response = await fetch(url);
    if (!response.ok) {
      console.error("Open-Meteo API error:", response.status, await response.text());
      res.status(502).json({ error: "Weather service unavailable" });
      return;
    }

    const data = await response.json();

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
    console.error("Error fetching weather forecast:", error);
    res.status(500).json({ error: "Failed to fetch weather forecast" });
  }
});

router.get("/history", requireAuth, async (req: AuthRequest, res: Response) => {
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
      console.error("Open-Meteo Archive API error:", response.status, await response.text());
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
    console.error("Error fetching weather history:", error);
    res.status(500).json({ error: "Failed to fetch weather history" });
  }
});

router.get("/geocode", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { address } = req.query;

    if (!address) {
      res.status(400).json({ error: "Address is required" });
      return;
    }

    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(address as string)}&count=5&language=en&format=json`;

    const response = await fetch(url);
    if (!response.ok) {
      console.error("Open-Meteo Geocoding error:", response.status);
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
    console.error("Error geocoding address:", error);
    res.status(500).json({ error: "Failed to geocode address" });
  }
});

export default router;
