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
  tempHigh: number;
  tempLow: number;
  precipitation: number;
  windSpeed: number;
  conditions: string;
  alerts?: string[];
}

interface WeatherEvidence {
  fetchedAt: string;
  location: { lat: number; lng: number };
  dailyData: WeatherDayEvidence[];
}

interface WeatherEvidenceCardProps {
  evidence: WeatherEvidence;
  compact?: boolean;
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
  return (
    day.precipitation > 0.5 ||
    day.windSpeed > 25 ||
    day.conditions.toLowerCase().includes("thunder") ||
    day.conditions.toLowerCase().includes("heavy") ||
    day.conditions.toLowerCase().includes("violent") ||
    day.tempLow < 32 ||
    day.tempHigh > 100
  );
}

function DayEvidence({ day }: { day: WeatherDayEvidence }) {
  const Icon = getWeatherIcon(day.conditions);
  const severe = isSevereWeather(day);

  return (
    <div 
      className={`flex-shrink-0 w-28 p-3 rounded-lg border ${severe ? "border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950" : "bg-muted/50"}`}
      data-testid={`weather-evidence-${day.date}`}
    >
      <div className="text-center">
        <p className="text-xs font-medium">{format(parseISO(day.date), "EEE")}</p>
        <p className="text-xs text-muted-foreground">{format(parseISO(day.date), "MMM d")}</p>
        <Icon className={`w-6 h-6 mx-auto my-2 ${severe ? "text-orange-600" : "text-muted-foreground"}`} />
        <p className="text-xs truncate" title={day.conditions}>{day.conditions}</p>
        <div className="flex justify-center items-center gap-1 text-xs mt-1">
          <Thermometer className="w-3 h-3 text-muted-foreground" />
          <span>{Math.round(day.tempHigh)}° / {Math.round(day.tempLow)}°</span>
        </div>
        {day.precipitation > 0 && (
          <div className="flex items-center justify-center gap-1 mt-1 text-xs text-blue-600 dark:text-blue-400">
            <Droplets className="w-3 h-3" />
            <span>{day.precipitation.toFixed(2)}"</span>
          </div>
        )}
        {day.windSpeed > 15 && (
          <div className="flex items-center justify-center gap-1 mt-1 text-xs text-gray-600 dark:text-gray-400">
            <Wind className="w-3 h-3" />
            <span>{Math.round(day.windSpeed)} mph</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function WeatherEvidenceCard({ evidence, compact = false }: WeatherEvidenceCardProps) {
  if (!evidence?.dailyData?.length) return null;

  const severeDays = evidence.dailyData.filter(isSevereWeather);
  const totalPrecipitation = evidence.dailyData.reduce((acc, d) => acc + (d.precipitation || 0), 0);
  const maxWind = Math.max(...evidence.dailyData.map(d => d.windSpeed || 0));
  const minTemp = Math.min(...evidence.dailyData.map(d => d.tempLow));
  const maxTemp = Math.max(...evidence.dailyData.map(d => d.tempHigh));

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
            <span>{evidence.dailyData.length} days tracked</span>
          </div>
        </div>
      </div>
    );
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
            <p className="text-lg font-semibold text-purple-700 dark:text-purple-300">{evidence.dailyData.length}</p>
            <p className="text-xs text-muted-foreground">Days Tracked</p>
          </div>
        </div>

        <ScrollArea className="w-full">
          <div className="flex gap-2 pb-2">
            {evidence.dailyData.map((day) => (
              <DayEvidence key={day.date} day={day} />
            ))}
          </div>
        </ScrollArea>

        <p className="text-xs text-muted-foreground mt-2 text-right">
          Data fetched {format(new Date(evidence.fetchedAt), "MMM d, yyyy 'at' h:mm a")}
        </p>
      </CardContent>
    </Card>
  );
}

export default WeatherEvidenceCard;
