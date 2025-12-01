import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// --------------------
// Define types
// --------------------
// What modes the theme can be in
// "light" - always light
// "dark" - always dark
type ThemeMode = "light" | "dark";

// What the context will expose to the rest of the app
type ThemeContextValue = {
  mode: ThemeMode; // user’s chosen mode
  isDark: boolean; // resolved result → should UI use dark colors?
  colors: {
    bg: string;
    bg2: string;
    text: string;
    sub: string;
    sub2: string;
    card: string;
    border: string;
    shadow: string;
    tint: string;
    danger: string;
    white: string;
  };
  fonts: {
    title: object;
    sectionLabel: object;
    text: object;
    buttonText: object;
  };
  setMode: (m: ThemeMode) => void; // function to change mode
};

// Create a React Context to share theme state across all components
const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "settings:themeMode";

// --------------------
// Provider component
// --------------------
export const ThemeProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const [mode, setMode] = useState<ThemeMode>("light");

  // Load saved preference from AsyncStorage on mount
  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved === "light" || saved === "dark") {
        setMode(saved);
      }
    })();
  }, []);

  // Save preference to AsyncStorage whenever it changes
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {});
  }, [mode]);

  // Decide whether app should be dark:
  // - if user forced "dark" - true
  // - if user forced "light" - false
  const isDark = useMemo(() => {
    if (mode === "dark") return true;
    if (mode === "light") return false;
  }, [mode]);

  // Change colors based on isDark
  const colors = useMemo(
    () => ({
      bg: isDark ? "#0B0B0B" : "#FFFFFF",
      bg2: isDark ? "#111" : "#fff",
      text: isDark ? "#F5F5F5" : "#0B0B0B",
      sub: isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)",
      sub2: "#222f3e",
      card: isDark ? "#161616" : "#F7F7F9",
      border: isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.5)",
      shadow: isDark ? "transparent" : "#00000020",
      tint: "#5B61FF", // primary action color
      danger: "#D64545", // destructive action color
      white: "#FFFFFF",
    }),
    [isDark]
  );

  // --------------------
  // Fonts
  // --------------------
  const fonts = useMemo(
    () => ({
      title: {
        fontFamily: "Roboto",
        fontSize: 28,
        fontWeight: "800",
        letterSpacing: 0.3,
        color: colors.text,
      },
      sectionLabel: {
        fontFamily: "Roboto",
        fontSize: 13,
        fontWeight: "800",
        letterSpacing: 0.3,
        color: colors.sub,
      },
      text: {
        fontFamily: "Roboto",
        fontSize: 16,
        fontWeight: "700",
        color: colors.text,
      },
      buttonText: { color: "#FFFFFF", fontSize: 16.5, fontWeight: "700" },
    }),
    [colors]
  );

  const componentStyle = useMemo(() => {
    button: {
      backgroundColor: colors.tint;
    }
  }, []);

  // Final value shared across the app
  const value: ThemeContextValue = {
    mode,
    isDark,
    colors,
    fonts,
    setMode,
  };

  // Provide the context to children
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

// Hook to access the theme anywhere in the app
export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
};
