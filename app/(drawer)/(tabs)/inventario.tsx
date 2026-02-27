// app/(drawer)/(tabs)/inventario.tsx
import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack } from "expo-router";
import React, { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../../lib/supabase";
import { ProductoModalContent } from "../../../components/producto/ProductoModalContent";
import { useRole } from "../../../lib/useRole";

type Row = {
  id: number;
  nombre: string;
  marca: string | null;
  precio_min_venta: number | null;
  stock_disponible: number;
  lote_proximo: string | null;
  fecha_exp_proxima: string | null;
  activo: boolean;
};

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function normalizeQuery(s: string) {
  return s.trim().replace(/[%_]/g, '\\$&');
}

const PAGE_SIZE = 30;

function ItemCard({
  item,
  onPress,
  s,
}: {
  item: Row;
  onPress: (id: number) => void;
  s: ReturnType<typeof styles>;
}) {
  return (
    <Pressable style={s.card} onPress={() => onPress(item.id)}>
      <View style={s.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>
            {item.nombre}
            {item.marca ? ` • ${item.marca}` : ""}
          </Text>

          <View style={s.metaRow}>
            <Text style={s.metaK}>Precio min de venta:</Text>
            <Text style={s.metaV}>
              {item.precio_min_venta == null ? "—" : `Q ${item.precio_min_venta.toFixed(2)}`}
            </Text>

            {!item.activo ? <Text style={s.badgeOff}>INACTIVO</Text> : null}
          </View>
        </View>

        <View style={s.stockBox}>
          <Text style={s.stockLabel}>Disponibles</Text>
          <Text style={s.stockValue}>{item.stock_disponible ?? 0}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const MemoItemCard = memo(ItemCard);

export default function InventarioScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => styles(colors), [colors]);

  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(normalizeQuery(q), 300);

  const { isAdmin, refreshRole } = useRole();
  const [showInactive, setShowInactive] = useState(false);

  const [rows, setRows] = useState<Row[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);

  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [productoOpen, setProductoOpen] = useState(false);
  const [productoId, setProductoId] = useState<number | null>(null);

  const loadingMoreRef = useRef(false);
  const pageRef = useRef(0);
  const requestSeq = useRef(0);

  React.useEffect(() => {
    if (!isAdmin) setShowInactive(false);
  }, [isAdmin]);

  const fetchPage = useCallback(
    async (pageIndex: number, replace: boolean) => {
      const seq = ++requestSeq.current;

      const from = pageIndex * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let req = supabase
        .from("vw_inventario_productos")
        .select(
          "id,nombre,marca,activo,precio_min_venta,stock_disponible,lote_proximo,fecha_exp_proxima"
        )
        .order("nombre", { ascending: true })
        .range(from, to);

      // Default: solo activos. Admin puede incluir inactivos con el toggle.
      if (!showInactive) {
        req = req.eq("activo", true);
      }

      if (debouncedQ) {
        req = req.or(`nombre.ilike.%${debouncedQ}%,marca.ilike.%${debouncedQ}%`);
      }

      const { data, error } = await req;

      // Si entró otra request después, ignorar esta
      if (seq !== requestSeq.current) return;

      if (error) throw error;

      const list = (data ?? []) as Row[];
      setHasMore(list.length === PAGE_SIZE);
      setRows((prev) => (replace ? list : [...prev, ...list]));
    },
    [debouncedQ, showInactive]
  );

  const loadFirst = useCallback(async () => {
    setErrorMsg(null);
    setInitialLoading(true);
    setHasMore(true);
    setPage(0);
    pageRef.current = 0;

    try {
      await fetchPage(0, true);
    } catch (e: any) {
      setRows([]);
      setHasMore(false);
      setErrorMsg(e?.message ?? "No se pudo cargar inventario");
    } finally {
      setInitialLoading(false);
    }
  }, [fetchPage]);

  useFocusEffect(
    useCallback(() => {
      void refreshRole();
      loadFirst();
      return () => {
        setQ("");
        setProductoOpen(false);
        setProductoId(null);
      };
    }, [refreshRole, loadFirst])
  );

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current || initialLoading) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      pageRef.current = next;
      await fetchPage(next, false);
      setPage(next);
    } catch {
      // paginación falla: no rompas la UI; puedes dejar hasMore=true para reintentar al scroll
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [fetchPage, hasMore, initialLoading]);

  const closeProducto = useCallback(() => {
    setProductoOpen(false);
    setProductoId(null);
  }, []);

  const onPressItem = useCallback((id: number) => {
    setProductoId(id);
    setProductoOpen(true);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Row }) => <MemoItemCard item={item} onPress={onPressItem} s={s} />,
    [onPressItem, s]
  );

  return (
    <>
      <Stack.Screen options={{ title: "Inventario" }} />

      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["bottom"]}>
        <View style={s.headerPad}>
          {/* ✅ Search con X */}
          <View style={s.searchWrap}>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Buscar por nombre o marca..."
              placeholderTextColor={colors.text + "66"}
              style={s.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {q.trim().length > 0 ? (
              <Pressable
                onPress={() => setQ("")}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Borrar búsqueda"
                style={s.clearBtn}
              >
                <Text style={s.clearTxt}>×</Text>
              </Pressable>
            ) : null}
          </View>

          {isAdmin ? (
            <View style={s.inactiveRow}>
              <Text style={s.inactiveLabel}>Mostrar inactivos</Text>
              <Switch
                value={showInactive}
                onValueChange={setShowInactive}
                trackColor={{ false: colors.border, true: "#34C759" }}
                thumbColor={Platform.OS === "android" ? "#FFFFFF" : undefined}
                style={Platform.OS === "android" ? { transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] } : undefined}
              />
            </View>
          ) : null}

          {errorMsg ? (
            <Pressable onPress={loadFirst} style={s.retry}>
              <Text style={s.retryText}>Reintentar</Text>
              <Text style={s.retrySub}>{errorMsg}</Text>
            </Pressable>
          ) : null}
        </View>

        <FlatList
          data={rows}
          keyExtractor={(it) => String(it.id)}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          onEndReachedThreshold={0.4}
          onEndReached={loadMore}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={50}
          windowSize={7}
          removeClippedSubviews
          contentContainerStyle={{
            paddingLeft: 12,
            paddingRight: 16, // espacio para que el scroll indicator no se monte
            paddingBottom: 16 + insets.bottom,
          }}
          scrollIndicatorInsets={{ right: 6, top: 0, left: 0, bottom: 0 }}
          ListEmptyComponent={
            initialLoading ? (
              <View style={s.center}>
                <Text style={s.empty}>Cargando...</Text>
              </View>
            ) : (
              <View style={s.center}>
                <Text style={s.empty}>Sin resultados</Text>
              </View>
            )
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={{ paddingVertical: 12 }}>
                <Text style={[s.empty, { fontSize: 12 }]}>Cargando...</Text>
              </View>
            ) : null
          }
        />
      </SafeAreaView>

      {productoOpen && productoId != null ? (
        <Modal
          visible
          transparent
          presentationStyle="overFullScreen"
          onRequestClose={closeProducto}
        >
          <ProductoModalContent productoId={productoId} onClose={closeProducto} />
        </Modal>
      ) : null}
    </>
  );
}

const styles = (colors: any) =>
  StyleSheet.create({
    container: { flex: 1 },

    headerPad: {
      paddingHorizontal: 12,
      paddingTop: 12,
      paddingBottom: 10,
    },

    // ✅ Nuevo wrapper para poder poner la X dentro
    searchWrap: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 12,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      paddingVertical: 10,
      fontSize: 16,
    },
    clearBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    clearTxt: {
      color: colors.text + "88",
      fontSize: 22,
      fontWeight: "900",
      lineHeight: 22,
      marginTop: -1,
    },

    retry: {
      marginTop: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: 12,
      borderRadius: 12,
    },
    retryText: { color: colors.text, fontWeight: "800" },
    retrySub: { color: colors.text + "AA", marginTop: 6, fontSize: 12 },

    inactiveRow: {
      marginTop: 10,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === "android" ? 8 : 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    inactiveLabel: {
      color: colors.text,
      fontWeight: "700",
      fontSize: Platform.OS === "android" ? 15 : 16,
    },

    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    empty: { color: colors.text },

    card: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: 12,
      borderRadius: 14,
      marginBottom: 10,
    },
    cardTop: { flexDirection: "row", gap: 10 },
    title: { color: colors.text, fontSize: 16, fontWeight: "700" },

    metaRow: { flexDirection: "row", alignItems: "center", marginTop: 8, flexWrap: "wrap" },
    metaK: { color: colors.text + "AA" },
    metaV: { color: colors.text, fontWeight: "700", marginLeft: 6 },

    badgeOff: {
      color: colors.text + "AA",
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      fontSize: 12,
      marginLeft: 12,
    },

    stockBox: { minWidth: 120, alignItems: "flex-end" },
    stockLabel: { color: colors.text + "AA", fontSize: 12 },
    stockValue: { color: colors.text, fontSize: 22, fontWeight: "800" },
  });
