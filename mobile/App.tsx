import React, { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "@sentry/react-native";

import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { SyncProvider } from "@/sync/SyncContext";
import { RootNavigator } from "@/navigation/RootNavigator";
import { LoginScreen } from "@/screens/Login";
import { getExpoExtra } from "@/api/expoExtra";

const sentryDsn = getExpoExtra().sentryDsn;
if (sentryDsn) {
  Sentry.init({ dsn: sentryDsn, tracesSampleRate: 0.2 });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      networkMode: "offlineFirst",
    },
    mutations: { networkMode: "offlineFirst" },
  },
});

function Gate() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <LoginScreen />;
  return (
    <SyncProvider>
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </SyncProvider>
  );
}

function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="auto" />
          <Gate />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

export default sentryDsn ? Sentry.wrap(App) : App;
