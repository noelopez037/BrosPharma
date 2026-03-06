// components/clientes/ClienteFormModal.tsx
// Web-only modal for creating a new client.
// Returns null on native — mobile uses router.push("/cliente-form") instead.

import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ClienteFormInline } from "./ClienteFormInline";

// Lazy-require react-dom so it never loads on native
const createPortal: ((children: React.ReactNode, container: Element) => React.ReactPortal) | null =
  Platform.OS === "web"
    ? (require("react-dom") as {
        createPortal: (children: React.ReactNode, container: Element) => React.ReactPortal;
      }).createPortal
    : null;

type Props = {
  visible: boolean;
  onClose: () => void;
  onDone: (newClienteId: number) => void;
  isDark: boolean;
  colors: { bg: string; card: string; text: string; sub: string; border: string; primary: string };
  isAdmin: boolean;
  vendedorId: string | null;
  uid: string | null;
};

export function ClienteFormModal({
  visible,
  onClose,
  onDone,
  isDark,
  colors: C,
  isAdmin,
  vendedorId,
  uid,
}: Props) {
  if (Platform.OS !== "web" || !createPortal) return null;
  if (!visible) return null;

  const content = (
    <View style={styles.overlay}>
      <Pressable
        style={[
          styles.backdrop,
          { backgroundColor: isDark ? "rgba(0,0,0,0.65)" : "rgba(0,0,0,0.5)" },
        ]}
        onPress={onClose}
      />
      <View style={[styles.panel, { backgroundColor: C.card }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: C.border }]}>
          <View style={styles.closeBtnPlaceholder} />
          <Text style={[styles.headerTitle, { color: C.text }]}>Nuevo cliente</Text>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
            <Text style={[styles.closeText, { color: C.sub }]}>✕</Text>
          </Pressable>
        </View>

        {/* Scrollable form */}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          style={{ backgroundColor: C.card }}
        >
          <ClienteFormInline
            onDone={onDone}
            onCancel={onClose}
            isDark={isDark}
            colors={C}
            isAdmin={isAdmin}
            vendedorId={vendedorId}
            uid={uid}
          />
        </ScrollView>
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
    maxWidth: 520,
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
  closeBtn: { padding: 8 },
  closeBtnPlaceholder: { width: 32 },
  closeText: { fontSize: 16, fontWeight: "600" },
});
