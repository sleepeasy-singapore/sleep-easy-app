import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../../theme/ThemeProvider";
import { CartesianChart, Line } from "victory-native";
import {
  View,
  StyleSheet,
  Dimensions,
  Text,
  TouchableOpacity,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { StatusBar, Platform } from "react-native";
import * as NavigationBar from "expo-navigation-bar";

export default function Home() {
  const { colors: C, isDark } = useTheme();
  const { t } = useTranslation();

  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);

  const { height } = Dimensions.get("window");

  useEffect(() => {
    const checkPatientID = async () => {
      setLoading(true);

      // Top bar: icon color + background (Android needs explicit bg for contrast)
      StatusBar.setBarStyle(isDark ? "light-content" : "dark-content", true);

      if (Platform.OS === "android") {
        StatusBar.setBackgroundColor(C.bg2, true);
        // Bottom Android navigation bar
        NavigationBar.setBackgroundColorAsync(C.bg2);
        NavigationBar.setButtonStyleAsync(isDark ? "light" : "dark");
      }

      try {
        const patientID = await AsyncStorage.getItem("patientID");
        if (!patientID) {
          router.replace("/Welcome");
        }
      } catch (e) {
        console.error("Error@index.tsx/useEffect: ", e);
      } finally {
        setLoading(false);
      }
    };

    checkPatientID();
  }, []);

  if (connected) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: C.bg, padding: 16 }}
        edges={["left", "right"]}>
        {/* SpO2 */}
        <View style={styles.chartContainer}>
          <Text>SpO2</Text>
          {/*<CartesianChart>
           </CartesianChart>*/}
          <View style={{ alignItems: "center" }}>
            <Text>Time</Text>
          </View>
        </View>

        {/* Pulse Rate */}
        <View style={styles.chartContainer}>
          <Text>Pulse Rate</Text>
          {/*<CartesianChart>
           </CartesianChart>*/}
          <View style={{ alignItems: "center" }}>
            <Text>Time</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: C.bg,
      }}>
      <MaterialCommunityIcons name="bluetooth-off" size={100} color={C.text} />
      <Text style={[styles.notConnectedText, { color: C.text }]}>
        {t("notConnected")}
      </Text>
      <TouchableOpacity
        onPress={() => setConnected(!connected)}
        activeOpacity={0.85}
        style={[
          styles.cta,
          {
            backgroundColor: C.tint,
          },
        ]}>
        <Text style={styles.ctaText}>{t("connectDevice")}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  chartContainer: {
    borderWidth: 1,
    width: "100%",
    paddingBottom: 3,
  },
  notConnectedText: {
    fontFamily: "Roboto",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  cta: {
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    paddingHorizontal: 20,
  },
  ctaText: { color: "#FFFFFF", fontSize: 16.5, fontWeight: "700" },
});
