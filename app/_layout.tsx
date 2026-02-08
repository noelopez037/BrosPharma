// app/_layout.tsx
import "react-native-gesture-handler";
import "react-native-reanimated";

import { GestureHandlerRootView } from "react-native-gesture-handler";

import { Platform } from "react-native";
import { enableScreens } from "react-native-screens";

import { ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo } from "react";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";

import RootLayout from "./_layout_root";

import { CompraDraftProvider } from "../lib/compraDraft";
import { VentaDraftProvider } from "../lib/ventaDraft";
import { ThemePrefProvider, useThemePref } from "../lib/themePreference";
import { registerPushToken } from "../lib/pushNotifications";
import { supabase } from "../lib/supabase";
import { makeNativeTheme } from "../src/theme/navigationTheme";
import { getHeaderColors } from "../src/theme/headerColors";

// iOS: avoid rare initial hit-testing issues with react-native-screens
// in nested navigators right after auth transitions.
enableScreens(Platform.OS !== "ios");

function AppShell() {
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  const theme = useMemo(() => makeNativeTheme(isDark), [isDark]);
  const header = useMemo(() => getHeaderColors(isDark), [isDark]);

  useEffect(() => {
    let alive = true;

    const tryRegister = async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data?.session?.user?.id;
      if (!alive || !userId) return;
      const result = await registerPushToken({ supabase, userId, debug: __DEV__ });
      if (__DEV__) {
        console.info("[push] registerPushToken:startup", result);
      }
    };

    tryRegister().catch((error) => {
      if (__DEV__) {
        console.info("[push] registerPushToken:startup_error", error);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const userId = session?.user?.id;
      if (!userId) return;
      try {
        const result = await registerPushToken({ supabase, userId, debug: __DEV__ });
        if (__DEV__) {
          console.info("[push] registerPushToken:auth_change", result);
        }
      } catch (error) {
        if (__DEV__) {
          console.info("[push] registerPushToken:auth_change_error", error);
        }
      }
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  return (
    <ThemeProvider value={theme}>
      <CompraDraftProvider>
        <VentaDraftProvider>
          <Stack
            // @ts-expect-error - forwarded to underlying navigator at runtime
            detachInactiveScreens={false}
            screenOptions={{
              headerStyle: { backgroundColor: header.bg },
              headerTintColor: header.fg,
              headerTitleStyle: { color: header.fg },
              headerBackTitle: "Atrás",
              ...(Platform.OS === "android"
                ? {
                    // Suaviza el pop/back en Android sin tocar iOS.
                    animation: "slide_from_right",
                    animationDuration: 260,
                    animationTypeForReplace: "pop",
                  }
                : {}),
            }}
          >
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

export default function Layout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ThemePrefProvider>
          <RootLayout>
            <AppShell />
          </RootLayout>
        </ThemePrefProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
