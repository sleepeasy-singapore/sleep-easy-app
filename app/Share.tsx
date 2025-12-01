import React, { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useShareIntentContext } from "expo-share-intent";
import { useTheme } from "../theme/ThemeProvider";
import { API_DEV, API_PROD } from "@env";
import { useTranslation } from "react-i18next";
import { Directory, Paths, File as ExpoFile } from "expo-file-system";
import { uploadCsv } from "../service/History";

const rawBase = __DEV__ ? API_DEV : API_PROD;
const baseURL = rawBase?.replace(/\/+$/, "");

// same helper as history/index.tsx
const getO2dataDir = (patientId: string) =>
  new Directory(Paths.document, "o2data", patientId);

export default function ShareScreen() {
  const { colors: C, fonts: F } = useTheme();
  const { t } = useTranslation();

  const {
    hasShareIntent,
    shareIntent,
    resetShareIntent,
    error: shareError,
  } = useShareIntentContext();

  const [patientID, setPatientID] = useState<string | null>(null);
  const [loadingPatient, setLoadingPatient] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Get first shared file (if any)
  const file = useMemo(() => {
    return shareIntent?.files?.[0] ?? null;
  }, [shareIntent]);

  // Load logged-in patient ID from AsyncStorage
  useEffect(() => {
    (async () => {
      try {
        const id = await AsyncStorage.getItem("patientID");
        setPatientID(id);
      } catch (e) {
        console.error("ShareScreen: failed to read patientID", e);
      } finally {
        setLoadingPatient(false);
      }
    })();
  }, []);

  // ensure o2data dir exists (same as history)
  const ensureDir = async (patientId: string) => {
    const dir = getO2dataDir(patientId);
    try {
      if (dir.exists !== true) {
        await dir.create({ intermediates: true });
      }
      return dir;
    } catch (e) {
      console.error("Error@Share.tsx/ensureDir:", e);
      throw e;
    }
  };

  const handleUpload = async () => {
    if (!file) {
      Alert.alert("Error@Share.tsx", "No file to upload.");
      return;
    }
    if (!patientID) {
      Alert.alert("Error@Share.tsx", "No patient is logged in.");
      return;
    }
    if (!baseURL) {
      Alert.alert("Error@Share.tsx", "Backend URL is not configured.");
      return;
    }

    try {
      setUploading(true);

      const dir = await ensureDir(patientID);

      // read contents from the shared file path
      const src = new ExpoFile(file.path);
      const text = await src.text();

      // use original filename if possible, or a fallback
      const storageName =
        file.fileName && file.fileName.length > 0
          ? file.fileName
          : `${Date.now()}.csv`;

      let dest = new ExpoFile(dir, storageName);
      if (dest.exists === true) {
        await dest.delete();
      }

      await dest.write(text, { encoding: "utf8" });

      await uploadCsv({
        patientId: patientID,
        item: { id: storageName, uri: dest.uri },
        baseURL,
      });

      // Success (uploadCsv resolves on 2xx/409)
      Alert.alert("Success", "File saved and uploaded for this patient.");
      // clear share intent so it doesn't repeat if user comes back
      resetShareIntent();
    } catch (e: any) {
      console.error("Error@Share.tsx:", e?.message ?? e);
      Alert.alert(
        "Error@Share.tsx",
        "Upload failed. Please check your network."
      );
    } finally {
      setUploading(false);
    }
  };

  // Loading states
  if (loadingPatient) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  // No share or error
  if (!hasShareIntent || (!file && !shareIntent?.text)) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
        <Text style={[F.text, { color: C.text }]}>
          No shared file detected.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      <Text style={[F.title, { color: C.text }]}>Shared File</Text>
      <Text style={[F.text, { color: C.sub, marginTop: 20 }]}>File Name</Text>
      <Text style={[F.text, { color: C.text }]}>
        {file?.fileName || "Unnamed file"}
      </Text>

      <Pressable
        style={[styles.button, { backgroundColor: C.tint }]}
        onPress={handleUpload}
        disabled={uploading}>
        {uploading ? (
          <ActivityIndicator />
        ) : (
          <Text style={F.buttonText}>Upload</Text>
        )}
      </Pressable>

      {shareError && (
        <Text style={[F.text, { color: "red" }]}>{String(shareError)}</Text>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  button: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
