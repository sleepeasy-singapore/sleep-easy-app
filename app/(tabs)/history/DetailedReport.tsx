import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../../../theme/ThemeProvider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  Text,
  Alert,
  TextInput,
} from "react-native";
import { CartesianChart, Line } from "victory-native";
import { File as ExpoFile } from "expo-file-system";
import { useTranslation } from "react-i18next";
import { getO2dataDir } from "../../../service/History";
import { useFont } from "@shopify/react-native-skia";

type Row = { t: number; spo2: number; pr: number }; // ms timestamp, SpO2, Pulse

const { height } = Dimensions.get("window");

/**
 * Parse Date Time into epoch ms number
 * Returns null if it can't parse.
 */
function parseNonISOTime(timeStr: string): number | null {
  // Try "HH:MM:SS Mon DD YYYY"
  {
    const months: Record<string, number> = {
      Jan: 0,
      Feb: 1,
      Mar: 2,
      Apr: 3,
      May: 4,
      Jun: 5,
      Jul: 6,
      Aug: 7,
      Sep: 8,
      Oct: 9,
      Nov: 10,
      Dec: 11,
    };

    const m = timeStr.match(
      /^(\d{2}):(\d{2}):(\d{2})\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})$/
    );
    if (m) {
      const [, HH, MM, SS, mon, ddStr, yyyyStr] = m;
      const monthIndex = months[mon];
      if (monthIndex == null) return null;

      const yyyy = Number(yyyyStr);
      const dd = Number(ddStr);
      const hh = Number(HH);
      const min = Number(MM);
      const ss = Number(SS);

      const ms = new Date(yyyy, monthIndex, dd, hh, min, ss).getTime();
      if (!Number.isNaN(ms)) return ms;
    }
  }

  // Try "HH:MM:SS DD/MM/YYYY"
  {
    const m = timeStr.match(
      /^(\d{2}):(\d{2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})$/
    );
    if (m) {
      const [, HH, MM, SS, ddStr, mon, yyyyStr] = m;
      const dd = Number(ddStr);
      const monthIndex = Number(mon);
      const yyyy = Number(yyyyStr);
      const hh = Number(HH);
      const min = Number(MM);
      const ss = 0;

      const ms = new Date(yyyy, monthIndex, dd, hh, min, ss).getTime();
      if (!Number.isNaN(ms)) return ms;
    }
  }

  return null;
}

/**
 * Parse CSV text into rows for graphing
 * @param csvText The entire CSV text
 */
function parseCsvToRows(csvText: string): Row[] {
  const lines = csvText.replace(/\r\n?/g, "\n").split("\n").filter(Boolean);
  if (lines.length <= 1) return [];

  // Headers
  const header = lines[0].split(",").map((h) => h.trim());
  const idxTime = header.findIndex((h) => /^time$/i.test(h));
  const idxSpO2 = header.findIndex((h) => /^oxygen level$/i.test(h));
  const idxPR = header.findIndex((h) => /^pulse rate$/i.test(h));
  if (idxTime === -1 || idxSpO2 === -1 || idxPR === -1) return [];

  const out: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length <= Math.max(idxTime, idxSpO2, idxPR)) continue;

    const timeStr = (cols[idxTime] ?? "").trim(); // "01:34:42 Oct 21 2025" or "21/10/2025 1:34"
    const spo2Str = (cols[idxSpO2] ?? "").trim();
    const prStr = (cols[idxPR] ?? "").trim();

    // Strip everything except digits and dot
    const toNum = (s: string) => Number((s.match(/[\d.]+/) ?? [""])[0]);

    const t = parseNonISOTime(timeStr);
    const spo2 = toNum(spo2Str);
    const pr = toNum(prStr);

    if (t != null && !Number.isNaN(spo2) && !Number.isNaN(pr)) {
      out.push({ t, spo2, pr });
    }
  }
  return out;
}

export default function DetailedReport() {
  const { colors: C, fonts: F } = useTheme();
  const { t } = useTranslation();
  const roboto = useFont(
    require("../../../assets/fonts/Roboto-Regular.ttf"),
    12
  );
  const { id } = useLocalSearchParams<{
    id: string;
  }>();

  const [rows, setRows] = useState<Row[] | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);

  const [patientID, setPatientID] = useState<string>("");

  /**
   * Get patientID from AsyncStorage
   */
  useEffect(() => {
    (async () => {
      try {
        const id = await AsyncStorage.getItem("patientID");
        if (id) setPatientID(id);
      } catch (error) {
        console.warn("Error@DetailedReport.tsx/useEffect:", error);
      }
    })();
  }, []);

  /**
   * Load data from file
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!id) {
        console.warn("Error@DetailedReport.tsx/useEffect: Missing file id");
        return;
      }

      // Wait for patientID to be available before attempting to read the file
      if (!patientID) return;

      setLoading(true);

      try {
        const o2dataDir = getO2dataDir(patientID);
        const file = new ExpoFile(o2dataDir, id);
        const text = await file.text();
        const data = parseCsvToRows(text);
        if (!cancelled) setRows(data);
      } catch (error) {
        console.warn("Error@DetailedReport.tsx/useEffect:", error);
        Alert.alert(t("error"), t("failedToLoadData"));
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, patientID]);

  /**
   * Add or edit notes in the CSV file
   */
  useEffect(() => {
    async () => {};
  }, [notes]);

  // Sort data by time ascending
  const data = useMemo(() => {
    if (!rows) return [];
    return [...rows].sort((a, b) => a.t - b.t);
  }, [rows]);

  // Loading
  if (loading) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: C.bg,
          justifyContent: "center",
          alignItems: "center",
        }}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  // No data
  if (!data.length) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: C.bg,
          justifyContent: "center",
          alignItems: "center",
        }}>
        <Text style={{ color: C.text, ...F.sectionLabel }}>No Data Found</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: C.bg, padding: 16 }}
      edges={["left", "right"]}>
      <Text style={[{ color: C.text, marginBottom: 10, ...F.sectionLabel }]}>
        {new Date(rows[0]?.t).toLocaleString("en-GB", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
        {" - "}
        {new Date(rows[rows.length - 1]?.t).toLocaleString("en-GB", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
      </Text>

      {/* SpO2 Chart*/}
      <View style={styles.chartContainer}>
        <Text
          style={[
            { color: C.text, ...F.title, fontSize: 20, marginBottom: 5 },
          ]}>
          {t("spo2")}
        </Text>
        <CartesianChart
          data={data}
          xKey="t"
          yKeys={["spo2"]}
          xAxis={{
            font: roboto,
            labelColor: C.text,
            lineColor: C.text,
            formatXLabel: (v) =>
              new Date(Number(v)).toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            tickCount: 5,
          }}
          yAxis={[
            {
              font: roboto,
              labelColor: C.text,
              lineColor: C.text,
            },
          ]}
          domain={{ y: [75, 100] }}>
          {({ points }) => <Line points={points.spo2} color="green" />}
        </CartesianChart>
      </View>

      {/* Pulse Rate Chart*/}
      <View style={styles.chartContainer}>
        <Text
          style={[
            { color: C.text, ...F.title, fontSize: 20, marginBottom: 5 },
          ]}>
          {t("pulseRate")}
        </Text>
        <CartesianChart
          data={data}
          xKey="t"
          yKeys={["pr"]}
          xAxis={{
            font: roboto,
            labelColor: C.text,
            lineColor: C.text,
            formatXLabel: (v) =>
              new Date(Number(v)).toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            tickCount: 5,
          }}
          yAxis={[
            {
              font: roboto,
              labelColor: C.text,
              lineColor: C.text,
            },
          ]}
          domain={{ y: [30, 120] }}>
          {({ points }) => <Line points={points.pr} color={"green"} />}
        </CartesianChart>
      </View>

      {/* Notes */}
      <View style={styles.notesTitleContainer}>
        <Text style={[{ color: C.sub, ...F.sectionLabel }]}>{t("notes")}</Text>
      </View>
      <View
        style={[
          styles.notesRow,
          {
            borderColor: C.border,
            backgroundColor: C.bg,
          },
        ]}>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder={t("notes")}
          placeholderTextColor={C.sub}
          autoCapitalize="none"
          underlineColorAndroid={"transparent"}
          style={{ color: C.text }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  chartContainer: {
    width: "100%",
    height: height * 0.3,
    paddingBottom: 3,
  },
  notesTitleContainer: { paddingHorizontal: 5, marginTop: 4, marginBottom: 8 },

  notesRow: {
    minHeight: 56,
    width: "100%",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
});
