import React, { type ReactNode, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter, useSegments } from "expo-router";

import { supabase } from "../lib/supabase";

export default function RootLayout({ children }: { children?: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const router = useRouter();
  const segments = useSegments();

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

        setIsReady(true);

        const firstSegment = segments[0] as unknown as string | undefined;
        const inAuthGroup = firstSegment === "(drawer)" || firstSegment === "(tabs)";

        if (session && !inAuthGroup) {
          router.replace("/(drawer)/(tabs)");
        } else if (!session && firstSegment !== "login") {
          router.replace("/login");
        }
      } catch (error) {
        // Si falla o hace timeout, asumir no hay sesión
        if (!mounted) return;
        console.log("Session restore timeout or error:", error);
        setIsReady(true);

        const firstSegment = segments[0] as unknown as string | undefined;
        if (firstSegment !== "login") {
          router.replace("/login");
        }
      }
    };

    restoreSession();

    // Manejar cambios de sesión (esto sigue siendo rápido)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;

      if (session) {
        router.replace("/(drawer)/(tabs)");
      } else {
        router.replace("/login");
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
    // Intencionalmente corre una sola vez al arrancar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isReady) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return <>{children}</>;
}
