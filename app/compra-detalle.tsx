// app/compra-detalle.tsx
// Detalle de compra (read-only)
// ✅ ThemePref (toggle drawer) dark/light
// ✅ Cabecera + líneas (con lote/exp) + stock por lote (2da query)
// ✅ Sin botón Refrescar
// ✅ Sin sección Pagos
// ✅ Botones abajo: Editar + Eliminar compra
// ✅ Editar abre compra-nueva en modo edición (editId)
// ✅ Eliminar usa RPC rpc_compra_eliminar_compra
// ✅ UI: más “nativa” iOS/Android (grouped bg, cards más suaves, sombras sutiles, mejor jerarquía)

import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { useThemePref } from "../lib/themePreference";

const BUCKET = "productos";

type Compra = {
  id: number;
  fecha: string;
  numero_factura: string | null;
  tipo_pago: string;
  fecha_vencimiento: string | null;
  estado: string;
  monto_total: string | null;
  saldo_pendiente: string | null;
  comentarios: string | null;
  proveedor_id: number;
  proveedor_nombre: string | null;
};

type Linea = {
  detalle_id: number;
  producto_id: number;
  producto_nombre: string | null;
  producto_marca: string | null;
  producto_image_path: string | null;
  lote_id: number;
  lote: string;
  fecha_exp: string | null;
  cantidad: number;
  precio_compra_unit: string;
  subtotal: string | null;
  stock_total: number | null;
  stock_reservado: number | null;
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return String(iso).slice(0, 10);
}
function fmtQ(n: string | number | null | undefined) {
  if (n == null) return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `Q ${x.toFixed(2)}`;
}
function normalizeUpper(s: string | null | undefined) {
  return (s ?? "").trim().toUpperCase();
}
function storagePublicUrl(bucket: string, path: string) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

export default function CompraDetalleScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const compraId = Number(id);

  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  const C = useMemo(
    () => ({
      bg: isDark ? "#000" : Platform.OS === "ios" ? "#F2F2F7" : "#f4f4f5",
      card: isDark ? "#0f0f10" : "#fff",
      text: isDark ? "#fff" : "#111",
      sub: isDark ? "rgba(255,255,255,0.65)" : "#6b7280",
      border: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",

      primary: Platform.OS === "ios" ? "#007AFF" : "#1976D2",
      danger: Platform.OS === "ios" ? "#FF3B30" : "#D32F2F",

      ok: isDark ? "rgba(140,255,170,0.95)" : "#16a34a",
      warn: isDark ? "rgba(255,210,120,0.95)" : "#b45309",

      okBg: isDark ? "rgba(22,163,74,0.18)" : "rgba(22,163,74,0.10)",
      warnBg: isDark ? "rgba(180,83,9,0.18)" : "rgba(180,83,9,0.10)",
      mutedBg: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
      dangerBg: isDark ? "rgba(255,59,48,0.16)" : "rgba(255,59,48,0.10)",

      divider: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)",
    }),
    [isDark]
  );

  const [loading, setLoading] = useState(true);
  const [compra, setCompra] = useState<Compra | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [deleting, setDeleting] = useState(false);

  const badge = useMemo(() => {
    const estado = normalizeUpper(compra?.estado);
    const tipo = normalizeUpper(compra?.tipo_pago);
    const saldo = Number(compra?.saldo_pendiente ?? 0);

    if (estado === "ANULADA") return { text: "ANULADA", kind: "muted" as const };
    if (tipo === "CONTADO") return { text: "PAGADA", kind: "ok" as const };
    if (tipo === "CREDITO" && saldo <= 0) return { text: "PAGADA", kind: "ok" as const };
    if (tipo === "CREDITO" && saldo > 0) return { text: "PENDIENTE", kind: "warn" as const };
    return { text: estado || tipo || "—", kind: "muted" as const };
  }, [compra]);

  const fetchAll = useCallback(async () => {
    if (!Number.isFinite(compraId) || compraId <= 0) return;

    setLoading(true);
    try {
      const { data: c, error: e1 } = await supabase
        .from("compras")
        .select(
          "id,fecha,numero_factura,tipo_pago,fecha_vencimiento,estado,monto_total,saldo_pendiente,comentarios,proveedor_id,proveedores(nombre)"
        )
        .eq("id", compraId)
        .maybeSingle();

      if (e1) throw e1;
      if (!c) throw new Error("Compra no encontrada");

      setCompra({
        id: c.id,
        fecha: c.fecha,
        numero_factura: c.numero_factura,
        tipo_pago: c.tipo_pago,
        fecha_vencimiento: c.fecha_vencimiento,
        estado: c.estado,
        monto_total: c.monto_total,
        saldo_pendiente: c.saldo_pendiente,
        comentarios: c.comentarios,
        proveedor_id: c.proveedor_id,
        proveedor_nombre: (c as any).proveedores?.nombre ?? null,
      });

      const { data: d, error: e2 } = await supabase
        .from("compras_detalle")
        .select(
          "id,compra_id,producto_id,lote_id,cantidad,precio_compra_unit,subtotal, productos(nombre,marca,image_path), producto_lotes(lote,fecha_exp)"
        )
        .eq("compra_id", compraId)
        .order("id", { ascending: true });

      if (e2) throw e2;

      const mapped: Linea[] = (d ?? []).map((r: any) => ({
        detalle_id: r.id,
        producto_id: r.producto_id,
        producto_nombre: r.productos?.nombre ?? null,
        producto_marca: r.productos?.marca ?? null,
        producto_image_path: r.productos?.image_path ?? null,
        lote_id: r.lote_id,
        lote: r.producto_lotes?.lote ?? "—",
        fecha_exp: r.producto_lotes?.fecha_exp ?? null,
        cantidad: r.cantidad,
        precio_compra_unit: String(r.precio_compra_unit),
        subtotal: r.subtotal ?? null,
        stock_total: null,
        stock_reservado: null,
      }));

      const loteIds = Array.from(
        new Set(mapped.map((x) => Number(x.lote_id)).filter((x) => Number.isFinite(x) && x > 0))
      );

      if (loteIds.length) {
        const { data: srows, error: se } = await supabase
          .from("stock_lotes")
          .select("lote_id,stock_total,stock_reservado")
          .in("lote_id", loteIds);

        if (se) throw se;

        const byLote = new Map<number, { stock_total: number; stock_reservado: number }>();
        (srows ?? []).forEach((r: any) =>
          byLote.set(Number(r.lote_id), {
            stock_total: Number(r.stock_total ?? 0),
            stock_reservado: Number(r.stock_reservado ?? 0),
          })
        );

        for (const it of mapped) {
          const st = byLote.get(Number(it.lote_id));
          it.stock_total = st?.stock_total ?? 0;
          it.stock_reservado = st?.stock_reservado ?? 0;
        }
      }

      setLineas(mapped);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo cargar");
      setCompra(null);
      setLineas([]);
    } finally {
      setLoading(false);
    }
  }, [compraId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const eliminarCompra = async () => {
    if (!compra) return;
    if (deleting) return;

    Alert.alert("Eliminar compra", "Esto eliminará la compra y sus líneas. ¿Seguro?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            const { error } = await supabase.rpc("rpc_compra_eliminar_compra", {
              p_compra_id: compra.id,
            });
            if (error) throw error;

            Alert.alert("Listo", "Compra eliminada", [{ text: "OK", onPress: () => router.back() }]);
          } catch (e: any) {
            Alert.alert("Error", e?.message ?? "No se pudo eliminar");
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  const badgeStyle = useMemo(() => {
    if (badge.kind === "ok") return { color: C.ok, bg: C.okBg };
    if (badge.kind === "warn") return { color: C.warn, bg: C.warnBg };
    return { color: C.sub, bg: C.mutedBg };
  }, [badge.kind, C]);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Detalle compra",
          headerBackTitle: "Atrás",
        }}
      />

      <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
        {loading ? (
          <View style={[styles.center, { paddingTop: 18 }]}>
            <ActivityIndicator />
          </View>
        ) : !compra ? (
          <View style={styles.center}>
            <Text style={{ color: C.text }}>No disponible</Text>
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1, backgroundColor: C.bg }}
            contentInsetAdjustmentBehavior="never"
            contentContainerStyle={{
              paddingTop: 12,
              paddingHorizontal: 16,
              paddingBottom: 12 + insets.bottom + 104,
            }}
          >
            {/* Cabecera */}
            <View
              style={[
                styles.cardBase,
                styles.headerCard,
                styles.shadowCard,
                { borderColor: C.border, backgroundColor: C.card },
              ]}
            >
              <View style={styles.headerTop}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.h1, { color: C.text }]} numberOfLines={2}>
                    {compra.proveedor_nombre ?? `Proveedor #${compra.proveedor_id}`}
                  </Text>
                  <Text style={[styles.meta, { color: C.sub }]} numberOfLines={1}>
                    Factura: {compra.numero_factura ?? "—"} · {fmtDate(compra.fecha)}
                  </Text>
                </View>

                <View
                  style={[
                    styles.badgePill,
                    { backgroundColor: badgeStyle.bg, borderColor: C.border },
                  ]}
                >
                  <Text style={[styles.badgeText, { color: badgeStyle.color }]}>{badge.text}</Text>
                </View>
              </View>

              <View style={[styles.kvGrid, { marginTop: 12 }]}>
                <View style={styles.kv}>
                  <Text style={[styles.k, { color: C.sub }]}>Tipo</Text>
                  <Text style={[styles.v, { color: C.text }]}>{normalizeUpper(compra.tipo_pago) || "—"}</Text>
                </View>

                {normalizeUpper(compra.tipo_pago) === "CREDITO" ? (
                  <View style={styles.kv}>
                    <Text style={[styles.k, { color: C.sub }]}>Vencimiento</Text>
                    <Text style={[styles.v, { color: C.text }]}>{fmtDate(compra.fecha_vencimiento)}</Text>
                  </View>
                ) : null}
              </View>

              {compra.comentarios ? (
                <View style={{ marginTop: 12 }}>
                  <Text style={[styles.k, { color: C.sub }]}>Notas</Text>
                  <Text style={[styles.note, { color: C.text }]}>{compra.comentarios}</Text>
                </View>
              ) : null}

              <View style={[styles.divider, { backgroundColor: C.divider }]} />

              <View style={styles.totalRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.k, { color: C.sub }]}>Total</Text>
                  <Text style={[styles.total, { color: C.text }]}>{fmtQ(compra.monto_total)}</Text>
                </View>

                {normalizeUpper(compra.tipo_pago) === "CREDITO" ? (
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[styles.k, { color: C.sub }]}>Saldo</Text>
                    <Text style={[styles.totalSmall, { color: C.text }]}>{fmtQ(compra.saldo_pendiente)}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* Líneas */}
            <Text style={[styles.sectionTitle, { color: C.text }]}>Productos</Text>

            {lineas.length === 0 ? (
              <View
                style={[
                  styles.cardBase,
                  styles.shadowCard,
                  { borderColor: C.border, backgroundColor: C.card, marginTop: 12 },
                ]}
              >
                <Text style={{ color: C.sub }}>Sin líneas</Text>
              </View>
            ) : (
              lineas.map((d, idx) => {
                const imgUrl = d.producto_image_path
                  ? storagePublicUrl(BUCKET, d.producto_image_path)
                  : null;

                return (
                  <View
                    key={String(d.detalle_id)}
                    style={[
                      styles.cardBase,
                      styles.shadowCard,
                      { borderColor: C.border, backgroundColor: C.card, marginTop: 12 },
                    ]}
                  >
                    <View style={styles.rowBetween}>
                      <Text style={[styles.cardTitle, { color: C.text }]} numberOfLines={2}>
                        {idx + 1}. {d.producto_nombre ?? `Producto #${d.producto_id}`}
                      </Text>
                      {!!d.producto_marca ? (
                        <Text style={[styles.brand, { color: C.sub }]} numberOfLines={1}>
                          {d.producto_marca}
                        </Text>
                      ) : null}
                    </View>

                    <View style={styles.productBody}>
                      {imgUrl ? (
                        <Image source={{ uri: imgUrl }} style={styles.photo} />
                      ) : (
                        <View
                          style={[
                            styles.photoPlaceholder,
                            { borderColor: C.border, backgroundColor: C.mutedBg },
                          ]}
                        >
                          <Text style={{ color: C.sub, fontWeight: "800", fontSize: 12 }}>
                            Sin foto
                          </Text>
                        </View>
                      )}

                      <View style={{ flex: 1 }}>
                        <View style={styles.miniRow}>
                          <Text style={[styles.miniK, { color: C.sub }]}>Lote</Text>
                          <Text style={[styles.miniV, { color: C.text }]} numberOfLines={1}>
                            {d.lote}
                          </Text>
                        </View>

                        <View style={styles.miniRow}>
                          <Text style={[styles.miniK, { color: C.sub }]}>Expira</Text>
                          <Text style={[styles.miniV, { color: C.text }]}>{fmtDate(d.fecha_exp)}</Text>
                        </View>

                        <View style={styles.miniRow}>
                          <Text style={[styles.miniK, { color: C.sub }]}>Cant.</Text>
                          <Text style={[styles.miniV, { color: C.text }]}>{d.cantidad}</Text>
                        </View>

                        <View style={styles.miniRow}>
                          <Text style={[styles.miniK, { color: C.sub }]}>Precio</Text>
                          <Text style={[styles.miniV, { color: C.text }]}>{fmtQ(d.precio_compra_unit)}</Text>
                        </View>

                        <View
                          style={[
                            styles.stockPill,
                            { backgroundColor: C.mutedBg, borderColor: C.border },
                          ]}
                        >
                          <Text style={[styles.stock, { color: C.sub }]} numberOfLines={1}>
                            Stock lote: {d.stock_total ?? "—"} (reservado {d.stock_reservado ?? "—"})
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={[styles.subtotalPill, { backgroundColor: C.mutedBg }]}>
                      <Text style={[styles.subtotalText, { color: C.text }]}>
                        Subtotal:{" "}
                        {fmtQ(d.subtotal ?? Number(d.cantidad) * Number(d.precio_compra_unit))}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}

            <View style={{ height: 12 }} />
          </ScrollView>
        )}

        {/* Bottom actions */}
        {!loading && compra ? (
          <View
            style={[
              styles.bottomBar,
              {
                backgroundColor: C.bg,
                borderTopColor: C.divider,
                paddingBottom: Math.max(12, insets.bottom),
              },
            ]}
          >
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/compra-nueva",
                  params: { editId: String(compra.id) },
                })
              }
              android_ripple={Platform.OS === "android" ? { color: "rgba(255,255,255,0.18)" } : undefined}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: C.primary },
                pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
              ]}
            >
              <Text style={styles.primaryBtnText}>Editar</Text>
            </Pressable>

            <Pressable
              onPress={eliminarCompra}
              disabled={deleting}
              android_ripple={Platform.OS === "android" ? { color: "rgba(0,0,0,0.10)" } : undefined}
              style={({ pressed }) => [
                styles.dangerBtn,
                {
                  backgroundColor: C.dangerBg,
                  borderColor: C.danger,
                  opacity: deleting ? 0.65 : 1,
                },
                pressed && Platform.OS === "ios" && !deleting ? { opacity: 0.85 } : null,
              ]}
            >
              <Text style={[styles.dangerBtnText, { color: C.danger }]}>
                {deleting ? "Eliminando..." : "Eliminar"}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  cardBase: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: 16,
  },

  // Sombra sutil (sin cambiar layout/flow)
  shadowCard: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
    },
    android: {
      elevation: 2,
    },
    default: {},
  }),

  headerCard: {
    padding: 16,
  },

  headerTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },

  h1: { fontSize: 20, fontWeight: "900", letterSpacing: -0.2 },
  meta: { marginTop: 6, fontSize: 13, fontWeight: "600" },

  badgePill: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  badgeText: { fontSize: 12, fontWeight: "900", letterSpacing: 0.2 },

  kvGrid: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  kv: { minWidth: 130 },
  k: { fontSize: 12, fontWeight: "800" },
  v: { marginTop: 3, fontSize: 14, fontWeight: "800" },
  note: { marginTop: 6, fontSize: 14, fontWeight: "700", lineHeight: 19 },

  divider: { height: StyleSheet.hairlineWidth, marginVertical: 14 },

  totalRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  total: { fontSize: 24, fontWeight: "900", marginTop: 4, letterSpacing: -0.3 },
  totalSmall: { fontSize: 16, fontWeight: "900", marginTop: 4 },

  sectionTitle: { marginTop: 16, fontSize: 18, fontWeight: "900", letterSpacing: -0.2 },

  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: "900", flex: 1, paddingRight: 10 },
  brand: { fontSize: 13, fontWeight: "800" },

  productBody: { marginTop: 12, flexDirection: "row", gap: 12, alignItems: "flex-start" },

  photo: { width: 92, height: 92, borderRadius: 16 },
  photoPlaceholder: {
    width: 92,
    height: 92,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },

  miniRow: { flexDirection: "row", justifyContent: "space-between", gap: 10, marginBottom: 6 },
  miniK: { fontSize: 12, fontWeight: "800", minWidth: 56 },
  miniV: { fontSize: 13, fontWeight: "800", flex: 1, textAlign: "right" },

  stockPill: {
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  stock: { fontSize: 12, fontWeight: "700" },

  subtotalPill: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  subtotalText: { fontSize: 14, fontWeight: "900" },

  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },

  primaryBtn: {
    borderRadius: 14,
    paddingVertical: Platform.select({ ios: 14, android: 12, default: 12 }),
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "900" },

  dangerBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: Platform.select({ ios: 14, android: 12, default: 12 }),
    alignItems: "center",
    justifyContent: "center",
  },
  dangerBtnText: { fontSize: 16, fontWeight: "900" },
});
