import { useTheme } from "@react-navigation/native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCompraDraft } from "../lib/compraDraft";
import { supabase } from "../lib/supabase";
import { getPrimary, getSwitchColors } from "../lib/ui";
import { AppButton } from "../components/ui/app-button";

type Marca = { id: number; nombre: string };
type ProductoRow = { id: number; nombre: string; marca_id: number | null; activo?: boolean };

export default function SelectProducto() {
  const { colors } = useTheme();

  const PRIMARY = getPrimary(colors);
  const { trackOn: switchTrackOn, trackOff: switchTrackOff, thumbOn: switchThumbOn, thumbOff: switchThumbOff } =
    getSwitchColors(colors);

  const { setProductoEnLinea } = useCompraDraft();
  const params = useLocalSearchParams<{ lineKey?: string }>();
  const lineKey = String(params?.lineKey ?? "");

  const [mode, setMode] = useState<"LISTA" | "CREAR">("LISTA");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ProductoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [newNombre, setNewNombre] = useState("");
  const [newRequiereReceta, setNewRequiereReceta] = useState(false);
  const [newTieneIva, setNewTieneIva] = useState(false);

  // Marca modal state (bottom sheet)
  const [brandSheet, setBrandSheet] = useState(false);
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
  useEffect(() => { if (mode === "LISTA") { const t = setTimeout(loadProductos, 200); return () => clearTimeout(t); } }, [loadProductos, mode]);
  useEffect(() => { loadProductos().catch(() => {}); }, [loadProductos]);

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
    if (!nombre) return;
    setLoading(true);
    try {
      const brandId = selectedMarcaId ?? null;
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
        <View style={styles.content}>
          {mode === "LISTA" ? (
            <View style={styles.row}>
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Buscar producto..."
                placeholderTextColor={(colors?.text ?? '#000') + '66'}
                style={[styles.inputSearch, { borderColor: colors?.border ?? '#ccc', backgroundColor: colors?.card ?? '#fff', color: colors?.text ?? '#000' }]}
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
          ) : (
            <>
              <Text style={[styles.label, { color: colors?.text ?? '#000' }]}>Nombre</Text>
              <TextInput
                value={newNombre}
                onChangeText={setNewNombre}
                placeholder="Ej: Acetaminofén 500mg"
                placeholderTextColor={(colors?.text ?? '#000') + '66'}
                style={[styles.input, { borderColor: colors?.border ?? '#ccc', backgroundColor: colors?.card ?? '#fff', color: colors?.text ?? '#000' }]}
              />
              <Text style={[styles.label, { color: colors?.text ?? '#000' }]}>Marca</Text>
              <Pressable
                onPress={() => setBrandSheet(true)}
                style={[styles.input, { borderColor: colors?.border ?? '#ccc', backgroundColor: colors?.card ?? '#fff', justifyContent: 'center' }]}
              >
                <Text style={{ color: colors?.text ?? '#000' }}>
                  {selectedMarcaId != null
                    ? (marcas.find((m) => m.id === selectedMarcaId)?.nombre ?? 'Seleccionar marca…')
                    : 'Seleccionar marca…'}
                </Text>
              </Pressable>

              <View
                style={[
                  styles.switchRow,
                  { borderColor: colors?.border ?? '#ccc', backgroundColor: colors?.card ?? '#fff' },
                ]}
              >
                <Text style={[styles.switchText, { color: colors?.text ?? '#000' }]}>Requiere receta</Text>
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
                  { borderColor: colors?.border ?? '#ccc', backgroundColor: colors?.card ?? '#fff' },
                ]}
              >
                <Text style={[styles.switchText, { color: colors?.text ?? '#000' }]}>Tiene IVA</Text>
                <Switch
                  value={newTieneIva}
                  onValueChange={setNewTieneIva}
                  trackColor={Platform.OS === "android" ? { false: switchTrackOff, true: switchTrackOn } : undefined}
                  thumbColor={Platform.OS === "android" ? (newTieneIva ? switchThumbOn : switchThumbOff) : undefined}
                />
              </View>
              {/* La creacion de marca se hace dentro del modal */}
              <AppButton title="Guardar producto" onPress={crear} loading={loading} />
              <AppButton title="Cancelar" variant="outline" size="sm" onPress={() => setMode("LISTA")} />
            </>
          )}
          {loading && mode === 'LISTA' && <ActivityIndicator />}
        </View>
        {mode === 'LISTA' && (
          <FlatList
            data={items}
            keyExtractor={(it) => String(it.id)}
            renderItem={({ item }) => (
              <Pressable onPress={() => pick(item)} style={({ pressed }) => [styles.rowItem, { borderTopColor: colors?.border ?? '#ccc' }, pressed && { opacity: 0.8 }]}>
                <Text style={[styles.itemTitle, { color: colors?.text ?? '#000' }]}>
                  {item.nombre} {item.marca_id ? (() => {
                    const m = marcas.find((mm) => mm.id === item.marca_id);
                    return m ? ` • ${m.nombre}` : "";
                  })() : ""}
                </Text>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
      {/* Brand bottom sheet (inline) */}
      {brandSheet && (
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setBrandSheet(false)} />
          <View
            style={[
              styles.sheetCard,
              {
                backgroundColor: colors?.card ?? "#fff",
                borderColor: colors?.border ?? "#ccc",
              },
            ]}
          >
            <Text style={styles.modalTitle}>Seleccionar marca</Text>
            <TextInput
              value={brandQuery}
              onChangeText={setBrandQuery}
              placeholder="Buscar marca…"
              placeholderTextColor={colors?.text ? colors.text + '66' : '#666'}
              style={[
                styles.input,
                {
                  borderColor: colors?.border ?? "#ccc",
                  backgroundColor: colors?.card ?? "#fff",
                  color: colors?.text ?? "#000",
                },
              ]}
            />
            <Pressable style={styles.modalItem} onPress={() => { setSelectedMarcaId(null); setBrandSheet(false); }}>
              <Text style={styles.modalItemText}>Sin marca</Text>
            </Pressable>
            <FlatList
              data={marcas.filter((m) => m.nombre.toLowerCase().includes(brandQuery.toLowerCase()))}
              keyExtractor={(m) => String(m.id)}
              style={{ maxHeight: 180 }}
              renderItem={({ item }) => (
                <Pressable style={styles.modalItem} onPress={() => { setSelectedMarcaId(item.id); setBrandSheet(false); }}>
                  <Text style={styles.modalItemText}>{item.nombre}</Text>
                </Pressable>
              )}
            />

            <Text style={styles.label}>Nueva marca</Text>
            <TextInput
              value={newBrandName}
              onChangeText={setNewBrandName}
              placeholder="Ej: Bayer"
              placeholderTextColor={colors?.text ? colors.text + '66' : '#666'}
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
                  const { data, error } = await supabase.from("marcas").insert({ nombre: nm, activo: true }).select("id,nombre").single();
                  if (error) { Alert.alert("Error", error.message); return; }
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
          </View>
        </View>
      )}
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
  // modal sheet (fallback)
  sheetOverlay: { position: 'absolute', left:0, right:0, bottom:0, top:0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheetBackdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  sheetCard: { height: 420, borderWidth: 1, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
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
