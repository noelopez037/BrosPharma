// app/_layout.tsx
import "react-native-gesture-handler";

import { ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useMemo } from "react";
import "react-native-reanimated";
import { enableScreens } from "react-native-screens";

import { CompraDraftProvider } from "../lib/compraDraft";
import { VentaDraftProvider } from "../lib/ventaDraft";
import { ThemePrefProvider, useThemePref } from "../lib/themePreference";
import { makeNativeTheme } from "../src/theme/navigationTheme";

enableScreens(true);

function AppShell() {
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  const theme = useMemo(() => makeNativeTheme(isDark), [isDark]);

  return (
    <ThemeProvider value={theme}>
      <CompraDraftProvider>
        <VentaDraftProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="login" />
            <Stack.Screen name="(drawer)" />

            {/* Modal tipo sheet (se ve inventario detrás) */}
            <Stack.Screen
              name="producto-modal"
              options={{
                presentation: "transparentModal",
                animation: "slide_from_bottom",
                contentStyle: { backgroundColor: "transparent" },
              }}
            />

            {/* Editar como página normal */}
            <Stack.Screen
              name="producto-edit"
              options={{
                presentation: "card",
                animation: "default",
              }}
            />
          </Stack>
        </VentaDraftProvider>
      </CompraDraftProvider>

      <StatusBar style={isDark ? "light" : "dark"} />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemePrefProvider>
      <AppShell />
    </ThemePrefProvider>
  );
}
