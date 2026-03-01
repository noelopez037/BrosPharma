import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack, router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
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

import { RoleGate } from "../../components/auth/RoleGate";
import { AppButton } from "../../components/ui/app-button";
import { navigateToVentaFromNotif } from "../../lib/notifNavigation";
import { emitSolicitudesChanged } from "../../lib/solicitudesEvents";
import { supabase } from "../../lib/supabase";
import { useThemePref } from "../../lib/themePreference";
import { alphaColor } from "../../lib/ui";
import { useGoHomeOnBack } from "../../lib/useGoHomeOnBack";
import { useRole } from "../../lib/useRole";
import { FB_DARK_DANGER } from "../../src/theme/headerColors";

type Role = "ADMIN" | "VENTAS" | "BODEGA" | "FACTURACION" | "";

type SolicitudRow = {
  venta_id: number;
  fecha: string | null;
  estado: string | null;
  cliente_nombre: string | null;
  vendedor_id: string | null;

  solicitud_tag: string | null;
  solicitud_accion: "ANULACION" | "EDICION" | "REFACTURACION" | null;
  solicitud_nota: string | null;
  solicitud_at: string | null;
  solicitud_by: string | null;
};

type PagoReportadoRow = {
  id: number;
  venta_id: number;
  factura_id: number | null;
  fecha_reportado: string | null;
  created_at: string | null;
  monto: number | null;
  metodo: string | null;
  referencia: string | null;
  comentario: string | null;
  comprobante_path: string | null;
  created_by: string | null;
  estado: string | null;
};

function normalizeUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  // yyyy-mm-dd hh:mm
  const s = String(iso).replace("T", " ");
  return s.slice(0, 16);
}

function fmtQ(n: number | string | null | undefined) {
  if (n == null) return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `Q ${x.toFixed(2)}`;
}

function actionLabel(a: SolicitudRow["solicitud_accion"]) {
  if (a === "ANULACION") return "Anulacion";
  if (a === "EDICION") return "Edicion";
  if (a === "REFACTURACION") return "Refacturacion";
  return "Solicitud";
}

function isPaymentEditRequest(row: SolicitudRow | null | undefined) {
  if (!row) return false;
  const acc = normalizeUpper(row.solicitud_accion);
  const note = String(row.solicitud_nota ?? "").toUpperCase();
  const tag = String(row.solicitud_tag ?? "").toUpperCase();

  // Prefer explicit tag/note containing PAGO
  if (tag.includes("PAGO") || note.includes("PAGO") || note.startsWith("PAGO:") || note.includes("EDITAR PAGO")) return true;
  // fallback: accion EDICION might be general; prefer note/tag-based detection
  return false;
}

function actionTone(a: SolicitudRow["solicitud_accion"]) {
  if (a === "EDICION") return "amber" as const;
  if (a === "REFACTURACION") return "amber" as const;
  return "red" as const;
}

export default function VentasSolicitudesScreen() {
  const { colors } = useTheme();
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  // UX: swipe-back / back siempre regresa a Inicio.
  useGoHomeOnBack(true, "/(drawer)/(tabs)");

  const C = useMemo(
    () => ({
      bg: colors.background ?? (isDark ? "#000" : "#fff"),
      card: colors.card ?? (isDark ? "#121214" : "#fff"),
      text: colors.text ?? (isDark ? "#fff" : "#111"),
      sub:
        alphaColor(String(colors.text ?? (isDark ? "#ffffff" : "#000000")), 0.65) ||
        (isDark ? "rgba(255,255,255,0.65)" : "#666"),
      border: colors.border ?? (isDark ? "rgba(255,255,255,0.14)" : "#e5e5e5"),
      danger: FB_DARK_DANGER,
      amber: isDark ? "rgba(255,201,107,0.92)" : "#b25a00",
      pillRedBg: isDark ? "rgba(255,90,90,0.18)" : "rgba(220,0,0,0.10)",
      pillAmberBg: isDark ? "rgba(255,201,107,0.18)" : "rgba(255,170,0,0.12)",
    }),
    [colors.background, colors.border, colors.card, colors.text, isDark]
  );

  const { role, isReady, refreshRole } = useRole();

  const roleUp = normalizeUpper(role) as Role;
  const canView = isReady && roleUp === "ADMIN";
  const canResolve = isReady && roleUp === "ADMIN";
  const [q, setQ] = useState("");

  const [rowsRaw, setRowsRaw] = useState<SolicitudRow[]>([]);
  const [vendedoresById, setVendedoresById] = useState<Record<string, { codigo: string | null; nombre: string | null }>>({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [actingVentaId, setActingVentaId] = useState<number | null>(null);
  const [pagosPendientesRaw, setPagosPendientesRaw] = useState<PagoReportadoRow[]>([]);
  const [initialLoadingPagos, setInitialLoadingPagos] = useState(true);
  const [actingPagoReportadoId, setActingPagoReportadoId] = useState<number | null>(null);
  const [ventasInfoById, setVentasInfoById] = useState<
    Record<string, { cliente_nombre: string | null; vendedor_id: string | null; vendedor_codigo: string | null }>
  >({});

  const fetchSolicitudes = useCallback(async () => {
    const { data, error } = await supabase
      .from("vw_ventas_solicitudes_pendientes_admin")
      .select(
        "venta_id,fecha,estado,cliente_nombre,vendedor_id,solicitud_tag,solicitud_accion,solicitud_nota,solicitud_at,solicitud_by"
      )
      .order("solicitud_at", { ascending: false })
      .limit(300);
    if (error) throw error;
    setRowsRaw((data ?? []) as any);
  }, []);

  const fetchPagosPendientes = useCallback(async () => {
    const { data, error } = await supabase
      .from("ventas_pagos_reportados")
      .select(
        "id,venta_id,factura_id,fecha_reportado,created_at,monto,metodo,referencia,comentario,comprobante_path,created_by,estado"
      )
      .eq("estado", "PENDIENTE")
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) throw error;
    setPagosPendientesRaw((data ?? []) as any);
  }, []);

  const reloadAll = useCallback(async () => {
    if (!isReady || roleUp !== "ADMIN") return;
    setInitialLoading(true);
    setInitialLoadingPagos(true);
    try {
      await Promise.all([fetchSolicitudes(), fetchPagosPendientes()]);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudieron cargar solicitudes");
      setRowsRaw([]);
      setPagosPendientesRaw([]);
    } finally {
      setInitialLoading(false);
      setInitialLoadingPagos(false);
    }
  }, [fetchPagosPendientes, fetchSolicitudes, isReady, roleUp]);

  useFocusEffect(
    useCallback(() => {
      void refreshRole("focus:ventas-solicitudes");
      void reloadAll(); // Fix 1: single fetch path — useFocusEffect covers mount + focus
    }, [refreshRole, reloadAll])
  );

  const rows = useMemo(() => {
    const search = q.trim().toLowerCase();
    if (!search) return rowsRaw;
    return rowsRaw.filter((r) => {
      const id = String(r.venta_id ?? "");
      const cliente = String(r.cliente_nombre ?? "").toLowerCase();
      const nota = String(r.solicitud_nota ?? "").toLowerCase();
      return id.includes(search) || cliente.includes(search) || nota.includes(search);
    });
  }, [q, rowsRaw]);

  const pagosPendientes = useMemo(() => {
    const search = q.trim().toLowerCase();
    if (!search) return pagosPendientesRaw;
    return pagosPendientesRaw.filter((p) => {
      const venta = String(p.venta_id ?? "");
      const ref = String(p.referencia ?? "").toLowerCase();
      const comentario = String(p.comentario ?? "").toLowerCase();
      return venta.includes(search) || ref.includes(search) || comentario.includes(search);
    });
  }, [pagosPendientesRaw, q]);

  // Fix 3: stable derived IDs — only changes when the actual set of venta_ids changes
  const ventaIdsPagos = useMemo(
    () =>
      Array.from(
        new Set(
          pagosPendientesRaw
            .map((p) => (p.venta_id == null ? null : Number(p.venta_id)))
            .filter((id): id is number => typeof id === "number" && Number.isFinite(id))
        )
      ),
    [pagosPendientesRaw]
  );

  useEffect(() => {
    const ventaIds = ventaIdsPagos; // Fix 3: use memoized IDs

    if (!ventaIds.length) {
      setVentasInfoById({});
      return;
    }

    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("vw_cxc_ventas")
          .select("venta_id,cliente_nombre,vendedor_id,vendedor_codigo")
          .in("venta_id", ventaIds);
        if (error) throw error;

        const map: Record<
          string,
          { cliente_nombre: string | null; vendedor_id: string | null; vendedor_codigo: string | null }
        > = {};
        (data ?? []).forEach((row: any) => {
          const id = String(row?.venta_id ?? "").trim();
          if (!id) return;
          map[id] = {
            cliente_nombre: row?.cliente_nombre ?? null,
            vendedor_id: row?.vendedor_id == null ? null : String(row.vendedor_id),
            vendedor_codigo: row?.vendedor_codigo == null ? null : String(row.vendedor_codigo),
          };
        });
        if (alive) setVentasInfoById(map);
      } catch (e) {
        if (alive) setVentasInfoById({});
      }
    })();

    return () => {
      alive = false;
    };
  }, [ventaIdsPagos]); // Fix 3: depend on stable memoized array reference

  useEffect(() => {
    const ids = Array.from(
      new Set(
        rowsRaw
          .map((r) => String(r.vendedor_id ?? "").trim())
          .filter((x) => x)
      )
    );
    if (!ids.length) {
      setVendedoresById({});
      return;
    }

    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id,codigo,full_name")
          .in("id", ids);
        if (error) throw error;

        const map: Record<string, { codigo: string | null; nombre: string | null }> = {};
        (data ?? []).forEach((p: any) => {
          const id = String(p.id ?? "").trim();
          if (!id) return;
          map[id] = {
            codigo: p.codigo == null ? null : String(p.codigo),
            nombre: p.full_name == null ? null : String(p.full_name),
          };
        });
        if (alive) setVendedoresById(map);
      } catch {
        if (alive) setVendedoresById({});
      }
    })();

    return () => {
      alive = false;
    };
  }, [rowsRaw]);

  const resolve = useCallback(
    async (ventaId: number, decision: "APROBAR" | "RECHAZAR") => {
      if (!canResolve) return;
      setActingVentaId(ventaId);
      try {
        const { error } = await supabase.rpc("rpc_admin_resolver_solicitud", {
          p_venta_id: Number(ventaId),
          p_decision: decision,
        });
        if (error) throw error;
        // If approved and the request is for payment edit, grant edit permission to the vendedor
        if (decision === "APROBAR") {
          try {
            const sol = rowsRaw.find((r) => Number(r.venta_id) === Number(ventaId));
            if (isPaymentEditRequest(sol) && sol?.vendedor_id) {
              const { error: grantErr } = await supabase.rpc("rpc_admin_otorgar_edicion_pago", {
                p_venta_id: Number(ventaId),
                p_otorgado_a: String(sol.vendedor_id),
                p_horas: 48,
              });
              if (grantErr) {
                // non-blocking: warn admin
                Alert.alert("Aviso", `Solicitud aprobada pero no se pudo otorgar permiso: ${grantErr.message || grantErr}`);
              }
            }
          } catch (e: any) {
            // ignore grant errors
            console.warn("grant permiso error", e?.message ?? e);
          }
        }
        await fetchSolicitudes();
        emitSolicitudesChanged();
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "No se pudo resolver la solicitud");
      } finally {
        setActingVentaId(null);
      }
    },
    [canResolve, fetchSolicitudes, rowsRaw] // Fix 2: rowsRaw added to prevent stale closure
  );

  const confirmResolve = useCallback(
    (ventaId: number, decision: "APROBAR" | "RECHAZAR") => {
      if (!canResolve) return;
      const title = decision === "APROBAR" ? "Aprobar solicitud" : "Rechazar solicitud";
      const msg =
        decision === "APROBAR"
          ? "Esto enviara la accion a la cola correspondiente."
          : "Esto cerrara la solicitud sin ejecutar cambios.";
      Alert.alert(title, msg, [
        { text: "Cancelar", style: "cancel" },
        {
          text: decision === "APROBAR" ? "Aprobar" : "Rechazar",
          style: decision === "RECHAZAR" ? "destructive" : "default",
          onPress: () => {
            resolve(ventaId, decision).catch(() => {});
          },
        },
      ]);
    },
    [canResolve, resolve]
  );

  const handlePagoAccion = useCallback(
    async (pago: PagoReportadoRow, decision: "APROBAR" | "RECHAZAR") => {
      if (!canResolve) return;
      setActingPagoReportadoId(pago.id);
      try {
        if (decision === "APROBAR") {
          const { error } = await supabase.rpc("rpc_venta_aprobar_pago_reportado", {
            p_pago_reportado_id: pago.id,
          });
          if (error) throw error;
        } else {
          const { error } = await supabase.rpc("rpc_venta_rechazar_pago_reportado", {
            p_pago_reportado_id: pago.id,
            p_nota_admin: "Rechazado por admin",
          });
          if (error) throw error;
        }
        await Promise.all([fetchSolicitudes(), fetchPagosPendientes()]);
        emitSolicitudesChanged();
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "No se pudo actualizar el pago reportado");
      } finally {
        setActingPagoReportadoId(null);
      }
    },
    [canResolve, fetchPagosPendientes, fetchSolicitudes]
  );

  const confirmPagoAccion = useCallback(
    (pago: PagoReportadoRow, decision: "APROBAR" | "RECHAZAR") => {
      if (!canResolve) return;
      const title = decision === "APROBAR" ? "Aprobar pago" : "Rechazar pago";
      const msg =
        decision === "APROBAR"
          ? "Esto marcara el pago como aprobado."
          : "Esto rechazara el pago reportado y notificara al vendedor.";
      Alert.alert(title, msg, [
        { text: "Cancelar", style: "cancel" },
        {
          text: decision === "APROBAR" ? "Aprobar" : "Rechazar",
          style: decision === "RECHAZAR" ? "destructive" : "default",
          onPress: () => {
            handlePagoAccion(pago, decision).catch(() => {});
          },
        },
      ]);
    },
    [canResolve, handlePagoAccion]
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Solicitudes",
          headerBackTitle: "Atrás",
          gestureEnabled: false,
        }}
      />

      <RoleGate allow={["ADMIN"]} deniedText="Solo ADMIN puede ver solicitudes." backHref="/(drawer)/(tabs)">
        <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
          <View style={[styles.content, { backgroundColor: C.bg }]}>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Buscar (cliente, id, nota)..."
              placeholderTextColor={C.sub}
              style={[styles.search, { borderColor: C.border, backgroundColor: C.card, color: C.text }]}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            
            {initialLoadingPagos ? (
              <Text style={{ color: C.sub, fontWeight: "700" }}>Cargando pagos...</Text>
            ) : pagosPendientes.length === 0 ? (
              <Text style={{ color: C.sub, fontWeight: "700" }}>Sin pagos reportados pendientes</Text>
            ) : (
              pagosPendientes.map((p) => {
                const isActing = actingPagoReportadoId === p.id;
                const displayDate = fmtDateTime(p.fecha_reportado ?? p.created_at);
                const ventaKey = String(p.venta_id ?? "").trim();
                const ventaInfo = ventaKey ? ventasInfoById[ventaKey] : undefined;
                const clienteNombre = ventaInfo?.cliente_nombre ?? "Cliente";
                const vendedorDisplay = (() => {
                  if (ventaInfo?.vendedor_codigo) return String(ventaInfo.vendedor_codigo).trim();
                  const vendedorId = ventaInfo?.vendedor_id ? String(ventaInfo.vendedor_id).trim() : "";
                  if (vendedorId) {
                    const vendedor = vendedoresById[vendedorId];
                    const code = String(vendedor?.codigo ?? "").trim();
                    if (code) return code;
                    const nombre = String(vendedor?.nombre ?? "").trim();
                    if (nombre) return nombre;
                    return vendedorId.slice(0, 8);
                  }
                  return "—";
                })();
                return (
                  <View key={p.id} style={{ marginTop: 10 }}>
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: "/cxc-venta-detalle",
                          params: { ventaId: String(p.venta_id) },
                        } as any)
                      }
                      style={({ pressed }) => [
                        styles.pagoCard,
                        { borderColor: C.border, backgroundColor: C.card },
                        pressed ? { opacity: 0.92 } : null,
                      ]}
                    >
                      <View style={styles.rowTopPay}>
                        <Text style={[styles.pagoVenta, { color: C.text, flex: 1 }]} numberOfLines={1}>
                          {clienteNombre}
                        </Text>
                        <View
                          style={[styles.vendorPill, { borderColor: C.border, backgroundColor: C.pillAmberBg }]}
                        >
                          <Text style={[styles.vendorPillText, { color: C.sub }]} numberOfLines={1}>
                            {vendedorDisplay}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.pagoMonto, { color: C.text }]}>Monto: {fmtQ(p.monto)}</Text>
                      <Text style={[styles.pagoMeta, { color: C.sub }]}>Método: {p.metodo ?? "—"}</Text>
                      {p.referencia ? (
                        <Text style={[styles.pagoMeta, { color: C.sub }]}>Ref: {p.referencia}</Text>
                      ) : null}
                      {p.comentario ? (
                        <Text style={[styles.pagoMeta, { color: C.sub }]}>Comentario: {p.comentario}</Text>
                      ) : null}
                      <Text style={[styles.pagoMeta, { color: C.sub }]}>Reportado: {displayDate}</Text>

                    </Pressable>
                  </View>
                );
              })
            )}
          </View>

          <FlatList
            data={rows}
            keyExtractor={(it) => `${it.venta_id}_${it.solicitud_at ?? ""}`} // Fix 4: composite key prevents duplicates
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={{ paddingBottom: 24, paddingTop: 4 }}
            renderItem={({ item }) => {
              const tone = actionTone(item.solicitud_accion);
              const pillBg = tone === "red" ? C.pillRedBg : C.pillAmberBg;
              const pillText = tone === "red" ? C.danger : C.amber;
              const isActing = actingVentaId === Number(item.venta_id);

              const vendor = vendedoresById[String(item.vendedor_id ?? "")] ?? null;
              const vendorCode = String(vendor?.codigo ?? "").trim();

              const openVenta = () => {
                navigateToVentaFromNotif(router as any, Number(item.venta_id), {
                  ensureBaseRoute: false,
                  notif: "VENTA_SOLICITUD_ADMIN",
                  accion: item.solicitud_accion,
                  nota: item.solicitud_nota,
                  clienteNombre: item.cliente_nombre,
                  vendedorCodigo: vendorCode || null,
                });
              };

              return (
                <View style={{ marginHorizontal: 16, marginTop: 12 }}>
                  <Pressable
                    onPress={openVenta}
                    style={({ pressed }) => [
                      styles.cardItem,
                      { borderColor: C.border, backgroundColor: C.card },
                      pressed ? { opacity: 0.92 } : null,
                    ]}
                  >
                    <View style={styles.rowTop}>
                      <View style={[styles.pill, { backgroundColor: pillBg, borderColor: C.border }]}>
                        <Text style={[styles.pillText, { color: pillText }]}>{actionLabel(item.solicitud_accion)}</Text>
                      </View>
                      <Text style={[styles.meta, { color: C.sub }]}>{fmtDateTime(item.solicitud_at)}</Text>
                    </View>

                    <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>
                      {item.cliente_nombre ?? "—"}
                    </Text>
                    <Text style={[styles.sub, { color: C.sub }]} numberOfLines={1}>
                      Venta #{item.venta_id} • Estado: {item.estado ?? "—"}
                    </Text>

                    {item.solicitud_tag ? (
                      <Text style={[styles.sub, { color: C.sub }]} numberOfLines={1}>
                        Tag: {String(item.solicitud_tag)}
                      </Text>
                    ) : null}

                    {item.vendedor_id ? (
                      <Text style={[styles.sub, { color: C.sub }]} numberOfLines={1}>
                        Vendedor: {(() => {
                          const code = vendorCode;
                          const name = String(vendor?.nombre ?? "").trim();
                          if (code) return code;
                          if (name) return name;
                          return String(item.vendedor_id).slice(0, 8);
                        })()}
                      </Text>
                    ) : null}

                    {!!item.solicitud_nota ? (
                      <Text style={[styles.note, { color: C.text }]}>{item.solicitud_nota}</Text>
                    ) : null}

                    {!canResolve ? null : (
                      <View style={styles.btnRow}>
                        <AppButton
                          title={isActing ? "..." : "Aprobar"}
                          size="sm"
                          onPress={() => confirmResolve(Number(item.venta_id), "APROBAR")}
                          disabled={isActing}
                        />
                        <View style={{ width: 10 }} />
                        <AppButton
                          title={isActing ? "..." : "Rechazar"}
                          size="sm"
                          variant="outline"
                          onPress={() => confirmResolve(Number(item.venta_id), "RECHAZAR")}
                          disabled={isActing}
                        />
                      </View>
                    )}
                  </Pressable>
                </View>
              );
            }}
            ListEmptyComponent={
              <Text style={{ padding: 16, color: C.sub, fontWeight: "700" }}>
                {initialLoading ? "Cargando..." : "Sin solicitudes pendientes"}
              </Text>
            }
          />
        </SafeAreaView>
      </RoleGate>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 10 },
  search: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 12, android: 10, default: 10 }),
    fontSize: 16,
  },
  cardItem: { borderWidth: 1, borderRadius: 16, padding: 14 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  pillText: { fontSize: 12, fontWeight: "800" },
  meta: { fontSize: 12, fontWeight: "700" },
  title: { marginTop: 8, fontSize: 16, fontWeight: "700" },
  sub: { marginTop: 4, fontSize: 13, fontWeight: "600" },
  note: { marginTop: 8, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  btnRow: { marginTop: 10, flexDirection: "row", alignItems: "center" },
  pagosHeaderRow: { paddingHorizontal: 4, paddingBottom: 6 },
  pagosHeaderTitle: { fontSize: 18, fontWeight: "800" },
  pagosHeaderSubtitle: { fontSize: 13, fontWeight: "600" },
  pagoCard: { borderWidth: 1, borderRadius: 14, padding: 14 },
  pagoVenta: { fontSize: 15, fontWeight: "800" },
  pagoMonto: { marginTop: 4, fontSize: 14, fontWeight: "700" },
  pagoMeta: { marginTop: 4, fontSize: 13, fontWeight: "600" },
  rowTopPay: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  vendorPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  vendorPillText: { fontSize: 12, fontWeight: "800" },
});
