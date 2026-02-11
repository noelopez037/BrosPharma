// app/producto-edit.tsx
// Ajuste de colores para que Android use colores del theme (Material) y no attrs que a veces salen “raros”.
// Cambios principales:
// - En Android usamos colors.primary / colors.card / colors.border en vez de PlatformColor(?attr/...)
// - Switch con trackColor/thumbColor para evitar el verde default y verse consistente
// - Botón "+ Nueva" con fondo colors.card (no gris flotante) para que no se vea oscuro
// - Pesos de fuente más moderados en Android (600/700 se ve muy “pesado” en muchos dispositivos)

import { useTheme } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ColorValue,
  FlatList,
  InteractionManager,
  KeyboardAvoidingView,
  Platform,
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
import { AppButton } from "../components/ui/app-button";
import { KeyboardAwareModal } from "../components/ui/keyboard-aware-modal";
import { DoneAccessory } from "../components/ui/done-accessory";
import { useKeyboardAutoScroll } from "../components/ui/use-keyboard-autoscroll";
import { goBackSafe } from "../lib/goBackSafe";
import { useRole } from "../lib/useRole";

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
  const headerHeight = useHeaderHeight();
  const DONE_ID = "doneAccessory";
  const { scrollRef, handleFocus } = useKeyboardAutoScroll(110);

  const reqSeq = useRef(0);

  // Colores “nativos”/correctos por plataforma:
  const PRIMARY: ColorValue = String(colors.primary ?? "#153c9e") as any;

  const s = useMemo(() => styles(colors, PRIMARY), [colors, PRIMARY]);

  const { id } = useLocalSearchParams<{ id: string }>();
  const productoId = Number(id);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const { refreshRole } = useRole();

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
    const seq = ++reqSeq.current;
    setLoading(true);

    const task: any = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();

          const uid = session?.user?.id ?? null;
          if (!uid) {
            Alert.alert("Sin sesión", "Debes iniciar sesión");
            goBackSafe("/(drawer)/(tabs)/inventario");
            return;
          }

          const r = String(await refreshRole()).trim().toUpperCase();
          const admin = r === "ADMIN";
          if (seq !== reqSeq.current) return;
          setIsAdmin(admin);

          if (!admin) {
            Alert.alert("Sin permiso", "Solo ADMIN puede editar productos");
            goBackSafe("/(drawer)/(tabs)/inventario");
            return;
          }

          const prodP = supabase
            .from("productos")
            .select("id,nombre,marca_id,requiere_receta,tiene_iva,activo")
            .eq("id", productoId)
            .single();

          const ovP = supabase
            .from("producto_precio_override")
            .select("precio_compra_override,motivo")
            .eq("producto_id", productoId)
            .maybeSingle();

          const [, prodRes, ovRes] = await Promise.all([loadMarcas(), prodP, ovP]);
          if (seq !== reqSeq.current) return;

          if (prodRes.error) throw prodRes.error;
          if ((ovRes as any)?.error) throw (ovRes as any).error;
          const p = prodRes.data as ProductoRow;

          setNombre(p.nombre ?? "");
          setMarcaId(p.marca_id ?? null);
          setRequiereReceta(!!p.requiere_receta);
          setTieneIva(!!p.tiene_iva);
          setActivo(!!p.activo);

          if (ovRes?.data?.precio_compra_override != null) setPrecioCompra(String(ovRes.data.precio_compra_override));
          else setPrecioCompra("");
          setMotivo(ovRes?.data?.motivo ?? "");

          setLoading(false);
        } catch (err: any) {
          if (seq !== reqSeq.current) return;
          Alert.alert("Error", err?.message ?? "No se pudo cargar");
          setLoading(false);
        }
      })();
    });

    return () => {
      // Invalida respuestas viejas (evita que una respuesta atrasada pise el estado)
      reqSeq.current++;
      task?.cancel?.();
    };
  }, [productoId, loadMarcas, refreshRole]);

  const onBack = useCallback(() => {
    // Preferimos router.back(); si no hay historial, caemos a una ruta segura.
    try {
      const can = typeof (router as any)?.canGoBack === "function" ? (router as any).canGoBack() : false;
      if (can) router.back();
      else router.replace("/(drawer)/(tabs)/inventario" as any);
    } catch {
      router.replace("/(drawer)/(tabs)/inventario" as any);
    }
  }, []);

  // Si algun layout global oculta el header, mostramos un boton inline.
  const showInlineBack = headerHeight <= 0;

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
      goBackSafe("/(drawer)/(tabs)/inventario");
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const Skeleton = useMemo(
    () => (
      <ScrollView
        contentContainerStyle={s.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        {showInlineBack ? (
          <Pressable onPress={onBack} style={({ pressed }) => [s.inlineBack, pressed && { opacity: 0.7 }]}>
            <Text style={s.inlineBackText}>{"<- Atrás"}</Text>
          </Pressable>
        ) : null}

        <View style={s.skelBlockLg} />
        <View style={s.skelBlockSm} />
        <View style={s.skelBlockLg} />
        <View style={s.skelBlockLg} />
        <View style={s.skelBlockLg} />
        <View style={s.skelBtn} />
      </ScrollView>
    ),
    [onBack, s, showInlineBack]
  );

  // Switch colors (para Android se vea “del theme” y no el verde default)
  const switchTrackOn =
    Platform.OS === "android"
      ? (alpha(String(colors.primary ?? "#153c9e"), 0.35) as any)
      : undefined;

  const switchTrackOff =
    Platform.OS === "android" ? (alpha(String(colors.text ?? "#000000"), 0.15) as any) : undefined;

  const switchThumbOn =
    Platform.OS === "android" ? (colors.primary ?? "#153c9e") : undefined;

  const switchThumbOff =
    Platform.OS === "android" ? (colors.border ?? "#C7C7CC") : undefined;

  return (
    <>
      <Stack.Screen
        options={{
          title: "Editar producto",
          headerShown: true,
          headerBackTitle: "Atrás",
        }}
      />

      <SafeAreaView style={[s.safe, { paddingBottom: insets.bottom }]} edges={["bottom"]}>
        {loading ? (
          Skeleton
        ) : (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
          >
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={s.container}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets
            >
              {showInlineBack ? (
                <Pressable onPress={onBack} style={({ pressed }) => [s.inlineBack, pressed && { opacity: 0.7 }]}>
                  <Text style={s.inlineBackText}>{"<- Atrás"}</Text>
                </Pressable>
              ) : null}

              <Text style={s.label}>Nombre</Text>
              <TextInput
                value={nombre}
                onChangeText={setNombre}
                onFocus={handleFocus}
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
              onFocus={handleFocus}
              style={s.input}
              placeholder="(vacío = usar última compra)"
              placeholderTextColor={colors.text + "66"}
              keyboardType="decimal-pad"
              inputAccessoryViewID={Platform.OS === "ios" ? DONE_ID : undefined}
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

            <AppButton title="Guardar" onPress={onSave} loading={saving} />

              <View style={{ height: 12 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        )}

        {/* Modales solo cuando la pantalla ya esta lista (evita trabajo extra en el primer paint) */}
        {!loading ? (
          <>
            {/* Modal: Seleccionar marca */}
            <KeyboardAwareModal
              visible={marcaModalOpen}
              onClose={() => {
                setMarcaModalOpen(false);
                setMarcaQuery("");
              }}
              cardStyle={{ backgroundColor: colors.card, borderColor: colors.border }}
              backdropOpacity={0.35}
            >
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
            automaticallyAdjustKeyboardInsets
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
            </KeyboardAwareModal>

            {/* Modal: Nueva marca */}
            <KeyboardAwareModal
              visible={nuevaMarcaOpen}
              onClose={() => setNuevaMarcaOpen(false)}
              cardStyle={{ backgroundColor: colors.card, borderColor: colors.border }}
              backdropOpacity={0.35}
            >
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
            </KeyboardAwareModal>

            <DoneAccessory nativeID={DONE_ID} />
          </>
        ) : null}
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

    inlineBack: { alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 2, marginBottom: 6 },
    inlineBackText: {
      color: colors.text,
      fontFamily: FONT_FAMILY,
      fontWeight: Platform.OS === "android" ? "600" : "600",
    },

    skelBlockLg: {
      height: 44,
      borderRadius: 12,
      backgroundColor: alpha(String(colors.text ?? "#000000"), 0.08) as any,
      borderWidth: 1,
      borderColor: alpha(String(colors.text ?? "#000000"), 0.06) as any,
      marginTop: 10,
    },
    skelBlockSm: {
      height: 18,
      borderRadius: 10,
      backgroundColor: alpha(String(colors.text ?? "#000000"), 0.06) as any,
      marginTop: 16,
      width: "55%",
    },
    skelBtn: {
      height: 46,
      borderRadius: 14,
      backgroundColor: alpha(String(colors.primary ?? "#153c9e"), 0.22) as any,
      marginTop: 18,
    },

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

    // Buttons handled by AppButton

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
