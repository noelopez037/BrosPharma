// components/ventas/VentasSolicitudesDetallePanel.tsx
// Embeddable panel version of app/cxc-venta-detalle.tsx for the split master-detail layout.
// Used in the ventas-solicitudes admin screen when canSplit is true.

import { useTheme } from "@react-navigation/native";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "../ui/app-button";
import { supabase } from "../../lib/supabase";
import { useThemePref } from "../../lib/themePreference";
import { alphaColor } from "../../lib/ui";
import { useRole } from "../../lib/useRole";

const BUCKET_COMPROBANTES = "comprobantes";
const BUCKET_VENTAS_DOCS = "Ventas-Docs";

function normalizeStoragePath(raw: string) {
  const p = String(raw ?? "").trim();
  if (!p) return "";
  let clean = p.startsWith("/") ? p.slice(1) : p;
  const pref = `${BUCKET_VENTAS_DOCS}/`;
  if (clean.startsWith(pref)) clean = clean.slice(pref.length);
  return clean;
}

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

function safeNumber(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function shortUid(u: string | null | undefined) {
  const s = String(u ?? "").trim();
  if (!s) return "—";
  return s.slice(0, 8);
}

type VentasSolicitudesDetallePanelProps = {
  ventaId: number | null;
  embedded?: boolean;
};

export function VentasSolicitudesDetallePanel({
  ventaId,
  embedded = false,
}: VentasSolicitudesDetallePanelProps) {
  if (!ventaId) return null;
  return <VentasSolicitudesDetallePanelContent ventaIdProp={ventaId} embedded={embedded} />;
}

type ContentProps = {
  ventaIdProp: number;
  embedded: boolean;
};

function VentasSolicitudesDetallePanelContent({ ventaIdProp, embedded }: ContentProps) {
  const id = ventaIdProp;
  const { colors } = useTheme();
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  const C = useMemo(
    () => ({
      bg: colors.background ?? (isDark ? "#000" : "#fff"),
      card: colors.card ?? (isDark ? "#1C1C1E" : "#fff"),
      text: colors.text ?? (isDark ? "#fff" : "#111"),
      sub: alphaColor(String(colors.text ?? (isDark ? "#ffffff" : "#000000")), 0.65) || (isDark ? "rgba(255,255,255,0.65)" : "#6b7280"),
      border: colors.border ?? (isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)"),
      primary: String(colors.primary ?? "#153c9e"),
      ok: isDark ? "rgba(140,255,170,0.95)" : "#16a34a",
      warn: isDark ? "rgba(255,210,120,0.95)" : "#b45309",
      okBg: isDark ? "rgba(22,163,74,0.18)" : "rgba(22,163,74,0.10)",
      warnBg: isDark ? "rgba(180,83,9,0.18)" : "rgba(180,83,9,0.10)",
      mutedBg: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
      divider: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)",
    }),
    [isDark, colors.background, colors.border, colors.card, colors.primary, colors.text]
  );

  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<any | null>(null);
  const [lineas, setLineas] = useState<any[]>([]);
  const [pagos, setPagos] = useState<any[]>([]);
  const [pagosReportadosPendientes, setPagosReportadosPendientes] = useState<any[]>([]);
  const [actingPagoReportadoId, setActingPagoReportadoId] = useState<number | null>(null);
  const [facturas, setFacturas] = useState<any[]>([]);
  const [vendedorDisplay, setVendedorDisplay] = useState<string>("");

  const { role } = useRole();
  const roleNormalized = normalizeUpper(role);
  const isAdmin = roleNormalized === "ADMIN";

  const fetchAll = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) return;
    setLoading(true);
    try {
      const { data: v } = await supabase
        .from("vw_cxc_ventas")
        .select("*")
        .eq("venta_id", id)
        .maybeSingle();
      setRow(v as any);

      const { data: d } = await supabase
        .from("ventas_detalle")
        .select(
          "id,venta_id,producto_id,lote_id,cantidad,precio_venta_unit,subtotal,producto_lotes(lote,fecha_exp),productos(nombre,marcas(nombre))"
        )
        .eq("venta_id", id)
        .order("id", { ascending: true });
      setLineas((d ?? []) as any[]);

      const { data: f } = await supabase
        .from("ventas_facturas")
        .select(
          "id,venta_id,tipo,path,numero_factura,original_name,size_bytes,created_at,monto_total,fecha_vencimiento"
        )
        .eq("venta_id", id)
        .order("created_at", { ascending: false });
      const frows = (f ?? []).map((r: any) => ({ ...r, path: normalizeStoragePath(r.path) }));
      setFacturas(frows);

      const { data: p } = await supabase
        .from("ventas_pagos")
        .select(
          "id,venta_id,factura_id,fecha,monto,metodo,referencia,comprobante_path,comentario,created_by"
        )
        .eq("venta_id", id)
        .order("fecha", { ascending: false });
      setPagos((p ?? []) as any[]);

      if (isAdmin) {
        const { data: pr } = await supabase
          .from("ventas_pagos_reportados")
          .select(
            "id,venta_id,factura_id,fecha_reportado,created_at,monto,metodo,referencia,comprobante_path,comentario,created_by,estado"
          )
          .eq("venta_id", id)
          .eq("estado", "PENDIENTE")
          .order("created_at", { ascending: false });
        setPagosReportadosPendientes((pr ?? []) as any[]);
      } else {
        setPagosReportadosPendientes([]);
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo cargar");
      setRow(null);
      setLineas([]);
      setPagos([]);
      setFacturas([]);
      setPagosReportadosPendientes([]);
    } finally {
      setLoading(false);
    }
  }, [id, isAdmin]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const vid = row?.vendedor_id ?? null;
    const codigo = String(row?.vendedor_codigo ?? "").trim();
    if (!vid) {
      setVendedorDisplay(codigo || "—");
      return;
    }

    let alive = true;
    setVendedorDisplay(codigo || shortUid(vid));

    (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("full_name,codigo")
          .eq("id", vid)
          .maybeSingle();
        if (error) throw error;
        const display =
          String(data?.codigo ?? "").trim() ||
          String(data?.full_name ?? "").trim() ||
          codigo ||
          shortUid(vid);
        if (alive) setVendedorDisplay(display);
      } catch {
        // keep previous display
      }
    })();

    return () => {
      alive = false;
    };
  }, [row?.vendedor_id, row?.vendedor_codigo]);

  const saldoNum = useMemo(() => safeNumber(row?.saldo), [row?.saldo]);

  const totalProductos = useMemo(() => {
    return (lineas ?? []).reduce((acc: number, d: any) => {
      const sub = d?.subtotal ?? safeNumber(d?.cantidad) * safeNumber(d?.precio_venta_unit);
      return acc + safeNumber(sub);
    }, 0);
  }, [lineas]);

  const facturasById = useMemo(() => {
    const m = new Map<number, any>();
    for (const f of facturas ?? []) {
      const fid = Number((f as any)?.id);
      if (Number.isFinite(fid) && fid > 0) m.set(fid, f);
    }
    return m;
  }, [facturas]);

  const pagadoPorFacturaId = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of pagos ?? []) {
      const fid = p?.factura_id == null ? NaN : Number(p.factura_id);
      if (!Number.isFinite(fid) || fid <= 0) continue;
      const monto = safeNumber(p?.monto);
      m.set(fid, (m.get(fid) ?? 0) + monto);
    }
    return m;
  }, [pagos]);

  const facturaMonto = useCallback(
    (f: any): number | null => {
      const montoRaw = f?.monto_total;
      const m = montoRaw == null ? NaN : safeNumber(montoRaw);
      if (Number.isFinite(m) && m > 0) return m;
      if ((facturas?.length ?? 0) === 1) {
        const t = safeNumber(row?.total ?? totalProductos);
        if (Number.isFinite(t) && t > 0) return t;
      }
      return null;
    },
    [facturas?.length, row?.total, totalProductos]
  );

  const openComprobante = useCallback(async (raw: string) => {
    const p = (raw ?? "").trim();
    if (!p) return;

    try {
      let signedUrl: string | null = null;

      if (p.startsWith("http://") || p.startsWith("https://")) {
        signedUrl = p;
      } else {
        let clean = p.startsWith("/") ? p.slice(1) : p;
        const pref = `${BUCKET_COMPROBANTES}/`;
        if (clean.startsWith(pref)) clean = clean.slice(pref.length);
        const { data, error } = await supabase.storage
          .from(BUCKET_COMPROBANTES)
          .createSignedUrl(clean, 60 * 10);
        if (error) throw error;
        signedUrl = data?.signedUrl ?? null;
      }

      if (!signedUrl) throw new Error("No se pudo generar URL del comprobante.");

      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.open(signedUrl, "_blank");
      } else {
        await WebBrowser.openBrowserAsync(signedUrl);
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo abrir el comprobante");
    }
  }, []);

  const openFacturaPdf = useCallback(async (pathRaw: string) => {
    const path = normalizeStoragePath(pathRaw);
    if (!path) return;
    try {
      const { data: s, error: se } = await supabase.storage
        .from(BUCKET_VENTAS_DOCS)
        .createSignedUrl(path, 60 * 15);
      if (se) throw se;
      const url = (s as any)?.signedUrl ?? null;
      if (!url) throw new Error("No se pudo abrir el PDF");

      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.open(url, "_blank");
      } else {
        await WebBrowser.openBrowserAsync(url);
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo abrir el PDF");
    }
  }, []);

  const runPagoReportadoAction = useCallback(
    async (p: any, action: "aprobar" | "rechazar") => {
      const pid = Number(p?.id);
      if (!Number.isFinite(pid) || pid <= 0) return;
      setActingPagoReportadoId(pid);
      try {
        if (action === "aprobar") {
          const { error } = await supabase.rpc("rpc_venta_aprobar_pago_reportado", {
            p_pago_reportado_id: pid,
          });
          if (error) throw error;
          Alert.alert("Listo", "Pago reportado aprobado.");
        } else {
          const { error } = await supabase.rpc("rpc_venta_rechazar_pago_reportado", {
            p_pago_reportado_id: pid,
            p_nota_admin: "Rechazado por admin",
          });
          if (error) throw error;
          Alert.alert("Listo", "Pago reportado rechazado.");
        }
        await fetchAll();
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "No se pudo actualizar el pago reportado");
      } finally {
        setActingPagoReportadoId(null);
      }
    },
    [fetchAll]
  );

  const handleAprobarPagoReportado = useCallback(
    (p: any) => void runPagoReportadoAction(p, "aprobar"),
    [runPagoReportadoAction]
  );

  const handleRechazarPagoReportado = useCallback(
    (p: any) => {
      Alert.alert(
        "Rechazar pago",
        `¿Deseas rechazar el pago reportado del ${fmtDate(p?.fecha_reportado ?? p?.created_at)} por ${fmtQ(p?.monto)}?`,
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Rechazar",
            style: "destructive",
            onPress: () => void runPagoReportadoAction(p, "rechazar"),
          },
        ]
      );
    },
    [runPagoReportadoAction]
  );

  const confirmDeletePago = useCallback(
    (p: any) => {
      const refInfo = p.referencia ? `\nRef: ${p.referencia}` : "";
      Alert.alert(
        "Eliminar pago",
        `Se eliminará el pago del ${fmtDate(p.fecha)} por ${fmtQ(p.monto)}.${refInfo}`,
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Eliminar",
            style: "destructive",
            onPress: async () => {
              try {
                const { error } = await supabase
                  .from("ventas_pagos")
                  .delete()
                  .eq("id", p.id);
                if (error) throw error;
                await fetchAll();
              } catch (e: any) {
                Alert.alert("Error", e?.message ?? "No se pudo eliminar");
              }
            },
          },
        ]
      );
    },
    [fetchAll]
  );

  const content = (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: 40 }}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >
      {/* Header card */}
      <View style={[styles.cardBase, styles.headerCard, { borderColor: C.border, backgroundColor: C.card }]}>
        <View style={styles.headerTop}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.h1, { color: C.text }]} numberOfLines={2}>
              {row?.cliente_nombre ?? `Cliente #${row?.cliente_id}`}
            </Text>
          </View>

          <View
            style={[
              styles.badgePill,
              {
                backgroundColor: saldoNum <= 0 ? C.okBg : C.warnBg,
                borderColor:
                  alphaColor(saldoNum <= 0 ? C.ok : C.warn, isDark ? 0.32 : 0.22) || C.border,
              },
            ]}
          >
            <Text style={[styles.badgeText, { color: saldoNum <= 0 ? C.ok : C.warn }]}>
              {saldoNum <= 0 ? "PAGADA" : "PENDIENTE"}
            </Text>
          </View>
        </View>

        <View style={[styles.kvGrid, { marginTop: 12 }]}>
          <View style={styles.kv}>
            <Text style={[styles.k, { color: C.sub }]}>Fecha de emisión</Text>
            <Text style={[styles.v, { color: C.text }]} numberOfLines={1}>
              {fmtDate(row?.fecha)}
            </Text>
          </View>
          <View style={styles.kv}>
            <Text style={[styles.k, { color: C.sub }]}>Vencimiento</Text>
            <Text style={[styles.v, { color: C.text }]} numberOfLines={1}>
              {fmtDate(row?.fecha_vencimiento)}
            </Text>
          </View>
          <View style={styles.kv}>
            <Text style={[styles.k, { color: C.sub }]}>Vendedor</Text>
            <Text style={[styles.v, { color: C.text }]} numberOfLines={1}>
              {vendedorDisplay || shortUid(row?.vendedor_id)}
            </Text>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: C.divider }]} />

        <View style={styles.kvGrid}>
          <View style={styles.kv}>
            <Text style={[styles.k, { color: C.sub }]}>Total</Text>
            <Text style={[styles.v, { color: C.text }]}>{fmtQ(row?.total)}</Text>
          </View>
          <View style={styles.kv}>
            <Text style={[styles.k, { color: C.sub }]}>Pagado</Text>
            <Text style={[styles.v, { color: C.text }]}>{fmtQ(row?.pagado)}</Text>
          </View>
          <View style={styles.kv}>
            <Text style={[styles.k, { color: C.sub }]}>Saldo</Text>
            <Text style={[styles.v, { color: C.text }]}>{fmtQ(row?.saldo)}</Text>
          </View>
        </View>
      </View>

      {/* Productos */}
      <Text style={[styles.sectionTitle, { color: C.text }]}>Productos</Text>
      {lineas.length === 0 ? (
        <View
          style={[styles.cardBase, { borderColor: C.border, backgroundColor: C.card, marginTop: 12 }]}
        >
          <Text style={{ color: C.sub }}>Sin líneas</Text>
        </View>
      ) : (
        <View
          style={[
            styles.tableWrap,
            { borderColor: C.border, backgroundColor: C.card, marginTop: 12 },
          ]}
        >
          <View
            style={[
              styles.tableHeaderRow,
              { borderBottomColor: C.divider, backgroundColor: C.mutedBg },
            ]}
          >
            <Text style={[styles.th, { color: C.sub, flex: 1 }]}>Detalle</Text>
            <Text style={[styles.th, { color: C.sub, width: 140, textAlign: "right" }]}>
              Importe
            </Text>
          </View>

          {lineas.map((d: any) => {
            const nombre = d.productos?.nombre ?? `Producto #${d.producto_id}`;
            const marca =
              d.productos?.marcas?.nombre ?? d.productos?.marcas?.[0]?.nombre ?? null;
            const title = `${String(nombre ?? "—")}${marca ? ` • ${marca}` : ""}`;
            const lote = d.producto_lotes?.lote ?? "—";
            const venc = fmtDate(d.producto_lotes?.fecha_exp);
            const cant = safeNumber(d.cantidad);
            const unit = safeNumber(d.precio_venta_unit);

            return (
              <View
                key={String(d.id)}
                style={[styles.tableRow, { borderTopColor: C.divider }]}
              >
                <View style={{ flex: 1, paddingRight: 10, minWidth: 0 }}>
                  <Text style={[styles.td, { color: C.text }]} numberOfLines={1}>
                    {title}
                  </Text>
                  <Text style={[styles.tdSub, { color: C.sub }]} numberOfLines={1}>
                    Lote: {lote}
                  </Text>
                  <Text style={[styles.tdSub, { color: C.sub }]} numberOfLines={1}>
                    Venc: {venc}
                  </Text>
                </View>

                <View style={{ width: 140, paddingLeft: 8, alignItems: "flex-end" }}>
                  <Text style={[styles.td, { color: C.text }]} numberOfLines={1}>
                    {cant} x {fmtQ(unit)}
                  </Text>
                </View>
              </View>
            );
          })}

          <View
            style={[
              styles.tableFooterRow,
              { borderTopColor: C.divider, backgroundColor: C.mutedBg },
            ]}
          >
            <Text style={[styles.td, { color: C.sub, flex: 1 }]}>Total</Text>
            <Text style={[styles.td, { color: C.text, width: 140, textAlign: "right" }]}>
              {fmtQ(row?.total ?? totalProductos)}
            </Text>
          </View>
        </View>
      )}

      {/* Facturas */}
      <Text style={[styles.sectionTitle, { color: C.text }]}>Facturas</Text>
      <View
        style={[
          styles.cardBase,
          { borderColor: C.border, backgroundColor: C.card, marginTop: 12 },
        ]}
      >
        {facturas.length === 0 ? (
          <Text style={{ color: C.sub }}>—</Text>
        ) : (
          facturas.slice(0, 2).map((f: any) => (
            <View key={String(f.id)} style={{ paddingVertical: 10 }}>
              <View style={styles.rowBetween}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "baseline",
                    gap: 10,
                    flex: 1,
                    minWidth: 0,
                    paddingRight: 10,
                  }}
                >
                  <Text
                    selectable
                    style={[styles.payTitle, { color: C.text }]}
                    numberOfLines={1}
                  >
                    {String(f.numero_factura ?? "—")}
                  </Text>

                  {(() => {
                    const monto = facturaMonto(f);
                    return monto != null ? (
                      <Text style={[styles.payAmount, { color: C.text }]} numberOfLines={1}>
                        {fmtQ(monto)}
                      </Text>
                    ) : null;
                  })()}
                </View>

                <Pressable
                  onPress={() =>
                    openFacturaPdf(String(f.path ?? "")).catch((e: any) =>
                      Alert.alert("Error", e?.message ?? "No se pudo abrir")
                    )
                  }
                  style={({ pressed }) => [
                    styles.linkBtnSmall,
                    { borderColor: C.border, backgroundColor: C.mutedBg },
                    pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
                  ]}
                >
                  <Text style={[styles.linkBtnTextSmall, { color: C.text }]}>Ver PDF</Text>
                </Pressable>
              </View>
              <View style={[styles.divider, { backgroundColor: C.divider }]} />
            </View>
          ))
        )}
      </View>

      {/* Pagos reportados pendientes — admin only */}
      {isAdmin ? (
        <>
          <Text style={[styles.sectionTitle, { color: C.text }]}>
            Pagos reportados (pendientes)
          </Text>
          <View
            style={[
              styles.cardBase,
              { borderColor: C.border, backgroundColor: C.card, marginTop: 12 },
            ]}
          >
            {pagosReportadosPendientes.length === 0 ? (
              <Text style={{ color: C.sub }}>Sin pagos reportados pendientes</Text>
            ) : (
              pagosReportadosPendientes.map((p: any) => {
                const comprobanteRaw = String(p.comprobante_path ?? "").trim();
                const hasComprobante = !!comprobanteRaw;
                const disabled = actingPagoReportadoId === Number(p.id);
                return (
                  <View key={String(p.id)} style={{ paddingVertical: 10 }}>
                    <View style={styles.rowBetween}>
                      <Text style={[styles.payTitle, { color: C.text }]}>
                        {fmtDate(p.fecha_reportado ?? p.created_at)} · {p.metodo ?? "—"}
                      </Text>
                      <Text style={[styles.payAmount, { color: C.text }]}>
                        {fmtQ(p.monto)}
                      </Text>
                    </View>
                    {!!p.referencia ? (
                      <Text style={[styles.payMeta, { color: C.sub }]}>
                        Ref: {p.referencia}
                      </Text>
                    ) : null}
                    {!!p.comentario ? (
                      <Text style={[styles.payMeta, { color: C.sub }]}>{p.comentario}</Text>
                    ) : null}

                    <View style={{ marginTop: 12 }}>
                      {hasComprobante ? (
                        <AppButton
                          title="Ver comprobante"
                          size="sm"
                          variant="outline"
                          style={{ width: "100%" } as any}
                          onPress={() => openComprobante(comprobanteRaw)}
                        />
                      ) : null}

                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          marginTop: 12,
                        }}
                      >
                        <AppButton
                          title="Aprobar"
                          size="sm"
                          variant="primary"
                          style={{ flex: 1 } as any}
                          onPress={() => handleAprobarPagoReportado(p)}
                          disabled={disabled}
                        />
                        <View style={{ width: 12 }} />
                        <AppButton
                          title="Rechazar"
                          size="sm"
                          variant="outline"
                          style={{ flex: 1, borderColor: "#E53935" } as any}
                          textStyle={{ color: "#E53935" } as any}
                          onPress={() => handleRechazarPagoReportado(p)}
                          disabled={disabled}
                        />
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </>
      ) : null}

      {/* Pagos */}
      <Text style={[styles.sectionTitle, { color: C.text }]}>Pagos</Text>
      <View
        style={[
          styles.cardBase,
          { borderColor: C.border, backgroundColor: C.card, marginTop: 12 },
        ]}
      >
        {pagos.length === 0 ? (
          <Text style={{ color: C.sub }}>Sin pagos registrados</Text>
        ) : (
          pagos.map((p: any) => {
            const comprobanteRaw = String(p.comprobante_path ?? "").trim();
            const hasComprobante = !!comprobanteRaw;
            const canDeletePago = isAdmin;
            const pfid = p?.factura_id == null ? null : Number(p.factura_id);
            const pf = pfid ? (facturasById.get(pfid) ?? null) : null;
            const facturaNum = pf ? String(pf?.numero_factura ?? "").trim() : "";

            return (
              <View key={String(p.id)} style={{ paddingVertical: 10 }}>
                <View style={styles.rowBetween}>
                  <Text style={[styles.payTitle, { color: C.text }]}>
                    {fmtDate(p.fecha)} · {p.metodo ?? "—"}
                  </Text>
                  <Text style={[styles.payAmount, { color: C.text }]}>{fmtQ(p.monto)}</Text>
                </View>
                {pfid ? (
                  <Text style={[styles.payMeta, { color: C.sub }]}>
                    Factura: {facturaNum || `#${pfid}`}
                  </Text>
                ) : null}
                {!!p.referencia ? (
                  <Text style={[styles.payMeta, { color: C.sub }]}>
                    Ref: {p.referencia}
                  </Text>
                ) : null}
                {!!p.comentario ? (
                  <Text style={[styles.payMeta, { color: C.sub }]}>{p.comentario}</Text>
                ) : null}

                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 10,
                    marginTop: hasComprobante || canDeletePago ? 10 : 0,
                  }}
                >
                  {hasComprobante ? (
                    <AppButton
                      title="Ver comprobante"
                      size="sm"
                      variant="outline"
                      onPress={() => openComprobante(comprobanteRaw)}
                    />
                  ) : null}

                  {canDeletePago ? (
                    <AppButton
                      title="Eliminar pago"
                      size="sm"
                      variant="danger"
                      onPress={() => confirmDeletePago(p)}
                    />
                  ) : null}
                </View>
              </View>
            );
          })
        )}

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={[styles.k, { color: C.sub }]}>Saldo pendiente</Text>
          <Text style={[styles.v, { color: C.text }]}>{fmtQ(row?.saldo)}</Text>
        </View>
      </View>

      <View style={{ height: 12 }} />
    </ScrollView>
  );

  if (embedded) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
        {loading ? (
          <View style={styles.center}>
            <Text style={{ color: C.sub, fontWeight: "700" }}>Cargando...</Text>
          </View>
        ) : !row ? (
          <View style={styles.center}>
            <Text style={{ color: C.text }}>No disponible</Text>
          </View>
        ) : (
          content
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
      {loading ? (
        <View style={styles.center}>
          <Text style={{ color: C.sub, fontWeight: "700" }}>Cargando...</Text>
        </View>
      ) : !row ? (
        <View style={styles.center}>
          <Text style={{ color: C.text }}>No disponible</Text>
        </View>
      ) : (
        content
      )}
    </SafeAreaView>
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
  headerCard: { padding: 16 },
  headerTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  h1: { fontSize: 20, fontWeight: "700", letterSpacing: -0.2, lineHeight: 24 },
  badgePill: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  kvGrid: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  kv: { minWidth: 140, flexBasis: 140, flexGrow: 1 },
  k: { fontSize: 12, fontWeight: "600" },
  v: { marginTop: 3, fontSize: 14, fontWeight: "600", lineHeight: 18 },
  sectionTitle: {
    marginTop: 18,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 14 },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  tableWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    overflow: "hidden",
  },
  tableHeaderRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tableFooterRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  th: { fontSize: 11, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  td: { fontSize: 13, fontWeight: "800" },
  tdSub: { marginTop: 2, fontSize: 12, fontWeight: "700" },
  payTitle: { fontSize: 14, fontWeight: "700", flex: 1, paddingRight: 8 },
  payAmount: { fontSize: 14, fontWeight: "800" },
  payMeta: { marginTop: 4, fontSize: 12, fontWeight: "600" },
  linkBtnSmall: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
  },
  linkBtnTextSmall: { fontSize: 12, fontWeight: "700" },
});
