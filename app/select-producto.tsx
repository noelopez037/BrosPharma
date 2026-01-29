import { useTheme } from "@react-navigation/native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
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
import { SafeAreaView } from "react-native-safe-area-context";
import { useCompraDraft } from "../lib/compraDraft";
import { useVentaDraft } from "../lib/ventaDraft";
import { supabase } from "../lib/supabase";
import { getPrimary, getSwitchColors } from "../lib/ui";
import { AppButton } from "../components/ui/app-button";
import { KeyboardAwareModal } from "../components/ui/keyboard-aware-modal";
import { useKeyboardAutoScroll } from "../components/ui/use-keyboard-autoscroll";

type Marca = { id: number; nombre: string };
type ProductoRow = { id: number; nombre: string; marca_id: number | null; activo?: boolean };

type ProductoVentaRow = {
  id: number;
  nombre: string;
  marca: string | null;
  stock_disponible: number;
  precio_min_venta: string | number | null;
  tiene_iva: boolean;
  requiere_receta: boolean;
  activo: boolean;
};

export default function SelectProducto() {
  const params = useLocalSearchParams<{ lineKey?: string; mode?: string }>();
  const lineKey = String(params?.lineKey ?? "");
  const modeParam = String(params?.mode ?? "compra").trim().toLowerCase();

  if (modeParam === "venta") return <SelectProductoVenta lineKey={lineKey} />;
  return <SelectProductoCompra lineKey={lineKey} />;
}

function SelectProductoCompra({ lineKey }: { lineKey: string }) {
  const { colors } = useTheme();

  const PRIMARY = getPrimary(colors);
  const { trackOn: switchTrackOn, trackOff: switchTrackOff, thumbOn: switchThumbOn, thumbOff: switchThumbOff } =
    getSwitchColors(colors);

  const { setProductoEnLinea } = useCompraDraft();

  const [mode, setMode] = useState<"LISTA" | "CREAR">("LISTA");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ProductoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [newNombre, setNewNombre] = useState("");
  const [newRequiereReceta, setNewRequiereReceta] = useState(false);
  const [newTieneIva, setNewTieneIva] = useState(false);

  // Marca modal state (bottom sheet)
  const [brandSheet, setBrandSheet] = useState(false);

  const { scrollRef, handleFocus } = useKeyboardAutoScroll(110);
  const [selectedMarcaId, setSelectedMarcaId] = useState<number | null>(null);
  const [brandQuery, setBrandQuery] = useState("");
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [newBrandName, setNewBrandName] = useState("");

  // Cargar marcas
  const loadMarcas = useCallback(async () => {
    const { data, error } = await supabase.from("marcas").select("id, nombre").order("nombre");
    if (error) {
      setMarcas([]);
      return;
    }
    setMarcas((data ?? []) as Marca[]);
  }, []);
  useEffect(() => { loadMarcas().catch(() => {}); }, [loadMarcas]);

  // Cargar productos
  const loadProductos = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase.from("productos").select("id,nombre,marca_id,activo").eq("activo", true).order("nombre", { ascending: true }).limit(300);
      if (q.trim()) query = query.or(`nombre.ilike.%${q.trim()}%`);
      const { data } = await query;
      setItems((data ?? []) as ProductoRow[]);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudieron cargar productos");
    } finally {
      setLoading(false);
    }
  }, [q]);
  useEffect(() => {
    if (mode !== "LISTA") return;
    const t = setTimeout(() => {
      loadProductos().catch(() => {});
    }, 220);
    return () => clearTimeout(t);
  }, [loadProductos, mode]);

  const brandNameForId = (id: number | null | undefined) => {
    if (!id) return null;
    const m = marcas.find((mm) => mm.id === id);
    return m?.nombre ?? null;
  };

  const labelForItem = (p: ProductoRow) => {
    const nm = p.nombre ?? "";
    const b = brandNameForId(p.marca_id ?? null);
    return b ? `${nm} • ${b}` : nm;
  };

  const pick = (p: ProductoRow) => {
    if (!lineKey) return;
    const label = labelForItem(p);
    setProductoEnLinea(lineKey, p.id, label);
    router.back();
  };

  const crear = async () => {
    if (!lineKey) return;
    const nombre = newNombre.trim();
    if (!nombre) {
      Alert.alert("Falta nombre", "Escribe el nombre del producto.");
      return;
    }
    if (selectedMarcaId == null) {
      Alert.alert("Falta marca", "Selecciona una marca para el producto.");
      return;
    }
    setLoading(true);
    try {
      const brandId = selectedMarcaId;
      const { data, error } = await supabase
        .from("productos")
        .insert({
          nombre,
          marca_id: brandId,
          requiere_receta: newRequiereReceta,
          tiene_iva: newTieneIva,
          activo: true,
        })
        .select("id,nombre,marca_id,activo")
        .single();
      if (error) throw error;
      pick(data as ProductoRow);
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "No se pudo crear el producto");
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
          headerBackTitle: "Atrás",
        }}
      />
      <SafeAreaView
        edges={["left", "right", "bottom"]}
        style={[styles.safe, { backgroundColor: colors?.background ?? "#fff" }]}
      >
        {mode === "LISTA" ? (
          <>
            <View style={styles.content}>
              <View style={styles.row}>
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder="Buscar producto..."
                  placeholderTextColor={(colors?.text ?? "#000") + "66"}
                  style={[
                    styles.inputSearch,
                    {
                      borderColor: colors?.border ?? "#ccc",
                      backgroundColor: colors?.card ?? "#fff",
                      color: colors?.text ?? "#000",
                    },
                  ]}
                />
                <AppButton
                  title={"+ Nuevo"}
                  variant="outline"
                  size="sm"
                  onPress={() => {
                    setMode("CREAR");
                    setNewNombre("");
                    setSelectedMarcaId(null);
                    setNewBrandName("");
                    setNewRequiereReceta(false);
                    setNewTieneIva(false);
                  }}
                />
              </View>

              {loading ? (
                <Text style={{ marginTop: 10, fontWeight: "700", color: (colors?.text ?? "#000") + "88" }}>
                  Cargando...
                </Text>
              ) : null}
            </View>

            <FlatList
              data={items}
              keyExtractor={(it) => String(it.id)}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => pick(item)}
                  style={({ pressed }) => [
                    styles.rowItem,
                    { borderTopColor: colors?.border ?? "#ccc" },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={[styles.itemTitle, { color: colors?.text ?? "#000" }]}>
                    {item.nombre}{" "}
                    {item.marca_id
                      ? (() => {
                          const m = marcas.find((mm) => mm.id === item.marca_id);
                          return m ? ` • ${m.nombre}` : "";
                        })()
                      : ""}
                  </Text>
                </Pressable>
              )}
            />
          </>
        ) : (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
          >
            <ScrollView
              ref={scrollRef}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={[styles.content, { paddingBottom: 20 }]}
              automaticallyAdjustKeyboardInsets
            >
              <Text style={[styles.label, { color: colors?.text ?? "#000" }]}>Nombre</Text>
              <TextInput
                value={newNombre}
                onChangeText={setNewNombre}
                onFocus={handleFocus}
                placeholder="Ej: Acetaminofén 500mg"
                placeholderTextColor={(colors?.text ?? "#000") + "66"}
                style={[
                  styles.input,
                  {
                    borderColor: colors?.border ?? "#ccc",
                    backgroundColor: colors?.card ?? "#fff",
                    color: colors?.text ?? "#000",
                  },
                ]}
              />
              <Text style={[styles.label, { color: colors?.text ?? "#000" }]}>Marca</Text>
              <Pressable
                onPress={() => setBrandSheet(true)}
                style={[
                  styles.input,
                  {
                    borderColor: colors?.border ?? "#ccc",
                    backgroundColor: colors?.card ?? "#fff",
                    justifyContent: "center",
                  },
                ]}
              >
                <Text style={{ color: colors?.text ?? "#000" }}>
                  {selectedMarcaId != null
                    ? marcas.find((m) => m.id === selectedMarcaId)?.nombre ?? "Seleccionar marca…"
                    : "Seleccionar marca…"}
                </Text>
              </Pressable>

              <View
                style={[
                  styles.switchRow,
                  { borderColor: colors?.border ?? "#ccc", backgroundColor: colors?.card ?? "#fff" },
                ]}
              >
                <Text style={[styles.switchText, { color: colors?.text ?? "#000" }]}>Requiere receta</Text>
                <Switch
                  value={newRequiereReceta}
                  onValueChange={setNewRequiereReceta}
                  trackColor={Platform.OS === "android" ? { false: switchTrackOff, true: switchTrackOn } : undefined}
                  thumbColor={Platform.OS === "android" ? (newRequiereReceta ? switchThumbOn : switchThumbOff) : undefined}
                />
              </View>

              <View
                style={[
                  styles.switchRow,
                  { borderColor: colors?.border ?? "#ccc", backgroundColor: colors?.card ?? "#fff" },
                ]}
              >
                <Text style={[styles.switchText, { color: colors?.text ?? "#000" }]}>Tiene IVA</Text>
                <Switch
                  value={newTieneIva}
                  onValueChange={setNewTieneIva}
                  trackColor={Platform.OS === "android" ? { false: switchTrackOff, true: switchTrackOn } : undefined}
                  thumbColor={Platform.OS === "android" ? (newTieneIva ? switchThumbOn : switchThumbOff) : undefined}
                />
              </View>

              <AppButton
                title="Guardar producto"
                onPress={crear}
                loading={loading}
                disabled={!newNombre.trim() || selectedMarcaId == null}
              />
              <AppButton title="Cancelar" variant="outline" size="sm" onPress={() => setMode("LISTA")} />
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
      {/* Brand bottom sheet */}
      <KeyboardAwareModal
        visible={brandSheet}
        onClose={() => setBrandSheet(false)}
        cardStyle={{
          backgroundColor: colors?.card ?? "#fff",
          borderColor: colors?.border ?? "#ccc",
          borderRadius: 16,
        }}
        backdropOpacity={0.5}
      >
        <Text style={styles.modalTitle}>Seleccionar marca</Text>
        <TextInput
          value={brandQuery}
          onChangeText={setBrandQuery}
          placeholder="Buscar marca…"
          placeholderTextColor={colors?.text ? colors.text + "66" : "#666"}
          style={[
            styles.input,
            {
              borderColor: colors?.border ?? "#ccc",
              backgroundColor: colors?.card ?? "#fff",
              color: colors?.text ?? "#000",
            },
          ]}
        />
        <FlatList
          data={marcas.filter((m) => m.nombre.toLowerCase().includes(brandQuery.toLowerCase()))}
          keyExtractor={(m) => String(m.id)}
          style={{ maxHeight: 180 }}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          renderItem={({ item }) => (
            <Pressable
              style={styles.modalItem}
              onPress={() => {
                setSelectedMarcaId(item.id);
                setBrandSheet(false);
              }}
            >
              <Text style={styles.modalItemText}>{item.nombre}</Text>
            </Pressable>
          )}
        />

        <Text style={styles.label}>Nueva marca</Text>
        <TextInput
          value={newBrandName}
          onChangeText={setNewBrandName}
          placeholder="Ej: Bayer"
          placeholderTextColor={colors?.text ? colors.text + "66" : "#666"}
          style={[
            styles.input,
            {
              borderColor: colors?.border ?? "#ccc",
              backgroundColor: colors?.card ?? "#fff",
              color: colors?.text ?? "#000",
            },
          ]}
        />

        <View style={styles.modalBtns}>
          <Pressable
            style={[styles.modalBtnNeutral, { borderColor: colors?.border ?? "#ccc" }]}
            onPress={() => setBrandSheet(false)}
          >
            <Text style={[styles.modalBtnNeutralText, { color: colors?.text ?? "#000" }]}>Cerrar</Text>
          </Pressable>
          <View style={{ width: 8 }} />
          <Pressable
            style={[styles.modalBtnPrimary, { backgroundColor: PRIMARY as any }]}
            onPress={async () => {
              const nm = newBrandName.trim();
              if (!nm) return;
              const { data, error } = await supabase
                .from("marcas")
                .insert({ nombre: nm, activo: true })
                .select("id,nombre")
                .single();
              if (error) {
                Alert.alert("Error", error.message);
                return;
              }
              const id = (data as any).id;
              setMarcas((prev) => [...prev, { id, nombre: nm }]);
              setSelectedMarcaId(id);
              setNewBrandName("");
              setBrandSheet(false);
            }}
          >
            <Text style={styles.modalBtnPrimaryText}>Crear</Text>
          </Pressable>
        </View>
      </KeyboardAwareModal>
    </>
  );
}

function SelectProductoVenta({ lineKey }: { lineKey: string }) {
  const { colors } = useTheme();
  const { setProductoEnLinea } = useVentaDraft();

  const [q, setQ] = useState("");
  const [items, setItems] = useState<ProductoVentaRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("vw_inventario_productos_v2")
        .select("id,nombre,marca,stock_disponible,precio_min_venta,tiene_iva,requiere_receta,activo")
        .eq("activo", true)
        .order("nombre", { ascending: true })
        .limit(300);

      const search = q.trim();
      if (search) query = query.or(`nombre.ilike.%${search}%,marca.ilike.%${search}%`);

      const { data, error } = await query;
      if (error) throw error;
      setItems((data ?? []) as any);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudieron cargar productos");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(() => load(), 220);
    return () => clearTimeout(t);
  }, [load]);

  const pick = (p: ProductoVentaRow) => {
    if (!lineKey) return;
    const stock = Number((p as any).stock_disponible ?? 0);
    if (stock <= 0) return;

    const label = `${p.nombre ?? ""}${p.marca ? ` • ${p.marca}` : ""}`.trim();
    const min = p.precio_min_venta == null ? null : Number(p.precio_min_venta);

    setProductoEnLinea({
      lineKey,
      producto_id: Number(p.id),
      producto_label: label,
      stock_disponible: stock,
      precio_min_venta: Number.isFinite(min as any) ? (min as number) : null,
      tiene_iva: !!p.tiene_iva,
      requiere_receta: !!p.requiere_receta,
    });
    router.back();
  };

  const title = "Producto";
  const s = styles;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title, headerBackTitle: "Atrás" }} />

      <SafeAreaView edges={["left", "right", "bottom"]} style={[s.safe, { backgroundColor: colors?.background ?? "#fff" }]}>
        <View style={s.content}>
          <View style={s.row}>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Buscar producto..."
              placeholderTextColor={(colors?.text ?? "#000") + "66"}
              style={[
                s.inputSearch,
                {
                  borderColor: colors?.border ?? "#ccc",
                  backgroundColor: colors?.card ?? "#fff",
                  color: colors?.text ?? "#000",
                },
              ]}
            />
          </View>

          {loading ? (
            <Text style={{ marginTop: 10, fontWeight: "700", color: (colors?.text ?? "#000") + "88" }}>
              Cargando...
            </Text>
          ) : null}
        </View>

        <FlatList
          data={items}
          keyExtractor={(it) => String(it.id)}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          renderItem={({ item }) => {
            const stock = Number((item as any).stock_disponible ?? 0);
            const min = item.precio_min_venta == null ? null : Number(item.precio_min_venta);
            const disabled = stock <= 0;
            return (
              <Pressable
                onPress={() => (disabled ? null : pick(item))}
                disabled={disabled}
                style={({ pressed }) => [
                  s.rowItem,
                  { borderTopColor: colors?.border ?? "#ccc", opacity: disabled ? 0.5 : 1 },
                  pressed && !disabled ? { opacity: 0.85 } : null,
                ]}
              >
                <Text style={[s.itemTitle, { color: colors?.text ?? "#000" }]} numberOfLines={1}>
                  {item.nombre}
                  {item.marca ? ` • ${item.marca}` : ""}
                  {disabled ? "  •  SIN STOCK" : ""}
                </Text>
                <Text style={[s.itemSub, { color: (colors?.text ?? "#000") + "AA" }]} numberOfLines={1}>
                  Disponibles: {stock}  •  Min: {min == null || !Number.isFinite(min) ? "—" : `Q ${min.toFixed(2)}`}
                </Text>
              </Pressable>
            );
          }}
          ListEmptyComponent={!loading ? <Text style={{ padding: 16, color: (colors?.text ?? "#000") + "88" }}>Sin resultados</Text> : null}
        />
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 12 },
  row: { flexDirection: "row", gap: 12, alignItems: "center" },
  label: { marginTop: 6, marginBottom: 6, fontSize: 13, fontWeight: "600" },
  inputSearch: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, fontSize: 16 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, fontSize: 16 },
  // Buttons handled by AppButton
  rowItem: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1 },
  itemTitle: { fontSize: 16, fontWeight: "600" },
  itemSub: { marginTop: 4, fontSize: 13 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: 12, padding: 12 },
  switchText: { fontSize: 15, fontWeight: Platform.OS === "android" ? "500" : "600" },
  // (brand sheet handled by KeyboardAwareModal)
  modalBackdrop: { flex: 1 },
  backdrop: { flex: 1 },
  modalCard: { },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  modalItem: { padding: 12, borderTopWidth: 0 },
  modalItemText: { fontSize: 16 },
  modalBtns: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  modalBtnNeutral: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1 },
  modalBtnNeutralText: { fontWeight: '700' },
  modalBtnPrimary: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 },
  modalBtnPrimaryText: { color: '#fff', fontWeight: '700' },
});
