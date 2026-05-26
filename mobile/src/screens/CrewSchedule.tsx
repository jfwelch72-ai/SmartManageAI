import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useAuth } from "@/auth/AuthContext";
import { api } from "@/api/client";
import { cacheList, cachePut } from "@/sync/db";
import { colors, spacing } from "@/theme";

export interface CrewScheduleMember {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  phone: string | null;
  hoursPerDay: number;
  isMe?: boolean;
}

export interface CrewScheduleCrew {
  id: string;
  name: string;
  hoursPerDay: number;
  members: CrewScheduleMember[];
}

export interface CrewScheduleProject {
  id: string;
  code: string | null;
  name: string;
  crews: CrewScheduleCrew[];
}

interface CrewScheduleDay {
  date: string;
  mine: boolean;
  projects: CrewScheduleProject[];
}

const CACHE_ENTITY = "CREW_SCHEDULE_DAY";

function isoDay(d: Date): string {
  // Use local date to match the day picker the user sees.
  const tzOffsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

function shiftDay(date: string, deltaDays: number): string {
  const [y, m, d] = date.split("-").map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function fullName(m: { firstName: string | null; lastName: string | null }): string {
  return [m.firstName, m.lastName].filter(Boolean).join(" ").trim() || "(Unnamed)";
}

/**
 * Return today's project count from the cache so the Home tile badge
 * can render without re-fetching from the server.
 */
export async function getTodaysCrewScheduleCount(): Promise<number> {
  const today = isoDay(new Date());
  const days = await cacheList<CrewScheduleDay>(CACHE_ENTITY);
  const match = days.find((d) => d?.date === today && d.mine === false);
  return match?.projects.length ?? 0;
}

export function CrewScheduleScreen() {
  const { user } = useAuth();
  const [date, setDate] = useState<string>(() => isoDay(new Date()));
  const [mine, setMine] = useState(false);
  const [day, setDay] = useState<CrewScheduleDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMember, setSelectedMember] = useState<
    (CrewScheduleMember & { crewName?: string; projectName?: string }) | null
  >(null);

  const cacheKey = useMemo(() => `${date}::${mine ? "mine" : "all"}`, [date, mine]);

  const loadCached = useCallback(async () => {
    const days = await cacheList<CrewScheduleDay & { _key?: string }>(CACHE_ENTITY);
    const match = days.find((d) => d?.date === date && d.mine === mine);
    if (match) setDay(match);
    else setDay(null);
  }, [date, mine]);

  const fetchFromServer = useCallback(async () => {
    try {
      const res = await api<CrewScheduleDay>(
        `/api/mobile/crew-schedule?date=${encodeURIComponent(date)}&mine=${mine ? "true" : "false"}`
      );
      setDay(res);
      await cachePut(CACHE_ENTITY, cacheKey, res, new Date().toISOString());
    } catch (err) {
      console.warn("[crew-schedule] fetch failed, falling back to cache", err);
    }
  }, [date, mine, cacheKey]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await loadCached();
      await fetchFromServer();
      setLoading(false);
    })();
  }, [loadCached, fetchFromServer]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchFromServer();
    setRefreshing(false);
  }, [fetchFromServer]);

  const totalProjects = day?.projects.length ?? 0;
  const totalCrews = day?.projects.reduce((acc, p) => acc + p.crews.length, 0) ?? 0;
  const todayStr = isoDay(new Date());

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <View style={styles.toolbar}>
        <Pressable
          style={styles.dayBtn}
          onPress={() => setDate((d) => shiftDay(d, -1))}
          testID="button-crew-prev-day"
        >
          <Text style={styles.dayBtnText}>{"‹ Prev"}</Text>
        </Pressable>
        <View style={{ alignItems: "center", flex: 1 }}>
          <Text style={styles.dayLabel} testID="text-crew-day">
            {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </Text>
          {date !== todayStr ? (
            <Pressable onPress={() => setDate(todayStr)} testID="button-crew-today">
              <Text style={{ color: colors.primary, fontSize: 12 }}>Jump to today</Text>
            </Pressable>
          ) : (
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>Today</Text>
          )}
        </View>
        <Pressable
          style={styles.dayBtn}
          onPress={() => setDate((d) => shiftDay(d, 1))}
          testID="button-crew-next-day"
        >
          <Text style={styles.dayBtnText}>{"Next ›"}</Text>
        </Pressable>
      </View>

      <View style={styles.toggleRow}>
        <Text style={{ color: colors.text, fontWeight: "600" }}>My day only</Text>
        <Switch
          value={mine}
          onValueChange={setMine}
          testID="switch-crew-mine"
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {loading ? <ActivityIndicator color={colors.primary} /> : null}

        {!loading && totalProjects === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No crews scheduled</Text>
            <Text style={styles.rowSub}>
              {mine
                ? "You're not on any crew assigned this day. Pull down to refresh."
                : "No crews are assigned to any project on this day. Pull down to refresh."}
            </Text>
          </View>
        ) : null}

        {totalProjects > 0 ? (
          <Text style={styles.summary} testID="text-crew-summary">
            {totalProjects} project{totalProjects === 1 ? "" : "s"} ·{" "}
            {totalCrews} crew{totalCrews === 1 ? "" : "s"}
          </Text>
        ) : null}

        {day?.projects.map((project) => (
          <View key={project.id} style={styles.projectCard} testID={`card-project-${project.id}`}>
            <Text style={styles.projectTitle}>{project.name}</Text>
            {project.code ? (
              <Text style={styles.rowSub}>{project.code}</Text>
            ) : null}

            {project.crews.map((crew) => (
              <View key={crew.id} style={styles.crewBlock} testID={`block-crew-${crew.id}`}>
                <View style={styles.crewHeader}>
                  <Text style={styles.crewName}>{crew.name}</Text>
                  <Text style={styles.rowSub}>{crew.hoursPerDay}h · {crew.members.length} member{crew.members.length === 1 ? "" : "s"}</Text>
                </View>
                {crew.members.length === 0 ? (
                  <Text style={styles.rowSub}>No members on this crew.</Text>
                ) : (
                  crew.members.map((m) => (
                    <Pressable
                      key={m.userId}
                      style={styles.memberRow}
                      onPress={() =>
                        setSelectedMember({ ...m, crewName: crew.name, projectName: project.name })
                      }
                      testID={`row-member-${m.userId}`}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {fullName(m)}
                          {m.userId === user?.id ? "  (you)" : ""}
                        </Text>
                        <Text style={styles.rowSub} numberOfLines={1}>
                          {(m.role ?? "Crew member")} · {m.hoursPerDay}h
                        </Text>
                      </View>
                      <Text style={{ color: colors.textMuted }}>{"›"}</Text>
                    </Pressable>
                  ))
                )}
              </View>
            ))}
          </View>
        ))}
      </ScrollView>

      <Modal
        animationType="slide"
        transparent
        visible={!!selectedMember}
        onRequestClose={() => setSelectedMember(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSelectedMember(null)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            {selectedMember ? (
              <View style={{ gap: spacing(1) }}>
                <Text style={styles.h2}>{fullName(selectedMember)}</Text>
                <Text style={styles.rowSub}>
                  {selectedMember.crewName} · {selectedMember.projectName}
                </Text>
                <View style={styles.sheetRow}>
                  <Text style={styles.sheetLabel}>Role</Text>
                  <Text style={styles.body}>{selectedMember.role ?? "Crew member"}</Text>
                </View>
                <View style={styles.sheetRow}>
                  <Text style={styles.sheetLabel}>Hours today</Text>
                  <Text style={styles.body}>{selectedMember.hoursPerDay}h</Text>
                </View>
                <View style={styles.sheetRow}>
                  <Text style={styles.sheetLabel}>Phone</Text>
                  {selectedMember.phone ? (
                    <Pressable
                      onPress={() => Linking.openURL(`tel:${selectedMember.phone}`)}
                      testID="button-member-call"
                    >
                      <Text style={[styles.body, { color: colors.primary }]}>
                        {selectedMember.phone}
                      </Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.rowSub}>Not on file</Text>
                  )}
                </View>
                <Pressable
                  style={[styles.dayBtn, { alignSelf: "stretch", marginTop: spacing(1) }]}
                  onPress={() => setSelectedMember(null)}
                  testID="button-member-close"
                >
                  <Text style={styles.dayBtnText}>Close</Text>
                </Pressable>
              </View>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing(2),
    gap: spacing(1),
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  dayBtn: {
    backgroundColor: colors.surfaceMuted,
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(2),
    borderRadius: 8,
    minWidth: 70,
    alignItems: "center",
  },
  dayBtnText: { color: colors.text, fontWeight: "600" },
  dayLabel: { color: colors.text, fontSize: 16, fontWeight: "700" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  summary: { color: colors.textMuted, fontSize: 12 },
  projectCard: {
    backgroundColor: colors.surface,
    padding: spacing(2),
    borderRadius: 10,
    gap: spacing(1),
  },
  projectTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  crewBlock: { marginTop: spacing(1), gap: spacing(1) },
  crewHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  crewName: { color: colors.text, fontWeight: "600" },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing(1),
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    gap: spacing(1),
  },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
  empty: { padding: spacing(2), gap: spacing(1) },
  emptyTitle: { color: colors.text, fontWeight: "600" },
  h2: { color: colors.text, fontSize: 18, fontWeight: "700" },
  body: { color: colors.text },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    padding: spacing(2),
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: spacing(1),
  },
  sheetRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing(1),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetLabel: { color: colors.textMuted, fontSize: 12 },
});
