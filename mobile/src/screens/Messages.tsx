import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NavigationProp } from "@react-navigation/native";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useAuth } from "@/auth/AuthContext";
import { useSync } from "@/sync/SyncContext";
import { cacheList, cachePut } from "@/sync/db";
import {
  getUnreadCount,
  listThreads,
  threadTitle,
  type ThreadSummary,
} from "@/sync/messaging";
import { colors, spacing } from "@/theme";

type Nav = NavigationProp<{ Conversation: { threadId: string; title?: string } }>;

export function MessagesScreen() {
  const nav = useNavigation<Nav>();
  const { user } = useAuth();
  const { lastResult } = useSync();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadFromCache = useCallback(async () => {
    const cached = await cacheList<ThreadSummary>("MESSAGE_THREAD");
    if (cached.length > 0) setThreads(cached);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const live = await listThreads();
      live.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
      setThreads(live);
      // Cache each thread so the list survives offline opens.
      for (const t of live) {
        await cachePut("MESSAGE_THREAD", t.id, t, t.updatedAt ?? new Date().toISOString());
      }
      await getUnreadCount();
    } catch {
      // keep cached view; SyncStatusBar already surfaces offline state
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadFromCache();
    void refresh();
  }, [loadFromCache, refresh]);

  // Re-fetch when a sync cycle completes (covers app-foreground & push).
  useEffect(() => {
    if (lastResult) void refresh();
  }, [lastResult, refresh]);

  const direct = threads.filter((t) => t.type === "DIRECT");
  const project = threads.filter((t) => t.type !== "DIRECT");

  const sections: Array<{ title: string; data: ThreadSummary[] }> = [
    { title: "Direct", data: direct },
    { title: "Projects & Channels", data: project },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <FlatList
        data={sections.flatMap((s) => [{ __header: s.title } as const, ...s.data])}
        keyExtractor={(item: { __header?: string; id?: string }, idx: number) =>
          item.__header ? `h-${item.__header}-${idx}` : (item.id as string)
        }
        refreshing={refreshing}
        onRefresh={refresh}
        ListEmptyComponent={
          <Text style={styles.empty} testID="text-no-threads">No conversations yet</Text>
        }
        renderItem={({ item }: { item: { __header?: string } & ThreadSummary }) => {
          if ("__header" in item) {
            return <Text style={styles.section}>{item.__header}</Text>;
          }
          const title = threadTitle(item, user?.id);
          const preview = item.lastMessage?.content ?? "";
          return (
            <Pressable
              onPress={() => nav.navigate("Conversation", { threadId: item.id, title })}
              style={styles.row}
              testID={`row-thread-${item.id}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{preview}</Text>
              </View>
              {item.unreadCount > 0 ? (
                <View style={styles.badge} testID={`badge-thread-${item.id}`}>
                  <Text style={styles.badgeText}>
                    {item.unreadCount > 99 ? "99+" : item.unreadCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    paddingHorizontal: spacing(2),
    paddingTop: spacing(2),
    paddingBottom: spacing(1),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    backgroundColor: colors.surface,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(2),
    marginHorizontal: spacing(2),
    marginBottom: spacing(1),
    borderRadius: 10,
  },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  badge: {
    backgroundColor: colors.primary,
    minWidth: 22,
    paddingHorizontal: 6,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  empty: { color: colors.textMuted, textAlign: "center", marginTop: spacing(4) },
});
