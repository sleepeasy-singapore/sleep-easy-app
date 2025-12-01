import { router, useRootNavigationState } from "expo-router";
import { useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useShareIntentContext } from "expo-share-intent";

/**
 * This page is just to redirect users to the actual home page due to how expo router works
 */
export default function Index() {
  const { hasShareIntent, shareIntent } = useShareIntentContext();
  const navState = useRootNavigationState();

  useEffect(() => {
    if (!navState?.key) return;

    /**
     * Check if patient ID and No Share Intent exist before push user to Home Page.
     */
    const checkAndNavigate = async () => {
      const storedId = await AsyncStorage.getItem("patientID");

      // If share intent exists route to Share (highest priority)
      if (hasShareIntent && shareIntent) {
        router.replace("/Share");
        return;
      }

      // If no ID found route to Welcome, otherwise go Home
      if (!storedId) {
        router.replace("/Welcome");
        return;
      }

      router.replace("/(tabs)/home");
    };

    checkAndNavigate();
  }, [navState?.key, hasShareIntent, shareIntent]);

  return null;
}
