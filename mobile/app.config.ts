import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "SmartManageAI",
  slug: "smartmanageai",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "smartmanageai",
  userInterfaceStyle: "automatic",
  newArchEnabled: false,
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#0f172a",
  },
  assetBundlePatterns: ["**/*"],
  ios: {
    bundleIdentifier: "com.smartmanageai.field",
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription:
        "SmartManageAI uses the camera to capture jobsite photos for daily reports, punch list items, and inspections.",
      NSLocationWhenInUseUsageDescription:
        "SmartManageAI uses your location to record GPS coordinates for time-clock punches and field reports.",
      NSPhotoLibraryUsageDescription:
        "SmartManageAI accesses your photo library so you can attach existing photos to reports and punch list items.",
      NSMicrophoneUsageDescription:
        "SmartManageAI uses the microphone to record voice notes attached to daily reports.",
      UIBackgroundModes: ["fetch", "processing", "remote-notification"],
    },
  },
  android: {
    package: "com.smartmanageai.field",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#0f172a",
    },
    permissions: [
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "CAMERA",
      "RECORD_AUDIO",
      "READ_MEDIA_IMAGES",
    ],
  },
  plugins: [
    "expo-secure-store",
    "expo-sqlite",
    "expo-notifications",
    "expo-image-picker",
    "expo-location",
    "expo-background-fetch",
    "expo-task-manager",
    [
      "expo-updates",
      { username: "smartmanageai" },
    ],
  ],
  extra: {
    apiBaseUrl:
      process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://app.smartmanageai.com",
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? "",
    eas: {
      projectId: process.env.EAS_PROJECT_ID ?? "00000000-0000-0000-0000-000000000000",
    },
  },
  updates: {
    url: "https://u.expo.dev/00000000-0000-0000-0000-000000000000",
    fallbackToCacheTimeout: 0,
  },
  runtimeVersion: { policy: "appVersion" },
};

export default config;
