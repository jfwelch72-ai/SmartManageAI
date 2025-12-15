import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Cloud, 
  CloudRain, 
  CloudSnow, 
  CloudLightning, 
  Sun,
  CloudFog,
  CloudDrizzle,
  Wind,
  Droplets,
  Thermometer,
  AlertTriangle
} from "lucide-react";
import { format, parseISO } from "date-fns";

interface WeatherDayEvidence {
  date: string;
  tempHigh?: number | null;
  tempLow?: number | null;
  precipitation?: number | null;
  windSpeed?: number | null;
  conditions?: string | null;
  alerts?: string[];
}

interface WeatherEvidence {
  fetchedAt: string;
  location: { lat: number; lng: number };
  dailyData: WeatherDayEvidence[];
}

interface WeatherEvidenceCardProps {
  evidence: unknown;
  compact?: boolean;
}

function isValidWeatherEvidence(data: unknown): data is WeatherEvidence {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.fetchedAt !== 'string') return false;
  if (!obj.dailyData || !Array.isArray(obj.dailyData)) return false;
  if (obj.dailyData.length === 0) return false;
  return obj.dailyData.every((day: unknown) => {
    if (!day || typeof day !== 'object') return false;
    const d = day as Record<string, unknown>;
    return typeof d.date === 'string';
  });
}

function safeNumber(val: unknown, fallback: number = 0): number {
  if (typeof val === 'number' && !isNaN(val)) return val;
  return fallback;
}

function safeString(val: unknown, fallback: string = ''): string {
  if (typeof val === 'string') return val;
  return fallback;
}

function getWeatherIcon(conditions: string) {
  const c = conditions.toLowerCase();
  if (c.includes("clear") || c.includes("sunny")) return Sun;
  if (c.includes("fog")) return CloudFog;
  if (c.includes("drizzle")) return CloudDrizzle;
  if (c.includes("rain") || c.includes("shower")) return CloudRain;
  if (c.includes("snow") || c.includes("sleet")) return CloudSnow;
  if (c.includes("thunder") || c.includes("storm")) return CloudLightning;
  return Cloud;
}

function isSevereWeather(day: WeatherDayEvidence): boolean {
  const precip = safeNumber(day.precipitation);
  const wind = safeNumber(day.windSpeed);
  const tempLow = safeNumber(day.tempLow, 50);
  const tempHigh = safeNumber(day.tempHigh, 70);
  const conditions = safeString(day.conditions).toLowerCase();
  
  return (
    precip > 0.5 ||
    wind > 25 ||
    conditions.includes("thunder") ||
    conditions.includes("heavy") ||
    conditions.includes("violent") ||
    tempLow < 32 ||
    tempHigh > 100
  );
}

function DayEvidence({ day }: { day: WeatherDayEvidence }) {
  const conditions = safeString(day.conditions, 'Unknown');
  const tempHigh = safeNumber(day.tempHigh, 70);
  const tempLow = safeNumber(day.tempLow, 50);
  const precip = safeNumber(day.precipitation);
  const wind = safeNumber(day.windSpeed);
  
  const Icon = getWeatherIcon(conditions);
  const severe = isSevereWeather(day);

  let formattedDay = "N/A";
  let formattedDate = "N/A";
  try {
    formattedDay = format(parseISO(day.date), "EEE");
    formattedDate = format(parseISO(day.date), "MMM d");
  } catch {
    formattedDay = day.date?.slice(0, 3) || "N/A";
  }

  return (
    <div 
      className={`flex-shrink-0 w-28 p-3 rounded-lg border ${severe ? "border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950" : "bg-muted/50"}`}
      data-testid={`weather-evidence-${day.date}`}
    >
      <div className="text-center">
        <p className="text-xs font-medium">{formattedDay}</p>
        <p className="text-xs text-muted-foreground">{formattedDate}</p>
        <Icon className={`w-6 h-6 mx-auto my-2 ${severe ? "text-orange-600" : "text-muted-foreground"}`} />
        <p className="text-xs truncate" title={conditions}>{conditions}</p>
        <div className="flex justify-center items-center gap-1 text-xs mt-1">
          <Thermometer className="w-3 h-3 text-muted-foreground" />
          <span>{Math.round(tempHigh)}° / {Math.round(tempLow)}°</span>
        </div>
        {precip > 0 && (
          <div className="flex items-center justify-center gap-1 mt-1 text-xs text-blue-600 dark:text-blue-400">
            <Droplets className="w-3 h-3" />
            <span>{precip.toFixed(2)}"</span>
          </div>
        )}
        {wind > 15 && (
          <div className="flex items-center justify-center gap-1 mt-1 text-xs text-gray-600 dark:text-gray-400">
            <Wind className="w-3 h-3" />
            <span>{Math.round(wind)} mph</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function WeatherEvidenceCard({ evidence, compact = false }: WeatherEvidenceCardProps) {
  if (!isValidWeatherEvidence(evidence)) {
    return null;
  }

  const validDays = evidence.dailyData.filter(d => d && typeof d.date === 'string');
  if (validDays.length === 0) return null;

  const severeDays = validDays.filter(isSevereWeather);
  const totalPrecipitation = validDays.reduce((acc, d) => acc + safeNumber(d.precipitation), 0);
  
  const windSpeeds = validDays.map(d => safeNumber(d.windSpeed));
  const maxWind = windSpeeds.length > 0 ? Math.max(...windSpeeds) : 0;
  
  const temps = validDays.flatMap(d => [safeNumber(d.tempLow, 50), safeNumber(d.tempHigh, 70)]);
  const minTemp = temps.length > 0 ? Math.min(...temps) : 50;
  const maxTemp = temps.length > 0 ? Math.max(...temps) : 70;

  if (compact) {
    return (
      <div className="mt-3 pt-3 border-t" data-testid="weather-evidence-compact">
        <div className="flex items-center gap-2 mb-2">
          <CloudRain className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-medium">Weather Evidence</span>
          {severeDays.length > 0 && (
            <Badge variant="destructive" className="text-xs">
              {severeDays.length} Severe Day{severeDays.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Droplets className="w-3 h-3" />
            <span>{totalPrecipitation.toFixed(2)}" total</span>
          </div>
          <div className="flex items-center gap-1">
            <Wind className="w-3 h-3" />
            <span>{Math.round(maxWind)} mph max</span>
          </div>
          <div className="flex items-center gap-1">
            <Thermometer className="w-3 h-3" />
            <span>{Math.round(minTemp)}° - {Math.round(maxTemp)}°</span>
          </div>
          <div className="text-right">
            <span>{validDays.length} days tracked</span>
          </div>
        </div>
      </div>
    );
  }

  let fetchedAtFormatted = "Unknown";
  try {
    fetchedAtFormatted = format(new Date(evidence.fetchedAt), "MMM d, yyyy 'at' h:mm a");
  } catch {
    fetchedAtFormatted = evidence.fetchedAt;
  }

  return (
    <Card data-testid="weather-evidence-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <CloudRain className="h-4 w-4 text-blue-500" />
              Weather Evidence
            </CardTitle>
            <CardDescription>
              Historical weather data for delay period
            </CardDescription>
          </div>
          {severeDays.length > 0 && (
            <Badge variant="destructive" className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {severeDays.length} Severe Day{severeDays.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
          <div className="p-2 rounded bg-blue-50 dark:bg-blue-950 text-center">
            <Droplets className="w-4 h-4 mx-auto text-blue-500 mb-1" />
            <p className="text-lg font-semibold text-blue-700 dark:text-blue-300">{totalPrecipitation.toFixed(2)}"</p>
            <p className="text-xs text-muted-foreground">Total Precipitation</p>
          </div>
          <div className="p-2 rounded bg-gray-50 dark:bg-gray-900 text-center">
            <Wind className="w-4 h-4 mx-auto text-gray-500 mb-1" />
            <p className="text-lg font-semibold">{Math.round(maxWind)} mph</p>
            <p className="text-xs text-muted-foreground">Max Wind Speed</p>
          </div>
          <div className="p-2 rounded bg-orange-50 dark:bg-orange-950 text-center">
            <Thermometer className="w-4 h-4 mx-auto text-orange-500 mb-1" />
            <p className="text-lg font-semibold text-orange-700 dark:text-orange-300">{Math.round(minTemp)}° - {Math.round(maxTemp)}°</p>
            <p className="text-xs text-muted-foreground">Temp Range (°F)</p>
          </div>
          <div className="p-2 rounded bg-purple-50 dark:bg-purple-950 text-center">
            <Cloud className="w-4 h-4 mx-auto text-purple-500 mb-1" />
            <p className="text-lg font-semibold text-purple-700 dark:text-purple-300">{validDays.length}</p>
            <p className="text-xs text-muted-foreground">Days Tracked</p>
          </div>
        </div>

        <ScrollArea className="w-full">
          <div className="flex gap-2 pb-2">
            {validDays.map((day) => (
              <DayEvidence key={day.date} day={day} />
            ))}
          </div>
        </ScrollArea>

        <p className="text-xs text-muted-foreground mt-2 text-right">
          Data fetched {fetchedAtFormatted}
        </p>
      </CardContent>
    </Card>
  );
}

export default WeatherEvidenceCard;
