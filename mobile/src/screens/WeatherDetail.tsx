import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { cacheList } from "@/sync/db";
import { fetchSiteWeather, weatherIconFor, type WeatherSiteResponse } from "@/api/weather";
import { colors, spacing } from "@/theme";

// Task #3107 — Weather detail screen. Shows next 24h hourly + 7-day daily
// forecast for the user's primary project. Reads project coordinates
// from the offline PROJECT cache so it works without an extra round-trip.

interface ProjectRow {
  id: string;
  name?: string;
  title?: string;
  siteLatitude?: number | null;
  siteLongitude?: number | null;
}

function formatHour(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric" });
}

function formatDay(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

export function WeatherDetailScreen(): JSX.Element {
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [data, setData] = useState<WeatherSiteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const projects = await cacheList<ProjectRow>("PROJECT");
      const primary = projects.find((p) => p.siteLatitude != null && p.siteLongitude != null) ?? projects[0] ?? null;
      if (cancelled) return;
      setProject(primary);
      if (!primary || primary.siteLatitude == null || primary.siteLongitude == null) {
        setError("No project with coordinates");
        setLoading(false);
        return;
      }
      try {
        const fresh = await fetchSiteWeather(primary.siteLatitude, primary.siteLongitude);
        if (!cancelled) setData(fresh);
      } catch {
        if (!cancelled) setError("Weather unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        <Text style={styles.h1} testID="text-weather-project">
          {project?.name ?? project?.title ?? "Weather"}
        </Text>

        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {error ? <Text style={styles.sub} testID="text-weather-detail-error">{error}</Text> : null}

        {data?.current ? (
          <View style={styles.card}>
            <Text style={styles.label}>Current</Text>
            <View style={styles.row}>
              <Text style={styles.icon}>{weatherIconFor(data.current.weatherCode)}</Text>
              <View>
                <Text style={styles.temp}>{Math.round(data.current.temp)}°F</Text>
                <Text style={styles.sub}>{data.current.conditions}</Text>
                <Text style={styles.sub}>
                  Wind {Math.round(data.current.windSpeed)} mph · Precip {data.current.precipitation.toFixed(2)} in
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {data?.hourly?.length ? (
          <View style={styles.card}>
            <Text style={styles.label}>Next 24 hours</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", gap: spacing(2) }}>
                {data.hourly.map((h) => (
                  <View key={h.time} style={styles.hourCell} testID={`hour-${h.time}`}>
                    <Text style={styles.sub}>{formatHour(h.time)}</Text>
                    <Text style={styles.iconSm}>{weatherIconFor(h.weatherCode)}</Text>
                    <Text style={styles.tempSm}>{Math.round(h.temp)}°</Text>
                    {h.precipitation > 0 ? (
                      <Text style={styles.precip}>{h.precipitation.toFixed(2)}″</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}

        {data?.daily?.length ? (
          <View style={styles.card}>
            <Text style={styles.label}>7-day forecast</Text>
            {data.daily.slice(0, 7).map((d) => (
              <View key={d.date} style={styles.dayRow} testID={`day-${d.date}`}>
                <Text style={[styles.sub, { flex: 1.4 }]}>{formatDay(d.date)}</Text>
                <Text style={styles.iconSm}>{weatherIconFor(d.weatherCode)}</Text>
                <Text style={[styles.sub, { flex: 2 }]} numberOfLines={1}>{d.conditions}</Text>
                <Text style={[styles.tempSm, { flex: 1, textAlign: "right" }]}>
                  {Math.round(d.tempHigh)}° / {Math.round(d.tempLow)}°
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {data ? (
          <Text style={styles.footnote}>
            Source: {data.source} · fetched {new Date(data.fetchedAt).toLocaleString()}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { color: colors.text, fontSize: 20, fontWeight: "700" },
  label: { color: colors.textMuted, fontSize: 12, marginBottom: spacing(1) },
  card: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing(2) },
  icon: { fontSize: 40 },
  iconSm: { fontSize: 20, width: 28, textAlign: "center" },
  temp: { color: colors.text, fontSize: 24, fontWeight: "700" },
  tempSm: { color: colors.text, fontSize: 14, fontWeight: "600" },
  sub: { color: colors.textMuted, fontSize: 12 },
  precip: { color: colors.primary, fontSize: 11 },
  hourCell: { alignItems: "center", gap: spacing(0.5), minWidth: 48 },
  dayRow: { flexDirection: "row", alignItems: "center", gap: spacing(1), paddingVertical: spacing(0.5) },
  footnote: { color: colors.textMuted, fontSize: 10, textAlign: "center" },
});
