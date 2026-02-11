import React, { useMemo } from "react";
import { useTheme } from "@react-navigation/native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { AppButton } from "../ui/app-button";
import { useRole } from "../../lib/useRole";

type Allow = string[] | ((role: string) => boolean);

function normalizeUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

export function RoleGate({
  allow,
  title,
  deniedTitle,
  deniedText,
  loadingText,
  backHref,
  children,
}: {
  allow: Allow;
  title?: string;
  deniedTitle?: string;
  deniedText?: string;
  loadingText?: string;
  backHref?: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const { role, isReady } = useRole();

  const roleUp = normalizeUpper(role);

  const allowed = useMemo(() => {
    if (Array.isArray(allow)) return allow.map((x) => normalizeUpper(x)).includes(roleUp);
    return !!allow(roleUp);
  }, [allow, roleUp]);

  const doBack = () => {
    if (backHref) {
      router.replace(backHref as any);
      return;
    }
    try {
      router.back();
    } catch {
      router.replace("/(drawer)/(tabs)" as any);
    }
  };

  if (!isReady) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["bottom"]}>
        <View style={s.center}>
          {title ? <Text style={[s.title, { color: colors.text }]}>{title}</Text> : null}
          <Text style={[s.sub, { color: colors.text + "AA" }]}>{loadingText ?? "Cargando..."}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!allowed) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["bottom"]}>
        <View style={s.center}>
          <Text style={[s.title, { color: colors.text }]}>{deniedTitle ?? "Acceso denegado"}</Text>
          <Text style={[s.sub, { color: colors.text + "AA" }]}>{deniedText ?? "No tienes permiso para ver esta pantalla."}</Text>
          <View style={{ height: 12 }} />
          <AppButton title="Volver" onPress={doBack} />
          <Pressable onPress={doBack} hitSlop={12} style={{ marginTop: 10 }}>
            <Text style={{ color: colors.text + "88", fontWeight: "800" }}>Regresar</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return <>{children}</>;
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  title: { fontSize: 18, fontWeight: "900", textAlign: "center" },
  sub: { marginTop: 8, fontSize: 13, fontWeight: "800", textAlign: "center" },
});
