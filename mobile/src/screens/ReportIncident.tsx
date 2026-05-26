import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useNavigation } from "@react-navigation/native";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useSync } from "@/sync/SyncContext";
import { enqueue } from "@/sync/outbox";
import { cacheList } from "@/sync/db";
import { colors, spacing } from "@/theme";

type CachedProject = { id: string; name?: string; title?: string };

type PendingAttachment = {
  localId: string;
  uri: string;
  mime: string;
  name: string;
};

const INCIDENT_TYPES = [
  { value: "INJURY", label: "Injury" },
  { value: "NEAR_MISS", label: "Near miss" },
  { value: "PROPERTY_DAMAGE", label: "Property" },
  { value: "ENVIRONMENTAL", label: "Spill" },
  { value: "ILLNESS", label: "Illness" },
  { value: "OTHER", label: "Other" },
];

// Severity ordered low → critical for the gloved-hand button row. Server
// derives OSHA classification + recordability from this value.
const SEVERITIES = [
  { value: "LOW", label: "Low", color: "#16a34a" },
  { value: "MEDIUM", label: "Medium", color: "#ca8a04" },
  { value: "HIGH", label: "High", color: "#ea580c" },
  { value: "CRITICAL", label: "Critical", color: "#dc2626" },
];

export function ReportIncidentScreen() {
  const nav = useNavigation();
  const { syncNow } = useSync();
  const [projects, setProjects] = useState<CachedProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [incidentType, setIncidentType] = useState<string>("INJURY");
  const [severity, setSeverity] = useState<string>("MEDIUM");
  const [when, setWhen] = useState<Date>(new Date());
  const [location, setLocation] = useState<string>("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [description, setDescription] = useState<string>("");
  const [peopleInvolved, setPeopleInvolved] = useState<string>("");
  const [witnesses, setWitnesses] = useState<string>("");
  const [photos, setPhotos] = useState<PendingAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  useEffect(() => {
    void cacheList<CachedProject>("PROJECT").then(setProjects);
  }, []);

  // Auto-attempt GPS on mount so the form is pre-filled by the time the
  // crew member finishes typing. Failure is silent — the field still works
  // without permission grant.
  useEffect(() => {
    void (async () => {
      try {
        setGpsBusy(true);
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted") return;
        const loc = await Location.getCurrentPositionAsync({});
        setGps({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      } catch {
        /* swallow — permission denied / no signal is non-fatal */
      } finally {
        setGpsBusy(false);
      }
    })();
  }, []);

  async function refreshGps() {
    try {
      setGpsBusy(true);
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({});
      setGps({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    } finally {
      setGpsBusy(false);
    }
  }

  async function takePhoto() {
    const photo = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (photo.canceled) return;
    const a = photo.assets[0];
    setPhotos((prev) => [
      ...prev,
      {
        localId: `incident-photo-${Date.now()}`,
        uri: a.uri,
        mime: a.mimeType ?? "image/jpeg",
        name: a.fileName ?? `incident-${Date.now()}.jpg`,
      },
    ]);
  }

  async function pickPhoto() {
    const photo = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (photo.canceled) return;
    const a = photo.assets[0];
    setPhotos((prev) => [
      ...prev,
      {
        localId: `incident-photo-${Date.now()}`,
        uri: a.uri,
        mime: a.mimeType ?? "image/jpeg",
        name: a.fileName ?? `incident-${Date.now()}.jpg`,
      },
    ]);
  }

  const canSubmit = useMemo(
    () => description.trim().length > 0 && !!incidentType && !!severity && !submitting,
    [description, incidentType, severity, submitting]
  );

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const rec = await enqueue({
        entityType: "SAFETY_INCIDENT",
        operation: "CREATE",
        payload: {
          projectId,
          incidentType,
          severity,
          date: when.toISOString().slice(0, 10),
          time: when.toTimeString().slice(0, 8),
          occurredAt: when.toISOString(),
          location: location.trim() || null,
          latitude: gps?.lat,
          longitude: gps?.lng,
          description: description.trim(),
          peopleInvolved: peopleInvolved.trim() || null,
          witnessNames: witnesses.trim() || null,
        },
        attachments: photos.length > 0 ? photos : undefined,
      });
      setReference(rec.localId);
      void syncNow();
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setReference(null);
    setIncidentType("INJURY");
    setSeverity("MEDIUM");
    setWhen(new Date());
    setLocation("");
    setDescription("");
    setPeopleInvolved("");
    setWitnesses("");
    setPhotos([]);
  }

  if (reference) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <SyncStatusBar />
        <View style={styles.confirmWrap} testID="view-incident-confirmation">
          <Text style={styles.confirmTitle}>Incident reported</Text>
          <Text style={styles.confirmBody}>
            Your report was saved on this device and will sync to the office
            as soon as you're back online.
          </Text>
          <Text style={styles.confirmRef} testID="text-incident-reference">
            Reference: {reference.slice(0, 8)}…
          </Text>
          <Pressable
            onPress={reset}
            style={[styles.btn, { backgroundColor: colors.danger }]}
            testID="button-report-another"
          >
            <Text style={styles.btnText}>Report another</Text>
          </Pressable>
          <Pressable
            onPress={() => nav.goBack()}
            style={[styles.btn, { backgroundColor: colors.surfaceMuted, marginTop: spacing(1) }]}
            testID="button-done"
          >
            <Text style={[styles.btnText, { color: colors.text }]}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Stop work if anyone is in danger. Then file this report.</Text>
        </View>

        <Text style={styles.label}>Project</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: "row", gap: spacing(1) }}>
            <Pressable
              onPress={() => setProjectId(null)}
              style={[styles.chip, projectId === null && styles.chipActive]}
              testID="chip-project-none"
            >
              <Text style={[styles.chipText, projectId === null && styles.chipTextActive]}>No project</Text>
            </Pressable>
            {projects.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => setProjectId(p.id)}
                style={[styles.chip, projectId === p.id && styles.chipActive]}
                testID={`chip-project-${p.id}`}
              >
                <Text style={[styles.chipText, projectId === p.id && styles.chipTextActive]}>
                  {p.name ?? p.title ?? p.id.slice(0, 6)}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <Text style={styles.label}>Incident type</Text>
        <View style={styles.gridButtons}>
          {INCIDENT_TYPES.map((t) => (
            <Pressable
              key={t.value}
              onPress={() => setIncidentType(t.value)}
              style={[styles.gridBtn, incidentType === t.value && styles.gridBtnActive]}
              testID={`button-type-${t.value}`}
            >
              <Text style={[styles.gridBtnText, incidentType === t.value && styles.gridBtnTextActive]}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Severity</Text>
        <View style={{ flexDirection: "row", gap: spacing(1) }}>
          {SEVERITIES.map((s) => (
            <Pressable
              key={s.value}
              onPress={() => setSeverity(s.value)}
              style={[
                styles.sevBtn,
                { backgroundColor: severity === s.value ? s.color : colors.surface, borderColor: s.color },
              ]}
              testID={`button-severity-${s.value}`}
            >
              <Text style={[styles.sevBtnText, severity === s.value && { color: "#fff" }]}>
                {s.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>When (defaults to now)</Text>
        <Text style={styles.helper} testID="text-incident-when">
          {when.toLocaleString()}
        </Text>
        <Pressable
          onPress={() => setWhen(new Date())}
          style={[styles.btn, { backgroundColor: colors.surface, padding: spacing(1) }]}
          testID="button-reset-time"
        >
          <Text style={[styles.btnText, { color: colors.text }]}>Set to now</Text>
        </Pressable>

        <Text style={styles.label}>Location</Text>
        <TextInput
          placeholder="e.g. Bay 4, near scaffold"
          placeholderTextColor={colors.textMuted}
          value={location}
          onChangeText={setLocation}
          style={styles.input}
          testID="input-incident-location"
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing(1) }}>
          <Text style={styles.helper} testID="text-incident-gps">
            {gpsBusy
              ? "Locating…"
              : gps
                ? `GPS ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`
                : "GPS not captured"}
          </Text>
          <Pressable
            onPress={refreshGps}
            style={[styles.btn, { backgroundColor: colors.surface, padding: spacing(1) }]}
            testID="button-refresh-gps"
          >
            <Text style={[styles.btnText, { color: colors.text }]}>Use my location</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>What happened?</Text>
        <TextInput
          placeholder="Describe the incident"
          placeholderTextColor={colors.textMuted}
          value={description}
          onChangeText={setDescription}
          multiline
          style={[styles.input, { minHeight: 100 }]}
          testID="input-incident-description"
        />

        <Text style={styles.label}>People involved</Text>
        <TextInput
          placeholder="Names of anyone hurt or involved"
          placeholderTextColor={colors.textMuted}
          value={peopleInvolved}
          onChangeText={setPeopleInvolved}
          style={styles.input}
          testID="input-incident-people"
        />

        <Text style={styles.label}>Witnesses</Text>
        <TextInput
          placeholder="Names of anyone who saw it"
          placeholderTextColor={colors.textMuted}
          value={witnesses}
          onChangeText={setWitnesses}
          style={styles.input}
          testID="input-incident-witnesses"
        />

        <Text style={styles.label}>Photos ({photos.length})</Text>
        <View style={{ flexDirection: "row", gap: spacing(1) }}>
          <Pressable onPress={takePhoto} style={[styles.btn, { flex: 1 }]} testID="button-incident-camera">
            <Text style={styles.btnText}>Take photo</Text>
          </Pressable>
          <Pressable onPress={pickPhoto} style={[styles.btn, { flex: 1 }]} testID="button-incident-gallery">
            <Text style={styles.btnText}>From gallery</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          style={[
            styles.btn,
            {
              backgroundColor: canSubmit ? colors.danger : colors.surfaceMuted,
              padding: spacing(2.5),
              marginTop: spacing(2),
            },
          ]}
          testID="button-submit-incident"
        >
          <Text style={[styles.btnText, { fontSize: 18 }]}>
            {submitting ? "Saving…" : "Submit incident report"}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "#7f1d1d",
    padding: spacing(2),
    borderRadius: 8,
  },
  bannerText: { color: "#fff", fontWeight: "600" },
  label: { color: colors.text, fontWeight: "600", marginTop: spacing(1) },
  helper: { color: colors.textMuted, fontSize: 12 },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    padding: spacing(2),
    borderRadius: 8,
    textAlignVertical: "top",
  },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  chip: {
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
    backgroundColor: colors.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  gridButtons: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  gridBtn: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    flexBasis: "31%",
    alignItems: "center",
  },
  gridBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  gridBtnText: { color: colors.text },
  gridBtnTextActive: { color: "#fff", fontWeight: "600" },
  sevBtn: {
    flex: 1,
    paddingVertical: spacing(2),
    borderRadius: 8,
    borderWidth: 2,
    alignItems: "center",
  },
  sevBtnText: { color: colors.text, fontWeight: "700" },
  confirmWrap: { padding: spacing(3), gap: spacing(2), flex: 1, justifyContent: "center" },
  confirmTitle: { color: colors.text, fontSize: 22, fontWeight: "700" },
  confirmBody: { color: colors.text, fontSize: 16 },
  confirmRef: { color: colors.textMuted, fontFamily: "monospace" },
});
