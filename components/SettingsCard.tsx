import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import { useTheme } from "../theme/ThemeProvider";

export default function SettingsCard({
  shadowColor,
  children,
}: {
  shadowColor: string;
  children: React.ReactNode;
}) {
  const { colors: C } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { borderColor: C.border, backgroundColor: C.bg, shadowColor },
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 1 },
    }),
  },
});
