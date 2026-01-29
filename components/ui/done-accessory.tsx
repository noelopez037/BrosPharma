import React from "react";
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTheme } from "@react-navigation/native";

type Props = {
  nativeID: string;
  label?: string;
};

export function DoneAccessory({ nativeID, label = "Listo" }: Props) {
  const { colors } = useTheme();

  if (Platform.OS !== "ios") return null;

  return (
    <InputAccessoryView nativeID={nativeID}>
      <View style={[styles.bar, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <View style={{ flex: 1 }} />
        <Pressable onPress={Keyboard.dismiss} hitSlop={10} style={({ pressed }) => [pressed ? { opacity: 0.75 } : null]}>
          <Text style={[styles.btn, { color: colors.primary }]}>{label}</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
  },
  btn: { fontSize: 16, fontWeight: "800" },
});
