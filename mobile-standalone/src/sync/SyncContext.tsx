import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";
import * as Network from "expo-network";

import { isOnline, registerDevice, syncNow, type SyncStats } from "./coordinator";
import { pendingCount } from "./outbox";
import { registerForPushAsync } from "@/push/registerForPush";

const BACKGROUND_SYNC_TASK = "smai-background-sync";

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    await syncNow();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

type SyncCtx = {
  online: boolean;
  pending: number;
  syncing: boolean;
  lastResult: SyncStats | null;
  syncNow: () => Promise<void>;
};

const Ctx = createContext<SyncCtx | null>(null);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncStats | null>(null);
  const subscribed = useRef(false);

  const refreshPending = useCallback(async () => {
    setPending(await pendingCount());
  }, []);

  const run = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const stats = await syncNow();
      setLastResult(stats);
    } finally {
      setSyncing(false);
      void refreshPending();
    }
  }, [syncing, refreshPending]);

  useEffect(() => {
    if (subscribed.current) return;
    subscribed.current = true;

    void (async () => {
      try {
        const pushToken = await registerForPushAsync().catch(() => undefined);
        await registerDevice(pushToken ?? undefined);
      } catch (err) {
        console.warn("[sync] device registration failed", err);
      }
      try {
        await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
          minimumInterval: 15 * 60,
          stopOnTerminate: false,
          startOnBoot: true,
        });
      } catch {}
      await refreshPending();
      void run();
    })();

    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void run();
    });

    let cancelled = false;
    void Network.getNetworkStateAsync().then((s) =>
      setOnline(Boolean(s.isConnected && s.isInternetReachable !== false))
    );
    const interval = setInterval(async () => {
      if (cancelled) return;
      setOnline(await isOnline());
      await refreshPending();
    }, 15_000);

    return () => {
      cancelled = true;
      sub.remove();
      clearInterval(interval);
    };
  }, [refreshPending, run]);

  return (
    <Ctx.Provider value={{ online, pending, syncing, lastResult, syncNow: run }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSync(): SyncCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSync must be used inside SyncProvider");
  return v;
}
