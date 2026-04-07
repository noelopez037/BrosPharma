// app/producto-edit.tsx
// Wrapper de ruta para edición de producto en móvil (iOS/Android).
// En web, la edición se abre como modal desde ProductoModalContent.

import { Stack, useLocalSearchParams } from "expo-router";
import React from "react";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native";
import { useTheme } from "@react-navigation/native";
import { ProductoEditContent } from "../components/producto/ProductoEditContent";
import { goBackSafe } from "../lib/goBackSafe";

export default function ProductoEdit() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const productoId = Number(id);

  const onClose = () => goBackSafe("/(drawer)/(tabs)/inventario");

  return (
    <>
      <Stack.Screen
        options={{
          title: "Editar producto",
          headerShown: true,
          headerBackTitle: "Atrás",
        }}
      />
      <SafeAreaView
        style={[styles.safe, { backgroundColor: colors.background, paddingBottom: insets.bottom }]}
        edges={["bottom"]}
      >
        <ProductoEditContent productoId={productoId} onClose={onClose} showBackButton={false} />
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
});
