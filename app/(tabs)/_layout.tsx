import { StatusBar, Platform } from "react-native";
import * as NavigationBar from "expo-navigation-bar";
import { Tabs, useSegments } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme/ThemeProvider";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";

export default function Layout() {
  const { colors: C, isDark } = useTheme();
  const { t } = useTranslation();
  const segments = useSegments();

  useEffect(() => {
    // Top bar: icon color + background (Android needs explicit bg for contrast)
    StatusBar.setBarStyle(isDark ? "light-content" : "dark-content", true);

    if (Platform.OS === "android") {
      StatusBar.setBackgroundColor(C.bg2, true);
      // Bottom Android navigation bar
      NavigationBar.setBackgroundColorAsync(C.bg2);
      NavigationBar.setButtonStyleAsync(isDark ? "light" : "dark");
    }
  }, [isDark, C.bg2]);

  const hideTabs =
    segments.at(0) === "(tabs)" &&
    ((segments.at(1) === "settings" && (segments.length ?? 0) > 2) ||
      (segments.at(1) === "history" && (segments.length ?? 0) > 2) ||
      (segments.at(1) === "home" && (segments.length ?? 0) > 2));

  return (
    <Tabs
      screenOptions={({ route }) => {
        const baseRaw = route.name.split("/")[0];
        const base = baseRaw.toLowerCase();
        const key =
          base === "index" ? "home" : (base as "history" | "settings");
        const ICONS = {
          home: { focused: "home", unfocused: "home-outline" },
          history: { focused: "time", unfocused: "time-outline" },
          settings: { focused: "settings", unfocused: "settings-outline" },
        } as const;
        const iconSet = ICONS[key as keyof typeof ICONS] ?? ICONS.home;

        return {
          headerShown: false,
          tabBarStyle: [
            { backgroundColor: C.bg2 },
            hideTabs ? { display: "none" } : null,
          ],
          tabBarActiveTintColor: C.tint,
          tabBarInactiveTintColor: C.sub,
          tabBarLabelStyle: { fontSize: 12 },
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? iconSet.focused : iconSet.unfocused}
              size={size}
              color={color}
            />
          ),
        };
      }}>
      <Tabs.Screen name="home" options={{ tabBarLabel: t("home") }} />
      <Tabs.Screen name="history" options={{ tabBarLabel: t("history") }} />
      <Tabs.Screen name="settings" options={{ tabBarLabel: t("settings") }} />
    </Tabs>
  );
}
