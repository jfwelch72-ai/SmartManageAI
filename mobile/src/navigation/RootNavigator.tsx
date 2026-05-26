import React, { useEffect } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { NavigationContainerRef } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";

import { HomeScreen } from "@/screens/Home";
import { DailyReportsScreen } from "@/screens/DailyReports";
import { TimeClockScreen } from "@/screens/TimeClock";
import { PhotosScreen } from "@/screens/Photos";
import { PunchListScreen } from "@/screens/PunchList";
import { TasksScreen } from "@/screens/Tasks";
import { RFIScreen } from "@/screens/RFI";
import { SubmittalsScreen } from "@/screens/Submittals";
import { InspectionsScreen } from "@/screens/Inspections";
import { SwpppInspectionScreen } from "@/screens/SwpppInspection";
import { DrawingsScreen } from "@/screens/Drawings";
import { DocumentsScreen } from "@/screens/Documents";
import { ConflictsScreen } from "@/screens/Conflicts";
import { InventoryScreen } from "@/screens/Inventory";
import { InventoryScanScreen } from "@/screens/InventoryScan";
import { InventoryActionScreen } from "@/screens/InventoryAction";
import { ReportEquipmentIssueScreen } from "@/screens/ReportEquipmentIssue";
import { HaulTicketsScreen } from "@/screens/HaulTickets";
import { ReportIncidentScreen } from "@/screens/ReportIncident";
import { NotificationSettingsScreen } from "@/screens/NotificationSettings";
import { installNotificationHandlers } from "@/push/pushManager";
import { TMTicketsScreen } from "@/screens/TMTickets";
import { CreateTaskScreen } from "@/screens/CreateTask";
import { RequestMaterialScreen } from "@/screens/RequestMaterial";
import { EquipmentHoursScreen } from "@/screens/EquipmentHours";
import { MessagesScreen } from "@/screens/Messages";
import { ConversationScreen } from "@/screens/Conversation";
import { AnalyzePhotoScreen } from "@/screens/AnalyzePhoto";
import { DeliveriesScreen } from "@/screens/Deliveries";
import { DeliveryDetailScreen } from "@/screens/DeliveryDetail";
import { IssueCapturesScreen } from "@/screens/IssueCaptures";
import { colors } from "@/theme";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { getUnreadCount } from "@/sync/messaging";
import { useSync } from "@/sync/SyncContext";

const Tabs = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function useMessagesBadge(): number {
  // Task #3094: poll unread count on app foreground and after every sync
  // cycle so the bottom-tab badge reflects newly arrived messages (push
  // arrival also triggers a syncNow via SyncContext).
  const [count, setCount] = useState(0);
  const { lastResult } = useSync();
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const c = await getUnreadCount();
      if (!cancelled) setCount(c);
    };
    void refresh();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    return () => { cancelled = true; sub.remove(); };
  }, [lastResult]);
  return count;
}

function FieldTabs() {
  const unread = useMessagesBadge();
  usePushDeepLink();
  return (
    <Tabs.Navigator
      screenOptions={{
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
      }}
    >
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="Daily" component={DailyReportsScreen} options={{ title: "Daily Reports" }} />
      <Tabs.Screen name="Time" component={TimeClockScreen} options={{ title: "Time Clock" }} />
      <Tabs.Screen name="Photos" component={PhotosScreen} />
      <Tabs.Screen name="Punch" component={PunchListScreen} options={{ title: "Punch List" }} />
      <Tabs.Screen name="Tasks" component={TasksScreen} options={{ title: "Tasks" }} />
      <Tabs.Screen name="Inventory" component={InventoryScreen} options={{ title: "Inventory" }} />
      <Tabs.Screen
        name="Messages"
        component={MessagesScreen}
        options={{ tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined }}
      />
    </Tabs.Navigator>
  );
}

function usePushDeepLink() {
  // Task #3094: handle taps on push notifications carrying { threadId } in
  // their data payload by routing the user straight to the Conversation
  // screen. The push registration / send-side is owned by the push task;
  // here we only consume the response so the round-trip is wired up.
  const nav = require("@react-navigation/native").useNavigation() as { navigate: (n: string, p?: object) => void };
  useEffect(() => {
    let sub: { remove: () => void } | undefined;
    void (async () => {
      try {
        const Notifications = await import("expo-notifications");
        sub = Notifications.addNotificationResponseReceivedListener((response) => {
          const data = response.notification.request.content.data as { threadId?: string; title?: string } | undefined;
          if (data?.threadId) {
            nav.navigate("Conversation", { threadId: data.threadId, title: data.title });
          }
        });
      } catch {
        // expo-notifications may not be available in tests
      }
    })();
    return () => { sub?.remove(); };
  }, [nav]);
}

export function RootNavigator({
  navRef,
}: {
  navRef: NavigationContainerRef<Record<string, object | undefined>>;
}) {
  const qc = useQueryClient();

  useEffect(() => {
    const dispose = installNotificationHandlers(navRef, qc);
    return dispose;
  }, [navRef, qc]);


  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="Tabs" component={FieldTabs} options={{ headerShown: false }} />
      <Stack.Screen name="RFI" component={RFIScreen} options={{ title: "RFIs" }} />
      <Stack.Screen name="Submittals" component={SubmittalsScreen} options={{ title: "Submittals" }} />
      <Stack.Screen name="Inspections" component={InspectionsScreen} />
      <Stack.Screen name="SwpppInspection" component={SwpppInspectionScreen} options={{ title: "SWPPP Inspection" }} />
      <Stack.Screen name="Drawings" component={DrawingsScreen} />
      <Stack.Screen name="Documents" component={DocumentsScreen} />
      <Stack.Screen name="Conflicts" component={ConflictsScreen} options={{ title: "Sync Conflicts" }} />
      <Stack.Screen name="InventoryScan" component={InventoryScanScreen} options={{ title: "Scan Material" }} />
      <Stack.Screen name="InventoryAction" component={InventoryActionScreen} options={{ title: "Inventory Action" }} />
      <Stack.Screen name="ReportEquipmentIssue" component={ReportEquipmentIssueScreen} options={{ title: "Report Equipment Issue" }} />
      <Stack.Screen name="HaulTickets" component={HaulTicketsScreen} options={{ title: "Haul Tickets" }} />
      <Stack.Screen name="ReportIncident" component={ReportIncidentScreen} options={{ title: "Report Incident" }} />
      <Stack.Screen
        name="NotificationSettings"
        component={NotificationSettingsScreen}
        options={{ title: "Notifications" }}
      />
      <Stack.Screen name="TMTickets" component={TMTicketsScreen} options={{ title: "T&M Tickets" }} />
      <Stack.Screen name="CreateTask" component={CreateTaskScreen} options={{ title: "Create Task" }} />
      <Stack.Screen name="RequestMaterial" component={RequestMaterialScreen} options={{ title: "Request Material" }} />
      <Stack.Screen name="EquipmentHours" component={EquipmentHoursScreen} options={{ title: "Equipment Hours" }} />
      <Stack.Screen name="Conversation" component={ConversationScreen} options={{ title: "Conversation" }} />
      <Stack.Screen name="AnalyzePhoto" component={AnalyzePhotoScreen} options={{ title: "Analyze Photo" }} />
      <Stack.Screen name="Deliveries" component={DeliveriesScreen} options={{ title: "Deliveries" }} />
      <Stack.Screen name="DeliveryDetail" component={DeliveryDetailScreen} options={{ title: "Confirm Delivery" }} />
      <Stack.Screen name="IssueCaptures" component={IssueCapturesScreen} options={{ title: "Issue Captures" }} />
    </Stack.Navigator>
  );
}
