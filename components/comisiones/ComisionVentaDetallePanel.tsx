// components/comisiones/ComisionVentaDetallePanel.tsx
// Embeddable panel version of app/cxc-venta-detalle.tsx for the split master-detail layout.

import { useTheme } from "@react-navigation/native";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useThemePref } from "../../lib/themePreference";

type ComisionVentaDetallePanelProps = {
  ventaId: number | null;
  embedded?: boolean;
};

function fmtQ(n: string | number | null | undefined) {
  if (n == null) return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `Q ${x.toFixed(2)}`;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return String(iso).slice(0, 10);
}

function safeNumber(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

export function ComisionVentaDetallePanel({
  ventaId,
  embedded = false,
}: ComisionVentaDetallePanelProps) {
  const { colors } = useTheme();
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";
  const s = useMemo(() => styles(colors), [colors]);

  const C = useMemo(
    () => ({
      sub: colors.text + "AA",
      border: colors.border,
      divider: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)",
    }),
    [isDark, colors.text, colors.border]
  );

  const [loading, setLoading] = useState(false);
  const [row, setRow] = useState<any | null>(null);
  const [lineas, setLineas] = useState<any[]>([]);
  const [pagos, setPagos] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    if (!ventaId || !Number.isFinite(ventaId) || ventaId <= 0) {
      setRow(null);
      setLineas([]);
      setPagos([]);
      return;
    }
    setLoading(true);
    try {
      const [{ data: v }, { data: d }, { data: p }] = await Promise.all([
        supabase.from("vw_cxc_ventas").select("*").eq("venta_id", ventaId).maybeSingle(),
        supabase
          .from("ventas_detalle")
          .select(
            "id,cantidad,precio_venta_unit,subtotal,productos(nombre,marcas(nombre)),producto_lotes(lote)"
          )
          .eq("venta_id", ventaId)
          .order("id", { ascending: true }),
        supabase
          .from("ventas_pagos")
          .select("id,fecha,monto,metodo,referencia,comentario")
          .eq("venta_id", ventaId)
          .order("fecha", { ascending: false }),
      ]);
      setRow(v ?? null);
      setLineas((d ?? []) as any[]);
      setPagos((p ?? []) as any[]);
    } catch {
      setRow(null);
      setLineas([]);
      setPagos([]);
    } finally {
      setLoading(false);
    }
  }, [ventaId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const saldoNum = safeNumber(row?.saldo);
  const isPaid = saldoNum <= 0;

  const openFull = useCallback(() => {
    if (!ventaId) return;
    router.push({
      pathname: "/cxc-venta-detalle",
      params: { ventaId: String(ventaId) },
    } as any);
  }, [ventaId]);

  if (!ventaId) {
    return (
      <View style={s.center}>
        <Text style={[s.empty]}>Sin venta seleccionada</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={s.center}>
        <Text style={[s.empty]}>Cargando...</Text>
      </View>
    );
  }

  if (!row) {
    return (
      <View style={s.center}>
        <Text style={s.empty}>Venta no encontrada</Text>
      </View>
    );
  }

  const facturas = Array.isArray(row.facturas) ? row.facturas.filter(Boolean) : [];
  const factStr = facturas.length > 0 ? facturas.join(" · ") : "—";

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.background }]} edges={["bottom"]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header row */}
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.clienteNombre} numberOfLines={2}>
              {row.cliente_nombre ?? "Cliente"}
            </Text>
            <Text style={[s.sub, { marginTop: 2 }]}>Venta #{ventaId}</Text>
          </View>
          <View style={[s.badge, isPaid ? s.badgePaid : s.badgePending]}>
            <Text style={[s.badgeTxt, isPaid ? s.badgePaidTxt : s.badgePendingTxt]}>
              {isPaid ? "PAGADA" : "PENDIENTE"}
            </Text>
          </View>
        </View>

        {/* Totales */}
        <View style={s.card}>
          <KV k="Total" v={fmtQ(row.total)} s={s} />
          <KV k="Pagado" v={fmtQ(row.pagado)} s={s} />
          <KV k="Saldo" v={fmtQ(row.saldo)} s={s} />
          <KV k="Facturas" v={factStr} s={s} />
          <KV k="Fecha" v={fmtDate(row.fecha)} s={s} />
          <KV k="Fecha último pago" v={fmtDate(row.fecha_ultimo_pago)} s={s} />
          {row.vendedor_codigo ? <KV k="Vendedor" v={String(row.vendedor_codigo)} s={s} /> : null}
        </View>

        {/* Líneas de detalle */}
        {lineas.length > 0 ? (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Detalle de productos</Text>
            {lineas.map((l: any, idx: number) => {
              const nombre =
                String((l as any)?.productos?.nombre ?? "").trim() || `Producto ${idx + 1}`;
              const marca = String((l as any)?.productos?.marcas?.nombre ?? "").trim();
              const lote = String((l as any)?.producto_lotes?.lote ?? "").trim();
              const cant = safeNumber(l.cantidad);
              const price = fmtQ(l.precio_venta_unit);
              const sub = fmtQ(l.subtotal ?? cant * safeNumber(l.precio_venta_unit));
              return (
                <View
                  key={String(l.id ?? idx)}
                  style={[
                    s.lineaRow,
                    idx < lineas.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: C.divider,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.lineaNombre} numberOfLines={2}>
                      {nombre}
                      {marca ? ` · ${marca}` : ""}
                    </Text>
                    {lote ? <Text style={s.sub}>Lote: {lote}</Text> : null}
                    <Text style={s.sub}>
                      {cant} × {price}
                    </Text>
                  </View>
                  <Text style={s.lineaSub}>{sub}</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Pagos */}
        {pagos.length > 0 ? (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Pagos</Text>
            {pagos.map((p: any, idx: number) => (
              <View
                key={String(p.id ?? idx)}
                style={[
                  s.lineaRow,
                  idx < pagos.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: C.divider,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.lineaNombre}>{fmtDate(p.fecha)}</Text>
                  <Text style={s.sub}>
                    {String(p.metodo ?? "—")}
                    {p.referencia ? ` · ${p.referencia}` : ""}
                  </Text>
                  {p.comentario ? <Text style={s.sub}>{p.comentario}</Text> : null}
                </View>
                <Text style={s.lineaSub}>{fmtQ(p.monto)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Botón ver detalles completos */}
        <Pressable
          onPress={openFull}
          style={({ pressed }) => [
            s.openBtn,
            { borderColor: colors.border },
            pressed && Platform.OS === "ios" ? { opacity: 0.8 } : null,
          ]}
        >
          <Text style={[s.openBtnTxt, { color: colors.text }]}>Ver detalle completo →</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function KV({ k, v, s }: { k: string; v: string; s: ReturnType<typeof styles> }) {
  return (
    <View style={s.kvRow}>
      <Text style={s.k}>{k}</Text>
      <Text style={s.v}>{v}</Text>
    </View>
  );
}

const styles = (colors: any) =>
  StyleSheet.create({
    safe: { flex: 1 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    empty: { color: colors.text + "88", fontSize: 14, textAlign: "center" },
    content: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 24, gap: 10 },

    headerRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      marginBottom: 2,
    },
    clienteNombre: { color: colors.text, fontSize: 18, fontWeight: "800" },
    sub: { color: colors.text + "AA", fontSize: 12, marginTop: 4 },

    badge: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      overflow: "hidden",
    },
    badgePaid: { borderColor: "#7bfd9b", backgroundColor: "#BBF7D0" },
    badgePending: { borderColor: colors.border, backgroundColor: colors.card },
    badgeTxt: { fontSize: 11, fontWeight: "900" },
    badgePaidTxt: { color: "#0a2213" },
    badgePendingTxt: { color: colors.text + "BB" },

    card: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 12,
    },

    sectionTitle: { color: colors.text, fontSize: 14, fontWeight: "900", marginBottom: 8 },

    kvRow: { marginTop: 8 },
    k: { color: colors.text + "AA", fontSize: 11, fontWeight: "700" },
    v: { color: colors.text, fontSize: 15, fontWeight: "600", marginTop: 2 },

    lineaRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingVertical: 8,
      gap: 8,
    },
    lineaNombre: { color: colors.text, fontSize: 13, fontWeight: "700" },
    lineaSub: { color: colors.text, fontSize: 13, fontWeight: "800", minWidth: 70, textAlign: "right" },

    openBtn: {
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 16,
      alignItems: "center",
      backgroundColor: colors.card,
    },
    openBtnTxt: { fontSize: 14, fontWeight: "700" },
  });
