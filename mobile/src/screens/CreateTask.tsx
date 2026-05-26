import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";

import { api, ApiError } from "@/api/client";
import { colors, spacing } from "@/theme";

export type CreateTaskPrefill = {
  title?: string;
  description?: string;
  category?:
    | "SUPPLY_NEED"
    | "EQUIPMENT_REPAIR"
    | "WEATHER_DELAY"
    | "CHANGE_ORDER"
    | "SAFETY"
    | "CLIENT_COMMUNICATION"
    | "OTHER";
  priority?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  projectId?: string | null;
  context?: string;
  sourceType?: "MANUAL" | "EMAIL" | "AI_GENERATED" | "SYSTEM";
};

type CreateTaskRoute = RouteProp<
  { CreateTask: { prefill?: CreateTaskPrefill } | undefined },
  "CreateTask"
>;

const CATEGORIES: NonNullable<CreateTaskPrefill["category"]>[] = [
  "SUPPLY_NEED",
  "EQUIPMENT_REPAIR",
  "WEATHER_DELAY",
  "CHANGE_ORDER",
  "SAFETY",
  "CLIENT_COMMUNICATION",
  "OTHER",
];
const PRIORITIES: NonNullable<CreateTaskPrefill["priority"]>[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
];

export function CreateTaskScreen() {
  const route = useRoute<CreateTaskRoute>();
  const nav = useNavigation();
  const prefill = route.params?.prefill ?? {};

  const [title, setTitle] = useState(prefill.title ?? "");
  const [description, setDescription] = useState(prefill.description ?? "");
  const [category, setCategory] = useState<NonNullable<CreateTaskPrefill["category"]>>(
    prefill.category ?? "OTHER",
  );
  const [priority, setPriority] = useState<NonNullable<CreateTaskPrefill["priority"]>>(
    prefill.priority ?? "MEDIUM",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit() {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim().slice(0, 200),
          description: description.trim() || null,
          category,
          priority,
          projectId: prefill.projectId ?? undefined,
          context: prefill.context,
          sourceType: prefill.sourceType ?? "MANUAL",
        }),
      });
      setSuccess(true);
      setTimeout(() => {
        if (nav.canGoBack()) nav.goBack();
      }, 700);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `Couldn't create task (HTTP ${e.status})`
          : "Couldn't create task. Check your connection and try again.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}
    >
      <Text style={styles.label}>Title</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Task title"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        testID="input-task-title"
      />

      <Text style={styles.label}>Description</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        multiline
        placeholder="Details, recommended actions…"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, { minHeight: 100, textAlignVertical: "top" }]}
        testID="input-task-description"
      />

      <Text style={styles.label}>Category</Text>
      <View style={styles.chipRow}>
        {CATEGORIES.map((c) => (
          <Pressable
            key={c}
            onPress={() => setCategory(c)}
            style={[
              styles.chip,
              { backgroundColor: c === category ? colors.primary : colors.surface },
            ]}
            testID={`chip-category-${c}`}
          >
            <Text style={{ color: c === category ? "#fff" : colors.text, fontSize: 12 }}>
              {c.replace(/_/g, " ")}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Priority</Text>
      <View style={styles.chipRow}>
        {PRIORITIES.map((p) => (
          <Pressable
            key={p}
            onPress={() => setPriority(p)}
            style={[
              styles.chip,
              { backgroundColor: p === priority ? colors.primary : colors.surface },
            ]}
            testID={`chip-priority-${p}`}
          >
            <Text style={{ color: p === priority ? "#fff" : colors.text, fontSize: 12 }}>
              {p}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? (
        <Text style={[styles.feedback, { color: colors.danger }]} testID="text-task-error">
          {error}
        </Text>
      ) : null}
      {success ? (
        <Text style={[styles.feedback, { color: colors.success ?? "#16a34a" }]} testID="text-task-success">
          Task created.
        </Text>
      ) : null}

      <Pressable
        onPress={submit}
        disabled={submitting}
        style={[
          styles.btn,
          { backgroundColor: submitting ? colors.textMuted : colors.success ?? "#16a34a" },
        ]}
        testID="button-create-task"
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>Create task</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.text, fontWeight: "600", fontSize: 13 },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    padding: spacing(2),
    borderRadius: 8,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  chip: {
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
    borderRadius: 999,
  },
  btn: { padding: spacing(2), borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  feedback: { fontSize: 13, fontWeight: "500" },
});
