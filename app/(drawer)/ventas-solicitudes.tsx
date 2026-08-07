import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack, router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
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
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { RoleGate } from "../../components/auth/RoleGate";
import { KeyboardAwareModal } from "../../components/ui/keyboard-aware-modal";
import { AppButton } from "../../components/ui/app-button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { VentasSolicitudesDetallePanel } from "../../components/ventas/VentasSolicitudesDetallePanel";
import { navigateToVentaFromNotif } from "../../lib/notifNavigation";
import { emitSolicitudesChanged } from "../../lib/solicitudesEvents";
import { supabase } from "../../lib/supabase";
import { useEmpresaActiva } from "../../lib/useEmpresaActiva";
import { useThemePref } from "../../lib/themePreference";
import { alphaColor } from "../../lib/ui";
import { useGoHomeOnBack } from "../../lib/useGoHomeOnBack";
import { useRole } from "../../lib/useRole";
import { useResumeLoad } from "../../lib/useResumeLoad";
import { fmtQ, fmtDateTime } from "../../lib/utils/format";
import { normalizeUpper, normalizeSearch } from "../../lib/utils/text";
import { FB_DARK_DANGER } from "../../src/theme/headerColors";

type Role = "ADMIN" | "VENTAS" | "BODEGA" | "FACTURACION" | "MENSAJERO" | "";

const BUCKET_CLIENTES_DOCS = "Clientes-Docs";

async function openLicenciaPdf(path: string) {
  const { data, error } = await supabase.storage.from(BUCKET_CLIENTES_DOCS).createSignedUrl(path, 60 * 15);
  if (error) throw error;
  const url = (data as any)?.signedUrl ?? null;
  if (!url) throw new Error("No se pudo abrir el documento");
  if (Platform.OS === "web") {
    window.open(url, "_blank");
  } else {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      await WebBrowser.openBrowserAsync(encodeURI(url));
    }
  }
}

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

type LicenciaRow = {
  cliente_id: number;
  empresa_id: number;
  nombre: string;
  nit: string | null;
  telefono: string | null;
  licencia_sanitaria_pdf_path: string | null;
  licencia_sanitaria_updated_at: string | null;
};

type UnifiedItem =
  | { kind: "solicitud"; data: SolicitudRow }
  | { kind: "pago"; data: PagoReportadoRow }
  | { kind: "licencia"; data: LicenciaRow };

function actionLabel(a: SolicitudRow["solicitud_accion"]) {
  if (a === "ANULACION") return "Anulacion";
  if (a === "EDICION") return "Edicion";
  if (a === "REFACTURACION") return "Refacturacion";
  return "Solicitud";
}

function isPaymentEditRequest(row: SolicitudRow | null | undefined) {
  if (!row) return false;
  const note = String(row.solicitud_nota ?? "").toUpperCase();
  const tag = String(row.solicitud_tag ?? "").toUpperCase();
  if (tag.includes("PAGO") || note.includes("PAGO") || note.startsWith("PAGO:") || note.includes("EDITAR PAGO")) return true;
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

  const { width } = useWindowDimensions();
  const canSplit = Platform.OS === "web" && width >= 1100;
  const [selectedVentaId, setSelectedVentaId] = useState<number | null>(null);

  useEffect(() => {
    if (!canSplit) setSelectedVentaId(null);
  }, [canSplit]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const style = document.createElement("style");
    style.textContent = "input:focus { outline: none !important; }";
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  const { role, isReady, refreshRole } = useRole();
  const { empresaActivaId } = useEmpresaActiva();

  const roleUp = normalizeUpper(role) as Role;
  const canResolve = isReady && roleUp === "ADMIN";
  const [q, setQ] = useState("");

  const [rowsRaw, setRowsRaw] = useState<SolicitudRow[]>([]);
  const [vendedoresById, setVendedoresById] = useState<Record<string, { codigo: string | null; nombre: string | null }>>({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [actingVentaId, setActingVentaId] = useState<number | null>(null);
  const [actingPagoId, setActingPagoId] = useState<number | null>(null);
  const [webConfirm, setWebConfirm] = useState<{
    ventaId: number;
    decision: "APROBAR" | "RECHAZAR";
  } | null>(null);
  const [webConfirmPago, setWebConfirmPago] = useState<{
    pagoId: number;
    decision: "APROBAR" | "RECHAZAR";
  } | null>(null);
  const [pagosPendientesRaw, setPagosPendientesRaw] = useState<PagoReportadoRow[]>([]);
  const [initialLoadingPagos, setInitialLoadingPagos] = useState(true);
  const [ventasInfoById, setVentasInfoById] = useState<
    Record<string, { cliente_nombre: string | null; vendedor_id: string | null; vendedor_codigo: string | null }>
  >({});

  const [licenciasPendientesRaw, setLicenciasPendientesRaw] = useState<LicenciaRow[]>([]);
  const [initialLoadingLicencias, setInitialLoadingLicencias] = useState(true);
  const [actingLicenciaId, setActingLicenciaId] = useState<number | null>(null);
  const [webConfirmLicencia, setWebConfirmLicencia] = useState<{ clienteId: number } | null>(null);
  const [rechazoLicenciaModal, setRechazoLicenciaModal] = useState<{ clienteId: number } | null>(null);
  const [rechazoMotivoDraft, setRechazoMotivoDraft] = useState("");

  const fetchSolicitudes = useCallback(async () => {
    if (!empresaActivaId) return;
    const { data, error } = await supabase
      .from("vw_ventas_solicitudes_pendientes_admin")
      .select(
        "venta_id,fecha,estado,cliente_nombre,vendedor_id,solicitud_tag,solicitud_accion,solicitud_nota,solicitud_at,solicitud_by"
      )
      .eq("empresa_id", empresaActivaId)
      .order("solicitud_at", { ascending: false })
      .limit(300);
    if (error) throw error;
    setRowsRaw((data ?? []) as any);
  }, [empresaActivaId]);

  const fetchPagosPendientes = useCallback(async () => {
    if (!empresaActivaId) return;
    const { data, error } = await supabase
      .from("ventas_pagos_reportados")
      .select(
        "id,venta_id,factura_id,fecha_reportado,created_at,monto,metodo,referencia,comentario,comprobante_path,created_by,estado"
      )
      .eq("empresa_id", empresaActivaId)
      .eq("estado", "PENDIENTE")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw error;
    setPagosPendientesRaw((data ?? []) as any);
  }, [empresaActivaId]);

  const fetchLicenciasPendientes = useCallback(async () => {
    if (!empresaActivaId) return;
    const { data, error } = await supabase
      .from("vw_clientes_licencia_sanitaria_pendientes_admin")
      .select("cliente_id,empresa_id,nombre,nit,telefono,licencia_sanitaria_pdf_path,licencia_sanitaria_updated_at")
      .eq("empresa_id", empresaActivaId)
      .limit(300);
    if (error) throw error;
    setLicenciasPendientesRaw((data ?? []) as any);
  }, [empresaActivaId]);

  const reloadAll = useCallback(async () => {
    if (!isReady || roleUp !== "ADMIN") return;
    setInitialLoading(true);
    setInitialLoadingPagos(true);
    setInitialLoadingLicencias(true);
    try {
      await Promise.all([fetchSolicitudes(), fetchPagosPendientes(), fetchLicenciasPendientes()]);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudieron cargar solicitudes");
      setRowsRaw([]);
      setPagosPendientesRaw([]);
      setLicenciasPendientesRaw([]);
    } finally {
      setInitialLoading(false);
      setInitialLoadingPagos(false);
      setInitialLoadingLicencias(false);
    }
  }, [fetchPagosPendientes, fetchSolicitudes, fetchLicenciasPendientes, isReady, roleUp]);

  useFocusEffect(
    useCallback(() => {
      void refreshRole("focus:ventas-solicitudes");
      void reloadAll();
    }, [refreshRole, reloadAll])
  );

  useResumeLoad(empresaActivaId, () => { void reloadAll(); });

  // Realtime subscriptions — refresh list when ventas (solicitudes) or pagos change
  useEffect(() => {
    if (!empresaActivaId || !isReady || roleUp !== "ADMIN") return;

    const channel = supabase
      .channel(`solicitudes_realtime_${empresaActivaId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ventas", filter: `empresa_id=eq.${empresaActivaId}` },
        () => { void fetchSolicitudes(); }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ventas_pagos_reportados", filter: `empresa_id=eq.${empresaActivaId}` },
        () => { void fetchPagosPendientes(); }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clientes", filter: `empresa_id=eq.${empresaActivaId}` },
        () => { void fetchLicenciasPendientes(); }
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [empresaActivaId, isReady, roleUp, fetchSolicitudes, fetchPagosPendientes, fetchLicenciasPendientes]);

  // Stable derived IDs for pagos — only changes when the actual set of venta_ids changes
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
    const ventaIds = ventaIdsPagos;
    if (!ventaIds.length) {
      setVentasInfoById({});
      return;
    }
    let alive = true;
    (async () => {
      try {
        if (!empresaActivaId) { if (alive) setVentasInfoById({}); return; }
        const { data, error } = await supabase
          .from("vw_cxc_ventas")
          .select("venta_id,cliente_nombre,vendedor_id,vendedor_codigo")
          .eq("empresa_id", empresaActivaId)
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
      } catch {
        if (alive) setVentasInfoById({});
      }
    })();
    return () => { alive = false; };
  }, [ventaIdsPagos, empresaActivaId]);

  useEffect(() => {
    const ids = Array.from(
      new Set(rowsRaw.map((r) => String(r.vendedor_id ?? "").trim()).filter((x) => x))
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
    return () => { alive = false; };
  }, [rowsRaw]);

  const resolve = useCallback(
    async (ventaId: number, decision: "APROBAR" | "RECHAZAR") => {
      if (!canResolve) return;
      setActingVentaId(ventaId);

      // Guardar datos necesarios ANTES de quitar el item del estado.
      const sol = rowsRaw.find((r) => Number(r.venta_id) === Number(ventaId));
      const prevRows = rowsRaw;

      // Quitar inmediatamente — el item desaparece antes del round-trip de red.
      setRowsRaw((r) => r.filter((x) => Number(x.venta_id) !== Number(ventaId)));
      setSelectedVentaId(null);

      try {
        const { error } = await supabase.rpc("rpc_admin_resolver_solicitud", {
          p_venta_id: Number(ventaId),
          p_decision: decision,
        });
        if (error) throw error;

        if (decision === "APROBAR" && isPaymentEditRequest(sol) && sol?.vendedor_id) {
          try {
            const { error: grantErr } = await supabase.rpc("rpc_admin_otorgar_edicion_pago", {
              p_venta_id: Number(ventaId),
              p_otorgado_a: String(sol.vendedor_id),
              p_horas: 48,
            });
            if (grantErr) {
              Alert.alert("Aviso", `Solicitud aprobada pero no se pudo otorgar permiso: ${grantErr.message || grantErr}`);
            }
          } catch (e: any) {
            console.warn("grant permiso error", e?.message ?? e);
          }
        }

        await fetchSolicitudes();
        emitSolicitudesChanged();
      } catch (e: any) {
        // Rollback: restaurar item si el RPC falló.
        setRowsRaw(prevRows);
        Alert.alert("Error", e?.message ?? "No se pudo resolver la solicitud");
      } finally {
        setActingVentaId(null);
      }
    },
    [canResolve, fetchSolicitudes, rowsRaw]
  );

  const confirmResolve = useCallback(
    (ventaId: number, decision: "APROBAR" | "RECHAZAR") => {
      if (!canResolve) return;
      // On web, Alert.alert is a no-op (react-native-web ships `static alert() {}`),
      // so the confirmation callback would never fire. Use a Modal-based dialog instead.
      if (Platform.OS === "web") {
        setWebConfirm({ ventaId, decision });
        return;
      }
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
          onPress: () => { resolve(ventaId, decision).catch(() => {}); },
        },
      ]);
    },
    [canResolve, resolve]
  );


  const resolvePago = useCallback(
    async (pagoId: number, decision: "APROBAR" | "RECHAZAR") => {
      if (!canResolve) return;
      setActingPagoId(pagoId);

      // Quitar inmediatamente — rollback si el RPC falla.
      const prevPagos = pagosPendientesRaw;
      setPagosPendientesRaw((p) => p.filter((x) => Number(x.id) !== Number(pagoId)));

      try {
        if (decision === "APROBAR") {
          const { error } = await supabase.rpc("rpc_venta_aprobar_pago_reportado", {
            p_pago_reportado_id: pagoId,
          });
          if (error) throw error;
        } else {
          const { error } = await supabase.rpc("rpc_venta_rechazar_pago_reportado", {
            p_pago_reportado_id: pagoId,
            p_nota_admin: "Rechazado por admin",
          });
          if (error) throw error;
        }
        await fetchPagosPendientes();
        emitSolicitudesChanged();
      } catch (e: any) {
        // Rollback: restaurar pago si el RPC falló.
        setPagosPendientesRaw(prevPagos);
        Alert.alert("Error", e?.message ?? "No se pudo actualizar el pago reportado");
      } finally {
        setActingPagoId(null);
      }
    },
    [canResolve, fetchPagosPendientes, pagosPendientesRaw]
  );

  const confirmResolvePago = useCallback(
    (pagoId: number, decision: "APROBAR" | "RECHAZAR") => {
      if (!canResolve) return;
      if (Platform.OS === "web") {
        setWebConfirmPago({ pagoId, decision });
        return;
      }
      const title = decision === "APROBAR" ? "Aprobar pago" : "Rechazar pago";
      const msg =
        decision === "APROBAR"
          ? "El pago sera registrado en la venta."
          : "El pago sera rechazado sin registrarse.";
      Alert.alert(title, msg, [
        { text: "Cancelar", style: "cancel" },
        {
          text: decision === "APROBAR" ? "Aprobar" : "Rechazar",
          style: decision === "RECHAZAR" ? "destructive" : "default",
          onPress: () => { resolvePago(pagoId, decision).catch(() => {}); },
        },
      ]);
    },
    [canResolve, resolvePago]
  );

  const resolveLicencia = useCallback(
    async (clienteId: number, decision: "APROBAR" | "RECHAZAR", nota?: string) => {
      if (!canResolve) return;
      setActingLicenciaId(clienteId);

      const prevLicencias = licenciasPendientesRaw;
      setLicenciasPendientesRaw((l) => l.filter((x) => Number(x.cliente_id) !== Number(clienteId)));

      try {
        const { error } = await supabase.rpc("rpc_cliente_licencia_sanitaria_revisar", {
          p_empresa_id: empresaActivaId,
          p_cliente_id: clienteId,
          p_decision: decision,
          p_nota: nota ?? null,
        });
        if (error) throw error;
        await fetchLicenciasPendientes();
        emitSolicitudesChanged();
      } catch (e: any) {
        setLicenciasPendientesRaw(prevLicencias);
        Alert.alert("Error", e?.message ?? "No se pudo actualizar la licencia sanitaria");
      } finally {
        setActingLicenciaId(null);
      }
    },
    [canResolve, empresaActivaId, fetchLicenciasPendientes, licenciasPendientesRaw]
  );

  const confirmAprobarLicencia = useCallback(
    (clienteId: number) => {
      if (!canResolve) return;
      if (Platform.OS === "web") {
        setWebConfirmLicencia({ clienteId });
        return;
      }
      Alert.alert("Aprobar licencia sanitaria", "El cliente quedará verificado en ventas.", [
        { text: "Cancelar", style: "cancel" },
        { text: "Aprobar", onPress: () => { resolveLicencia(clienteId, "APROBAR").catch(() => {}); } },
      ]);
    },
    [canResolve, resolveLicencia]
  );

  const openRechazarLicencia = useCallback(
    (clienteId: number) => {
      if (!canResolve) return;
      setRechazoMotivoDraft("");
      setRechazoLicenciaModal({ clienteId });
    },
    [canResolve]
  );

  const confirmRechazarLicencia = useCallback(() => {
    const pending = rechazoLicenciaModal;
    const nota = rechazoMotivoDraft.trim();
    if (!pending || !nota) return;
    setRechazoLicenciaModal(null);
    resolveLicencia(pending.clienteId, "RECHAZAR", nota).catch(() => {});
  }, [rechazoLicenciaModal, rechazoMotivoDraft, resolveLicencia]);

  // Unified + sorted list
  const unifiedItems = useMemo<UnifiedItem[]>(() => {
    const items: UnifiedItem[] = [
      ...rowsRaw.map((d) => ({ kind: "solicitud" as const, data: d })),
      ...pagosPendientesRaw.map((d) => ({ kind: "pago" as const, data: d })),
      ...licenciasPendientesRaw.map((d) => ({ kind: "licencia" as const, data: d })),
    ];
    return items.sort((a, b) => {
      const dateA = a.kind === "solicitud" ? a.data.solicitud_at : a.kind === "pago" ? a.data.created_at : a.data.licencia_sanitaria_updated_at;
      const dateB = b.kind === "solicitud" ? b.data.solicitud_at : b.kind === "pago" ? b.data.created_at : b.data.licencia_sanitaria_updated_at;
      return (dateB ?? "").localeCompare(dateA ?? "");
    });
  }, [rowsRaw, pagosPendientesRaw, licenciasPendientesRaw]);

  const filteredItems = useMemo<UnifiedItem[]>(() => {
    const search = normalizeSearch(q);
    if (!search) return unifiedItems;
    return unifiedItems.filter((item) => {
      if (item.kind === "solicitud") {
        const r = item.data;
        return (
          String(r.venta_id ?? "").includes(search) ||
          normalizeSearch(r.cliente_nombre).includes(search) ||
          normalizeSearch(r.solicitud_nota).includes(search)
        );
      } else if (item.kind === "pago") {
        const p = item.data;
        return (
          String(p.venta_id ?? "").includes(search) ||
          normalizeSearch(p.referencia).includes(search) ||
          normalizeSearch(p.comentario).includes(search)
        );
      } else {
        const l = item.data;
        return normalizeSearch(l.nombre).includes(search) || normalizeSearch(l.nit).includes(search);
      }
    });
  }, [unifiedItems, q]);

  const renderItem = useCallback(
    ({ item }: { item: UnifiedItem }) => {
      if (item.kind === "solicitud") {
        const sol = item.data;
        const tone = actionTone(sol.solicitud_accion);
        const pillBg = tone === "red" ? C.pillRedBg : C.pillAmberBg;
        const pillText = tone === "red" ? C.danger : C.amber;
        const isActing = actingVentaId === Number(sol.venta_id);
        const vendor = vendedoresById[String(sol.vendedor_id ?? "")] ?? null;
        const vendorCode = String(vendor?.codigo ?? "").trim();

        return (
          <View style={{ marginHorizontal: 16, marginTop: 12 }}>
            <Pressable
              onPress={() => {
                if (canSplit) {
                  setSelectedVentaId(Number(sol.venta_id));
                } else {
                  navigateToVentaFromNotif(router as any, Number(sol.venta_id), {
                    ensureBaseRoute: false,
                    notif: "VENTA_SOLICITUD_ADMIN",
                    accion: sol.solicitud_accion,
                    nota: sol.solicitud_nota,
                    clienteNombre: sol.cliente_nombre,
                    vendedorCodigo: vendorCode || null,
                  });
                }
              }}
              style={({ pressed }) => [
                styles.cardItem,
                { borderColor: C.border, backgroundColor: C.card },
                canSplit && selectedVentaId === Number(sol.venta_id) && { borderColor: colors.primary, borderWidth: 2 },
                pressed ? { opacity: 0.92 } : null,
              ]}
            >
              <View style={styles.rowTop}>
                <View style={[styles.pill, { backgroundColor: pillBg, borderColor: C.border }]}>
                  <Text style={[styles.pillText, { color: pillText }]}>{actionLabel(sol.solicitud_accion)}</Text>
                </View>
                <Text style={[styles.meta, { color: C.sub }]}>{fmtDateTime(sol.solicitud_at)}</Text>
              </View>

              <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>
                {sol.cliente_nombre ?? "—"}
              </Text>
              <Text style={[styles.sub, { color: C.sub }]} numberOfLines={1}>
                Venta #{sol.venta_id} • Estado: {sol.estado ?? "—"}
              </Text>

              {sol.solicitud_tag ? (
                <Text style={[styles.sub, { color: C.sub }]} numberOfLines={1}>
                  Tag: {String(sol.solicitud_tag)}
                </Text>
              ) : null}

              {sol.vendedor_id ? (
                <Text style={[styles.sub, { color: C.sub }]} numberOfLines={1}>
                  Vendedor: {(() => {
                    const name = String(vendor?.nombre ?? "").trim();
                    if (vendorCode) return vendorCode;
                    if (name) return name;
                    return String(sol.vendedor_id).slice(0, 8);
                  })()}
                </Text>
              ) : null}

              {!!sol.solicitud_nota ? (
                <Text style={[styles.note, { color: C.text }]}>{sol.solicitud_nota}</Text>
              ) : null}

              {!canResolve ? null : (
                <View
                  style={styles.btnRow}
                  {...(Platform.OS === "web"
                    ? { onClick: (e: any) => e?.stopPropagation?.() }
                    : { onStartShouldSetResponder: () => true })}
                >
                  <AppButton
                    title={isActing ? "..." : "Aprobar"}
                    size="sm"
                    onPress={() => confirmResolve(Number(sol.venta_id), "APROBAR")}
                    disabled={isActing}
                  />
                  <View style={{ width: 10 }} />
                  <AppButton
                    title={isActing ? "..." : "Rechazar"}
                    size="sm"
                    variant="danger"
                    style={{ backgroundColor: "#F02849", borderColor: "#F02849" } as any}
                    onPress={() => confirmResolve(Number(sol.venta_id), "RECHAZAR")}
                    disabled={isActing}
                  />
                </View>
              )}
            </Pressable>
          </View>
        );
      } else if (item.kind === "pago") {
        const p = item.data;
        const displayDate = fmtDateTime(p.fecha_reportado ?? p.created_at);
        const ventaKey = String(p.venta_id ?? "").trim();
        const ventaInfo = ventaKey ? ventasInfoById[ventaKey] : undefined;
        const clienteNombre = ventaInfo?.cliente_nombre ?? "Cliente";
        const isActingPago = actingPagoId === Number(p.id);
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
          <View style={{ marginHorizontal: 16, marginTop: 12 }}>
            <Pressable
              onPress={() => {
                if (canSplit) {
                  setSelectedVentaId(Number(p.venta_id));
                } else {
                  router.push({
                    pathname: "/cxc-venta-detalle",
                    params: { ventaId: String(p.venta_id) },
                  } as any);
                }
              }}
              style={({ pressed }) => [
                styles.cardItem,
                { borderColor: C.border, backgroundColor: C.card },
                canSplit && selectedVentaId === Number(p.venta_id) && { borderColor: colors.primary, borderWidth: 2 },
                pressed ? { opacity: 0.92 } : null,
              ]}
            >
              <View style={styles.rowTop}>
                <View style={[styles.pill, { backgroundColor: C.pillAmberBg, borderColor: C.border }]}>
                  <Text style={[styles.pillText, { color: C.amber }]}>Pago</Text>
                </View>
                <Text style={[styles.meta, { color: C.sub }]}>{displayDate}</Text>
              </View>

              <View style={styles.rowTopPay}>
                <Text style={[styles.title, { color: C.text, flex: 1 }]} numberOfLines={1}>
                  {clienteNombre}
                </Text>
                <View style={[styles.vendorPill, { borderColor: C.border, backgroundColor: C.pillAmberBg }]}>
                  <Text style={[styles.vendorPillText, { color: C.sub }]} numberOfLines={1}>
                    {vendedorDisplay}
                  </Text>
                </View>
              </View>

              <Text style={[styles.sub, { color: C.sub }]} numberOfLines={1}>
                Venta #{p.venta_id} • {fmtQ(p.monto)}
              </Text>
              <Text style={[styles.sub, { color: C.sub }]} numberOfLines={1}>
                Método: {p.metodo ?? "—"}
              </Text>
              {p.referencia ? (
                <Text style={[styles.sub, { color: C.sub }]} numberOfLines={1}>
                  Ref: {p.referencia}
                </Text>
              ) : null}
              {p.comentario ? (
                <Text style={[styles.note, { color: C.text }]} numberOfLines={2}>
                  {p.comentario}
                </Text>
              ) : null}

              {!canResolve ? null : (
                <View
                  style={styles.btnRow}
                  {...(Platform.OS === "web"
                    ? { onClick: (e: any) => e?.stopPropagation?.() }
                    : { onStartShouldSetResponder: () => true })}
                >
                  <AppButton
                    title={isActingPago ? "..." : "Aprobar"}
                    size="sm"
                    onPress={() => confirmResolvePago(Number(p.id), "APROBAR")}
                    disabled={isActingPago}
                  />
                  <View style={{ width: 10 }} />
                  <AppButton
                    title={isActingPago ? "..." : "Rechazar"}
                    size="sm"
                    variant="danger"
                    style={{ backgroundColor: "#F02849", borderColor: "#F02849" } as any}
                    onPress={() => confirmResolvePago(Number(p.id), "RECHAZAR")}
                    disabled={isActingPago}
                  />
                </View>
              )}
            </Pressable>
          </View>
        );
      } else {
        const l = item.data;
        const isActingLicencia = actingLicenciaId === Number(l.cliente_id);
        const hasPdf = !!l.licencia_sanitaria_pdf_path;

        return (
          <View style={{ marginHorizontal: 16, marginTop: 12 }}>
            <Pressable
              onPress={() => router.push({ pathname: "/cliente-detalle", params: { id: String(l.cliente_id) } } as any)}
              style={({ pressed }) => [
                styles.cardItem,
                { borderColor: C.border, backgroundColor: C.card },
                pressed ? { opacity: 0.92 } : null,
              ]}
            >
              <View style={styles.rowTop}>
                <View style={[styles.pill, { backgroundColor: C.pillAmberBg, borderColor: C.border }]}>
                  <Text style={[styles.pillText, { color: C.amber }]}>Licencia sanitaria</Text>
                </View>
                <Text style={[styles.meta, { color: C.sub }]}>{fmtDateTime(l.licencia_sanitaria_updated_at)}</Text>
              </View>

              <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>
                {l.nombre}
              </Text>
              <Text style={[styles.sub, { color: C.sub }]} numberOfLines={1}>
                NIT: {l.nit || "CF"}{l.telefono ? ` • Tel: ${l.telefono}` : ""}
              </Text>

              {hasPdf ? (
                <Pressable
                  onPress={(e: any) => {
                    e?.stopPropagation?.();
                    openLicenciaPdf(String(l.licencia_sanitaria_pdf_path)).catch((err: any) => {
                      Alert.alert("Error", err?.message ?? "No se pudo abrir el documento");
                    });
                  }}
                  style={{ marginTop: 8 }}
                >
                  <Text style={[styles.note, { color: colors.primary, fontWeight: "800" }]}>Ver PDF</Text>
                </Pressable>
              ) : null}

              {!canResolve ? null : (
                <View
                  style={styles.btnRow}
                  {...(Platform.OS === "web"
                    ? { onClick: (e: any) => e?.stopPropagation?.() }
                    : { onStartShouldSetResponder: () => true })}
                >
                  <AppButton
                    title={isActingLicencia ? "..." : "Aprobar"}
                    size="sm"
                    onPress={() => confirmAprobarLicencia(Number(l.cliente_id))}
                    disabled={isActingLicencia}
                  />
                  <View style={{ width: 10 }} />
                  <AppButton
                    title={isActingLicencia ? "..." : "Rechazar"}
                    size="sm"
                    variant="danger"
                    style={{ backgroundColor: "#F02849", borderColor: "#F02849" } as any}
                    onPress={() => openRechazarLicencia(Number(l.cliente_id))}
                    disabled={isActingLicencia}
                  />
                </View>
              )}
            </Pressable>
          </View>
        );
      }
    },
    [
      C, colors.primary, canSplit, selectedVentaId,
      actingVentaId, actingPagoId, vendedoresById, ventasInfoById,
      actingLicenciaId, confirmAprobarLicencia, openRechazarLicencia,
      canResolve, confirmResolve, confirmResolvePago,
    ]
  );

  const listContent = (
    <>
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

      <FlatList
        style={{ flex: 1 }}
        data={filteredItems}
        keyExtractor={(item) =>
          item.kind === "solicitud"
            ? `sol_${item.data.venta_id}_${item.data.solicitud_at ?? ""}`
            : item.kind === "pago"
              ? `pago_${item.data.id}`
              : `licencia_${item.data.cliente_id}`
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingBottom: 24, paddingTop: 4 }}
        initialNumToRender={Platform.OS === "web" ? 999 : 12}
        maxToRenderPerBatch={Platform.OS === "web" ? 999 : 10}
        updateCellsBatchingPeriod={50}
        windowSize={Platform.OS === "web" ? 999 : 7}
        removeClippedSubviews={Platform.OS === "android"}
        renderItem={renderItem}
        ListEmptyComponent={
          <Text style={{ padding: 16, color: C.sub, fontWeight: "700" }}>
            {initialLoading || initialLoadingPagos || initialLoadingLicencias ? "Cargando..." : "Sin solicitudes pendientes"}
          </Text>
        }
      />
    </>
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
          {canSplit ? (
            <View style={[styles.splitWrap, { backgroundColor: C.bg }]}>
              <View style={[styles.splitListPane, { borderRightColor: C.border, backgroundColor: C.bg }]}>
                {listContent}
              </View>
              <View style={styles.splitDetailPane}>
                {selectedVentaId ? (
                  <VentasSolicitudesDetallePanel ventaId={selectedVentaId} embedded />
                ) : (
                  <View style={[styles.splitPlaceholder, { borderColor: C.border }]}>
                    <Text style={[styles.splitPlaceholderText, { color: C.sub }]}>
                      Selecciona una solicitud para ver detalles
                    </Text>
                  </View>
                )}
              </View>
            </View>
          ) : (
            listContent
          )}

          <ConfirmModal
            visible={webConfirm !== null}
            title={webConfirm?.decision === "APROBAR" ? "Aprobar solicitud" : "Rechazar solicitud"}
            message={
              webConfirm?.decision === "APROBAR"
                ? "Esto enviara la accion a la cola correspondiente."
                : "Esto cerrara la solicitud sin ejecutar cambios."
            }
            confirmText={webConfirm?.decision === "APROBAR" ? "Aprobar" : "Rechazar"}
            confirmVariant={webConfirm?.decision === "RECHAZAR" ? "danger" : "primary"}
            onConfirm={() => {
              const pending = webConfirm;
              setWebConfirm(null);
              if (pending) resolve(pending.ventaId, pending.decision).catch(() => {});
            }}
            onCancel={() => setWebConfirm(null)}
          />

          <ConfirmModal
            visible={webConfirmPago !== null}
            title={webConfirmPago?.decision === "APROBAR" ? "Aprobar pago" : "Rechazar pago"}
            message={
              webConfirmPago?.decision === "APROBAR"
                ? "El pago sera registrado en la venta."
                : "El pago sera rechazado sin registrarse."
            }
            confirmText={webConfirmPago?.decision === "APROBAR" ? "Aprobar" : "Rechazar"}
            confirmVariant={webConfirmPago?.decision === "RECHAZAR" ? "danger" : "primary"}
            onConfirm={() => {
              const pending = webConfirmPago;
              setWebConfirmPago(null);
              if (pending) resolvePago(pending.pagoId, pending.decision).catch(() => {});
            }}
            onCancel={() => setWebConfirmPago(null)}
          />

          <ConfirmModal
            visible={webConfirmLicencia !== null}
            title="Aprobar licencia sanitaria"
            message="El cliente quedará verificado en ventas."
            confirmText="Aprobar"
            confirmVariant="primary"
            onConfirm={() => {
              const pending = webConfirmLicencia;
              setWebConfirmLicencia(null);
              if (pending) resolveLicencia(pending.clienteId, "APROBAR").catch(() => {});
            }}
            onCancel={() => setWebConfirmLicencia(null)}
          />

          <KeyboardAwareModal
            visible={rechazoLicenciaModal !== null}
            onClose={() => setRechazoLicenciaModal(null)}
            cardStyle={{ backgroundColor: C.card, borderColor: C.border }}
          >
            <Text style={{ color: C.text, fontSize: 16, fontWeight: "800", marginBottom: 10 }}>
              Rechazar licencia sanitaria
            </Text>
            <Text style={{ color: C.sub, fontSize: 13, fontWeight: "600", marginBottom: 10 }}>
              El cliente verá este motivo en su ficha y podrá volver a subir el documento.
            </Text>
            <TextInput
              value={rechazoMotivoDraft}
              onChangeText={setRechazoMotivoDraft}
              placeholder="Motivo del rechazo (obligatorio)"
              placeholderTextColor={C.sub}
              multiline
              style={{
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: 12,
                padding: 12,
                minHeight: 90,
                color: C.text,
                fontSize: 14,
                textAlignVertical: "top",
              }}
            />
            <View style={{ flexDirection: "row", marginTop: 16 }}>
              <AppButton
                title="Cancelar"
                variant="outline"
                size="sm"
                style={{ flex: 1 } as any}
                onPress={() => setRechazoLicenciaModal(null)}
              />
              <View style={{ width: 12 }} />
              <AppButton
                title="Rechazar"
                variant="danger"
                size="sm"
                style={{ flex: 1 } as any}
                onPress={confirmRechazarLicencia}
                disabled={!rechazoMotivoDraft.trim()}
              />
            </View>
          </KeyboardAwareModal>
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
    fontSize: Platform.OS === "web" ? 16 : 14,
  },
  cardItem: { borderWidth: 1, borderRadius: 16, padding: 14 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  pillText: { fontSize: 12, fontWeight: "800" },
  meta: { fontSize: 12, fontWeight: "700" },
  title: { marginTop: 8, fontSize: Platform.OS === "web" ? 13 : 12, fontWeight: "700" },
  sub: { marginTop: 4, fontSize: 11, fontWeight: "600" },
  note: { marginTop: 8, fontSize: 11, fontWeight: "600", lineHeight: 18 },
  btnRow: { marginTop: 10, flexDirection: "row", alignItems: "center" },
  rowTopPay: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  vendorPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  vendorPillText: { fontSize: 12, fontWeight: "800" },
  splitWrap: { flex: 1, flexDirection: "row" },
  splitListPane: { width: 420, maxWidth: 420, borderRightWidth: StyleSheet.hairlineWidth },
  splitDetailPane: { flex: 1 },
  splitPlaceholder: { flex: 1, margin: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, alignItems: "center", justifyContent: "center", padding: 24 },
  splitPlaceholderText: { fontSize: 15, fontWeight: "800", textAlign: "center" },
});
