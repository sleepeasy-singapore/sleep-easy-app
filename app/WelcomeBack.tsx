import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useTheme } from "../theme/ThemeProvider";

export default function WelcomeBack() {
  const { colors: C, fonts: F, isDark } = useTheme();
  const [patientID, setPatientID] = useState<string | null>(null);
  const bannerSource = isDark
    ? require("../assets/sleepeasylogo-banner-darkMode.png")
    : require("../assets/sleepeasylogo-banner.png");

  useEffect(() => {
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;

    const checkAndRedirect = async () => {
      try {
        const stored = await AsyncStorage.getItem("patientID");
        if (!stored) {
          router.replace("/Welcome");
          return;
        }

        setPatientID(stored);

        // Give users a quick splash of the welcome state before entering the app
        redirectTimer = setTimeout(() => {
          router.replace("/(tabs)/history");
        }, 1500);
      } catch (error) {
        console.error("Error@WelcomeBack:", error);
        router.replace("/(tabs)/history");
      }
    };

    checkAndRedirect();

    return () => {
      if (redirectTimer) clearTimeout(redirectTimer);
    };
  }, []);

  return (
    <SafeAreaView
      style={{
        flex: 1,
        justifyContent: "space-between",
        padding: 16,
        backgroundColor: C.bg,
      }}>
      <View style={styles.welcomeContainer}>
        <Image
          source={bannerSource}
          style={styles.image}
          resizeMode="contain"
        />
        <Text style={[{ color: C.text, ...F.title, marginBottom: 3 }]}>
          Welcome back
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  welcomeContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    width: 300,
    height: 80,
    marginBottom: 16,
  },
  loaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
  },
  loaderText: {
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 10,
  },
  supportContainer: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 12,
  },
});
