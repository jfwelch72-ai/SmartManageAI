import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { fetchSiteWeather, weatherIconFor, type WeatherSiteResponse } from "@/api/weather";
import { getMeta, setMeta } from "@/sync/db";
import { colors, spacing } from "@/theme";

// Task #3107 — Compact current-conditions widget for the home screen.
// Renders the primary project's last-known weather even when offline by
// caching the most recent /api/weather/site response in AsyncStorage.
// Tapping the widget navigates to the Weather detail screen.

const CACHE_PREFIX = "weather.site.";

export interface WeatherWidgetProject {
  id: string;
  name?: string;
  title?: string;
  siteLatitude?: number | null;
  siteLongitude?: number | null;
}

interface Props {
  project: WeatherWidgetProject | null;
  onPress?: () => void;
}

async function readCache(projectId: string): Promise<WeatherSiteResponse | null> {
  try {
    const raw = await getMeta(CACHE_PREFIX + projectId);
    return raw ? (JSON.parse(raw) as WeatherSiteResponse) : null;
  } catch {
    return null;
  }
}

async function writeCache(projectId: string, data: WeatherSiteResponse): Promise<void> {
  try {
    await setMeta(CACHE_PREFIX + projectId, JSON.stringify(data));
  } catch {
    /* non-fatal — widget will refetch next time. */
  }
}

export function WeatherWidget({ project, onPress }: Props): JSX.Element | null {
  const [data, setData] = useState<WeatherSiteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!project?.id) return;
    void (async () => {
      const cached = await readCache(project.id);
      if (!cancelled && cached) setData(cached);
      if (project.siteLatitude == null || project.siteLongitude == null) {
        if (!cached) setError("No coordinates on project");
        return;
      }
      setLoading(true);
      try {
        const fresh = await fetchSiteWeather(project.siteLatitude, project.siteLongitude);
        if (cancelled) return;
        setData(fresh);
        setError(null);
        await writeCache(project.id, fresh);
      } catch (e) {
        if (cancelled) return;
        if (!cached) setError("Weather unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [project?.id, project?.siteLatitude, project?.siteLongitude]);

  if (!project) return null;

  const current = data?.current ?? null;
  const projectName = project.name ?? project.title ?? "Project";

  return (
    <Pressable
      onPress={onPress}
      style={styles.card}
      testID="widget-weather"
      accessibilityRole="button"
      accessibilityLabel="Open weather detail"
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>Weather · {projectName}</Text>
        {current ? (
          <View style={styles.row}>
            <Text style={styles.icon}>{weatherIconFor(current.weatherCode)}</Text>
            <View>
              <Text style={styles.temp} testID="text-weather-temp">{Math.round(current.temp)}°F</Text>
              <Text style={styles.sub} testID="text-weather-conditions">{current.conditions}</Text>
              <Text style={styles.sub}>
                Wind {Math.round(current.windSpeed)} mph · Precip {current.precipitation.toFixed(2)} in
              </Text>
              {(current.todayHigh != null || current.todayLow != null) ? (
                <Text style={styles.sub}>
                  Today H {current.todayHigh != null ? Math.round(current.todayHigh) : "—"}° ·
                  L {current.todayLow != null ? Math.round(current.todayLow) : "—"}°
                </Text>
              ) : null}
            </View>
          </View>
        ) : loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Text style={styles.sub} testID="text-weather-error">{error ?? "Loading weather…"}</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 10, minHeight: 64 },
  label: { color: colors.textMuted, fontSize: 12, marginBottom: spacing(0.5) },
  row: { flexDirection: "row", alignItems: "center", gap: spacing(2) },
  icon: { fontSize: 40 },
  temp: { color: colors.text, fontSize: 22, fontWeight: "700" },
  sub: { color: colors.textMuted, fontSize: 12 },
});
