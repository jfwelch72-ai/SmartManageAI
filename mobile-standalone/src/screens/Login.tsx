import React, { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { colors, spacing } from "@/theme";

export function LoginScreen() {
  const { login, ssoLogin } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ssoSlug, setSsoSlug] = useState("");
  const [showSso, setShowSso] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setBusy(true); setError(null);
    try {
      await login(email.trim(), password);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Login failed";
      // Server signals SSO_REQUIRED:<slug> when the org enforces SSO. Pivot
      // the UI to the SSO handoff button rather than failing the user.
      if (msg.startsWith("SSO_REQUIRED:")) {
        const slug = msg.slice("SSO_REQUIRED:".length);
        setSsoSlug(slug);
        setShowSso(true);
        setError("Your organization requires single sign-on.");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSsoSubmit() {
    if (!ssoSlug.trim()) { setError("Enter your organization slug"); return; }
    setBusy(true); setError(null);
    try {
      await ssoLogin(ssoSlug.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "SSO sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>SmartManageAI Field</Text>
        <Text style={styles.sub}>Sign in with your SmartManageAI credentials</Text>
        <TextInput
          autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
          placeholder="Email" placeholderTextColor={colors.textMuted}
          value={email} onChangeText={setEmail} style={styles.input}
          testID="input-email"
        />
        <TextInput
          secureTextEntry placeholder="Password" placeholderTextColor={colors.textMuted}
          value={password} onChangeText={setPassword} style={styles.input}
          testID="input-password"
        />
        {error ? <Text style={styles.error} testID="text-login-error">{error}</Text> : null}
        <Pressable onPress={onSubmit} disabled={busy} style={[styles.btn, busy && { opacity: 0.6 }]} testID="button-signin">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Sign in</Text>}
        </Pressable>

        <Pressable onPress={() => setShowSso((s) => !s)} style={styles.linkBtn} testID="button-toggle-sso">
          <Text style={styles.linkText}>{showSso ? "Hide" : "Use"} single sign-on (SSO)</Text>
        </Pressable>

        {showSso ? (
          <View style={{ gap: spacing(1) }}>
            <TextInput
              autoCapitalize="none" autoCorrect={false}
              placeholder="Organization slug" placeholderTextColor={colors.textMuted}
              value={ssoSlug} onChangeText={setSsoSlug} style={styles.input}
              testID="input-sso-slug"
            />
            <Pressable onPress={onSsoSubmit} disabled={busy} style={[styles.btn, busy && { opacity: 0.6 }]} testID="button-sso-signin">
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Continue with SSO</Text>}
            </Pressable>
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: spacing(3) },
  card: { width: "100%", maxWidth: 420, backgroundColor: colors.surface, padding: spacing(3), borderRadius: 12, gap: spacing(2) },
  title: { color: colors.text, fontSize: 22, fontWeight: "700" },
  sub: { color: colors.textMuted, fontSize: 13, marginBottom: spacing(2) },
  input: { backgroundColor: colors.surfaceMuted, color: colors.text, padding: spacing(2), borderRadius: 8 },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center", marginTop: spacing(1) },
  btnText: { color: "#fff", fontWeight: "600" },
  linkBtn: { alignItems: "center", paddingVertical: spacing(1) },
  linkText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  error: { color: colors.danger, fontSize: 13 },
});
