import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@react-navigation/native";
import { VentaNuevaForm } from "./VentaNuevaForm";
import { alphaColor } from "../../lib/ui";
import { FB_DARK_DANGER } from "../../src/theme/headerColors";

// Lazy-require react-dom so it never loads on native
const createPortal: ((children: React.ReactNode, container: Element) => React.ReactPortal) | null =
  Platform.OS === "web"
    ? (require("react-dom") as { createPortal: (children: React.ReactNode, container: Element) => React.ReactPortal }).createPortal
    : null;

type Props = {
  visible: boolean;
  onClose: () => void;
  onDone: () => void;
  isDark: boolean;
  colors: { card: string; text: string; border: string; sub: string };
};

export function CotizacionModal({ visible, onClose, onDone, isDark, colors }: Props) {
  const { colors: navColors } = useTheme();

  if (Platform.OS !== "web" || !createPortal) return null;
  if (!visible) return null;

  const C = {
    bg: navColors.background ?? (isDark ? "#000" : "#fff"),
    card: colors.card,
    text: colors.text,
    sub: colors.sub,
    border: colors.border,
    blueText: String(navColors.primary ?? "#153c9e"),
    blue: alphaColor(String(navColors.primary ?? "#153c9e"), 0.18) || "rgba(64, 156, 255, 0.18)",
    danger: FB_DARK_DANGER,
  };

  const content = (
    <View style={styles.overlay}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: isDark ? "rgba(0,0,0,0.65)" : "rgba(0,0,0,0.5)" }]}
        onPress={onClose}
      />
      <View style={[styles.panel, { backgroundColor: C.card }]}>
        <View style={[styles.header, { borderBottomColor: C.border }]}>
          <View style={styles.closeBtnPlaceholder} />
          <Text style={[styles.headerTitle, { color: C.text }]}>Nueva cotización</Text>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
            <Text style={[styles.closeText, { color: C.sub }]}>✕</Text>
          </Pressable>
        </View>
        <VentaNuevaForm
          onDone={onDone}
          onCancel={onClose}
          isDark={isDark}
          colors={C}
          canCreate={true}
          mode="cotizacion"
        />
      </View>
    </View>
  );

  return createPortal(content, document.body);
}

const styles = StyleSheet.create({
  overlay: {
    position: "fixed" as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99999,
    alignItems: "center",
    justifyContent: "center",
  },
  backdrop: {
    position: "absolute" as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  panel: {
    maxWidth: 560,
    width: "100%" as any,
    maxHeight: "90vh" as any,
    borderRadius: 16,
    overflow: "hidden" as any,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  closeBtn: {
    padding: 8,
  },
  closeBtnPlaceholder: { width: 32 },
  closeText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
