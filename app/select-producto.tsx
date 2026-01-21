// app/select-producto.tsx
import { useTheme } from "@react-navigation/native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCompraDraft } from "../lib/compraDraft";
import { supabase } from "../lib/supabase";

type Producto = { id: number; nombre: string; marca: string | null; activo?: boolean };

export default function SelectProducto() {
  const { colors, dark } = useTheme(); // ✅ RESPETA TOGGLE
  const isDark = dark;

  const { setProductoEnLinea } = useCompraDraft();

  const params = useLocalSearchParams();
  const lineKey = String(params?.lineKey ?? "");

  // 🔁 mismos colores, pero basados en el theme global
  const C = useMemo(
    () => ({
      bg: colors.background,
      card: colors.card,
      text: colors.text,
      sub: isDark ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.6)",
      border: colors.border,
      tint: colors.primary ?? "#007AFF",
    }),
    [colors, isDark]
  );

  const [mode, setMode] = useState<"LISTA" | "CREAR">("LISTA");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(false);

  const [newNombre, setNewNombre] = useState("");
  const [newMarca, setNewMarca] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("productos")
        .select("id,nombre,marca,activo")
        .eq("activo", true)
        .order("nombre", { ascending: true })
        .limit(300);

      if (q.trim()) query = query.or(`nombre.ilike.%${q.trim()}%,marca.ilike.%${q.trim()}%`);

      const { data, error } = await query;
      if (error) throw error;

      setItems((data ?? []) as Producto[]);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudieron cargar productos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mode !== "LISTA") return;
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [q, mode]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (p: Producto) => {
    if (!lineKey) return;
    const label = `${p.nombre}${p.marca ? ` • ${p.marca}` : ""}`;
    setProductoEnLinea(lineKey, p.id, label);
    router.back();
  };

  const crear = async () => {
    if (!lineKey) return;

    const nombre = newNombre.trim();
    const marca = newMarca.trim();
    if (!nombre) return Alert.alert("Falta dato", "Ingresa el nombre del producto");

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("productos")
        .insert({ nombre, marca: marca ? marca : null, activo: true })
        .select("id,nombre,marca,activo")
        .single();

      if (error) throw error;

      pick(data as Producto);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo crear el producto");
    } finally {
      setLoading(false);
    }
  };

  const title = mode === "LISTA" ? "Producto" : "Nuevo producto";

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerBackTitle: "Atras",
          headerStyle: { backgroundColor: C.bg },
          headerTitleStyle: { color: C.text },
          headerTintColor: C.text,
        }}
      />

      <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
        <View style={styles.content}>
          {mode === "LISTA" ? (
            <View style={styles.row}>
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Buscar producto..."
                placeholderTextColor={C.sub}
                selectionColor={C.tint}
                cursorColor={C.tint}
                keyboardAppearance={isDark ? "dark" : "light"}
                style={[
                  styles.inputSearch,
                  { borderColor: C.border, backgroundColor: C.card, color: C.text },
                ]}
              />

              <Pressable
                onPress={() => {
                  setMode("CREAR");
                  setNewNombre(q.trim());
                  setNewMarca("");
                }}
                style={({ pressed }) => [
                  styles.btnOutline,
                  { borderColor: C.tint },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={[styles.btnOutlineText, { color: C.tint }]}>+ Nuevo</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={[styles.label, { color: C.text }]}>Nombre</Text>
              <TextInput
                value={newNombre}
                onChangeText={setNewNombre}
                placeholder="Ej: Acetaminofén 500mg"
                placeholderTextColor={C.sub}
                selectionColor={C.tint}
                cursorColor={C.tint}
                keyboardAppearance={isDark ? "dark" : "light"}
                autoCorrect={false}
                style={[
                  styles.input,
                  { borderColor: C.border, backgroundColor: C.card, color: C.text },
                ]}
              />

              <Text style={[styles.label, { color: C.text }]}>Marca (opcional)</Text>
              <TextInput
                value={newMarca}
                onChangeText={setNewMarca}
                placeholder="Ej: Bayer"
                placeholderTextColor={C.sub}
                selectionColor={C.tint}
                cursorColor={C.tint}
                keyboardAppearance={isDark ? "dark" : "light"}
                autoCorrect={false}
                style={[
                  styles.input,
                  { borderColor: C.border, backgroundColor: C.card, color: C.text },
                ]}
              />

              <Pressable
                onPress={crear}
                disabled={loading}
                style={({ pressed }) => [
                  styles.btnPrimary,
                  { backgroundColor: C.tint, opacity: loading ? 0.75 : pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={styles.btnPrimaryText}>
                  {loading ? "Guardando…" : "Guardar producto"}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setMode("LISTA")}
                style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={[styles.linkText, { color: C.tint }]}>Cancelar</Text>
              </Pressable>
            </>
          )}

          {loading && mode === "LISTA" && <ActivityIndicator />}
        </View>

        {mode === "LISTA" && (
          <FlatList
            data={items}
            keyExtractor={(it) => String(it.id)}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingBottom: 24 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => pick(item)}
                style={({ pressed }) => [
                  styles.rowItem,
                  { borderTopColor: C.border },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={[styles.itemTitle, { color: C.text }]}>{item.nombre}</Text>
                {!!item.marca && (
                  <Text style={[styles.itemSub, { color: C.sub }]}>{item.marca}</Text>
                )}
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, gap: 12 },
  row: { flexDirection: "row", gap: 12, alignItems: "center" },
  label: { marginTop: 6, marginBottom: 6, fontSize: 13, fontWeight: "600" },

  inputSearch: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    fontSize: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    fontSize: 16,
  },

  btnOutline: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  btnOutlineText: { fontSize: 14, fontWeight: "600" },

  btnPrimary: {
    marginTop: 8,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimaryText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  linkBtn: { paddingVertical: 8, alignItems: "center" },
  linkText: { fontSize: 14, fontWeight: "600" },

  rowItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  itemTitle: { fontSize: 16, fontWeight: "600" },
  itemSub: { marginTop: 4, fontSize: 13 },
});
