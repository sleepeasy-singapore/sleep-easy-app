import React, { useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTheme } from "../theme/ThemeProvider";
import { createAccountWithEmailAndPassword } from "../service/Welcome";

export default function CreateAccount() {
  const { colors: C, fonts: F } = useTheme();

  const [formValues, setFormValues] = useState<Record<string, string>>({
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const email = formValues.email ?? "";
  const password = formValues.password ?? "";
  const confirmPassword = formValues.confirmPassword ?? "";

  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    confirmPassword.length > 0 &&
    !isSubmitting;

  const handleCreateAccount = async () => {
    if (!canSubmit) return;
    if (password !== confirmPassword) {
      Alert.alert("Passwords don't match", "Please confirm your password.");
      return;
    }

    setIsSubmitting(true);
    try {
      await createAccountWithEmailAndPassword({ email, password });
      Alert.alert(
        "Account created",
        "Your account is ready. Please log in to continue."
      );
      router.replace("/Welcome");
    } catch (error) {
      const statusCode = Number(
        (error as any)?.status ??
          (error as any)?.response?.status ??
          (error as any)?.response?.data?.status
      );
      const status = Number.isFinite(statusCode) ? statusCode : undefined;
      console.error("Error@CreateAccount:", {
        status,
        message: (error as any)?.message,
        body: (error as any)?.body ?? (error as any)?.response?.data,
      });
      const message =
        error instanceof Error
          ? error.message
          : "Create account failed. Try again.";
      const messageWithStatus =
        status !== undefined ? `${message} (status ${status})` : message;
      Alert.alert("Create account failed", messageWithStatus);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled">
          <View>
            <Text style={[{ ...F.title, color: C.text, textAlign: "center" }]}>
              Create your account
            </Text>
            <Text
              style={[
                { ...F.sectionLabel, color: C.sub, marginTop: 6 },
                { textAlign: "center" },
              ]}>
              Use the email you shared with SleepEasy to create your account.
            </Text>
          </View>

          <View style={styles.form}>
            <View
              style={[
                styles.formRow,
                { backgroundColor: C.bg, borderColor: C.border },
              ]}>
              <TextInput
                value={email}
                onChangeText={(value) =>
                  setFormValues((prev) => ({ ...prev, email: value }))
                }
                placeholder="Email"
                placeholderTextColor={C.sub}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                underlineColorAndroid="transparent"
                style={[styles.input, { color: C.text }]}
              />
            </View>

            <View
              style={[
                styles.formRow,
                { backgroundColor: C.bg, borderColor: C.border },
              ]}>
              <TextInput
                value={password}
                onChangeText={(value) =>
                  setFormValues((prev) => ({ ...prev, password: value }))
                }
                placeholder="Password"
                placeholderTextColor={C.sub}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                textContentType="newPassword"
                underlineColorAndroid="transparent"
                style={[styles.input, { color: C.text }]}
              />
            </View>

            <View
              style={[
                styles.formRow,
                { backgroundColor: C.bg, borderColor: C.border },
              ]}>
              <TextInput
                value={confirmPassword}
                onChangeText={(value) =>
                  setFormValues((prev) => ({ ...prev, confirmPassword: value }))
                }
                placeholder="Confirm password"
                placeholderTextColor={C.sub}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                textContentType="password"
                underlineColorAndroid="transparent"
                style={[styles.input, { color: C.text }]}
              />
            </View>

            <TouchableOpacity
              style={[
                styles.button,
                { backgroundColor: C.tint, opacity: canSubmit ? 1 : 0.5 },
                Platform.select({ android: { elevation: 1.5 } }),
              ]}
              disabled={!canSubmit}
              activeOpacity={0.85}
              onPress={handleCreateAccount}>
              <Text style={[{ ...F.buttonText }]}>
                {isSubmitting ? "Creating..." : "Create Account"}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        <View style={styles.extraLinksContainer}>
          <Text
            style={[{ color: C.text, ...F.sectionLabel, textAlign: "center" }]}>
            Already have an account?
          </Text>

          <TouchableOpacity
            style={[
              styles.buttonSecondary,
              { borderColor: C.border, marginTop: 8 },
            ]}
            activeOpacity={0.85}
            onPress={() => router.replace("/Welcome")}>
            <Text style={[{ ...F.buttonText, fontSize: 14, color: C.text }]}>
              Log In
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
            Need help?
          </Text>

          <TouchableOpacity
            style={[
              styles.buttonSecondary,
              { borderColor: C.border, marginTop: 8 },
            ]}
            activeOpacity={0.85}
            onPress={() => Linking.openURL("https://wa.me/+6587884738")}>
            <Text style={[{ ...F.buttonText, fontSize: 14, color: C.text }]}>
              Contact Us
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "space-between",
  },
  scrollContainer: {
    flexGrow: 1,
    padding: 16,
    justifyContent: "center",
  },

  form: {
    width: "100%",
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
    marginVertical: 10,
  },
  input: {
    flex: 1,
  },
  button: {
    height: 52,
    borderRadius: 12,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
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

  extraLinksContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});
