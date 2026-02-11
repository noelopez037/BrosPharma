// app/_layout.tsx
import "react-native-gesture-handler";
import "react-native-reanimated";

import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AppState, type AppStateStatus, Platform } from "react-native";
import { enableScreens } from "react-native-screens";

import { ThemeProvider } from "@react-navigation/native";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo, useRef } from "react";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";

import RootLayout from "./_layout_root";

import { CompraDraftProvider } from "../lib/compraDraft";
import { VentaDraftProvider } from "../lib/ventaDraft";
import { ThemePrefProvider, useThemePref } from "../lib/themePreference";
import { claimPushForCurrentSession } from "../lib/pushNotifications";
import { supabase } from "../lib/supabase";
import { makeNativeTheme } from "../src/theme/navigationTheme";
import { getHeaderColors } from "../src/theme/headerColors";

// iOS: avoid rare initial hit-testing issues with react-native-screens
// in nested navigators right after auth transitions.
enableScreens(Platform.OS !== "ios");

Notifications.setNotificationHandler({
  handleNotification: async () =>
    ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    } as any),
} as any);

function AppShell() {
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";
  const router = useRouter();
  const lastHandledNotifIdRef = useRef<string>("");

  const theme = useMemo(() => makeNativeTheme(isDark), [isDark]);
  const header = useMemo(() => getHeaderColors(isDark), [isDark]);

  useEffect(() => {
    let alive = true;

    const pushSubs: { remove: () => void }[] = [];

    const handleNotifResponse = (response: Notifications.NotificationResponse) => {
      try {
        const req = response?.notification?.request;
        const id = String(req?.identifier ?? "");
        if (id && lastHandledNotifIdRef.current === id) return;
        if (id) lastHandledNotifIdRef.current = id;

        const content = req?.content;
        const data = content?.data as unknown;

        const kind =
          (data && typeof data === "object" && (data as any).kind != null)
            ? String((data as any).kind)
            : "";

        if (kind === "VENTA_SOLICITUD_ADMIN") {
          if (__DEV__) console.log("[notif] handled VENTA_SOLICITUD_ADMIN", data);

          const to =
            (data && typeof data === "object" && (data as any).to != null)
              ? String((data as any).to)
              : "/(drawer)/(tabs)/ventas";

          router.replace((to && to.startsWith("/") ? to : "/(drawer)/(tabs)/ventas") as any);

          const ventaIdRaw =
            (data && typeof data === "object" && (data as any).venta_id != null)
              ? String((data as any).venta_id)
              : "";
          const ventaId = ventaIdRaw.trim();
          if (ventaId) {
            router.push({ pathname: "/venta-detalle", params: { ventaId } } as any);
          }
          return;
        }

        // Generic route support for existing notifications.
        const route =
          (data && typeof data === "object" && (data as any).route != null)
            ? String((data as any).route)
            : "";
        if (route && route.startsWith("/")) {
          router.replace(route as any);
          return;
        }

        // Back-compat: older notifications used `screen`.
        const screen =
          (data && typeof data === "object" && (data as any).screen != null)
            ? String((data as any).screen)
            : "";
        if (screen === "inventario") {
          router.replace("/(drawer)/(tabs)/inventario" as any);
        }

        if (__DEV__) {
          console.info("[push] response", content);
        }
      } catch (error) {
        if (__DEV__) console.warn("[push] handleNotifResponse failed", error);
      }
    };

    pushSubs.push(Notifications.addNotificationResponseReceivedListener(handleNotifResponse));
    Notifications.getLastNotificationResponseAsync()
      .then((r) => {
        if (!alive || !r) return;
        handleNotifResponse(r);
      })
      .catch((error) => {
        if (__DEV__) console.warn("[push] getLastNotificationResponseAsync failed", error);
      });

    if (__DEV__ && (Platform.OS === "ios" || Platform.OS === "android")) {
      pushSubs.push(
        Notifications.addNotificationReceivedListener((notification) => {
          console.info("[push] received", notification.request.content);
        })
      );
    }

    const tryRegister = async () => {
      if (!alive) return;
      try {
        const result = await claimPushForCurrentSession(supabase, { reason: "startup" });
        if (__DEV__) console.info("[push] claim:startup", result);
      } catch (error) {
        console.error("[push] claim:startup_error", error);
      }
    };

    void tryRegister();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Only claim when we have a valid session.
      if (event !== "SIGNED_IN" && event !== "TOKEN_REFRESHED" && event !== "USER_UPDATED") return;
      if (!session?.user?.id) return;
      try {
        const result = await claimPushForCurrentSession(supabase, {
          forceUpsert: true,
          reason: `auth:${event}`,
        });
        if (__DEV__) console.info("[push] claim:auth_change", { event, result });
      } catch (error) {
        console.error("[push] claim:auth_change_error", { event, error });
      }
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
      for (const s of pushSubs) s.remove();
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
  useEffect(() => {
    const clearBadge = async () => {
      try {
        await Notifications.setBadgeCountAsync(0);
      } catch (error) {
        if (__DEV__) console.warn("[badge] failed to clear badge", error);
      }
    };

    void clearBadge();

    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (nextState === "active") {
        void clearBadge();
      }
    });

    return () => {
      sub.remove();
    };
  }, []);

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
