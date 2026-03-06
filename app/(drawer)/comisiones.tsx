import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack, router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  SectionList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton } from "../../components/ui/app-button";
import { RoleGate } from "../../components/auth/RoleGate";
import { ComisionVentaDetallePanel } from "../../components/comisiones/ComisionVentaDetallePanel";
import { supabase } from "../../lib/supabase";
import { useGoHomeOnBack } from "../../lib/useGoHomeOnBack";
import { useThemePref } from "../../lib/themePreference";
import { useRole } from "../../lib/useRole";
import { onAppResumed } from "../../lib/resumeEvents";
import { FB_DARK_DANGER } from "../../src/theme/headerColors";

type RpcComisionRow = {
  vendedor_id: string | null;
  vendedor_codigo: string | null;
  total_con_iva: number | null;
  total_sin_iva: number | null;
  comision_mes: number | null;
};

type CxCVentaRow = {
  venta_id: number;
  fecha: string | null;
  fecha_ultimo_pago: string | null;
  cliente_nombre: string | null;
  vendedor_id: string | null;
  vendedor_codigo: string | null;
  total: number | null;
  pagado: number | null;
  saldo: number | null;
  facturas: string[] | null;
};

type VendedorOption = { vendedor_id: string; vendedor_codigo: string };

function normalizeUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

function safeNumber(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function fmtQ(n: number | string | null | undefined) {
  if (n == null) return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `Q ${x.toFixed(2)}`;
}

function fmtDateLongEs(isoOrYmd: string | null | undefined) {
  if (!isoOrYmd) return "—";
  const raw = String(isoOrYmd).trim();
  if (!raw) return "—";
  if (raw.toUpperCase() === "SIN_FECHA" || raw.toLowerCase() === "sin fecha") return "Sin fecha";
  const ymd = raw.slice(0, 10);
  const d = new Date(`${ymd}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return "—";
  const weekday = new Intl.DateTimeFormat("es-ES", { weekday: "long" }).format(d).toLowerCase();
  const month = new Intl.DateTimeFormat("es-ES", { month: "short" }).format(d).toLowerCase().replace(/\./g, "");
  const day = String(d.getDate()).padStart(2, "0");
  const year = d.getFullYear();
  return `${weekday}, ${day} de ${month} de ${year}`;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function daysInMonthUtc(year: number, monthIndex0: number) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function monthRangeGtIso(year: number, monthIndex0: number) {
  const mm = pad2(monthIndex0 + 1);
  const last = pad2(daysInMonthUtc(year, monthIndex0));
  return {
    desde: `${year}-${mm}-01T00:00:00-06:00`,
    hasta: `${year}-${mm}-${last}T23:59:59-06:00`,
  };
}

const MONTHS_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function nowGtMonthYear() {
  // Forzar referencia a Guatemala (-06) sin depender del tz del dispositivo.
  const gt = new Date(Date.now() - 6 * 60 * 60 * 1000);
  return { year: gt.getUTCFullYear(), monthIndex0: gt.getUTCMonth() };
}

export default function ComisionesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => styles(colors), [colors]);

  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  useGoHomeOnBack(true, "/(drawer)/(tabs)");

  const M = useMemo(
    () => ({
      card: isDark ? "#121214" : "#ffffff",
      text: isDark ? "#F5F5F7" : "#111111",
      sub: isDark ? "rgba(245,245,247,0.80)" : "rgba(0,0,0,0.60)",
      border: isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.14)",
      divider: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
      fieldBg: isDark ? "rgba(255,255,255,0.10)" : "#ffffff",
      back: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)",
      primary: String(colors.primary ?? "#153c9e"),
    }),
    [isDark, colors.primary]
  );

  const { width } = useWindowDimensions();
  const canSplit = Platform.OS === "web" && width >= 1100;
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (!canSplit) setSelectedId(null);
  }, [canSplit]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const style = document.createElement("style");
    style.textContent = "input:focus { outline: none !important; }";
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  const { role, uid, isReady, refreshRole } = useRole();
  const roleUp = normalizeUpper(role);
  const isAdmin = roleUp === "ADMIN";
  const isVentas = roleUp === "VENTAS";
  const isAllowed = isReady && (isAdmin || isVentas);

  useFocusEffect(
    useCallback(() => {
      void refreshRole("focus:comisiones");
    }, [refreshRole])
  );

  // selector de mes
  const init = useMemo(() => nowGtMonthYear(), []);
  const [selYear, setSelYear] = useState<number>(init.year);
  const [selMonthIndex0, setSelMonthIndex0] = useState<number>(init.monthIndex0);
  const [monthOpenIOS, setMonthOpenIOS] = useState(false);

  const monthLabel = useMemo(() => {
    const m = MONTHS_ES[selMonthIndex0] ?? "Mes";
    return `${m} ${selYear}`;
  }, [selMonthIndex0, selYear]);

  const { desde, hasta } = useMemo(() => monthRangeGtIso(selYear, selMonthIndex0), [selYear, selMonthIndex0]);

  const openMonthPicker = useCallback(() => {
    if (Platform.OS === "android") {
      const value = new Date(selYear, selMonthIndex0, 1);
      DateTimePickerAndroid.open({
        value,
        mode: "date",
        onChange: (_ev, date) => {
          if (!date) return;
          setSelYear(date.getFullYear());
          setSelMonthIndex0(date.getMonth());
        },
      });
      return;
    }
    setMonthOpenIOS(true);
  }, [selYear, selMonthIndex0]);

  // filtro vendedor (ADMIN)
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [vendedorOpen, setVendedorOpen] = useState(false);
  const [fVendedorId, setFVendedorId] = useState<string | null>(null);
  const [vendedoresCache, setVendedoresCache] = useState<VendedorOption[]>([]);

  // data
  const [rowsRaw, setRowsRaw] = useState<RpcComisionRow[]>([]);
  const [ventasPagadasRaw, setVentasPagadasRaw] = useState<CxCVentaRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fetchTokenRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  const hasAnyRowsRef = useRef(false);
  useEffect(() => {
    hasAnyRowsRef.current = rowsRaw.length > 0;
  }, [rowsRaw.length]);

  const fetchRows = useCallback(async (): Promise<RpcComisionRow[]> => {
    if (!uid) return [];

    const args: any = {
      p_desde: desde,
      p_hasta: hasta,
      p_iva_pct: 12,
      p_comision_pct: 5,
    };

    // Solo ADMIN puede filtrar por vendedor; VENTAS siempre depende del backend.
    if (isAdmin) args.p_vendedor_id = fVendedorId;

    const { data, error } = await supabase.rpc("rpc_comisiones_resumen_mes", args);
    if (error) throw error;
    return (data ?? []) as RpcComisionRow[];
  }, [desde, hasta, fVendedorId, isAdmin, uid]);

  const fetchVentasPagadas = useCallback(async (): Promise<CxCVentaRow[]> => {
    if (!uid) return [];

    const roleUp = normalizeUpper(role);
    const isAdminLocal = roleUp === "ADMIN";
    const isVentasLocal = roleUp === "VENTAS";

    const params: any = {};
    if (isAdminLocal && fVendedorId) params.p_vendedor_id = fVendedorId;

    const { data, error } = await supabase.rpc("rpc_cxc_ventas", params);
    if (error) throw error;

    const fromMs = new Date(desde).getTime();
    const toMs = new Date(hasta).getTime();

    let rows = (data ?? []) as CxCVentaRow[];
    rows = rows
      .filter((r) => {
        const saldoNum = Number((r as any)?.saldo);
        if (!Number.isFinite(saldoNum)) return false;
        if (!(saldoNum <= 0)) return false;

        const pagoRaw = r?.fecha_ultimo_pago ? String(r.fecha_ultimo_pago) : "";
        const ms = pagoRaw ? new Date(pagoRaw).getTime() : NaN;
        if (!Number.isFinite(ms)) return false;
        if (ms < fromMs || ms > toMs) return false;

        const vid = String(r?.vendedor_id ?? "").trim();
        if (isVentasLocal && uid && vid && vid !== uid) return false;
        if (isAdminLocal && fVendedorId && vid && vid !== fVendedorId) return false;

        return true;
      })
      .sort((a, b) => {
        const ams = a.fecha_ultimo_pago ? new Date(a.fecha_ultimo_pago).getTime() : NaN;
        const bms = b.fecha_ultimo_pago ? new Date(b.fecha_ultimo_pago).getTime() : NaN;
        const aValid = Number.isFinite(ams);
        const bValid = Number.isFinite(bms);
        if (!aValid && !bValid) return 0;
        if (!aValid) return 1;
        if (!bValid) return -1;
        if (ams === bms) return 0;
        return ams > bms ? -1 : 1;
      });

    return rows;
  }, [desde, hasta, fVendedorId, role, uid]);

  useFocusEffect(
    useCallback(() => {
      const token = ++fetchTokenRef.current;
      const showLoading = !hasLoadedOnceRef.current && !hasAnyRowsRef.current;

      // Nunca cargar ni renderizar data antes de resolver el rol.
      if (!isReady) {
        setLoadError(null);
        setInitialLoading(true);
        return () => {
          if (fetchTokenRef.current === token) fetchTokenRef.current++;
        };
      }

      // Si no tiene permisos, evitar cualquier fetch y limpiar cache visible.
      if (!isAllowed) {
        setRowsRaw([]);
        setVentasPagadasRaw([]);
        setLoadError(null);
        setInitialLoading(false);
        return () => {
          if (fetchTokenRef.current === token) fetchTokenRef.current++;
        };
      }

      // Esperar a que auth restaure sesión.
      if (!uid) {
        setLoadError(null);
        setInitialLoading(true);
        return () => {
          if (fetchTokenRef.current === token) fetchTokenRef.current++;
        };
      }

      (async () => {
        try {
          if (showLoading) setInitialLoading(true);
          setLoadError(null);
          const [next, paid] = await Promise.all([fetchRows(), fetchVentasPagadas()]);
          if (fetchTokenRef.current !== token) return;
          setRowsRaw(next);
          setVentasPagadasRaw(paid);
          if (isAdmin && !fVendedorId) {
            const out = (next ?? [])
              .map((r) => {
                const id = String(r.vendedor_id ?? "").trim();
                if (!id) return null;
                const code = String(r.vendedor_codigo ?? "").trim() || id.slice(0, 8);
                return { vendedor_id: id, vendedor_codigo: code };
              })
              .filter(Boolean) as VendedorOption[];
            out.sort((a, b) => String(a.vendedor_codigo).localeCompare(String(b.vendedor_codigo)));
            setVendedoresCache(out);
          }
          hasLoadedOnceRef.current = true;
        } finally {
          if (fetchTokenRef.current === token) setInitialLoading(false);
        }
      })().catch((e: any) => {
        if (fetchTokenRef.current !== token) return;
        const msg = String(e?.message ?? e?.error_description ?? e ?? "Error cargando comisiones");
        setLoadError(msg);
        Alert.alert("Comisiones", msg);
      });

      return () => {
        if (fetchTokenRef.current === token) fetchTokenRef.current++;
      };
    }, [fetchRows, fetchVentasPagadas, fVendedorId, isAdmin, isAllowed, isReady, uid])
  );

  useEffect(() => onAppResumed(() => { void fetchRows(); void fetchVentasPagadas(); }), [fetchRows, fetchVentasPagadas]);

  // Filtrado por rol (defensivo; el backend ya aplica seguridad)
  const rows = useMemo(() => {
    const out = (rowsRaw ?? []).filter((r) => {
      const vid = String(r.vendedor_id ?? "").trim();
      if (isVentas && uid && vid && vid !== uid) return false;
      return true;
    });
    // orden por codigo
    out.sort((a, b) => String(a.vendedor_codigo ?? "").localeCompare(String(b.vendedor_codigo ?? "")));
    return out;
  }, [isVentas, rowsRaw, uid]);

  const totals = useMemo(() => {
    const totalSinIva = rows.reduce((acc, r) => acc + safeNumber(r.total_sin_iva), 0);
    const totalComision = rows.reduce((acc, r) => acc + safeNumber(r.comision_mes), 0);
    return { totalSinIva, totalComision };
  }, [rows]);

  const vendedorLabelById = useMemo(() => {
    const map = new Map<string, string>();
    const base = vendedoresCache.length > 0 ? vendedoresCache : rowsRaw;
    (base as any[]).forEach((r: any) => {
      const id = String(r.vendedor_id ?? "").trim();
      const code = String(r.vendedor_codigo ?? "").trim();
      if (id) map.set(id, code || id.slice(0, 8));
    });
    return map;
  }, [rowsRaw, vendedoresCache]);

  const vendedorLabel = useMemo(() => {
    if (!fVendedorId) return "Todos";
    return vendedorLabelById.get(fVendedorId) ?? "Todos";
  }, [fVendedorId, vendedorLabelById]);

  const limpiarFiltros = () => {
    setFVendedorId(null);
    setVendedorOpen(false);
  };

  const aplicarFiltros = () => {
    setFiltersOpen(false);
    setVendedorOpen(false);
  };

  const renderVentaPagada = useCallback(({ item }: { item: CxCVentaRow }) => {
    const fact = Array.isArray(item.facturas) ? item.facturas.filter(Boolean).join(" · ") : "—";
    return (
      <Pressable
        onPress={() => {
          if (canSplit) {
            setSelectedId(item.venta_id);
          } else {
            router.push({ pathname: "/cxc-venta-detalle", params: { ventaId: String(item.venta_id) } } as any);
          }
        }}
        style={({ pressed }) => [
          s.card,
          canSplit && selectedId === item.venta_id && { borderColor: colors.primary, borderWidth: 2 },
          pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
        ]}
      >
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>
              {item.cliente_nombre ?? "Cliente"}
            </Text>
            <Text style={s.sub}>Facturas: {fact}</Text>
            <Text style={s.sub}>Fecha pago: {fmtDateLongEs(item.fecha_ultimo_pago)}</Text>
            <Text style={s.sub}>Total: {fmtQ(item.total)} · Pagado: {fmtQ(item.pagado)}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.paidBadge}>PAGADA</Text>
          </View>
        </View>
      </Pressable>
    );
  }, [s, canSplit, selectedId, colors.primary]);

  type SectionData = { key: string; ymd: string; data: CxCVentaRow[] };

  const sections = useMemo<SectionData[]>(() => {
    if (ventasPagadasRaw.length === 0) return [];

    const grouped = new Map<string, CxCVentaRow[]>();
    ventasPagadasRaw.forEach((venta) => {
      const ymd = venta?.fecha_ultimo_pago ? String(venta.fecha_ultimo_pago).slice(0, 10) : "SIN_FECHA";
      if (!grouped.has(ymd)) grouped.set(ymd, []);
      grouped.get(ymd)!.push(venta);
    });

    const orderedDays = Array.from(grouped.keys()).sort((a, b) => {
      if (a === b) return 0;
      if (a === "SIN_FECHA") return 1;
      if (b === "SIN_FECHA") return -1;
      return a < b ? 1 : -1;
    });

    return orderedDays.map((ymd) => ({
      key: `s-${ymd}`,
      ymd,
      data: grouped.get(ymd)!,
    }));
  }, [ventasPagadasRaw]);

  const renderSectionHeader = useCallback(({ section }: { section: SectionData }) => (
    <View style={[s.sectionHeader, { backgroundColor: colors.background, alignItems: "flex-end" }]}>
      <Text style={[s.sectionHeaderText, { color: colors.text + "AA" }]}>
        {section.ymd === "SIN_FECHA" ? "Sin fecha" : fmtDateLongEs(section.ymd)}
      </Text>
    </View>
  ), [s, colors]);

  const hasActiveFilters = !!fVendedorId;

  const ListHeader = useMemo(
    () => (
      <>
        <View style={s.topRow}>
          {Platform.OS === "web" ? (
            <input
              type="month"
              value={`${selYear}-${String(selMonthIndex0 + 1).padStart(2, "0")}`}
              onChange={(e) => {
                const val = (e.target as HTMLInputElement).value;
                if (val) {
                  const [yr, mo] = val.split("-").map(Number);
                  setSelYear(yr);
                  setSelMonthIndex0(mo - 1);
                }
              }}
              style={{
                flex: 1,
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: M.border,
                borderRadius: 12,
                padding: 12,
                fontSize: 16,
                fontWeight: "700",
                boxSizing: "border-box",
                backgroundColor: M.card,
                color: M.text,
                fontFamily: "inherit",
                cursor: "pointer",
                outline: "none",
                colorScheme: isDark ? "dark" : "light",
              } as any}
            />
          ) : (
            <Pressable
              onPress={openMonthPicker}
              style={({ pressed }) => [s.searchWrap, pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null]}
            >
              <Text style={s.monthTxt} numberOfLines={1}>
                {monthLabel}
              </Text>
              <Text style={s.monthCaret}>▼</Text>
            </Pressable>
          )}

          {isAdmin ? (
            <Pressable
              onPress={() => setFiltersOpen(true)}
              style={({ pressed }) => [
                s.filterBtn,
                { borderColor: hasActiveFilters ? FB_DARK_DANGER : colors.border },
                pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
              ]}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={[s.filterTxt, { color: hasActiveFilters ? FB_DARK_DANGER : colors.text }]}>Filtros</Text>
                {hasActiveFilters ? (
                  <View style={[s.filterDot, { backgroundColor: FB_DARK_DANGER }]} />
                ) : null}
              </View>
            </Pressable>
          ) : null}
        </View>

        {/* Cards resumen compactas */}
        {isVentas ? (
          <View style={s.summaryBar}>
            <View style={s.summaryItem}>
              <Text style={s.summaryLabel}>Comisión del mes</Text>
              <Text style={s.summaryValue}>{fmtQ(totals.totalComision)}</Text>
            </View>
          </View>
        ) : (
          <View style={s.summaryBar}>
            <View style={s.summaryItem}>
              <Text style={s.summaryLabel}>Sin IVA</Text>
              <Text style={s.summaryValue}>{fmtQ(totals.totalSinIva)}</Text>
            </View>
            <View style={s.summaryDivider} />
            <View style={s.summaryItem}>
              <Text style={s.summaryLabel}>Comisión</Text>
              <Text style={s.summaryValue}>{fmtQ(totals.totalComision)}</Text>
            </View>
          </View>
        )}

        {initialLoading ? (
          <View style={{ paddingVertical: 10 }}>
            <Text style={[s.empty, { paddingTop: 0 }]}>Cargando...</Text>
          </View>
        ) : null}

        {!initialLoading && loadError ? (
          <View style={{ paddingVertical: 10 }}>
            <Text style={[s.empty, { paddingTop: 0 }]}>{loadError}</Text>
          </View>
        ) : null}

        {/* Filas de comisiones (solo rol no-VENTAS) */}
        {!isVentas ? (
          rows.length === 0 && !initialLoading ? (
            <View style={s.card}>
              <Text style={s.empty}>No hay comisiones en este mes</Text>
            </View>
          ) : (
            <View style={[s.card, { paddingHorizontal: 0, paddingVertical: 0, overflow: "hidden", marginBottom: 10 }]}>
              {rows.map((r, idx) => {
                const code = String(r.vendedor_codigo ?? "").trim() || "—";
                return (
                  <View
                    key={String(r.vendedor_id ?? r.vendedor_codigo ?? idx)}
                    style={[
                      s.vendedorRow,
                      idx < rows.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: colors.border,
                      },
                    ]}
                  >
                    <Text style={[s.title, { flex: 1 }]} numberOfLines={1}>{code}</Text>
                    <Text style={s.sub}>Sin IVA: {fmtQ(r.total_sin_iva)}</Text>
                    <Text style={[s.sub, { marginLeft: 12 }]}>Comisión: {fmtQ(r.comision_mes)}</Text>
                  </View>
                );
              })}
            </View>
          )
        ) : null}

        {/* Título sección ventas pagadas */}
        <View style={s.ventasPagadasHeader}>
          <Text style={s.ventasPagadasTitle}>Ventas pagadas</Text>
          <Text style={[s.sub, { marginTop: 0 }]}>{monthLabel}</Text>
        </View>

        {/* Empty state ventas pagadas */}
        {ventasPagadasRaw.length === 0 && !initialLoading ? (
          <View style={s.card}>
            <Text style={s.empty}>No hay ventas pagadas en este mes</Text>
          </View>
        ) : null}
      </>
    ),
    [s, openMonthPicker, monthLabel, selYear, selMonthIndex0, M, isAdmin, isVentas, totals, initialLoading, loadError, rows, ventasPagadasRaw.length, hasActiveFilters, colors.border, colors.text]
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: "Comisiones",
        }}
      />

      <RoleGate
        allow={["ADMIN", "VENTAS"]}
        deniedText="No tienes permiso para ver Comisiones."
        backHref="/(drawer)/(tabs)"
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["bottom"]}>
          {canSplit ? (
            <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.background }}>
              <View style={{ width: 420, maxWidth: 420, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border }}>
                <SectionList<CxCVentaRow, SectionData>
                  style={{ backgroundColor: colors.background }}
                  sections={sections}
                  keyExtractor={(item) => String(item.venta_id)}
                  renderItem={renderVentaPagada}
                  renderSectionHeader={renderSectionHeader}
                  stickySectionHeadersEnabled={true}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  automaticallyAdjustKeyboardInsets
                  contentContainerStyle={{
                    paddingHorizontal: 12,
                    paddingTop: 12,
                    paddingBottom: 16 + insets.bottom,
                  }}
                  ListHeaderComponent={ListHeader}
                  removeClippedSubviews={Platform.OS === "android"}
                  initialNumToRender={14}
                  maxToRenderPerBatch={14}
                  windowSize={9}
                  updateCellsBatchingPeriod={50}
                />
              </View>
              <View style={{ flex: 1 }}>
                {selectedId ? (
                  <ComisionVentaDetallePanel ventaId={selectedId} embedded />
                ) : (
                  <View style={{
                    flex: 1, margin: 16, borderWidth: StyleSheet.hairlineWidth,
                    borderRadius: 18, borderColor: colors.border,
                    alignItems: "center", justifyContent: "center", padding: 24,
                  }}>
                    <Text style={{ fontSize: 15, fontWeight: "800", textAlign: "center", color: colors.text + "99" }}>
                      Selecciona una venta para ver detalles
                    </Text>
                  </View>
                )}
              </View>
            </View>
          ) : (
            <SectionList<CxCVentaRow, SectionData>
              style={{ backgroundColor: colors.background }}
              sections={sections}
              keyExtractor={(item) => String(item.venta_id)}
              renderItem={renderVentaPagada}
              renderSectionHeader={renderSectionHeader}
              stickySectionHeadersEnabled={true}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={{
                paddingHorizontal: 12,
                paddingTop: 12,
                paddingBottom: 16 + insets.bottom,
              }}
              ListHeaderComponent={ListHeader}
              removeClippedSubviews={Platform.OS === "android"}
              initialNumToRender={14}
              maxToRenderPerBatch={14}
              windowSize={9}
              updateCellsBatchingPeriod={50}
            />
          )}

          {/* Modal: seleccionar mes (iOS) */}
          {monthOpenIOS && Platform.OS !== "web" ? (
            <Modal visible={monthOpenIOS} transparent animationType="fade" onRequestClose={() => setMonthOpenIOS(false)}>
              <Pressable style={[s.modalBackdrop, { backgroundColor: M.back }]} onPress={() => setMonthOpenIOS(false)} />
              <View style={[s.modalCard, { top: 14 + insets.top, backgroundColor: M.card, borderColor: M.border }]}>
                <View style={s.modalHeader}>
                  <Text style={[s.modalTitle, { color: M.text }]}>Mes</Text>
                  <Pressable onPress={() => setMonthOpenIOS(false)} hitSlop={10}>
                    <Text style={[s.modalClose, { color: M.sub }]}>Cerrar</Text>
                  </Pressable>
                </View>
                <View style={[s.iosPickerWrap, { borderColor: M.border, backgroundColor: M.fieldBg, marginTop: 12 }]}>
                  <DateTimePicker
                    value={new Date(selYear, selMonthIndex0, 1)}
                    mode="date"
                    display="inline"
                    themeVariant={isDark ? "dark" : "light"}
                    onChange={(_ev, date) => {
                      if (!date) return;
                      setSelYear(date.getFullYear());
                      setSelMonthIndex0(date.getMonth());
                      setMonthOpenIOS(false);
                    }}
                  />
                </View>
              </View>
            </Modal>
          ) : null}

          {/* Modal filtros (ADMIN) */}
          {filtersOpen ? (
            <Modal visible={filtersOpen} transparent animationType="fade" onRequestClose={() => setFiltersOpen(false)}>
              <Pressable style={[s.modalBackdrop, { backgroundColor: M.back }]} onPress={() => setFiltersOpen(false)} />

              <View
                pointerEvents="box-none"
                style={
                  Platform.OS === "web"
                    ? {
                        position: "absolute",
                        top: 0, left: 0, right: 0, bottom: 0,
                        alignItems: "center",
                        justifyContent: "center",
                      }
                    : {
                        position: "absolute",
                        top: 0, left: 0, right: 0, bottom: 0,
                        justifyContent: "flex-start",
                        paddingTop: 14 + insets.top,
                      }
                }
              >
              <View
                style={[
                  s.modalCard,
                  { backgroundColor: M.card, borderColor: M.border },
                  Platform.OS === "web"
                    ? { width: "100%", maxWidth: 480, marginHorizontal: 0 }
                    : null,
                ]}
              >
                <View style={s.modalHeader}>
                  <Text style={[s.modalTitle, { color: M.text }]}>Filtros</Text>
                  <Pressable onPress={() => setFiltersOpen(false)} hitSlop={10}>
                    <Text style={[s.modalClose, { color: M.sub }]}>Cerrar</Text>
                  </Pressable>
                </View>

              <Text style={[s.sectionLabel, { color: M.text }]}>Vendedor</Text>
              <Pressable
                onPress={() => setVendedorOpen((v) => !v)}
                style={[s.dropdownInput, { borderColor: M.border, backgroundColor: M.fieldBg }]}
              >
                <Text style={[s.dropdownText, { color: M.text }]} numberOfLines={1}>
                  {vendedorLabel}
                </Text>
                <Text style={[s.dropdownCaret, { color: M.sub }]}>{vendedorOpen ? "▲" : "▼"}</Text>
              </Pressable>

              {vendedorOpen ? (
                <View style={[s.dropdownPanel, { borderColor: M.border, backgroundColor: M.fieldBg }]}>
                  <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled">
                    <DDRow
                      label="Todos"
                      selected={!fVendedorId}
                      onPress={() => {
                        setFVendedorId(null);
                        setVendedorOpen(false);
                      }}
                      isDark={isDark}
                      M={M}
                    />
                    {(vendedoresCache.length > 0 ? vendedoresCache : rows).map((r: any) => {
                      const id = String(r.vendedor_id ?? "").trim();
                      if (!id) return null;
                      const label = String(r.vendedor_codigo ?? "").trim() || id.slice(0, 8);
                      return (
                        <DDRow
                          key={id}
                          label={label}
                          selected={fVendedorId === id}
                          onPress={() => {
                            setFVendedorId(id);
                            setVendedorOpen(false);
                          }}
                          isDark={isDark}
                          M={M}
                        />
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}

              <View style={s.modalActions}>
                <AppButton title="Limpiar" variant="ghost" size="sm" onPress={limpiarFiltros} />
                <AppButton title="Aplicar" variant="primary" size="sm" onPress={aplicarFiltros} />
              </View>
              </View>
              </View>
            </Modal>
          ) : null}
        </SafeAreaView>
      </RoleGate>
    </>
  );
}

function DDRow({
  label,
  selected,
  onPress,
  isDark,
  M,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  isDark: boolean;
  M: { text: string; primary: any; divider: string };
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: M.divider,
          backgroundColor: selected
            ? isDark
              ? "rgba(0,122,255,0.22)"
              : "rgba(0,122,255,0.12)"
            : "transparent",
        },
        pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
      ]}
    >
      <Text style={{ fontSize: 16, fontWeight: "600", color: selected ? M.primary : M.text }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = (colors: any) =>
  StyleSheet.create({
    topRow: { flexDirection: "row", gap: 10, alignItems: "center", marginBottom: 10 },
    searchWrap: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    monthTxt: { color: colors.text, fontWeight: "800", fontSize: 16, flex: 1, paddingRight: 10 },
    monthCaret: { color: colors.text + "88", fontSize: 14, fontWeight: "900" },

    filterBtn: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    filterTxt: { color: colors.text, fontWeight: "800" },
    filterDot: { width: 8, height: 8, borderRadius: 99 },

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
    total: { color: colors.text, fontWeight: "900", marginTop: 10, fontSize: 14 },

    sectionTitle: { color: colors.text, fontSize: 15, fontWeight: "900" },
    sectionHeader: {
      paddingTop: 8,
      paddingBottom: 6,
      alignItems: "flex-end",
    },
    sectionHeaderText: { fontSize: 13, fontWeight: "900", textAlign: "right" },
    paidBadge: {
      borderWidth: 1,
      borderColor: "#7bfd9b",
      backgroundColor: "#BBF7D0",
      color: "#0a2213",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      fontSize: 12,
      fontWeight: "900",
      overflow: "hidden",
    },

    summaryBar: {
      flexDirection: "row" as const,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 14,
      marginBottom: 10,
      overflow: "hidden" as const,
    },
    summaryItem: { flex: 1, paddingVertical: 10, paddingHorizontal: 14 },
    summaryLabel: { fontSize: 12, fontWeight: "700" as const, color: colors.text + "AA" },
    summaryValue: { fontSize: 16, fontWeight: "900" as const, color: colors.text, marginTop: 2 },
    summaryDivider: {
      width: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: 10,
    },
    vendedorRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    ventasPagadasHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: 4,
      paddingVertical: 6,
      marginBottom: 4,
    },
    ventasPagadasTitle: { fontSize: 15, fontWeight: "900" as const, color: colors.text },

    modalBackdrop: { ...StyleSheet.absoluteFillObject },
    modalCard: {
      marginHorizontal: 14,
      borderRadius: 18,
      padding: 16,
      borderWidth: 1,
    },
    modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    modalTitle: { fontSize: 22, fontWeight: "800" },
    modalClose: { fontSize: 15, fontWeight: "700" },
    sectionLabel: { marginTop: 12, fontSize: 15, fontWeight: "800" },

    dropdownInput: {
      marginTop: 8,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    dropdownText: { fontSize: 16, fontWeight: "600", flex: 1, paddingRight: 10 },
    dropdownCaret: { fontSize: 14, fontWeight: "900" },
    dropdownPanel: { marginTop: 10, borderWidth: 1, borderRadius: 12, overflow: "hidden" },
    iosPickerWrap: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
    modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },
  });
