// app/select-proveedor.tsx
import { useTheme } from "@react-navigation/native";
import { Stack, router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Proveedor, useCompraDraft } from "../lib/compraDraft";
import { supabase } from "../lib/supabase";
import { AppButton } from "../components/ui/app-button";

function alpha(hexOrRgb: string, a: number) {
  if (!hexOrRgb?.startsWith("#") || hexOrRgb.length !== 7) return hexOrRgb;
  const r = parseInt(hexOrRgb.slice(1, 3), 16);
  const g = parseInt(hexOrRgb.slice(3, 5), 16);
  const b = parseInt(hexOrRgb.slice(5, 7), 16);
  const aa = Math.max(0, Math.min(1, a));
  return `rgba(${r},${g},${b},${aa})`;
}

export default function SelectProveedor() {
  const { colors, dark } = useTheme();
  const { setProveedor } = useCompraDraft();

  const C = useMemo(() => {
    const tint = colors.primary ?? "#007AFF";
    const text = colors.text ?? (dark ? "#fff" : "#111");
    const bg = colors.background ?? (dark ? "#000" : "#fff");
    const card = colors.card ?? (dark ? "#0f0f10" : "#fff");
    const border = colors.border ?? (dark ? "rgba(255,255,255,0.14)" : "#e5e5e5");
    const sub = alpha(text, 0.65);
    return { bg, card, text, sub, border, tint };
  }, [colors, dark]);

  const [mode, setMode] = useState<"LISTA" | "CREAR">("LISTA");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(false);

  const [newNombre, setNewNombre] = useState("");
  const [newTel, setNewTel] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("proveedores")
        .select("id,nombre,telefono,activo")
        .order("nombre", { ascending: true })
        .limit(200);

      if (q.trim()) query = query.ilike("nombre", `%${q.trim()}%`);

      const { data, error } = await query;
      if (error) throw error;

      setItems(((data ?? []) as Proveedor[]).filter((x) => x.activo !== false));
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudieron cargar proveedores");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mode !== "LISTA") return;
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, mode]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (p: Proveedor) => {
    setProveedor({
      id: p.id,
      nombre: p.nombre,
      telefono: p.telefono ?? null,
      activo: p.activo,
    });
    router.back();
  };

  const crear = async () => {
    const nombre = newNombre.trim();
    const telefono = newTel.trim();
    if (!nombre) return Alert.alert("Falta dato", "Ingresa el nombre del proveedor");

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("proveedores")
        .insert({ nombre, telefono: telefono ? telefono : null, activo: true })
        .select("id,nombre,telefono,activo")
        .single();

      if (error) throw error;

      pick(data as Proveedor);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo crear el proveedor");
    } finally {
      setLoading(false);
    }
  };

  const title = mode === "LISTA" ? "Proveedor" : "Nuevo proveedor";

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerBackTitle: "Atras",
          // En iOS deja el header nativo. En Android sí forzamos colores del theme (toggle)
          ...(Platform.OS === "android"
            ? {
                headerStyle: { backgroundColor: C.bg as any },
                headerTitleStyle: { color: C.text as any },
                headerTintColor: C.text as any,
              }
            : {}),
        }}
      />

      <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
        <View style={styles.content}>
          {mode === "LISTA" ? (
            <View style={styles.row}>
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Buscar proveedor..."
                placeholderTextColor={C.sub}
                selectionColor={C.tint as any}
                cursorColor={C.tint as any}
                style={[
                  styles.input,
                  styles.inputFlex, // ✅ SOLO aquí
                  {
                    borderColor: C.border,
                    backgroundColor: C.card,
                    color: C.text,
                  },
                ]}
              />

              <AppButton
                title={"+ Nuevo"}
                variant="outline"
                size="sm"
                onPress={() => {
                  setMode("CREAR");
                  setNewNombre(q.trim());
                  setNewTel("");
                }}
              />
            </View>
          ) : (
            <>
              <Text style={[styles.label, { color: C.text }]}>Nombre</Text>
              <TextInput
                value={newNombre}
                onChangeText={setNewNombre}
                placeholder="Ej: Proveedor demo"
                placeholderTextColor={C.sub}
                selectionColor={C.tint as any}
                cursorColor={C.tint as any}
                style={[
                  styles.input,
                  {
                    borderColor: C.border,
                    backgroundColor: C.card,
                    color: C.text,
                  },
                ]}
              />

              <Text style={[styles.label, { color: C.text }]}>Teléfono (opcional)</Text>
              <TextInput
                value={newTel}
                onChangeText={setNewTel}
                placeholder="Ej: 5555-5555"
                placeholderTextColor={C.sub}
                keyboardType="phone-pad"
                selectionColor={C.tint as any}
                cursorColor={C.tint as any}
                style={[
                  styles.input,
                  {
                    borderColor: C.border,
                    backgroundColor: C.card,
                    color: C.text,
                  },
                ]}
              />

              <AppButton title="Guardar proveedor" onPress={crear} loading={loading} />

              <AppButton title="Cancelar" variant="outline" size="sm" onPress={() => setMode("LISTA")} />
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
                {!!item.telefono && <Text style={[styles.itemSub, { color: C.sub }]}>{item.telefono}</Text>}
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

  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },

  // ✅ solo para el buscador en la fila
  inputFlex: { flex: 1 },

  // Buttons handled by AppButton

  rowItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  itemTitle: { fontSize: 16, fontWeight: "600" },
  itemSub: { marginTop: 4, fontSize: 13 },
});
