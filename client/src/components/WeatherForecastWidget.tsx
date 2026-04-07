import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, Component, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  MapPin,
  RefreshCw,
  Search,
  AlertCircle
} from "lucide-react";
import { format, parseISO } from "date-fns";

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

interface GeocodeResult {
  name: string;
  admin1?: string;
  country: string;
  lat: number;
  lng: number;
}

function getWeatherIcon(code: number): typeof Sun {
  if (code === 0 || code === 1) return Sun;
  if (code === 2 || code === 3) return Cloud;
  if (code >= 45 && code <= 48) return CloudFog;
  if (code >= 51 && code <= 57) return CloudDrizzle;
  if (code >= 61 && code <= 67) return CloudRain;
  if (code >= 71 && code <= 77) return CloudSnow;
  if (code >= 80 && code <= 82) return CloudRain;
  if (code >= 85 && code <= 86) return CloudSnow;
  if (code >= 95) return CloudLightning;
  return Cloud;
}

function getWeatherGradient(code: number): string {
  if (code === 0 || code === 1) return "from-yellow-100 to-orange-100 dark:from-yellow-900/20 dark:to-orange-900/20";
  if (code === 2 || code === 3) return "from-gray-100 to-slate-100 dark:from-gray-900/20 dark:to-slate-900/20";
  if (code >= 45 && code <= 48) return "from-gray-200 to-gray-300 dark:from-gray-800/30 dark:to-gray-700/30";
  if (code >= 51 && code <= 67) return "from-blue-100 to-blue-200 dark:from-blue-900/20 dark:to-blue-800/30";
  if (code >= 71 && code <= 86) return "from-slate-100 to-blue-100 dark:from-slate-900/20 dark:to-blue-900/20";
  if (code >= 95) return "from-purple-100 to-gray-200 dark:from-purple-900/20 dark:to-gray-800/30";
  return "from-gray-100 to-gray-200 dark:from-gray-900/20 dark:to-gray-800/30";
}

function DayCard({ day, isToday }: { day: WeatherDay; isToday: boolean }) {
  const Icon = getWeatherIcon(day.weatherCode);
  const gradient = getWeatherGradient(day.weatherCode);
  const dayName = isToday ? "Today" : format(parseISO(day.date), "EEE");
  const dateStr = format(parseISO(day.date), "MMM d");

  return (
    <div 
      className={`flex-shrink-0 w-20 sm:w-24 p-2 sm:p-3 rounded-lg border bg-gradient-to-b ${gradient} ${isToday ? "ring-2 ring-primary" : ""}`}
      data-testid={`weather-day-${day.date}`}
    >
      <div className="text-center">
        <p className={`text-xs font-medium ${isToday ? "text-primary" : "text-muted-foreground"}`}>
          {dayName}
        </p>
        <p className="text-xs text-muted-foreground">{dateStr}</p>
        <Icon className="w-8 h-8 mx-auto my-2 text-foreground" />
        <div className="flex justify-center items-center gap-1 text-sm">
          <span className="font-semibold">{Math.round(day.tempHigh)}°</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground">{Math.round(day.tempLow)}°</span>
        </div>
        {day.precipitation > 0 && (
          <div className="flex items-center justify-center gap-1 mt-1 text-xs text-blue-600 dark:text-blue-400">
            <Droplets className="w-3 h-3" />
            <span>{day.precipitation.toFixed(1)}"</span>
          </div>
        )}
      </div>
    </div>
  );
}

type GeoState = "idle" | "requesting" | "denied" | "unavailable" | "granted";

interface WeatherWidgetProps {
  compact?: boolean;
  defaultLat?: number;
  defaultLng?: number;
  defaultLocationName?: string;
}

interface WeatherErrorBoundaryState {
  hasError: boolean;
}

class WeatherErrorBoundary extends Component<
  { children: ReactNode; onRetry?: () => void },
  WeatherErrorBoundaryState
> {
  constructor(props: { children: ReactNode; onRetry?: () => void }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): WeatherErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card data-testid="weather-widget-render-error">
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="w-8 h-8 text-destructive mb-2 opacity-70" />
            <p className="text-sm text-muted-foreground">Weather unavailable</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                this.setState({ hasError: false });
                if (this.props.onRetry) this.props.onRetry();
              }}
              data-testid="button-retry-weather-boundary"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Retry
            </Button>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}

function WeatherForecastWidgetInner({ 
  compact = false,
  defaultLat,
  defaultLng,
  defaultLocationName,
}: WeatherWidgetProps) {
  const [location, setLocation] = useState<{ lat: number; lng: number; name?: string }>({
    lat: defaultLat ?? 40.7128,
    lng: defaultLng ?? -74.0060,
    name: defaultLocationName ?? "New York, NY"
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [geoState, setGeoState] = useState<GeoState>("idle");

  useEffect(() => {
    if (defaultLat != null || defaultLng != null) return;
    if (!navigator?.geolocation) {
      setGeoState("unavailable");
      return;
    }
    setGeoState("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          name: "Current Location",
        });
        setGeoState("granted");
      },
      () => {
        setGeoState("denied");
      },
      { timeout: 10000 }
    );
  }, [defaultLat, defaultLng]);

  const { data: weather, isLoading, isError, refetch, isFetching } = useQuery<WeatherResponse>({
    queryKey: ['/api/weather/forecast', location.lat, location.lng, 7],
    queryFn: async () => {
      const res = await fetch(`/api/weather/forecast?lat=${location.lat}&lng=${location.lng}&days=7`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error('Failed to fetch weather');
      return res.json();
    },
    staleTime: 1000 * 60 * 30,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
  });

  const { data: searchResults } = useQuery<{ results: GeocodeResult[] }>({
    queryKey: ['/api/weather/geocode', searchQuery],
    queryFn: async () => {
      const res = await fetch(`/api/weather/geocode?address=${encodeURIComponent(searchQuery)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error('Failed to geocode');
      return res.json();
    },
    enabled: searchQuery.length >= 3,
    staleTime: 1000 * 60 * 5,
  });

  const handleLocationSelect = (result: GeocodeResult) => {
    setLocation({
      lat: result.lat,
      lng: result.lng,
      name: `${result.name}${result.admin1 ? `, ${result.admin1}` : ""}`
    });
    setSearchQuery("");
    setIsSearching(false);
  };

  if (isLoading && !weather) {
    return (
      <Card data-testid="weather-widget-loading">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Cloud className="h-5 w-5 text-primary" />
            Weather Forecast
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-20 w-full rounded-lg" />
            <div className="flex gap-2 overflow-hidden">
              {[1, 2, 3, 4, 5].map(i => (
                <Skeleton key={i} className="w-24 h-32 rounded-lg flex-shrink-0" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError && !weather) {
    return (
      <Card data-testid="weather-widget-error">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Cloud className="h-5 w-5 text-primary" />
              Weather Forecast
            </CardTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-retry-weather"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground" data-testid="weather-error-state">
            <Cloud className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm font-medium">Weather unavailable</p>
            <p className="text-xs mt-1 opacity-75">Unable to load forecast. Check your connection or try again.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-retry-weather-cta"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const dailyData = weather?.dailyData;
  if (!dailyData || !Array.isArray(dailyData) || dailyData.length === 0) {
    return (
      <Card data-testid="weather-widget-no-data">
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <Cloud className="w-8 h-8 text-muted-foreground mb-2 opacity-40" />
          <p className="text-sm text-muted-foreground">Weather unavailable</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()} disabled={isFetching}
            data-testid="button-retry-weather-nodata">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const todayConditions = dailyData[0];

  return (
    <Card data-testid="weather-widget">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Cloud className="h-5 w-5 text-primary" />
                Weather Forecast
              </CardTitle>
              <CardDescription className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {location.name || `${location.lat.toFixed(2)}, ${location.lng.toFixed(2)}`}
                {(geoState === "denied" || geoState === "unavailable") && !defaultLat && (
                  <span className="ml-1 text-muted-foreground/60">(location unavailable — using default)</span>
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {geoState === "requesting" && (
                <Badge variant="outline" className="text-xs">Detecting location...</Badge>
              )}
              <Button 
                size="sm" 
                variant="ghost"
                onClick={() => setIsSearching(!isSearching)}
                data-testid="button-search-location"
              >
                <Search className="h-4 w-4" />
              </Button>
              <Button 
                size="sm" 
                variant="ghost"
                onClick={() => refetch()}
                disabled={isFetching}
                data-testid="button-refresh-weather"
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          {isSearching && (
            <div className="relative mt-2 space-y-2">
              <Input
                placeholder="Search location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8"
                data-testid="input-search-location"
              />
              {searchResults?.results && searchResults.results.length > 0 && (
                <div className="absolute z-10 left-0 right-0 bg-background border rounded-md shadow-lg mt-1">
                  {searchResults.results.map((result, i) => (
                    <button
                      key={i}
                      className="w-full text-left px-3 py-2 hover-elevate text-sm"
                      onClick={() => handleLocationSelect(result)}
                      data-testid={`location-result-${i}`}
                    >
                      {result.name}{result.admin1 ? `, ${result.admin1}` : ""}, {result.country}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardHeader>

        <CardContent>
          {todayConditions && !compact && (
            <div className={`p-4 rounded-lg mb-4 bg-gradient-to-br ${getWeatherGradient(todayConditions.weatherCode)}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Today</p>
                  <p className="text-2xl sm:text-3xl font-bold">{Math.round(todayConditions.tempHigh)}°F</p>
                  <p className="text-sm text-muted-foreground">{todayConditions.conditions}</p>
                </div>
                <div className="text-center">
                  {(() => {
                    const TodayIcon = getWeatherIcon(todayConditions.weatherCode);
                    return <TodayIcon className="w-12 h-12 sm:w-16 sm:h-16 text-foreground" />;
                  })()}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:gap-4 mt-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Thermometer className="w-4 h-4" />
                  <span>L: {Math.round(todayConditions.tempLow)}°</span>
                </div>
                <div className="flex items-center gap-1">
                  <Wind className="w-4 h-4" />
                  <span>{Math.round(todayConditions.windSpeed)} mph</span>
                </div>
                {todayConditions.precipitation > 0 && (
                  <div className="flex items-center gap-1">
                    <Droplets className="w-4 h-4" />
                    <span>{todayConditions.precipitation.toFixed(1)}"</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <ScrollArea className="w-full">
            <div className="flex gap-2 pb-2">
              {dailyData.map((day, index) => (
                <DayCard key={day.date} day={day} isToday={index === 0} />
              ))}
            </div>
          </ScrollArea>

          {weather?.fetchedAt && (
            <p className="text-xs text-muted-foreground mt-2 text-right">
              Updated {format(new Date(weather.fetchedAt), "h:mm a")}
            </p>
          )}
        </CardContent>
      </Card>
    );
}

export function WeatherForecastWidget(props: WeatherWidgetProps) {
  return (
    <WeatherErrorBoundary>
      <WeatherForecastWidgetInner {...props} />
    </WeatherErrorBoundary>
  );
}

export default WeatherForecastWidget;
