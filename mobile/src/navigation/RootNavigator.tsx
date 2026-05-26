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
import { DrawingsScreen } from "@/screens/Drawings";
import { ConflictsScreen } from "@/screens/Conflicts";
import { InventoryScreen } from "@/screens/Inventory";
import { InventoryScanScreen } from "@/screens/InventoryScan";
import { InventoryActionScreen } from "@/screens/InventoryAction";
import { ReportEquipmentIssueScreen } from "@/screens/ReportEquipmentIssue";
import { HaulTicketsScreen } from "@/screens/HaulTickets";
import { ReportIncidentScreen } from "@/screens/ReportIncident";
import { NotificationSettingsScreen } from "@/screens/NotificationSettings";
import { installNotificationHandlers } from "@/push/pushManager";
import { colors } from "@/theme";

const Tabs = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function FieldTabs() {
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
    </Tabs.Navigator>
  );
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
      <Stack.Screen name="Drawings" component={DrawingsScreen} />
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
    </Stack.Navigator>
  );
}
