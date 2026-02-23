import React, { type ReactNode, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import { usePathname, useRouter, useSegments } from "expo-router";

import { supabase } from "../lib/supabase";

// URL pendiente de deep link para reset password
export let pendingResetUrl: string | null = null;
export const setPendingResetUrl = (url: string | null) => { pendingResetUrl = url; };

export default function RootLayout({ children }: { children?: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const isReadyRef = useRef(false);
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const segmentsRef = useRef(segments);
  const resetRouteRef = useRef(isResetPasswordRoute(pathname, segments));

  useEffect(() => {
    segmentsRef.current = segments;
    resetRouteRef.current = isResetPasswordRoute(pathname, segments);
  }, [segments, pathname]);

  const getFirstSegment = () => {
    const current = segmentsRef.current as unknown as string[] | undefined;
    return current?.[0];
  };

  const replaceIfNeeded = (to: "/login" | "/(drawer)/(tabs)") => {
    if (resetRouteRef.current) return;

    const first = getFirstSegment();
    if (to === "/login") {
      if (first !== "login") router.replace("/login" as any);
      return;
    }

    const inAuthGroup = first === "(drawer)" || first === "(tabs)";
    if (!inAuthGroup) router.replace("/(drawer)/(tabs)" as any);
  };

  useEffect(() => {
    let mounted = true;

    const restoreSession = async () => {
      try {
        // Timeout de 3 segundos para getSession
        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Session timeout")), 2000),
        );

        const {
          data: { session },
        } = (await Promise.race([sessionPromise, timeoutPromise])) as any;

        if (!mounted) return;

        isReadyRef.current = true;
        setIsReady(true);

        if (resetRouteRef.current) {
          return;
        }

        if (session) replaceIfNeeded("/(drawer)/(tabs)");
        else replaceIfNeeded("/login");
      } catch (_error) {
        // Si falla o hace timeout, asumir no hay sesión
        if (!mounted) return;
        isReadyRef.current = true;
        setIsReady(true);

        if (resetRouteRef.current) {
          return;
        }

        replaceIfNeeded("/login");
      }
    };

    restoreSession();

    return () => {
      mounted = false;
    };
    // Intencionalmente corre una sola vez al arrancar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isReady) return;

    let mounted = true;

    // Manejar cambios de sesión (esto sigue siendo rápido)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (!isReadyRef.current) return;

      // Nunca redirigir globalmente durante recovery
      if (event === "PASSWORD_RECOVERY") return;
      if (event === "USER_UPDATED") return;

      if (resetRouteRef.current) return;

      if (session) replaceIfNeeded("/(drawer)/(tabs)");
      else replaceIfNeeded("/login");
    });

    // Capturar deep links de reset antes de que reset-password esté montado
    const linkingSub = Linking.addEventListener("url", (event) => {
      if (event.url.includes("reset-password")) {
        setPendingResetUrl(event.url);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      linkingSub.remove();
    };
  }, [isReady]);

  if (!isReady) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return <>{children}</>;
}

function isResetPasswordRoute(pathname: string | null, currentSegments: ReturnType<typeof useSegments>) {
  if (pathname && stripLeadingSlash(pathname) === "reset-password") {
    return true;
  }

  if (Array.isArray(currentSegments)) {
    for (const segment of currentSegments as unknown as Array<string | string[]>) {
      if (Array.isArray(segment)) {
        if (segment.includes("reset-password")) {
          return true;
        }
      } else if (segment === "reset-password") {
        return true;
      }
    }
  }

  return false;
}

function stripLeadingSlash(value: string) {
  return value.startsWith("/") ? value.slice(1) : value;
}
