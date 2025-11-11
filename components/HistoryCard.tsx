import { StyleSheet, TouchableOpacity, Text, View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { Ionicons } from "@expo/vector-icons";

type Props = {
  /** e.g. "2025-10-08 23:00" */
  label: string;
  online: boolean;
  /** true = uploaded (green tick), false = not uploaded (red x) */
  uploaded: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
};

export default function HistoryCard({
  label,
  online,
  uploaded,
  onPress,
  onLongPress,
}: Props) {
  const { colors: C } = useTheme();

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
      style={[styles.card, { backgroundColor: C.bg2, borderColor: C.border }]}
      accessibilityRole="button"
      accessibilityLabel={`History item ${label}, ${
        uploaded ? "uploaded" : "not uploaded"
      }`}
      testID="history-card">
      {/* Left icon */}
      <Ionicons
        name="document-text-outline"
        size={20}
        color={C.text}
        style={{ marginRight: 12 }}
      />

      {/* Main text */}
      <Text style={[styles.cardLabel, { color: C.text }]} numberOfLines={1}>
        {label}
      </Text>

      {/* Chevron (navigation hint) */}
      <Ionicons
        name="chevron-forward"
        size={18}
        color={C.sub}
        style={{ marginLeft: 8 }}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />

      {/* Upload status - at the FAR RIGHT */}
      <View style={{ width: 8 }} />

      <Ionicons
        name={
          online
            ? uploaded
              ? "checkmark-circle"
              : "close-circle"
            : "cloud-offline"
        }
        size={18}
        color={online ? (uploaded ? "#22c55e" : "#ef4444") : "#ffffff"} // green / red / white
        accessibilityLabel={uploaded ? "Uploaded" : "Not uploaded"}
        testID={uploaded ? "status-uploaded" : "status-not-uploaded"}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 64, // slightly larger for easier tapping
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
  },
});
