import { useTheme } from "@react-navigation/native";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { AppButton } from "./app-button";

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal({
  visible,
  title,
  message,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  confirmVariant = "primary",
  onConfirm,
  onCancel,
}: Props) {
  const { colors } = useTheme();

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        {/* Backdrop — absoluteFill sibling rendered below the dialog in z-order */}
        <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onCancel} />

        {/* Dialog — rendered after backdrop so it sits on top */}
        <View style={[styles.dialog, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          {!!message ? (
            <Text style={[styles.message, { color: colors.text }]}>{message}</Text>
          ) : null}
          <View style={styles.btnRow}>
            <AppButton
              title={cancelText}
              variant="outline"
              size="sm"
              style={{ flex: 1 } as any}
              onPress={onCancel}
            />
            <View style={{ width: 12 }} />
            <AppButton
              title={confirmText}
              variant={confirmVariant}
              size="sm"
              style={{ flex: 1 } as any}
              onPress={onConfirm}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  dialog: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
    marginBottom: 4,
  },
  btnRow: {
    flexDirection: "row",
    marginTop: 16,
  },
});
