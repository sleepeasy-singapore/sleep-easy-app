import React, { useCallback, useEffect } from "react";
import {
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as NavigationBar from "expo-navigation-bar";
import { useFocusEffect, useRouter } from "expo-router";
import { useTheme } from "../../../theme/ThemeProvider";
import { useTranslation } from "react-i18next";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useO2Ring } from "../../../service/O2RingProvider";

export default function Home() {
  const { colors: C, isDark, fonts: F } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const {
    connectedDevice,
    spo2,
    pr,
    disconnect,
    refreshRealtime,
    isRealtimeReady,
  } =
    useO2Ring();

  useEffect(() => {
    StatusBar.setBarStyle(isDark ? "light-content" : "dark-content", true);

    if (Platform.OS === "android") {
      StatusBar.setBackgroundColor(C.bg2, true);
      NavigationBar.setBackgroundColorAsync(C.bg2);
      NavigationBar.setButtonStyleAsync(isDark ? "light" : "dark");
    }
  }, [C.bg2, isDark]);

  const handleDisconnect = async () => {
    await disconnect();
  };

  const handleScan = () => {
    router.push("/(tabs)/home/Scan");
  };

  /**
   * Display values from O2 Ring live with fallback
   */
  useFocusEffect(
    useCallback(() => {
      if (!connectedDevice || !isRealtimeReady) return;

      // call once immediately when screen is focused
      refreshRealtime();

      // then keep calling every 1 second
      const intervalId = setInterval(() => {
        refreshRealtime();
      }, 1000);

      // clean up when leaving the screen or losing focus
      return () => {
        clearInterval(intervalId);
      };
    }, [connectedDevice, isRealtimeReady, refreshRealtime])
  );

  const displaySpo2 =
    spo2 == null || spo2 < 20 || spo2 > 100 ? "--" : `${spo2}`;

  const displayPr = pr == null || pr < 20 || pr > 250 ? "--" : `${pr}`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      {connectedDevice ? (
        // Connected view
        <View>
          <View style={styles.titleContainer}>
            <Text style={[F.title, { color: C.text }]}>{t("home")}</Text>
            <Text style={{ color: C.text, marginBottom: 16 }}>
              {t("connectedTo")} : {connectedDevice.name}
            </Text>
          </View>

          {/* Live Display */}
          <View style={{ paddingHorizontal: 16 }}>
            <View style={[styles.card, { backgroundColor: C.bg2 }]}>
              <Text style={[styles.label, { color: C.text }]}>SpO2</Text>
              <Text style={[styles.value, { color: C.tint }]}>
                {displaySpo2} %
              </Text>
            </View>

            <View style={[styles.card, { backgroundColor: C.bg2 }]}>
              <Text style={[styles.label, { color: C.text }]}>
                {t("pulseRate")}
              </Text>
              <Text style={[styles.value, { color: C.tint }]}>
                {displayPr} bpm
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleDisconnect}
              style={[styles.button, { backgroundColor: C.danger }]}
              activeOpacity={0.85}>
              <Text style={[F.buttonText]}>{t("disconnect")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        // Not connected view
        <View style={styles.centerTop}>
          <MaterialCommunityIcons
            name="bluetooth-off"
            size={80}
            color={C.text}
          />
          <Text style={[styles.bigText, { color: C.text }]}>
            {t("notConnected")}
          </Text>

          <TouchableOpacity
            onPress={handleScan}
            style={[styles.button, { backgroundColor: C.tint, marginTop: 24 }]}
            activeOpacity={0.85}>
            <Text style={[F.buttonText]}>{t("connectDevice")}</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  titleContainer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6 },
  centerTop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 4,
  },
  bigText: {
    fontSize: 24,
    fontWeight: "800",
    marginTop: 12,
  },
  button: {
    marginTop: 16,
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  value: {
    fontSize: 32,
    fontWeight: "800",
  },
});
