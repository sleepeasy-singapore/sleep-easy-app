import React, { useCallback, useMemo, useState } from "react";
import { Alert, Linking } from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import SettingsList from "../../../components/SettingsList";
import { useTheme } from "../../../theme/ThemeProvider";
import { useO2Ring } from "../../../service/O2RingProvider";
import type { Card } from "../../../types/settings";

export default function SettingsScreen() {
  const { colors: C, isDark, setMode } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { disconnect } = useO2Ring();

  const appVersion = Constants.expoConfig.version;

  const [switches, setSwitches] = useState<Record<string, boolean>>({
    dark: isDark,
  });

  /**
   * Handler to toggle switches in Settings
   */
  const handleToggle = useCallback(
    (id: string, next: boolean) => {
      if (id === "dark") setMode(next ? "dark" : "light");
      setSwitches((prev) => ({ ...prev, [id]: next }));
    },
    [setMode]
  );

  /**
   * Signout function
   */
  const signOut = async () => {
    Alert.alert(
      "Sign Out",
      "Are you sure you want to sign out?",
      [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("signOut"),
          style: "destructive",
          onPress: async () => {
            try {
              await disconnect().catch(() => undefined);
              await AsyncStorage.removeItem("patientID"); // clear storage
              router.replace("/Welcome"); // navigate to welcome
            } catch (error) {
              console.error("Error@signOut:", error);
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  const cards: Card[] = useMemo(
    () => [
      {
        id: "profile",
        sectionLabel: t("profile"),
        rows: [
          {
            id: "patientProfile",
            type: "link",
            title: t("patientProfile"),
            icon: "person-circle-outline",
            route: "/(tabs)/settings/Profile",
          },
        ],
      },
      {
        id: "general",
        sectionLabel: t("general"),
        rows: [
          {
            id: "dark",
            type: "switch",
            title: isDark ? t("lightMode") : t("darkMode"),
            icon: isDark ? "sunny" : "moon",
            switchValue: isDark,
          },
          /*
          {
            id: "notif",
            type: "link",
            title: t("notification"),
            icon: "notifications-outline",
            route: "/(tabs)/settings/Notification",
          },
          */
          {
            id: "language",
            type: "link",
            title: t("language"),
            icon: "language-outline",
            route: "/(tabs)/settings/Language",
          },
        ],
      },
      /*
      {
        id: "pap-machine",
        sectionLabel: t("papMachine"),
        rows: [
          {
            id: "no-pap-machine",
            type: "note",
            title: t("noPapMachine"),
            icon: "close",
          },
        ],
      },
      {
        id: "oximeter",
        sectionLabel: t("oximeter"),
        rows: [
          {
            id: "no-oximeter",
            type: "note",
            title: t("noOximeter"),
            icon: "close",
          },
        ],
      },
      */
      {
        id: "support",
        sectionLabel: t("support"),
        rows: [
          {
            id: "visit-website",
            type: "button",
            title: t("visitOurWebsite"),
            icon: "globe-outline",
            onPress: () => Linking.openURL("https://sleepeasysingapore.com/"),
          },
          {
            id: "contact-whatsapp",
            type: "button",
            title: t("contactUsOnWhatsapp"),
            icon: "logo-whatsapp",
            onPress: () => Linking.openURL("https://wa.me/+6587884738"),
          },
          /*
          {
            id: "faq",
            type: "link",
            title: t("faq"),
            icon: "help-circle-outline",
            route: "/(tabs)/settings/FAQ",
          },
          */
          {
            id: "app-version",
            type: "note",
            title: `${t("appVersion")} ${appVersion}`,
          },
        ],
      },
    ],
    [t, isDark]
  );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: C.bg }}
      edges={["top", "left", "right"]}>
      <SettingsList
        cards={cards}
        titleFlag={true}
        ctaFlag={{ enabled: true, label: t("signOut"), onPress: signOut }}
        switchValues={switches}
        onToggleSwitch={handleToggle}
      />
    </SafeAreaView>
  );
}
