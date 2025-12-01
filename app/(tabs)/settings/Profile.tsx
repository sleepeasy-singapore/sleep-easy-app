import React, { useMemo, useState, useCallback } from "react";
import SettingsList from "../../../components/SettingsList";
import type { Card } from "../../../types/settings";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";
import { useTheme } from "../../../theme/ThemeProvider";
import api from "../../../api/api";
import NetInfo from "@react-native-community/netinfo";

export default function Profile() {
  const { t } = useTranslation();
  const { colors: C } = useTheme();

  const [loading, setLoading] = useState(true);

  const [formValues, setFormValues] = useState<{ [key: string]: string }>({});

  /**
   * Load stored profile data when screen is focused
   */
  useFocusEffect(
    useCallback(() => {
      let isActive = true; // avoid setState after unmount

      // Helper to map API patient object to form values
      const mapPatient = (p: any) => ({
        patientName: p?.name ?? "",
        dob: p?.birthdate ?? "",
        contact: p?.telephone_number ?? "",
        email: p?.email ?? "",
      });

      // Load patient information from AsyncStorage cache
      const loadFromCache = async () => {
        const [storedID, patientData] = await Promise.all([
          AsyncStorage.getItem("patientID"),
          AsyncStorage.getItem("patientData"),
        ]);

        const id = storedID?.trim();

        // Set ID field
        if (isActive && id) {
          setFormValues((prev) => ({ ...prev, "patient-id": id }));
        }

        // Set patient data from cache if available
        if (isActive && patientData) {
          try {
            const cached = JSON.parse(patientData);
            setFormValues((prev) => ({ ...prev, ...mapPatient(cached) }));
          } catch (e) {
            console.error("Error@Profile.tsx/loadFromCache:", e);
          }
        }
        return id;
      };

      const fetchFromServer = async (id: string) => {
        if (!id) return;

        const ETAG = await AsyncStorage.getItem("patientETag");

        const res = await api.get(
          `sleep_easy_app/get_patient_details_with_id.php`,
          {
            params: { patient_id: Number(id) },
            headers: ETAG ? { "If-None-Match": ETAG } : undefined,
            validateStatus: (status) =>
              (status >= 200 && status < 300) || status === 304,
          }
        );

        if (res.status === 200) {
          const p = res.data.patient;

          await AsyncStorage.setItem("patientData", JSON.stringify(p));
          const etag = res.headers?.etag;
          if (etag) await AsyncStorage.setItem("patientETag", etag);

          if (isActive && p) {
            setFormValues((prev) => ({ ...prev, ...mapPatient(p) }));
          }
        }
      };

      (async () => {
        setLoading(true);
        try {
          const id = await loadFromCache();
          const netState = await NetInfo.fetch();

          if (!id) return;

          if (netState.isConnected) {
            await fetchFromServer(id);
          }
        } catch (error) {
          console.error("Error@Profile.tsx/useFocusEffect:", error);
          Alert.alert("Error", "Could not load profile. Please try again.");
        } finally {
          if (isActive) setLoading(false);
        }
      })();

      return () => {
        isActive = false;
      };
    }, [])
  );

  /**
   * Handler for form field changes
   * @param id Forms value to be changed
   * @param value Updated values
   */
  const onChangeField = (id: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [id]: value }));
  };

  /**
   * Handler to save profile information
   */
  const onSaveProfile = async () => {
    try {
      // Only for testing purposes - in real app, ID will not be editable
      const id = formValues["patient-id"];
      if (id) {
        await AsyncStorage.setItem("patientID", id);
      }
      Alert.alert(t("profileSaved"), t("profileSavedMessage"));
    } catch (error) {
      console.error("Error@Profile.tsx/onSaveProfile:", error);
    }
  };

  // Layout cards for SettingsList
  const cards: Card[] = useMemo(
    () => [
      {
        id: "profile",
        sectionLabel: t("userInformation"),
        rows: [
          // { id: "patient-id", type: "text-input", title: "ID *" },
          { id: "patientName", type: "text-input", title: t("name") + " *" },
          { id: "dob", type: "text-input", title: t("dateOfBirth") + " *" },
        ],
      },
      {
        id: "contacts",
        sectionLabel: t("contacts"),
        rows: [
          {
            id: "contact",
            type: "text-input",
            title: t("contactNumber") + " *",
          },
          { id: "email", type: "text-input", title: t("email") + " *" },
        ],
      },
      /*{
        id: "emergency-contact",
        sectionLabel: t("emergencyContact"),
        rows: [
          {
            id: "emergency-name",
            type: "text-input",
            title: t("emergencyContactName"),
          },
          {
            id: "emergency-relation",
            type: "text-input",
            title: t("relationship"),
          },
          {
            id: "emergency-contact",
            type: "text-input",
            title: t("emergencyContactNumber"),
          },
        ],
      },*/
    ],
    [t]
  );

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

  return (
    <SafeAreaView edges={["left", "right"]} style={{ flex: 1 }}>
      <SettingsList
        cards={cards}
        ctaFlag={{ enabled: true, label: t("save"), onPress: onSaveProfile }}
        formValues={formValues}
        onChangeField={onChangeField}
      />
    </SafeAreaView>
  );
}
