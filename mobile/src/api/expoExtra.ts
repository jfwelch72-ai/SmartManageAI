import Constants from "expo-constants";

// Centralised, typed accessor for Expo runtime config (`expo.extra` from
// app.config.ts). Keeping the cast in one place lets the rest of the app
// use the typed `getExpoExtra()` helper instead of sprinkling
// `as any` reads of `Constants.expoConfig?.extra`.
export interface ExpoExtra {
  apiBaseUrl?: string;
  sentryDsn?: string;
  eas?: { projectId?: string };
}

export function getExpoExtra(): ExpoExtra {
  const raw = Constants.expoConfig?.extra ?? Constants.manifest2?.extra ?? {};
  return raw as ExpoExtra;
}
