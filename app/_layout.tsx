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
import { resetHttpSession } from "../modules/http-session-reset";
import { refreshEmpresaActiva } from "../lib/useEmpresaActiva";
import { startNetworkRecovery, stopNetworkRecovery } from "../lib/networkRecovery";
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

    // Iniciar auto-refresh de tokens al montar — imprescindible en React Native
    // porque no existe el evento `visibilitychange` del navegador.
    // Sin esto, el access token expira silenciosamente si la app nunca va a background.
    if (__DEV__) console.log("[resume] startAutoRefresh (mount)");
    void supabase.auth.startAutoRefresh();

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

    // Emite resume de forma segura: espera empresaActiva (con timeout) antes de notificar pantallas.
    // Awaitar empresa evita que las pantallas reciban el emit con empresaActivaId=null
    // y fallen por RLS. Timeout de 4s para no bloquear indefinidamente si hay red lenta.
    const EMPRESA_TIMEOUT_MS = 4_000;
    async function doEmitResume(trigger: string) {
      const t0 = Date.now();
      console.log(`[resume] doEmitResume — trigger=${trigger} esperando empresaActiva`);

      let empresaReady = false;
      try {
        await Promise.race([
          refreshEmpresaActiva(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("empresa timeout")), EMPRESA_TIMEOUT_MS),
          ),
        ]);
        empresaReady = true;
        if (__DEV__) console.log(`[resume] empresaActiva lista en ${Date.now() - t0}ms`);
      } catch (e: any) {
        console.warn(
          `[resume] recovery degraded: empresa no lista tras ${Date.now() - t0}ms — ${e?.message ?? e}`,
        );
      }

      // Pequeño tick para que React procese el cambio de estado antes del emit.
      await new Promise((r) => setTimeout(r, 80));

      console.log(
        `[resume] emitAppResumed — trigger=${trigger} empresaReady=${empresaReady} elapsed=${Date.now() - t0}ms`,
      );
      emitAppResumed();
    }

    function scheduleDeferredResume() {
      cancelDeferred();
      if (__DEV__) console.log("[resume] scheduleDeferredResume — listening for auth events");
      // Escuchar el siguiente TOKEN_REFRESHED o SIGNED_IN para emitir resume.
      deferredSub = supabase.auth.onAuthStateChange(async (event) => {
        if (__DEV__) console.log("[resume] deferred auth event:", event);
        if (event === "SIGNED_OUT") {
          // Sesión realmente expirada — cancelar espera y dejar que
          // _layout_root.tsx maneje la redirección a login.
          if (__DEV__) console.warn("[resume] deferred got SIGNED_OUT — cancelling");
          cancelDeferred();
          return;
        }
        if (event !== "TOKEN_REFRESHED" && event !== "SIGNED_IN") return;
        cancelDeferred();
        invalidateAll();
        await doEmitResume(`deferred:${event}`);
      });
      // Fallback: si no llega evento en 15s, intentar emitir resume con sesión local.
      // (reducido de 30s para no dejar al usuario bloqueado demasiado tiempo)
      deferredTimer = setTimeout(() => {
        console.warn("[resume] deferred timeout (15s) — forcing resume with local session");
        cancelDeferred();
        void (async () => {
          const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
          if (data?.session) {
            invalidateAll();
            await doEmitResume("deferred:timeout");
          } else {
            console.warn("[resume] deferred timeout: sin sesión local — app puede quedar zombie");
          }
        })();
      }, 15_000);
    }

    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (__DEV__) console.log("[resume] AppState →", nextState);

      if (nextState === "active") {
        void clearBadge();
        markAppResumed();
        cancelDeferred();

        // Reactivar auto-refresh INMEDIATAMENTE al volver a foreground.
        // Esto permite que el SDK renueve el token en paralelo mientras esperamos la red.
        if (__DEV__) console.log("[resume] startAutoRefresh (foreground)");
        void supabase.auth.startAutoRefresh();

        void (async () => {
          // Resetear el pool de conexiones HTTP del OS antes del primer fetch.
          // En iOS esto llama URLSession.shared.reset() — cierra todas las conexiones
          // TCP zombie del pool de NSURLSession, igual que si la app fuera kill+reopen.
          // En Android evicta el pool de OkHttp.
          console.log("[resume] resetHttpSession — inicio");
          const t0 = Date.now();
          await resetHttpSession();
          console.log(`[resume] resetHttpSession — listo en ${Date.now() - t0}ms`);
          // Pequeño delay adicional para que el OS procese el cierre de sockets.
          await new Promise((r) => setTimeout(r, 300));

          // Verificar sesión con getUser() (llamada real de red).
          // Timeout global de 10s sobre el loop entero para que emitAppResumed()
          // nunca tarde más de ~10.5s, incluso si los sockets TCP están zombie y
          // el fetch individual no respeta el AbortSignal a tiempo.
          let hasSession = false;
          try {
            await Promise.race([
              (async () => {
                for (let attempt = 0; attempt < 2; attempt++) {
                  try {
                    if (__DEV__) console.log("[resume] getUser attempt", attempt + 1);
                    const { data, error } = await supabase.auth.getUser();
                    if (data?.user && !error) {
                      hasSession = true;
                      if (__DEV__) console.log("[resume] getUser OK");
                      break;
                    }
                    if (__DEV__ && error) console.warn("[resume] getUser error:", error.message);
                  } catch (e: any) {
                    if (__DEV__) console.warn("[resume] getUser exception:", e?.message ?? e);
                  }
                  if (attempt < 1) await new Promise((r) => setTimeout(r, 1000));
                }
              })(),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("resume getUser timeout")), 10_000)
              ),
            ]);
          } catch (e: any) {
            if (__DEV__) console.warn("[resume] getUser loop timeout/error:", e?.message ?? e);
          }

          invalidateAll();

          if (hasSession) {
            // Red + sesión confirmados: esperar empresa + emitir resume a pantallas.
            console.log("[resume] sesión OK — emitiendo resume (trigger: foreground)");
            await doEmitResume("foreground");
          } else {
            // Red aún no lista tras reintentos: emitir resume de todas formas con
            // sesión local para que las pantallas intenten cargar (muchas RPCs pueden
            // funcionar si el SDK logra refrescar el token en paralelo).
            // También escuchar TOKEN_REFRESHED como respaldo.
            console.warn("[resume] red no lista tras reintentos — emitiendo resume optimista + deferred");
            await doEmitResume("foreground:optimistic");
            scheduleDeferredResume();
          }
        })();
      } else if (nextState === "background") {
        cancelDeferred();
        if (__DEV__) console.log("[resume] stopAutoRefresh (background)");
        void supabase.auth.stopAutoRefresh();
      }
    });

    // Iniciar recovery por reconexión de red (WiFi ↔ datos, pérdida y retorno)
    startNetworkRecovery();

    return () => {
      sub.remove();
      cancelDeferred();
      void supabase.auth.stopAutoRefresh();
      stopNetworkRecovery();
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
