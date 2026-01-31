import { useTheme } from "@react-navigation/native";
import React, { useMemo } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, ViewStyle } from "react-native";

type Variant = "primary" | "outline" | "danger" | "ghost";
type Size = "sm" | "md";

export function AppButton({
  title,
  onPress,
  variant = "primary",
  size = "md",
  disabled,
  loading,
  style,
  textStyle,
  accessibilityLabel,
  androidRipple,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  textStyle?: any;
  accessibilityLabel?: string;
  androidRipple?: any;
}) {
  const { colors } = useTheme();

  const PRIMARY = Platform.OS === "ios" ? "#007AFF" : (colors.primary ?? "#007AFF");
  const DANGER = Platform.OS === "ios" ? "#FF3B30" : "#E53935";

  const S = useMemo(() => makeStyles(colors, PRIMARY, DANGER), [colors, PRIMARY, DANGER]);
  const isDisabled = !!disabled || !!loading;

  const base = [S.btn, size === "sm" ? S.btnSm : S.btnMd];

  // Make the "outline" variant use a different color when the button label
  // indicates a cancellation action. Many places use title="Cancelar" with
  // variant="outline"; treat that case as a danger/negative outline (red).
  const isCancelLabel = String(title ?? "").trim().toLowerCase() === "cancelar" || String(title ?? "").trim().toLowerCase() === "cancel";
  const outlineColor = isCancelLabel ? DANGER : PRIMARY;

  const variantStyle =
    variant === "primary"
      ? S.primary
      : variant === "outline"
        ? S.outline
        : variant === "danger"
          ? S.danger
          : S.ghost;

  const txt = [
    S.txt,
    size === "sm" ? S.txtSm : S.txtMd,
    variant === "primary" ? S.txtOnPrimary : null,
    variant === "outline" ? S.txtOnOutline : null,
    variant === "danger" ? S.txtOnDanger : null,
    variant === "ghost" ? S.txtOnGhost : null,
    textStyle,
    // dynamic color override for outline text when label is a cancel action
    variant === "outline" ? { color: outlineColor } : null,
  ];

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      android_ripple={androidRipple}
      style={({ pressed }) => [
        base,
        variantStyle,
        // override outline border color for cancel buttons
        variant === "outline" ? { borderColor: outlineColor } : null,
        style,
        pressed && !isDisabled ? S.pressed : null,
        isDisabled ? S.disabled : null,
      ]}
    >
      {loading ? <ActivityIndicator color={variant === "primary" || variant === "danger" ? "#fff" : (PRIMARY as any)} /> : <Text style={txt}>{title}</Text>}
    </Pressable>
  );
}

const makeStyles = (colors: any, PRIMARY: string, DANGER: string) =>
  StyleSheet.create({
    btn: {
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderRadius: 14,
      flexShrink: 0,
    },

    btnSm: { paddingHorizontal: 12, paddingVertical: 10, minHeight: 40 },
    btnMd: { paddingHorizontal: 16, paddingVertical: 14, minHeight: 50 },

    primary: { backgroundColor: PRIMARY, borderColor: PRIMARY },
    outline: { backgroundColor: "transparent", borderColor: PRIMARY },
    danger: { backgroundColor: DANGER, borderColor: DANGER },
    ghost: { backgroundColor: colors.card, borderColor: colors.border },

    txt: { fontSize: 16, fontWeight: Platform.OS === "android" ? "700" : "600" },
    txtSm: { fontSize: 14 },
    txtMd: { fontSize: 16 },

    txtOnPrimary: { color: "#fff" },
    txtOnOutline: { color: PRIMARY },
    txtOnDanger: { color: "#fff" },
    txtOnGhost: { color: colors.text },

    pressed: { opacity: 0.85 },
    disabled: { opacity: 0.65 },
  });
