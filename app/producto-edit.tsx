// app/producto-edit.tsx
// Ajuste de colores para que Android use colores del theme (Material) y no attrs que a veces salen “raros”.
// Cambios principales:
// - En Android usamos colors.primary / colors.card / colors.border en vez de PlatformColor(?attr/...)
// - Switch con trackColor/thumbColor para evitar el verde default y verse consistente
// - Botón "+ Nueva" con fondo colors.card (no gris flotante) para que no se vea oscuro
// - Pesos de fuente más moderados en Android (600/700 se ve muy “pesado” en muchos dispositivos)

import { useTheme } from "@react-navigation/native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ColorValue,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  PlatformColor,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";

type Marca = { id: number; nombre: string };

type ProductoRow = {
  id: number;
  nombre: string;
  marca_id: number | null;
  requiere_receta: boolean;
  tiene_iva: boolean;
  activo: boolean;
};

// Tipografía consistente
const FONT_FAMILY = Platform.select({
  ios: "System",
  android: "sans-serif",
  default: undefined,
});

function alpha(hexColor: string, a: number) {
  // hexColor: "#RRGGBB"
  const c = hexColor.replace("#", "");
  if (c.length !== 6) return hexColor;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const aa = Math.max(0, Math.min(1, a));
  return `rgba(${r},${g},${b},${aa})`;
}

export default function ProductoEdit() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // Colores “nativos”/correctos por plataforma:
  // iOS: systemBlue
  // Android: colors.primary (viene del theme de navigation / material)
  const PRIMARY: ColorValue =
    Platform.OS === "ios" ? PlatformColor("systemBlue") : (colors.primary ?? "#007AFF");

  const s = useMemo(() => styles(colors, PRIMARY), [colors, PRIMARY]);

  const { id } = useLocalSearchParams<{ id: string }>();
  const productoId = Number(id);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [nombre, setNombre] = useState("");

  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [marcaId, setMarcaId] = useState<number | null>(null);

  const [requiereReceta, setRequiereReceta] = useState(false);
  const [tieneIva, setTieneIva] = useState(false);
  const [activo, setActivo] = useState(true);

  const [precioCompra, setPrecioCompra] = useState("");
  const [motivo, setMotivo] = useState("");

  const [marcaModalOpen, setMarcaModalOpen] = useState(false);
  const [nuevaMarcaOpen, setNuevaMarcaOpen] = useState(false);
  const [nuevaMarcaNombre, setNuevaMarcaNombre] = useState("");
  const [marcaQuery, setMarcaQuery] = useState("");

  const marcaLabel = useMemo(() => {
    if (!marcaId) return "Seleccionar marca (opcional)…";
    return marcas.find((m) => m.id === marcaId)?.nombre ?? "Seleccionar marca…";
  }, [marcaId, marcas]);

  const marcasFiltradas = useMemo(() => {
    const q = marcaQuery.trim().toLowerCase();
    if (!q) return marcas;
    return marcas.filter((m) => m.nombre.toLowerCase().includes(q));
  }, [marcaQuery, marcas]);

  const loadMarcas = useCallback(async () => {
    const { data, error } = await supabase
      .from("marcas")
      .select("id,nombre")
      .eq("activo", true)
      .order("nombre", { ascending: true });

    if (error) throw error;
    setMarcas((data ?? []) as Marca[]);
  }, []);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const uid = session?.user?.id ?? null;
      if (!uid) {
        Alert.alert("Sin sesión", "Debes iniciar sesión");
        router.back();
        return;
      }

      const { data: prof } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
      const admin = (prof?.role ?? "").toUpperCase() === "ADMIN";
      setIsAdmin(admin);

      if (!admin) {
        Alert.alert("Sin permiso", "Solo ADMIN puede editar productos");
        router.back();
        return;
      }

      await loadMarcas();

      const { data: prod, error: e1 } = await supabase
        .from("productos")
        .select("id,nombre,marca_id,requiere_receta,tiene_iva,activo")
        .eq("id", productoId)
        .single();
      if (e1) throw e1;

      const { data: ov } = await supabase
        .from("producto_precio_override")
        .select("precio_compra_override,motivo")
        .eq("producto_id", productoId)
        .maybeSingle();

      if (!mounted) return;

      const p = prod as ProductoRow;

      setNombre(p.nombre ?? "");
      setMarcaId(p.marca_id ?? null);
      setRequiereReceta(!!p.requiere_receta);
      setTieneIva(!!p.tiene_iva);
      setActivo(!!p.activo);

      if (ov?.precio_compra_override != null) setPrecioCompra(String(ov.precio_compra_override));
      else setPrecioCompra("");
      setMotivo(ov?.motivo ?? "");

      setLoading(false);
    };

    load().catch((err) => {
      Alert.alert("Error", err?.message ?? "No se pudo cargar");
      setLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [productoId, loadMarcas]);

  const crearMarca = async () => {
    const nm = nuevaMarcaNombre.trim();
    if (!nm) return;

    try {
      const { data, error } = await supabase
        .from("marcas")
        .insert({ nombre: nm, activo: true })
        .select("id,nombre")
        .single();

      if (error) throw error;

      setMarcaId((data as any).id);
      setNuevaMarcaNombre("");
      setNuevaMarcaOpen(false);
      await loadMarcas();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo crear la marca");
    }
  };

  const onSave = async () => {
    if (!isAdmin) return;

    const cleanNombre = nombre.trim();
    if (!cleanNombre) return Alert.alert("Faltan datos", "Nombre es obligatorio");

    setSaving(true);
    try {
      const selectedMarcaNombre =
        marcaId != null ? marcas.find((m) => m.id === marcaId)?.nombre ?? null : null;

      const { error: e1 } = await supabase
        .from("productos")
        .update({
          nombre: cleanNombre,
          marca_id: marcaId,
          requiere_receta: requiereReceta,
          tiene_iva: tieneIva,
          activo,
        })
        .eq("id", productoId);

      if (e1) throw e1;

      const cleanPrecio = precioCompra.trim();
      if (cleanPrecio) {
        const n = Number(cleanPrecio);
        if (!Number.isFinite(n) || n < 0) throw new Error("Precio compra inválido");

        const {
          data: { session },
        } = await supabase.auth.getSession();

        const { error: e2 } = await supabase.from("producto_precio_override").upsert({
          producto_id: productoId,
          precio_compra_override: n,
          motivo: motivo.trim() || null,
          updated_by: session?.user?.id ?? null,
          updated_at: new Date().toISOString(),
        });

        if (e2) throw e2;
      } else {
        await supabase.from("producto_precio_override").delete().eq("producto_id", productoId);
      }

      Alert.alert("Listo", "Producto actualizado");
      router.back();
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={["bottom"]}>
        <View style={s.center}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  // Switch colors (para Android se vea “del theme” y no el verde default)
  const switchTrackOn =
    Platform.OS === "android"
      ? (alpha(String(colors.primary ?? "#007AFF"), 0.35) as any)
      : undefined;

  const switchTrackOff =
    Platform.OS === "android" ? (alpha(String(colors.text ?? "#000000"), 0.15) as any) : undefined;

  const switchThumbOn =
    Platform.OS === "android" ? (colors.primary ?? "#007AFF") : undefined;

  const switchThumbOff =
    Platform.OS === "android" ? (colors.border ?? "#C7C7CC") : undefined;

  return (
    <>
      <Stack.Screen options={{ title: "Editar producto", headerShown: true, headerBackTitle: "Atras" }} />

      <SafeAreaView style={[s.safe, { paddingBottom: insets.bottom }]} edges={["bottom"]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
        >
          <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
            <Text style={s.label}>Nombre</Text>
            <TextInput
              value={nombre}
              onChangeText={setNombre}
              style={s.input}
              placeholder="Nombre"
              placeholderTextColor={colors.text + "66"}
            />

            <Text style={s.label}>Marca (opcional)</Text>

            <View style={s.row2}>
              <Pressable
                style={s.select}
                onPress={() => {
                  setMarcaQuery("");
                  setMarcaModalOpen(true);
                }}
              >
                <Text style={[s.selectText, { color: marcaId ? colors.text : colors.text + "88" }]}>
                  {marcaLabel}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setNuevaMarcaOpen(true)}
                style={({ pressed }) => [
                  s.btnTint,
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Text style={s.btnTintText}>+ Nueva</Text>
              </Pressable>
            </View>

            <Text style={s.label}>Regulador</Text>
            <TextInput
              value={precioCompra}
              onChangeText={setPrecioCompra}
              style={s.input}
              placeholder="(vacío = usar última compra)"
              placeholderTextColor={colors.text + "66"}
              keyboardType="decimal-pad"
            />

            <View style={s.switchRow}>
              <Text style={s.switchText}>Requiere receta</Text>
              <Switch
                value={requiereReceta}
                onValueChange={setRequiereReceta}
                trackColor={Platform.OS === "android" ? { false: switchTrackOff, true: switchTrackOn } : undefined}
                thumbColor={
                  Platform.OS === "android"
                    ? (requiereReceta ? switchThumbOn : switchThumbOff)
                    : undefined
                }
              />
            </View>

            <View style={s.switchRow}>
              <Text style={s.switchText}>Tiene IVA</Text>
              <Switch
                value={tieneIva}
                onValueChange={setTieneIva}
                trackColor={Platform.OS === "android" ? { false: switchTrackOff, true: switchTrackOn } : undefined}
                thumbColor={
                  Platform.OS === "android"
                    ? (tieneIva ? switchThumbOn : switchThumbOff)
                    : undefined
                }
              />
            </View>

            <View style={s.switchRow}>
              <Text style={s.switchText}>Activo</Text>
              <Switch
                value={activo}
                onValueChange={setActivo}
                trackColor={Platform.OS === "android" ? { false: switchTrackOff, true: switchTrackOn } : undefined}
                thumbColor={
                  Platform.OS === "android"
                    ? (activo ? switchThumbOn : switchThumbOff)
                    : undefined
                }
              />
            </View>

            <Pressable
              onPress={onSave}
              disabled={saving}
              style={({ pressed }) => [
                s.btnPrimary,
                (pressed || saving) && { opacity: 0.85 },
              ]}
            >
              <Text style={s.btnPrimaryText}>{saving ? "Guardando..." : "Guardar"}</Text>
            </Pressable>

            <View style={{ height: 12 }} />
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Modal: Seleccionar marca */}
        <Modal
          visible={marcaModalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setMarcaModalOpen(false);
            setMarcaQuery("");
          }}
        >
          <Pressable
            style={s.backdrop}
            onPress={() => {
              setMarcaModalOpen(false);
              setMarcaQuery("");
            }}
          />

          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Seleccionar marca</Text>

            <TextInput
              value={marcaQuery}
              onChangeText={setMarcaQuery}
              style={s.input}
              placeholder="Buscar marca…"
              placeholderTextColor={colors.text + "66"}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Pressable
              style={s.modalItem}
              onPress={() => {
                setMarcaId(null);
                setMarcaModalOpen(false);
                setMarcaQuery("");
              }}
            >
              <Text style={s.modalItemText}>Sin marca</Text>
            </Pressable>

            <FlatList
              data={marcasFiltradas}
              keyExtractor={(it) => String(it.id)}
              style={{ maxHeight: 340 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  style={s.modalItem}
                  onPress={() => {
                    setMarcaId(item.id);
                    setMarcaModalOpen(false);
                    setMarcaQuery("");
                  }}
                >
                  <Text style={s.modalItemText}>{item.nombre}</Text>
                </Pressable>
              )}
              ListEmptyComponent={<Text style={[s.helper, { marginTop: 8 }]}>Sin resultados</Text>}
            />
          </View>
        </Modal>

        {/* Modal: Nueva marca */}
        <Modal
          visible={nuevaMarcaOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setNuevaMarcaOpen(false)}
        >
          <Pressable style={s.backdrop} onPress={() => setNuevaMarcaOpen(false)} />

          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Nueva marca</Text>

            <TextInput
              value={nuevaMarcaNombre}
              onChangeText={setNuevaMarcaNombre}
              style={s.input}
              placeholder="Ej: Bayer"
              placeholderTextColor={colors.text + "66"}
              autoCapitalize="words"
            />

            <View style={s.modalBtns}>
              <Pressable
                style={({ pressed }) => [s.modalBtnNeutral, pressed && { opacity: 0.75 }]}
                onPress={() => setNuevaMarcaOpen(false)}
              >
                <Text style={s.modalBtnNeutralText}>Cancelar</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  s.modalBtnPrimary,
                  (pressed || !nuevaMarcaNombre.trim()) && { opacity: 0.75 },
                ]}
                onPress={crearMarca}
                disabled={!nuevaMarcaNombre.trim()}
              >
                <Text style={s.modalBtnPrimaryText}>Crear</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const styles = (colors: any, PRIMARY: ColorValue) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },

    container: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 16,
      backgroundColor: colors.background,
    },

    center: { flex: 1, alignItems: "center", justifyContent: "center" },

    label: {
      color: colors.text + "AA",
      marginTop: 12,
      marginBottom: 6,
      fontFamily: FONT_FAMILY,
      // Android se ve muy “pesado” con 600; mantenemos 500
      fontWeight: Platform.OS === "android" ? "500" : "500",
    },

    helper: {
      color: colors.text + "88",
      marginTop: 6,
      fontSize: 12,
      fontFamily: FONT_FAMILY,
      fontWeight: "400",
    },

    input: {
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: colors.card,
      marginBottom: 10,
      fontFamily: FONT_FAMILY,
      fontWeight: "400",
      fontSize: 16,
    },

    row2: { flexDirection: "row", gap: 10, alignItems: "center" },

    select: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: colors.card,
      justifyContent: "center",
    },

    selectText: {
      fontSize: 16,
      fontFamily: FONT_FAMILY,
      fontWeight: "400",
    },

    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 12,
      backgroundColor: colors.card,
    },

    switchText: {
      color: colors.text,
      fontFamily: FONT_FAMILY,
      fontWeight: Platform.OS === "android" ? "500" : "600",
    },

    // "+ Nueva" ahora se ve correcto en Android (fondo claro/oscuro según theme)
    btnTint: {
      borderWidth: 1,
      borderColor: PRIMARY as any,
      backgroundColor: colors.card,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    btnTintText: {
      color: PRIMARY as any,
      fontFamily: FONT_FAMILY,
      fontWeight: Platform.OS === "android" ? "600" : "600",
    },

    btnPrimary: {
      marginTop: 18,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: PRIMARY as any,
    },
    btnPrimaryText: {
      color: "#fff",
      fontFamily: FONT_FAMILY,
      fontWeight: Platform.OS === "android" ? "700" : "700",
      fontSize: 16,
    },

    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },

    modalCard: {
      position: "absolute",
      left: 16,
      right: 16,
      top: "14%",
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
    },

    modalTitle: {
      color: colors.text,
      fontFamily: FONT_FAMILY,
      fontWeight: Platform.OS === "android" ? "700" : "700",
      fontSize: 16,
      marginBottom: 10,
    },

    modalItem: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 12,
      marginBottom: 10,
      backgroundColor: colors.background,
    },
    modalItemText: { color: colors.text, fontFamily: FONT_FAMILY, fontWeight: "400" },

    modalBtns: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 10 },

    modalBtnNeutral: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    modalBtnNeutralText: { color: colors.text, fontFamily: FONT_FAMILY, fontWeight: "600" },

    modalBtnPrimary: {
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: PRIMARY as any,
    },
    modalBtnPrimaryText: { color: "#fff", fontFamily: FONT_FAMILY, fontWeight: "700" },
  });
