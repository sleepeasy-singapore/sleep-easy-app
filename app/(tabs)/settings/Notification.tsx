import { useTheme } from "../../../theme/ThemeProvider";
import type { Card } from "../../../types/settings";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "react-native-safe-area-context";
import SettingsList from "../../../components/SettingsList";
import { useMemo } from "react";
import { useCallback, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function Notification() {
  const { colors: C, isDark, setMode } = useTheme();
  const { t } = useTranslation();

  const [switches, setSwitches] = useState<Record<string, boolean>>({
    "o2ring-upload-reminder": false,
    "o2ring-uploaded-notification": true,
  });

  const STORAGE_KEY = "settings:notifications";

  const handleToggle = useCallback((id: string, next: boolean) => {
    setSwitches((prev) => ({ ...prev, [id]: next }));
  }, []);

  const cards: Card[] = useMemo(
    () => [
      {
        id: "reminder",
        sectionLabel: t("reminders"),
        rows: [
          {
            id: "o2ring-upload-reminder",
            type: "switch",
            title: t("o2ringUploadReminder"),
          },
        ],
      },
      {
        id: "notifications",
        sectionLabel: t("notifications"),
        rows: [
          {
            id: "o2ring-uploaded-notification",
            type: "switch",
            title: t("o2ringUploadedEmailNotification"),
          },
        ],
      },
    ],
    []
  );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: C.bg }}
      edges={["left", "right"]}>
      <SettingsList
        cards={cards}
        ctaFlag={{ enabled: false }}
        switchValues={switches}
        onToggleSwitch={handleToggle}
      />
    </SafeAreaView>
  );
}
