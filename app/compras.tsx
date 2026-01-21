// app/compras.tsx
// FIX teclado:
// - FlatList SIEMPRE montado (no alternar loading ? <ActivityIndicator> : <FlatList>)
// - initialLoading solo para primera carga
// - ListHeaderComponent sigue, pero no se desmonta porque FlatList nunca se desmonta
// ✅ UX: limpiar buscador al salir de la pantalla (useFocusEffect cleanup)
// ✅ UX: agregar "X" a la derecha del buscador para borrar texto

import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack, router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  PlatformColor,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";

type CompraRow = {
  id: number;
  fecha: string | null;
  proveedor: string | null;
  numero_factura: string | null;
  tipo_pago: string | null;
  fecha_vencimiento: string | null;
  monto_total: number | null;
  saldo_pendiente: number | null;
  estado: string | null;
};

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function fmtQ(n: number | null | undefined) {
  if (n == null) return "—";
  return `Q ${Number(n).toFixed(2)}`;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function normalizeUpper(s: string | null | undefined) {
  return (s ?? "").trim().toUpperCase();
}

export default function ComprasScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => styles(colors), [colors]);

  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q.trim(), 250);

  const [rows, setRows] = useState<CompraRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canManage, setCanManage] = useState(false);

  // ✅ Limpiar buscador al SALIR de la pantalla (cuando pierde foco)
  useFocusEffect(
    useCallback(() => {
      return () => {
        setQ("");
      };
    }, [])
  );

  // roles
  useEffect(() => {
    let mounted = true;

    const loadRole = async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return;

      const { data } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();

      const role = normalizeUpper(data?.role);
      if (mounted) setCanManage(role === "ADMIN" || role === "BODEGA");
    };

    loadRole().catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const fetchCompras = useCallback(async () => {
    let req = supabase
      .from("compras")
      .select(
        "id,fecha,proveedor,numero_factura,tipo_pago,fecha_vencimiento,monto_total,saldo_pendiente,estado"
      )
      .order("fecha", { ascending: false });

    if (dq) {
      req = req.or(`proveedor.ilike.%${dq}%,numero_factura.ilike.%${dq}%`);
    }

    const { data } = await req;
    setRows((data ?? []) as CompraRow[]);
  }, [dq]);

  // primera carga + cada vez que cambia el debounce (buscar)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (alive) setInitialLoading(true);
        await fetchCompras();
      } finally {
        if (alive) setInitialLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [fetchCompras]);

  // al volver a la pantalla
  useFocusEffect(
    useCallback(() => {
      fetchCompras().catch(() => {});
    }, [fetchCompras])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchCompras();
    } finally {
      setRefreshing(false);
    }
  }, [fetchCompras]);

  const badge = (c: CompraRow) => {
    const estado = normalizeUpper(c.estado);
    const tipo = normalizeUpper(c.tipo_pago);
    const saldo = Number(c.saldo_pendiente ?? 0);

    if (estado === "ANULADA") return { text: "ANULADA", kind: "muted" as const };
    if (tipo === "CONTADO") return { text: "PAGADA", kind: "ok" as const };
    if (tipo === "CREDITO" && saldo <= 0) return { text: "PAGADA", kind: "ok" as const };
    if (tipo === "CREDITO" && saldo > 0) return { text: "PENDIENTE", kind: "warn" as const };
    return { text: estado || tipo || "—", kind: "muted" as const };
  };

  const renderItem = ({ item }: { item: CompraRow }) => {
    const b = badge(item);

    return (
      <Pressable
        style={s.card}
        onPress={() =>
          router.push({
            pathname: "/compra-detalle",
            params: { id: String(item.id) },
          })
        }
      >
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{item.proveedor ?? "Proveedor"}</Text>
            <Text style={s.sub}>Factura: {item.numero_factura ?? "—"}</Text>
            <Text style={s.sub}>Fecha: {fmtDate(item.fecha)}</Text>
          </View>

          <View style={{ alignItems: "flex-end" }}>
            <Text
              style={[
                s.badge,
                b.kind === "ok" && s.badgeOk,
                b.kind === "warn" && s.badgeWarn,
                b.kind === "muted" && s.badgeMuted,
              ]}
            >
              {b.text}
            </Text>

            <Text style={s.total}>{fmtQ(item.monto_total)}</Text>
          </View>
        </View>
      </Pressable>
    );
  };

  const fabBg =
    Platform.OS === "ios" ? (PlatformColor("systemBlue") as any) : (colors.primary as any);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Compras",
          headerBackTitle: "Atrás",
        }}
      />

      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["bottom"]}>
        <FlatList
          style={{ backgroundColor: colors.background }}
          data={rows}
          keyExtractor={(it) => String(it.id)}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingTop: 12,
            paddingBottom: 16 + insets.bottom,
          }}
          ListHeaderComponent={
            <>
              {/* ✅ Search con X */}
              <View style={s.searchWrap}>
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder="Buscar por proveedor o factura..."
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

              {initialLoading ? (
                <View style={{ paddingVertical: 10 }}>
                  <ActivityIndicator />
                </View>
              ) : null}
            </>
          }
          ListEmptyComponent={
            !initialLoading ? (
              <View style={s.center}>
                <Text style={s.empty}>Sin compras</Text>
              </View>
            ) : null
          }
        />

        {canManage ? (
          <Pressable style={[s.fab, { backgroundColor: fabBg }]} onPress={() => router.push("/compra-nueva")}>
            <Text style={s.fabText}>＋</Text>
          </Pressable>
        ) : null}
      </SafeAreaView>
    </>
  );
}

const styles = (colors: any) =>
  StyleSheet.create({
    // ✅ Nuevo wrapper para poder poner la X dentro
    searchWrap: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 12,
      marginBottom: 10,
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

    row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
    title: { color: colors.text, fontSize: 16, fontWeight: "800" },
    sub: { color: colors.text + "AA", marginTop: 6, fontSize: 12 },

    badge: {
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      fontSize: 12,
      fontWeight: "800",
      color: colors.text,
    },
    badgeOk: {},
    badgeWarn: {},
    badgeMuted: { color: colors.text + "AA" },

    total: { color: colors.text, fontWeight: "900", marginTop: 10, fontSize: 14 },

    fab: {
      position: "absolute",
      right: 18,
      bottom: 18,
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000",
      shadowOpacity: 0.25,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 6,
    },
    fabText: { color: "#fff", fontSize: 30, fontWeight: "900", marginTop: -2 },
  });
