import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  TextInput,
  Image,
} from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";

export default function Welcome() {
  const { colors: C, fonts: F } = useTheme();

  const [patientID, setPatientID] = useState<string>("");

  const savePatientID = async () => {
    try {
      await AsyncStorage.setItem("patientID", patientID);
      router.replace("/(tabs)/home");
    } catch (error) {
      console.error("Error@Welcome.tsx:", error);
    }
  };

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
          source={require("../assets/sleepeasylogo-banner.png")}
          style={styles.image}
          resizeMode="contain"
        />
        <Text style={[{ color: C.text, ...F.title, marginBottom: 3 }]}>
          Welcome to Sleep Easy
        </Text>
        <Text style={[{ color: C.text, ...F.sectionLabel }]}>
          Please enter your Patient ID to continue.
        </Text>
        <View
          style={[
            styles.formRow,
            {
              backgroundColor: C.bg,
              borderColor: C.border,
            },
          ]}>
          <TextInput
            value={patientID}
            onChangeText={setPatientID}
            placeholder={"Patient ID"}
            placeholderTextColor={C.sub}
            autoCapitalize="none"
            underlineColorAndroid={"transparent"}
            style={{ color: C.text, flex: 1 }}
          />

          <TouchableOpacity onPress={savePatientID}>
            <Ionicons
              name="arrow-forward-circle-outline"
              size={32}
              color={C.tint}
            />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.supportContainer}>
        <Text
          style={[{ color: C.text, ...F.sectionLabel, textAlign: "center" }]}>
          If you do not know your Patient ID.
        </Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: C.tint, marginTop: 8 }]}
          activeOpacity={0.85}
          onPress={() => Linking.openURL("https://wa.me/+6587884738")}>
          <Text style={[{ ...F.buttonText, fontSize: 14 }]}>
            Contact Us Here
          </Text>
        </TouchableOpacity>
        <Text
          style={[
            {
              color: C.text,
              ...F.sectionLabel,
              textAlign: "center",
              marginTop: 16,
            },
          ]}>
          Want to know more about us?
        </Text>{" "}
        <TouchableOpacity
          style={[styles.buttonSecondary, { borderColor: C.border }]}
          activeOpacity={0.85}
          onPress={() => Linking.openURL("https://sleepeasysingapore.com/")}>
          <Text style={[{ ...F.buttonText, fontSize: 14, color: C.text }]}>
            Visit our website
          </Text>
        </TouchableOpacity>
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
  formRow: {
    minHeight: 56,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  supportContainer: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  buttonSecondary: {
    height: 40,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginTop: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  button: {
    height: 40,
    borderRadius: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
});
