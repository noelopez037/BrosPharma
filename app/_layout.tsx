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

import ErrorBoundary from "../components/ErrorBoundary";
import { CompraDraftProvider } from "../lib/compraDraft";
import { VentaDraftProvider } from "../lib/ventaDraft";
import { ThemePrefProvider, useThemePref } from "../lib/themePreference";
import { claimPushForCurrentSession } from "../lib/pushNotifications";
import { parseVentaSolicitudAdminNotifData } from "../lib/pushPayload";
import { supabase } from "../lib/supabase";
import { invalidateAll } from "../lib/productoCache";
import { emitAppResumed, markAppResumed } from "../lib/resumeEvents";
import { refreshEmpresaActiva } from "../lib/useEmpresaActiva";
import { makeNativeTheme } from "../src/theme/navigationTheme";
import { getHeaderColors } from "../src/theme/headerColors";

if (Platform.OS === "web") {
  require("../global.css");
}


enableScreens(true);

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () =>
      ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      } as any),
  } as any);
}

function AppShell() {
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";
  const router = useRouter();
  const lastHandledNotifIdRef = useRef<string>("");

  const theme = useMemo(() => makeNativeTheme(isDark), [isDark]);
  const header = useMemo(() => getHeaderColors(isDark), [isDark]);

  useEffect(() => {
    if (Platform.OS === "web" || typeof window === "undefined") return;

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

        const kindUp =
          data && typeof data === "object" && data != null
            ? String((data as any).kind ?? (data as any).type ?? "")
                .trim()
                .toUpperCase()
            : "";

        if (kindUp === "VENTA_SOLICITUD_ADMIN") {
          if (__DEV__) console.log("[notif] handled VENTA_SOLICITUD_ADMIN", data);

          const baseRouteRaw =
            data && typeof data === "object" && (data as any).to != null ? String((data as any).to) : "";
          const baseRoute = baseRouteRaw && baseRouteRaw.startsWith("/") ? baseRouteRaw : "/(drawer)/(tabs)/ventas";
          router.replace(baseRoute as any);

          const solicitud = parseVentaSolicitudAdminNotifData(data);
          if (solicitud?.ventaId) {
            const params: Record<string, string> = { ventaId: String(solicitud.ventaId) };
            params.notif = "VENTA_SOLICITUD_ADMIN";
            if (solicitud.accion) params.accion = String(solicitud.accion);
            if (solicitud.nota) params.nota = String(solicitud.nota);
            if (solicitud.clienteNombre) params.clienteNombre = String(solicitud.clienteNombre);
            if (solicitud.vendedorCodigo) params.vendedorCodigo = String(solicitud.vendedorCodigo);

            router.push({ pathname: "/venta-detalle", params } as any);
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

        if (__DEV__) console.info("[push] response", content);
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
          <ErrorBoundary>
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
          </ErrorBoundary>
        </VentaDraftProvider>
      </CompraDraftProvider>

      <StatusBar style={isDark ? "light" : "dark"} />
    </ThemeProvider>
  );
}

export default function Layout() {
  useEffect(() => {
    if (Platform.OS === "web" || typeof window === "undefined") return;

    const clearBadge = async () => {
      try {
        await Notifications.setBadgeCountAsync(0);
      } catch (error) {
        if (__DEV__) console.warn("[badge] failed to clear badge", error);
      }
    };

    void clearBadge();

    // Estado de resume diferido (sesión no disponible inmediatamente tras foreground).
    let deferredSub: ReturnType<typeof supabase.auth.onAuthStateChange> | null = null;
    let deferredTimer: ReturnType<typeof setTimeout> | null = null;

    function cancelDeferred() {
      if (deferredSub) {
        try { deferredSub.data.subscription.unsubscribe(); } catch { /* ignorar */ }
        deferredSub = null;
      }
      if (deferredTimer) {
        clearTimeout(deferredTimer);
        deferredTimer = null;
      }
    }

    // Emite resume de forma segura: espera empresa lista + tick de React antes de notificar.
    async function doEmitResume() {
      // Esperar empresa antes de emitir para que los callbacks tengan empresaActivaId válido.
      await refreshEmpresaActiva().catch(() => {});
      // Pequeño delay para que React procese el cambio de estado y actualice los refs.
      await new Promise((r) => setTimeout(r, 80));
      emitAppResumed();
    }

    function scheduleDeferredResume() {
      cancelDeferred();
      // Escuchar el siguiente TOKEN_REFRESHED o SIGNED_IN para emitir resume.
      deferredSub = supabase.auth.onAuthStateChange(async (event) => {
        if (event !== "TOKEN_REFRESHED" && event !== "SIGNED_IN") return;
        cancelDeferred();
        invalidateAll();
        await doEmitResume();
      });
      // Cancelar si la sesión no se recupera en 60 s.
      deferredTimer = setTimeout(cancelDeferred, 60_000);
    }

    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (nextState === "active") {
        void clearBadge();
        markAppResumed();
        void (async () => {
          // iOS puede tardar 1-2s en reconectar WiFi/celular tras background prolongado.
          await new Promise((r) => setTimeout(r, 1200));

          // Intentar obtener sesion valida antes de emitir resume a las pantallas.
          // 5 reintentos × 2 s = hasta 11 s adicionales para que la red se estabilice.
          // NOTA: startAutoRefresh se llama solo DESPUÉS de confirmar sesión para evitar
          // que el SDK intente un refresh fallido y limpie la sesión cuando no hay red.
          let hasSession = false;
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              const { data } = await supabase.auth.getSession();
              if (data?.session) {
                hasSession = true;
                break;
              }
            } catch {
              // ignorar — reintentar
            }
            if (attempt < 4) await new Promise((r) => setTimeout(r, 2000));
          }

          // Activar auto-refresh tras intentar recuperar sesión manualmente.
          // Se llama siempre (no solo si hasSession) porque scheduleDeferredResume
          // depende de los eventos TOKEN_REFRESHED/SIGNED_IN que emite el auto-refresh.
          void supabase.auth.startAutoRefresh();
          invalidateAll();

          if (hasSession) {
            // Sesión disponible: esperar empresa + emitir.
            await doEmitResume();
          } else {
            // Red aún no lista: diferir el resume hasta que la sesión se recupere.
            if (__DEV__) {
              console.warn("[resume] sesión no recuperada tras reintentos — diferiendo emitAppResumed");
            }
            scheduleDeferredResume();
          }
        })();
      } else if (nextState === "background") {
        cancelDeferred();
        void supabase.auth.stopAutoRefresh();
      }
    });

    return () => {
      sub.remove();
      cancelDeferred();
      void supabase.auth.stopAutoRefresh();
    };
  }, []);

  return (
    <GestureHandlerRootView
      style={[
        { flex: 1 },
        Platform.OS === "web" ? ({ minHeight: "100%" } as const) : null,
      ]}
    >
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
