import React, { useMemo, useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../theme/ThemeProvider";
import { DeviceItem, useO2Ring } from "../../../service/O2RingProvider";

type DeviceRowProps = {
  item: DeviceItem;
  onPress: (item: DeviceItem) => void;
  disabled?: boolean;
  connecting?: boolean;
};

function DeviceRow({ item, onPress, disabled, connecting }: DeviceRowProps) {
  const { colors: C, fonts: F } = useTheme();

  return (
    <TouchableOpacity
      onPress={() => onPress(item)}
      style={[
        disabled ? styles.deviceRowDisabled : null,
        connecting ? styles.deviceRowConnecting : null,
        {
          backgroundColor: C.sub2,
          flexDirection: "row",
          alignItems: "center",
          padding: 12,
          borderRadius: 12,
          marginBottom: 2,
        },
      ]}
      activeOpacity={0.8}
      disabled={disabled}>
      <Image
        source={require("../../../assets/images/O2RingBGR.png")}
        style={{ width: 40, height: 40, marginRight: 8 }}
        resizeMode="contain"
      />
      <View style={{ flex: 1 }}>
        <Text style={[F.text, { color: C.white }]}>{item.name}</Text>
      </View>
      {connecting ? (
        <ActivityIndicator color={C.white} />
      ) : (
        <MaterialCommunityIcons
          name="chevron-right"
          color={C.white}
          size={24}
        />
      )}
    </TouchableOpacity>
  );
}

export default function ScanDeviceScreen() {
  const { colors: C, fonts: F } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const {
    devices,
    isScanning,
    connecting,
    startScan,
    stopScan,
    connectToDevice,
    clearDevices,
  } = useO2Ring();

  // Ensure scanning starts whenever this screen is focused (and stops on blur)
  useFocusEffect(
    useCallback(() => {
      clearDevices();
      startScan();
      return () => {
        stopScan();
      };
    }, [clearDevices, startScan, stopScan])
  );

  const hasDevices = useMemo(() => devices.length > 0, [devices]);

  async function handleConnect(item: DeviceItem) {
    const ok = await connectToDevice(item);
    if (ok) {
      router.back();
    }
  }

  async function handleScanToggle() {
    if (isScanning) {
      await stopScan();
    } else {
      await startScan();
    }
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: C.bg, padding: 16 }]}>
      {/* This wrapper controls vertical position */}
      <View
        style={[
          styles.content,
          !hasDevices && styles.contentCentered, // center when no devices
        ]}>
        <View style={styles.header}>
          <MaterialCommunityIcons
            name="radar"
            size={hasDevices ? 40 : 80}
            color={C.tint}
          />

          {/* Scan Button */}
          <TouchableOpacity
            onPress={handleScanToggle}
            style={{
              backgroundColor: isScanning ? C.danger : C.tint,
              flexDirection: "row",
              marginTop: 8,
              paddingHorizontal: 15,
              height: 48,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
            }}
            activeOpacity={0.85}>
            <Text style={[F.buttonText]}>
              {isScanning ? t("stop") : t("scan")}
            </Text>
            {isScanning && (
              <ActivityIndicator color={"#ffffff"} style={{ marginLeft: 10 }} />
            )}
          </TouchableOpacity>
        </View>

        {!hasDevices ? (
          <View
            style={{
              alignItems: "center",
              justifyContent: "center",
            }}>
            <Text style={{ color: C.sub }}>{t("noDevices")}</Text>
          </View>
        ) : (
          <FlatList
            data={devices}
            keyExtractor={(item) => item.mac}
            renderItem={({ item }) => (
              <DeviceRow
                item={item}
                onPress={handleConnect}
                disabled={connecting}
                connecting={connecting}
              />
            )}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            contentContainerStyle={{ paddingVertical: 12 }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  content: {
    flex: 1,
  },

  contentCentered: {
    justifyContent: "center",
  },

  header: {
    marginBottom: 16,
    justifyContent: "center",
    alignItems: "center",
  },

  title: {
    fontSize: 22,
    fontWeight: "800",
    marginTop: 6,
  },

  deviceRowDisabled: {
    opacity: 0.65,
  },

  deviceRowConnecting: {
    backgroundColor: "#1e272e",
  },
});
