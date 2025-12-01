import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme/ThemeProvider";
import type { RowType } from "../types/settings";

function SettingsRow({
  type,
  title,
  icon,
  switchValue,
  textValue,
  onToggleSwitch,
  onChangeText,
  onPress,
}: {
  type: RowType;
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  switchValue?: boolean;
  onToggleSwitch?: (next: boolean) => void;
  textValue?: string;
  onChangeText?: (t: string) => void;
  onPress?: () => void;
}) {
  const isSwitch = type === "switch";
  const isForm = type === "text-input";

  const isPressable =
    type === "link" || type === "button" || type === "radio-button";
  const Wrapper: any = isPressable ? TouchableOpacity : View;

  const { colors: C, fonts: F } = useTheme();

  return (
    <Wrapper
      activeOpacity={0.7}
      onPress={onPress}
      accessibilityRole={
        isSwitch ? "switch" : isPressable ? "button" : undefined
      }
      accessibilityState={
        type === "radio-button" ? { selected: !!switchValue } : undefined
      }
      style={[
        styles.row,
        isForm && styles.formRow,
        isForm && {
          backgroundColor: C.bg,
          borderColor: C.border,
          borderBottomWidth: 0,
        },
      ]}>
      {/* Left icon (or reserved space) */}
      {isForm ? (
        <View style={{ width: 0 }} />
      ) : icon ? (
        <Ionicons name={icon} size={20} color={C.text} style={{ width: 26 }} />
      ) : (
        <View style={{ width: 26 }} />
      )}

      {/* Middle content */}
      <View
        style={{ flex: isForm ? 0 : 1, width: isForm ? "100%" : undefined }}>
        {isForm ? (
          <TextInput
            value={textValue}
            onChangeText={onChangeText}
            placeholder={title}
            placeholderTextColor={C.sub}
            autoCapitalize="none"
            underlineColorAndroid={"transparent"}
            style={{ color: C.text }}
          />
        ) : (
          <>
            <Text style={{ color: C.text, ...F.text }}>{title}</Text>
          </>
        )}
      </View>

      {/* Right accessory */}
      {isSwitch ? (
        <Switch
          value={!!switchValue}
          onValueChange={(next) => onToggleSwitch?.(next)}
          trackColor={{ false: C.sub, true: C.sub }}
          thumbColor={switchValue ? C.tint : C.tint}
        />
      ) : type === "link" ? (
        <Ionicons
          name="chevron-forward"
          size={18}
          color={C.sub}
          style={{ marginLeft: 8 }}
        />
      ) : type === "radio-button" ? (
        <Ionicons
          name={switchValue ? "checkmark-circle" : "ellipse-outline"}
          size={20}
          color={switchValue ? C.tint : C.sub}
          style={{ marginLeft: 8 }}
        />
      ) : null}
    </Wrapper>
  );
}

export default React.memo(SettingsRow);

const styles = StyleSheet.create({
  row: {
    minHeight: 57,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  formRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 0,
  },
});
