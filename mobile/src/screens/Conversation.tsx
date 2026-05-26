import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";

import { useAuth } from "@/auth/AuthContext";
import { useSync } from "@/sync/SyncContext";
import { enqueue, listOutbox } from "@/sync/outbox";
import { cacheList, cachePut } from "@/sync/db";
import {
  listMessages,
  markThreadRead,
  type MessageSummary,
} from "@/sync/messaging";
import { baseUrl } from "@/api/client";
import { colors, spacing } from "@/theme";

type ConvRoute = RouteProp<{ Conversation: { threadId: string; title?: string } }, "Conversation">;

type PendingAttachment = { localId: string; uri: string; mime: string; name: string };

type LocalMessage = MessageSummary & { _pending?: boolean; _localId?: string };

const CACHE_KEY = (threadId: string) => `MESSAGE_${threadId}`;

export function ConversationScreen() {
  const route = useRoute<ConvRoute>();
  const nav = useNavigation();
  const { user } = useAuth();
  const { syncNow, lastResult } = useSync();
  const { threadId, title } = route.params;

  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingAttachment | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const listRef = useRef<{ scrollToEnd: (opts?: { animated?: boolean }) => void } | null>(null);

  useLayoutEffect(() => {
    nav.setOptions({ title: title ?? "Conversation" });
  }, [nav, title]);

  const mergeAndCache = useCallback(async (fetched: MessageSummary[]) => {
    // Cache server-side messages individually so they survive offline opens.
    for (const m of fetched) {
      await cachePut(CACHE_KEY(threadId), m.id, m, m.createdAt);
    }
    const outbox = await listOutbox();
    const pendingMine = outbox
      .filter((o) => o.entityType === "MESSAGE" && (o.payload as { conversationId?: string }).conversationId === threadId)
      .filter((o) => o.status === "PENDING" || o.status === "FAILED" || o.status === "SYNCING")
      .map<LocalMessage>((o) => {
        const p = o.payload as { content?: string };
        return {
          id: `pending-${o.localId}`,
          conversationId: threadId,
          senderId: user?.id ?? "",
          content: p.content ?? "",
          attachmentUrl: null,
          attachmentName: null,
          attachmentType: null,
          voiceUrl: null,
          createdAt: o.clientTimestamp,
          sender: { id: user?.id ?? "", firstName: user?.firstName ?? null, lastName: user?.lastName ?? null },
          _pending: true,
          _localId: o.localId,
        };
      });
    setMessages([...fetched, ...pendingMine]);
  }, [threadId, user]);

  const initialLoad = useCallback(async () => {
    // Show cached immediately so the view is never blank offline.
    const cached = await cacheList<MessageSummary>(CACHE_KEY(threadId));
    if (cached.length > 0) {
      cached.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      await mergeAndCache(cached);
    }
    try {
      const live = await listMessages(threadId);
      setHasMore(live.hasMore);
      await mergeAndCache(live.messages);
      void markThreadRead(threadId);
    } catch {
      // Offline — keep cached view.
    }
  }, [threadId, mergeAndCache]);

  useEffect(() => { void initialLoad(); }, [initialLoad]);

  // Refresh when a sync cycle completes — e.g. when push delivers our
  // queued sends so they swap from "Sending…" to confirmed server rows.
  useEffect(() => { if (lastResult) void initialLoad(); }, [lastResult, initialLoad]);

  async function loadOlder() {
    if (loadingMore || !hasMore || messages.length === 0) return;
    const oldest = messages.find((m) => !m._pending);
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const r = await listMessages(threadId, oldest.id);
      setHasMore(r.hasMore);
      // Prepend, dedup by id, keep sort
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const additions = r.messages.filter((m) => !seen.has(m.id));
        const merged = [...additions, ...prev];
        merged.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
        return merged;
      });
      for (const m of r.messages) {
        await cachePut(CACHE_KEY(threadId), m.id, m, m.createdAt);
      }
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }

  async function pickPhoto() {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (r.canceled) return;
    const a = r.assets[0];
    setPending({
      localId: `attach-${Date.now()}`,
      uri: a.uri,
      mime: a.mimeType ?? "image/jpeg",
      name: a.fileName ?? `photo-${Date.now()}.jpg`,
    });
  }

  async function send() {
    const text = draft.trim();
    if (!text && !pending) return;
    await enqueue({
      entityType: "MESSAGE",
      operation: "CREATE",
      payload: { conversationId: threadId, content: text },
      attachments: pending ? [pending] : undefined,
    });
    setDraft("");
    setPending(null);
    await initialLoad();
    void syncNow();
  }

  function renderItem({ item }: { item: LocalMessage }) {
    const mine = item.senderId === user?.id;
    const name = `${item.sender.firstName ?? ""} ${item.sender.lastName ?? ""}`.trim() || "Unknown";
    const imgUri = item.attachmentUrl && item.attachmentType?.startsWith("image/")
      ? `${baseUrl}${item.attachmentUrl}`
      : null;
    return (
      <View style={[styles.bubbleRow, mine ? { justifyContent: "flex-end" } : null]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]} testID={`message-${item.id}`}>
          {!mine ? <Text style={styles.sender}>{name}</Text> : null}
          {imgUri ? (
            <Image source={{ uri: imgUri }} style={styles.image} resizeMode="cover" />
          ) : null}
          {item.content ? (
            <Text style={[styles.bubbleText, mine ? { color: "#fff" } : { color: colors.text }]}>
              {item.content}
            </Text>
          ) : null}
          <Text style={[styles.meta, mine ? { color: "#dbeafe" } : { color: colors.textMuted }]}>
            {item._pending ? "Sending…" : "Sent"}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={80}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m: LocalMessage) => m.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: spacing(1), gap: spacing(1) }}
        onEndReachedThreshold={0.3}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListHeaderComponent={
          hasMore ? (
            <Pressable onPress={loadOlder} style={styles.loadMore} testID="button-load-older">
              {loadingMore ? <ActivityIndicator color={colors.text} /> : <Text style={styles.loadMoreText}>Load older messages</Text>}
            </Pressable>
          ) : null
        }
      />
      {pending ? (
        <View style={styles.pendingRow}>
          <Text style={{ color: colors.textMuted, flex: 1 }} numberOfLines={1}>{pending.name}</Text>
          <Pressable onPress={() => setPending(null)} testID="button-remove-attachment">
            <Text style={{ color: colors.danger }}>Remove</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.composer}>
        <Pressable onPress={pickPhoto} style={styles.attachBtn} testID="button-attach-photo">
          <Text style={{ color: colors.text, fontSize: 20 }}>📎</Text>
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          placeholderTextColor={colors.textMuted}
          multiline
          style={styles.input}
          testID="input-message"
        />
        <Pressable onPress={send} style={styles.sendBtn} testID="button-send-message">
          <Text style={{ color: "#fff", fontWeight: "700" }}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bubbleRow: { flexDirection: "row", paddingHorizontal: spacing(1) },
  bubble: { maxWidth: "80%", padding: spacing(1.5), borderRadius: 12 },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 2 },
  bubbleTheirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 2 },
  sender: { color: colors.textMuted, fontSize: 11, marginBottom: 2, fontWeight: "600" },
  bubbleText: { fontSize: 14 },
  image: { width: 220, height: 160, borderRadius: 8, marginBottom: spacing(0.5) },
  meta: { fontSize: 10, marginTop: 4, textAlign: "right" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing(1),
    padding: spacing(1),
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    color: colors.text,
    backgroundColor: colors.background,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1),
    borderRadius: 18,
    maxHeight: 120,
    minHeight: 38,
  },
  attachBtn: { padding: spacing(1) },
  sendBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.25),
    borderRadius: 18,
  },
  loadMore: { padding: spacing(1.5), alignItems: "center" },
  loadMoreText: { color: colors.textMuted, fontSize: 12 },
  pendingRow: {
    flexDirection: "row",
    gap: spacing(1),
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
