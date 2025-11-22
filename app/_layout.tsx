import { SafeAreaProvider } from "react-native-safe-area-context";
import { useEffect } from "react";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { ThemeProvider } from "../theme/ThemeProvider";
import { Stack, useRouter } from "expo-router";
import "../locales/i18n";

function InnerLayout() {
  const router = useRouter();
  const { hasShareIntent, shareIntent } = useShareIntentContext();

  // When the app is opened from a share, go to /Share
  useEffect(() => {
    if (!hasShareIntent || !shareIntent) return;

    // Navigate to the Share screen
    router.push("/Share");
  }, [hasShareIntent, shareIntent, router]);

  return (
    <SafeAreaProvider>
      {/* ThemeProvider wraps the whole app so useTheme() works anywhere */}
      <ThemeProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="Welcome"
            options={{ headerShown: false, gestureEnabled: false }}
          />
          <Stack.Screen name="Share" options={{ headerShown: false }} />
        </Stack>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * Root layout wraps the entire app.
 * Everything rendered by expo-router will be nested inside this.
 */
export default function RootLayout() {
  return (
    <ShareIntentProvider>
      <InnerLayout />
    </ShareIntentProvider>
  );
}
