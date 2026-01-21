// lib/themePreference.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type ThemeMode = "light" | "dark";

type ThemePrefCtx = {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
  resolved: "light" | "dark";
};

const KEY = "theme_mode_v1";
const Ctx = createContext<ThemePrefCtx | null>(null);

export function ThemePrefProvider({ children }: { children: React.ReactNode }) {
  // ✅ default LIGHT
  const [mode, setModeState] = useState<ThemeMode>("light");

  useEffect(() => {
    (async () => {
      try {
        const v = (await AsyncStorage.getItem(KEY)) as ThemeMode | null;
        if (v === "light" || v === "dark") setModeState(v);
      } catch {}
    })();
  }, []);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(KEY, m).catch(() => {});
  };

  const toggle = () => setMode(mode === "dark" ? "light" : "dark");

  const value = useMemo(
    () => ({
      mode,
      setMode,
      toggle,
      resolved: mode, // ya no hay system
    }),
    [mode]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useThemePref() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useThemePref must be used within ThemePrefProvider");
  return ctx;
}
