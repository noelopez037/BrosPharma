// app/cotizacion-nueva.tsx
// Pantalla para generar una cotización en PDF (sin guardar en BD).

import { useTheme } from "@react-navigation/native";
import { Stack } from "expo-router";
import React from "react";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { VentaNuevaForm } from "../components/ventas/VentaNuevaForm";
import { useThemePref } from "../lib/themePreference";
import { alphaColor } from "../lib/ui";
import { goBackSafe } from "../lib/goBackSafe";
import { FB_DARK_DANGER } from "../src/theme/headerColors";

export default function CotizacionNuevaScreen() {
  const { colors } = useTheme();
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  const C = {
    bg: String(colors.background ?? (isDark ? "#000" : "#fff")),
    card: isDark ? "#1c1c1e" : "#fff",
    text: String(colors.text ?? (isDark ? "#fff" : "#000")),
    sub: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)",
    border: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
    blueText: String(colors.primary ?? "#153c9e"),
    blue: alphaColor(String(colors.primary ?? "#153c9e"), 0.18) || "rgba(64,156,255,0.18)",
    danger: FB_DARK_DANGER,
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
      <Stack.Screen options={{ title: "Nueva cotización" }} />
      <VentaNuevaForm
        onDone={() => goBackSafe()}
        onCancel={() => goBackSafe()}
        isDark={isDark}
        colors={C}
        canCreate={true}
        mode="cotizacion"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
});
