import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { File as ExpoFile } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import { useState, useCallback, useEffect, useRef } from "react";
import { HistoryItem } from "../../../types/history";
import { router, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { API_DEV, API_PROD } from "@env";
import api from "../../../api/api";
import {
  ensureDir,
  uploadPendingCsvs,
  UploadItem,
} from "../../../service/History";
import HistoryCard from "../../../components/HistoryCard";
import { useTheme } from "../../../theme/ThemeProvider";

const rawBase = __DEV__ ? API_DEV : API_PROD;
const baseURL = rawBase?.replace(/\/+$/, "");

export default function History() {
  const { colors: C, fonts: F } = useTheme();
  const { t } = useTranslation();

  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const isUploading = useRef(false);
  const [uploadingIds, setUploadingIds] = useState<string[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(false);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(new Date());
  const [patientID, setPatientID] = useState<string | null>(null);

  //-------------------------
  // NETWORK HELPER
  //-------------------------
  /**
   * Wrap a promise with a timeout
   * @param p Promise to wrap with timeout
   * @param ms Timeout in milliseconds
   * @param msg Error message on timeout
   * @returns Promise that rejects if timeout is reached
   */
  function withTimeout<T>(
    p: Promise<T>,
    ms: number,
    msg = "Timeout"
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Waits for API to respond or timeout
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        setIsOnline(false);

        reject(new Error(msg));
      }, ms);
    });

    // if promise finish first, clear the timeout
    // else if timeout fires first, reject with timeout error
    return Promise.race([p, timeout]).finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    }) as Promise<T>;
  }

  //-------------------------
  // UPLOAD FUNCTIONS
  //-------------------------
  /**
   * Load history from o2data dir
   */
  const loadHistory = useCallback(async () => {
    if (!patientID) {
      setHistory([]);
      return [];
    }

    try {
      // Get list of files in o2data/patientID
      const dir = await ensureDir(patientID);
      const entries = await dir.list();
      const files = entries.filter((e): e is ExpoFile => e instanceof ExpoFile);

      const csvs: HistoryItem[] = [];
      for (const f of files) {
        if (!f.name.toLowerCase().endsWith(".csv")) continue;

        csvs.push({
          id: f.name,
          label: formatFileName(f.name),
          uploaded: false,
          uri: f.uri,
        });
      }

      setHistory(csvs);
      setLastUpdateTime(new Date());

      if (!isOnline) return csvs;

      // Check upload status from backend
      setIsCheckingStatus(true);

      const existsMap =
        (await checkUploadStatus(
          patientID,
          csvs.map((c) => c.id)
        )) ?? {};

      // Update history with upload status
      const merged: HistoryItem[] = csvs.map((c) => ({
        ...c,
        uploaded: !!existsMap[c.id],
      }));

      setHistory(merged);
      return merged;
    } catch (e) {
      console.error("Error@history/index.tsx/loadHistory: ", e);
    } finally {
      setIsCheckingStatus(false);
    }
  }, [patientID, isOnline]);

  /**
   * Check upload status from backend
   * @param patientID Patient ID of patient
   * @param files Array of file names
   */
  const checkUploadStatus = async (patientID: string, files: string[]) => {
    try {
      const res = await withTimeout(
        api.post(`sleep_easy_app/get_patient_file_upload_status.php`, {
          patient_id: patientID,
          files,
        }),
        10000
      );
      setIsOnline(true);
      //res.data returns: {"exists": {"filename.csv": false, "filename2.csv": true}, "msg": "Success", "status": 200}
      return (res?.data?.exists ?? {}) as Record<string, boolean>;
    } catch (e) {
      // if backend down, just treat as not uploaded
      console.error("Error@history/index.tsx/checkUploadStatus: ", e);
    } finally {
      setLastUpdateTime(new Date());
    }
  };

  /**
   * Auto upload pending files when online
   */
  const autoUpload = useCallback(async () => {
    if (isUploading.current || !patientID || !isOnline || !baseURL) return;

    const pending = history.filter((h) => !h.uploaded);
    if (pending.length === 0) return;

    isUploading.current = true;
    setUploadingIds(pending.map((p) => p.id));

    try {
      const uploadedIds = await uploadPendingCsvs({
        patientId: patientID,
        items: pending as UploadItem[],
        baseURL,
      });
      if (uploadedIds.length > 0) {
        setHistory((h) =>
          h.map((item) =>
            uploadedIds.includes(item.id) ? { ...item, uploaded: true } : item
          )
        );
      }
    } catch (inner) {
      console.error("Error@history/index.tsx/autoUpload:", inner);
    } finally {
      setUploadingIds([]);
      isUploading.current = false;
    }
  }, [patientID, isOnline, history, loadHistory, baseURL]);

  /**
   * Load patient ID and check net status on mount
   */
  useEffect(() => {
    const sub = NetInfo.addEventListener((state) => {
      setIsOnline(
        state.isConnected && state.isInternetReachable ? true : false
      );
    });

    let alive = true;

    (async () => {
      const id = await AsyncStorage.getItem("patientID");
      setPatientID(id);
    })();
    return () => {
      alive = false;
      sub?.();
    };
  }, []);

  /**
   * Auto upload when online status or patientID changes
   */
  useEffect(() => {
    autoUpload();
  }, [history, isOnline, patientID, autoUpload]);

  /**
   * Load history when screen focused
   */
  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory])
  );

  /**
   * Format file name (for display not actually renaming)
   */
  const formatFileName = (name: string) => {
    // remove .csv (case-insensitive)
    const base = name.replace(/\.csv$/i, "");

    // get the part after the last underscore (or fall back to whole base)
    const parts = base.split("_");
    const coreRaw = parts[parts.length - 1] ?? base;
    const core = coreRaw.trim();

    // expect a 14-digit timestamp like 20251013112910
    if (/^\d{14}$/.test(core)) {
      const y = core.slice(0, 4);
      const m = core.slice(4, 6);
      const d = core.slice(6, 8);
      const hh = core.slice(8, 10);
      const mm = core.slice(10, 12);
      const ss = core.slice(12, 14);
      return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
    }

    // fallback: show whatever we got
    return core;
  };

  /**
   * Handle file upload (import)
   */
  const onUploadPress = useCallback(async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: [
        "public.comma-separated-values-text",
        "text/csv",
        "application/csv",
        "text/comma-separated-values",
        "application/vnd.ms-excel",
      ],
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;

    const asset = res.assets?.[0];
    if (!asset?.uri) return;

    if (!patientID) {
      Alert.alert(t("error"), "No Patient Id");
      return;
    }
    /// Create o2data dir if not exists
    const dir = await ensureDir(patientID);

    // read picked file
    const src = new ExpoFile(asset.uri);
    const text = await src.text();

    if (asset.name == null) return;
    const fileName = formatFileName(asset.name);
    const storageName = asset.name;

    let dest = new ExpoFile(dir, storageName);
    if (dest.exists === true) {
      await dest.delete();
    }

    await dest.write(text, {
      encoding: "utf8",
    });

    if (!isOnline || !patientID) {
      await loadHistory();
      return;
    }

    // Refresh history page
    await loadHistory();
  }, [loadHistory, isOnline, patientID]);

  //-------------------------
  // DELETE FUNCTIONS
  //-------------------------
  /**
   * Confirm delete
   * @param item
   */
  const confirmDelete = (item: HistoryItem) => {
    Alert.alert(
      t("confirmDeleteTitle"),
      t("confirmDeleteMessage", { fileName: item.label }),
      [
        {
          text: t("cancel"),
          style: "cancel",
        },
        {
          text: t("delete"),
          style: "destructive",
          onPress: () => {
            deleteFile(item);
          },
        },
      ]
    );
  };

  const deleteFile = async (item: HistoryItem) => {
    if (!patientID) return;

    try {
      const dir = await ensureDir(patientID);
      const file = new ExpoFile(dir, item.id);
      if (file.exists === true) {
        await file.delete();
      }

      setHistory((h) => h.filter((i) => i.id !== item.id));
      setLastUpdateTime(new Date());
    } catch (e) {
      Alert.alert(t("error"), t("deleteFileError" + e));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Title */}
      <View style={styles.titleContainer}>
        <Text style={[{ color: C.text, ...F.title }]}>{t("history")}</Text>
        <Text style={[{ color: C.sub, marginTop: 4, ...F.sectionLabel }]}>
          {t("lastUpdated") +
            (lastUpdateTime ? lastUpdateTime.toLocaleString() : "-")}
        </Text>
      </View>
      <View style={styles.spacer} />

      {/* Legend */}
      <View style={styles.legendContainer}>
        <View style={styles.legendItem}>
          <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
          <Text style={[styles.legendText, { color: C.text }]}>
            {t("uploaded")}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <Ionicons name="close-circle" size={16} color="#ef4444" />
          <Text style={[styles.legendText, { color: C.text }]}>
            {t("notUploaded")}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <Ionicons name="cloud-offline" size={16} color={C.text} />
          <Text style={[styles.legendText, { color: C.text }]}>
            {t("offline")}
          </Text>
        </View>
      </View>

      {/* History Cards */}
      <ScrollView
        contentContainerStyle={[styles.cardsContainer, { paddingBottom: 24 }]}>
        {history.length === 0 ? (
          <Text style={{ color: C.sub, textAlign: "center", marginTop: 24 }}>
            {t("noDataYet")}
          </Text>
        ) : (
          history.map((item) => (
            <HistoryCard
              key={item.id}
              label={item.label}
              isChecking={isCheckingStatus}
              online={isOnline}
              uploaded={item.uploaded}
              uploading={uploadingIds.includes(item.id)}
              onPress={() => {
                router.push({
                  pathname: `/history/DetailedReport`,
                  params: { id: item.id },
                });
              }}
              onLongPress={() => {
                confirmDelete(item);
              }}
            />
          ))
        )}
      </ScrollView>

      <TouchableOpacity
        onPress={() => {
          onUploadPress();
        }}
        style={[styles.addButton, { backgroundColor: C.tint }]}>
        <Ionicons name="add" size={30} color={C.white} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  spacer: { height: 12 },
  titleContainer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6 },
  legendContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 16,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendText: { fontSize: 14 },
  cardsContainer: { paddingHorizontal: 16, gap: 12 },
  addButton: {
    flex: 1,
    position: "absolute",
    bottom: 24,
    right: 24,
    borderRadius: 50,
    width: 50,
    height: 50,
    justifyContent: "center",
    alignItems: "center",
  },
});
