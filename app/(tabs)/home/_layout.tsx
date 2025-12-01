import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../theme/ThemeProvider";

export default function HistoryStack() {
  const { t } = useTranslation();
  const { colors: C, fonts: F } = useTheme();

  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="Scan"
        options={{
          headerBackTitle: "Back",
          headerShown: true,
          headerStyle: { backgroundColor: C.bg },
          headerTitleStyle: [{ color: C.text, ...F.title, fontSize: 20 }],
          headerTintColor: C.text,
          title: t("scan"),
        }}
      />
    </Stack>
  );
}
