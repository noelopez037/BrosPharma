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
          <Stack>
            {/* Login debe ocultar header */}
            <Stack.Screen name="login" options={{ headerShown: false }} />

            {/* Drawer principal: el Drawer layout controla su propio header */}
            <Stack.Screen name="(drawer)" options={{ headerShown: false }} />

            {/* Modal tipo sheet (se ve inventario detrás) - seguir ocultando header */}
            <Stack.Screen
              name="producto-modal"
              options={{
                headerShown: false,
                presentation: "transparentModal",
                animation: "slide_from_bottom",
                contentStyle: { backgroundColor: "transparent" },
              }}
            />

            {/* Editar como página normal - conservar comportamiento previo (sin header) */}
            <Stack.Screen
              name="producto-edit"
              options={{
                headerShown: false,
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
