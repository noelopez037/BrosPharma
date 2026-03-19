// app/compras.tsx
// FIX teclado:
// - FlatList SIEMPRE montado (no alternar loading ? <ActivityIndicator> : <FlatList>)
// - initialLoading solo para primera carga
// - ListHeaderComponent sigue, pero no se desmonta porque FlatList nunca se desmonta
// ✅ UX: limpiar buscador al salir de la pantalla (useFocusEffect cleanup)
// ✅ UX: agregar "X" a la derecha del buscador para borrar texto
// ✅ UX: badge con colores (verde pagada, AMARILLO pendiente, ROJO vencida) + días para vencer en crédito
// ✅ Filtros: botón junto al buscador + modal
// ✅ Dropdown proveedor: maxHeight + scroll (SIN FlatList para evitar warning VirtualizedLists)
// ✅ Fechas: DateTimePicker (sin instalar nada)
// ✅ iOS: al elegir fecha SE CIERRA el calendario
// ✅ Modal respeta tema (dark/light) + mejor contraste en dark

import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack, router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SectionList,
  Modal,
  Platform,
  PlatformColor,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useThemePref } from "../../lib/themePreference";
import { AppButton } from "../../components/ui/app-button";
import { useGoHomeOnBack } from "../../lib/useGoHomeOnBack";
import { useEmpresaActiva } from "../../lib/useEmpresaActiva";
import { useRole } from "../../lib/useRole";
import { useResumeLoad } from "../../lib/useResumeLoad";
import { CompraDetallePanel } from "../../components/compras/CompraDetallePanel";
import { CompraNuevaModal } from "../../components/compras/CompraNuevaModal";
import { fmtQ, fmtDate, fmtDateLongEs } from "../../lib/utils/format";
import { normalizeUpper, safeIlike } from "../../lib/utils/text";
import { FB_DARK_DANGER } from "../../src/theme/headerColors";


// Carga silenciosa: evitar spinners y evitar doble fetch en mount.

type CompraRow = {
  id: number;
  fecha: string | null;
  proveedor: string | null;
  proveedor_id: number | null;
  numero_factura: string | null;
  tipo_pago: string | null;
  fecha_vencimiento: string | null;
  monto_total: number | null;
  saldo_pendiente: number | null;
  estado: string | null;
};

type ProveedorRow = { id: number; nombre: string };
type PayFilter = "ALL" | "PAID" | "PENDING" | "OVERDUE";
type CompraSection = { title: string; data: CompraRow[] };

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function parseYmdToDate(iso: string) {
  const ymd = String(iso).slice(0, 10);
  return new Date(`${ymd}T12:00:00`);
}
function dayDiffFromToday(isoYmdOrIso: string) {
  const due = parseYmdToDate(isoYmdOrIso);
  const now = new Date();
  const today = new Date(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}T12:00:00`
  );
  const ms = due.getTime() - today.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

// ─── Badge logic (module-level, sin dependencias de estado) ───────────────────
function badge(c: CompraRow) {
  const estado = normalizeUpper(c.estado);
  const tipo = normalizeUpper(c.tipo_pago);
  const saldo = Number(c.saldo_pendiente ?? 0);

  if (estado === "ANULADA") return { text: "ANULADA", kind: "muted" as const };
  if (tipo === "CONTADO") return { text: "PAGADA", kind: "ok" as const };

  if (tipo === "CREDITO") {
    if (saldo <= 0) return { text: "PAGADA", kind: "ok" as const };

    if (c.fecha_vencimiento) {
      const d = dayDiffFromToday(c.fecha_vencimiento);
      if (d < 0) return { text: `VENCIDA • ${Math.abs(d)}d`, kind: "overdue" as const };
      if (d === 0) return { text: "PENDIENTE • HOY", kind: "warn" as const };
      return { text: `PENDIENTE • ${d}d`, kind: "warn" as const };
    }
    return { text: "PENDIENTE", kind: "warn" as const };
  }

  return { text: estado || tipo || "—", kind: "muted" as const };
}

// ─── Card memoizado para evitar re-renders innecesarios ───────────────────────
const CompraCard = React.memo(function CompraCard({
  item,
  s,
  onPress,
  selected,
  tint,
}: {
  item: CompraRow;
  s: any;
  onPress: (id: number) => void;
  selected?: boolean;
  tint: string;
}) {
  const b = badge(item);
  const tipo = normalizeUpper(item.tipo_pago);
  const showSaldo = tipo === "CREDITO";
  return (
    <Pressable
      style={[s.card, selected ? { borderColor: tint, borderWidth: 2 } : null]}
      onPress={() => onPress(item.id)}
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
              b.kind === "overdue" && s.badgeOverdue,
              b.kind === "muted" && s.badgeMuted,
            ]}
            numberOfLines={1}
          >
            {b.text}
          </Text>

          <Text style={s.total}>{fmtQ(item.monto_total)}</Text>

          {showSaldo ? <Text style={s.saldo}>Saldo: {fmtQ(item.saldo_pendiente)}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
});

export default function ComprasScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomRail = insets.bottom;
  const s = useMemo(() => styles(colors), [colors]);

  // ✅ respetar toggle dark/light
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const canSplit = isWeb && width >= 1100;

  const [selectedCompraId, setSelectedCompraId] = useState<number | null>(null);
  const [nuevaCompraOpen, setNuevaCompraOpen] = useState(false);

  React.useEffect(() => {
    if (!canSplit) {
      setSelectedCompraId(null);
    }
  }, [canSplit]);

  React.useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const styleTag = document.createElement("style");
    styleTag.textContent = `input:focus { outline: none !important; }`;
    document.head.appendChild(styleTag);
    return () => {
      document.head.removeChild(styleTag);
    };
  }, []);

  // UX: swipe-back / back siempre regresa a Inicio.
  useGoHomeOnBack(true, "/(drawer)/(tabs)");

  const M = useMemo(
    () => ({
      card: isDark ? "#121214" : "#ffffff",
      text: isDark ? "#F5F5F7" : "#111111",
      sub: isDark ? "rgba(245,245,247,0.80)" : "rgba(0,0,0,0.60)", // ✅ más claro en dark
      border: isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.14)",
      divider: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
      fieldBg: isDark ? "rgba(255,255,255,0.10)" : "#ffffff", // ✅ un poco más claro
      back: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)",
      primary: String(colors.primary ?? "#153c9e"),
    }),
    [isDark, colors.primary]
  );

  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q.trim(), 250);

  const [rowsRaw, setRowsRaw] = useState<CompraRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const hasLoadedOnceRef = useRef(false);
  const hasAnyRowsRef = useRef(false);
  // ─── Protección contra respuestas fuera de orden ──────────────────────────
  const requestSeqRef = useRef(0);

  useEffect(() => {
    hasAnyRowsRef.current = rowsRaw.length > 0;
  }, [rowsRaw.length]);

  const { role, refreshRole } = useRole();
  const { empresaActivaId } = useEmpresaActiva();
  const roleUp = normalizeUpper(role);
  const canManage = roleUp === "ADMIN" || roleUp === "BODEGA";

  useFocusEffect(
    useCallback(() => {
      void refreshRole("focus:compras");
    }, [refreshRole])
  );

  // filtros
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [proveedores, setProveedores] = useState<ProveedorRow[]>([]);
  const [provOpen, setProvOpen] = useState(false);

  const [fProveedorId, setFProveedorId] = useState<number | null>(null);
  const [fProveedorQ, setFProveedorQ] = useState("");
  const [fDesde, setFDesde] = useState<Date | null>(null);
  const [fHasta, setFHasta] = useState<Date | null>(null);
  const [fPago, setFPago] = useState<PayFilter>("ALL");

  // iOS pickers
  const [showDesdeIOS, setShowDesdeIOS] = useState(false);
  const [showHastaIOS, setShowHastaIOS] = useState(false);

  useFocusEffect(
    useCallback(() => {
      return () => {
        setQ("");
        setProvOpen(false);
        setShowDesdeIOS(false);
        setShowHastaIOS(false);

        // ✅ limpiar filtros al salir para que al regresar esté limpio
        setFiltersOpen(false);
        setFProveedorId(null);
        setFDesde(null);
        setFHasta(null);
        setFPago("ALL");
      };
    }, [])
  );

  // proveedores
  useEffect(() => {
    if (!empresaActivaId) return;
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("proveedores")
          .select("id,nombre")
          .eq("empresa_id", empresaActivaId)
          .eq("activo", true)
          .order("nombre", { ascending: true });

        if (error) throw error;
        if (alive) setProveedores((data ?? []) as any);
      } catch {
        if (alive) setProveedores([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [empresaActivaId]);

  const fetchCompras = useCallback(async () => {
    // ─── Protección contra race conditions ──────────────────────────────────
    requestSeqRef.current += 1;
    const mySeq = requestSeqRef.current;

    if (!empresaActivaId) return;
    let req = supabase
      .from("compras")
      .select(
        "id,fecha,proveedor,proveedor_id,numero_factura,tipo_pago,fecha_vencimiento,monto_total,saldo_pendiente,estado"
      )
      .eq("empresa_id", empresaActivaId)
      .order("fecha", { ascending: false });

    if (dq) { const safe = safeIlike(dq); req = req.or(`proveedor.ilike.%${safe}%,numero_factura.ilike.%${safe}%`); }

    // filtros server-side simples
    if (fProveedorId) req = req.eq("proveedor_id", fProveedorId);
    if (fDesde) req = req.gte("fecha", startOfDay(fDesde).toISOString());
    if (fHasta) req = req.lte("fecha", endOfDay(fHasta).toISOString());

    const { data, error } = await req;

    // Descartar respuesta si ya hay una más reciente en vuelo
    if (mySeq !== requestSeqRef.current) return;

    if (error) {
      setErrorMsg("Error cargando compras");
      return;
    }
    setErrorMsg(null);
    setRowsRaw((data ?? []) as CompraRow[]);
  }, [dq, fProveedorId, fDesde, fHasta, empresaActivaId]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const showLoading = !hasLoadedOnceRef.current && !hasAnyRowsRef.current;
      (async () => {
        try {
          if (showLoading && alive) setInitialLoading(true);
          await fetchCompras();
          hasLoadedOnceRef.current = true;
        } finally {
          if (showLoading && alive) setInitialLoading(false);
        }
      })().catch(() => {
        if (showLoading && alive) setInitialLoading(false);
      });

      return () => {
        alive = false;
      };
    }, [fetchCompras])
  );

  useResumeLoad(empresaActivaId, () => { void fetchCompras(); });

  // filtro client-side: estado pago (porque depende de cálculo)
  const rows = useMemo(() => {
    if (fPago === "ALL") return rowsRaw;

    return rowsRaw.filter((r) => {
      const tipo = normalizeUpper(r.tipo_pago);
      const saldo = Number(r.saldo_pendiente ?? 0);

      const isPaid = tipo === "CONTADO" || (tipo === "CREDITO" && saldo <= 0);
      if (fPago === "PAID") return isPaid;

      if (tipo !== "CREDITO" || saldo <= 0) return false;

      const fv = r.fecha_vencimiento;
      if (!fv) return fPago === "PENDING";

      const d = dayDiffFromToday(fv);
      if (fPago === "OVERDUE") return d < 0;
      if (fPago === "PENDING") return d >= 0;
      return true;
    });
  }, [rowsRaw, fPago]);

  const sections = useMemo<CompraSection[]>(() => {
    const out: CompraSection[] = [];
    let lastKey: string | null = null;

    rows.forEach((item) => {
      const ymd = item.fecha ? String(item.fecha).slice(0, 10) : "SIN_FECHA";
      if (ymd !== lastKey) {
        out.push({ title: ymd === "SIN_FECHA" ? "Sin fecha" : ymd, data: [] });
        lastKey = ymd;
      }
      out[out.length - 1].data.push(item);
    });

    return out;
  }, [rows]);

  const openCompra = useCallback(
    (id: number) => {
      if (canSplit) {
        setSelectedCompraId(id);
        return;
      }
      router.push({ pathname: "/compra-detalle", params: { id: String(id) } });
    },
    [canSplit]
  );

  // ─── renderItem memoizado ─────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: CompraRow }) => (
      <CompraCard
        item={item}
        s={s}
        onPress={openCompra}
        selected={selectedCompraId === item.id}
        tint={M.primary}
      />
    ),
    [s, openCompra, selectedCompraId, M.primary]
  );

  const renderSectionHeader = ({ section }: { section: CompraSection }) => (
    <View style={[s.sectionHeader, { backgroundColor: colors.background, alignItems: "flex-end" }]}>
      <Text style={[s.sectionHeaderText, { color: M.sub, textAlign: "right" }]}>
        {section.title === "Sin fecha" ? "Sin fecha" : fmtDateLongEs(section.title)}
      </Text>
    </View>
  );

  const fabBg =
    Platform.OS === "ios" ? (PlatformColor("systemBlue") as any) : (colors.primary as any);

  const hasActiveFilters = !!(fProveedorId || fDesde || fHasta || fPago !== "ALL");

  const proveedorLabel = useMemo(() => {
    if (!fProveedorId) return "Todos";
    const p = proveedores.find((x) => x.id === fProveedorId);
    return p?.nombre ?? "Todos";
  }, [fProveedorId, proveedores]);

  const filteredProveedores = useMemo(() => {
    const q = fProveedorQ.trim().toLowerCase();
    if (!q) return [];
    return proveedores.filter((p) => p.nombre.toLowerCase().includes(q));
  }, [proveedores, fProveedorQ]);

  const openDesdePicker = () => {
    setProvOpen(false);

    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: fDesde ?? new Date(),
        mode: "date",
        onChange: (_ev, date) => {
          if (date) setFDesde(date);
        },
      });
    } else {
      setShowDesdeIOS(true);
      setShowHastaIOS(false);
    }
  };

  const openHastaPicker = () => {
    setProvOpen(false);

    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: fHasta ?? new Date(),
        mode: "date",
        onChange: (_ev, date) => {
          if (date) setFHasta(date);
        },
      });
    } else {
      setShowHastaIOS(true);
      setShowDesdeIOS(false);
    }
  };

  const limpiarFiltros = () => {
    setFProveedorId(null);
    setFDesde(null);
    setFHasta(null);
    setFPago("ALL");
    setProvOpen(false);
    setShowDesdeIOS(false);
    setShowHastaIOS(false);
  };

  const aplicarFiltros = () => {
    setFiltersOpen(false);
    setProvOpen(false);
    setShowDesdeIOS(false);
    setShowHastaIOS(false);
    // fetchCompras se dispara por dependencias (fProveedorId/fDesde/fHasta) automáticamente
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Compras",
        }}
      />

      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["bottom"]}>
        {canSplit ? (
          <View style={s.splitWrap}>
            <View style={[s.splitListPane, { borderRightColor: colors.border }]}>
              <View style={[s.stickyTop, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
                <View style={s.topRow}>
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
                      <Pressable onPress={() => setQ("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Borrar búsqueda" style={s.clearBtn}>
                        <Text style={s.clearTxt}>×</Text>
                      </Pressable>
                    ) : null}
                  </View>
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
                      {hasActiveFilters ? <View style={[s.filterDot, { backgroundColor: FB_DARK_DANGER }]} /> : null}
                    </View>
                  </Pressable>
                </View>
                {initialLoading ? (
                  <View style={{ paddingVertical: 10 }}>
                    <Text style={[s.empty, { paddingTop: 0 }]}>Cargando...</Text>
                  </View>
                ) : null}
              </View>
              <SectionList<CompraRow, CompraSection>
                style={{ flex: 1, backgroundColor: colors.background }}
                sections={sections}
                keyExtractor={(it: CompraRow) => String(it.id)}
                renderItem={renderItem}
                renderSectionHeader={renderSectionHeader}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                automaticallyAdjustKeyboardInsets
                stickySectionHeadersEnabled={true}
                initialNumToRender={12}
                maxToRenderPerBatch={12}
                windowSize={7}
                updateCellsBatchingPeriod={50}
                contentContainerStyle={{
                  paddingHorizontal: 12,
                  paddingTop: 12,
                  paddingBottom: 16 + bottomRail,
                }}
                ListHeaderComponent={<View style={{ height: 0 }} />}
                ListEmptyComponent={
                  !initialLoading ? (
                    <View style={s.center}>
                      <Text style={s.empty}>{errorMsg ?? "Sin compras"}</Text>
                    </View>
                  ) : null
                }
              />
              {canManage ? (
                <Pressable
                  style={[s.fab, { backgroundColor: fabBg, bottom: 18 + bottomRail }]}
                  onPress={() => setNuevaCompraOpen(true)}
                >
                  <Text style={s.fabText}>＋</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={s.splitDetailPane}>
              {selectedCompraId ? (
                <CompraDetallePanel
                  compraId={selectedCompraId}
                  embedded
                  onRefresh={() => fetchCompras().catch(() => {})}
                  onDeleted={() => { setSelectedCompraId(null); fetchCompras().catch(() => {}); }}
                />
              ) : (
                <View style={[s.splitPlaceholder, { borderColor: colors.border }]}>
                  <Text style={[s.splitPlaceholderText, { color: M.sub }]}>
                    Selecciona una compra para ver detalles
                  </Text>
                </View>
              )}
            </View>
          </View>
        ) : (
          <>
            <View style={{ paddingHorizontal: 12, paddingTop: 12, backgroundColor: colors.background }}>
              <View style={s.topRow}>
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
                    <Pressable onPress={() => setQ("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Borrar búsqueda" style={s.clearBtn}>
                      <Text style={s.clearTxt}>×</Text>
                    </Pressable>
                  ) : null}
                </View>
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
                    {hasActiveFilters ? <View style={[s.filterDot, { backgroundColor: FB_DARK_DANGER }]} /> : null}
                  </View>
                </Pressable>
              </View>
              {initialLoading ? (
                <View style={{ paddingVertical: 10 }}>
                  <Text style={[s.empty, { paddingTop: 0 }]}>Cargando...</Text>
                </View>
              ) : null}
            </View>
            <SectionList<CompraRow, CompraSection>
              style={{ backgroundColor: colors.background }}
              sections={sections}
              keyExtractor={(it: CompraRow) => String(it.id)}
              renderItem={renderItem}
              renderSectionHeader={renderSectionHeader}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets
              stickySectionHeadersEnabled={true}
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={7}
              updateCellsBatchingPeriod={50}
              contentContainerStyle={{
                paddingHorizontal: 12,
                paddingTop: 12,
                paddingBottom: 16 + bottomRail,
              }}
              ListHeaderComponent={<View style={{ height: 0 }} />}
              ListEmptyComponent={
                !initialLoading ? (
                  <View style={s.center}>
                    <Text style={s.empty}>{errorMsg ?? "Sin compras"}</Text>
                  </View>
                ) : null
              }
            />
          </>
        )}

        {canManage && !canSplit ? (
          <Pressable
            style={[s.fab, { backgroundColor: fabBg, bottom: 18 + bottomRail }]}
            onPress={() => {
              if (Platform.OS === "web") {
                setNuevaCompraOpen(true);
              } else {
                router.push("/compra-nueva");
              }
            }}
          >
            <Text style={s.fabText}>＋</Text>
          </Pressable>
        ) : null}

        <CompraNuevaModal
          visible={nuevaCompraOpen}
          onClose={() => setNuevaCompraOpen(false)}
          onDone={() => { setNuevaCompraOpen(false); fetchCompras().catch(() => {}); }}
          isDark={isDark}
          colors={{ card: M.card, text: M.text, border: M.border, sub: M.sub }}
        />

        {/* MODAL FILTROS */}
        {filtersOpen ? (
          <Modal
            visible={filtersOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setFiltersOpen(false)}
          >
            <Pressable
              style={[s.modalBackdrop, { backgroundColor: M.back }]}
              onPress={() => setFiltersOpen(false)}
            />

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
                      paddingTop: insets.top + 12,
                    }
              }
            >
            <View
              style={[
                s.modalCard,
                {
                  backgroundColor: M.card,
                  borderColor: M.border,
                  maxHeight: "80%",
                },
                Platform.OS === "web"
                  ? { width: "100%", maxWidth: 480, marginHorizontal: 0 }
                  : null,
              ]}
            >
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <View style={s.modalHeader}>
                  <Text style={[s.modalTitle, { color: M.text }]}>Filtros</Text>
                  <Pressable onPress={() => setFiltersOpen(false)} hitSlop={10}>
                    <Text style={[s.modalClose, { color: M.sub }]}>Cerrar</Text>
                  </Pressable>
                </View>

              {/* Proveedor */}
              <Text style={[s.sectionLabel, { color: M.text }]}>Proveedor</Text>

              <Pressable
                onPress={() => {
                  setProvOpen((v) => !v);
                  setShowDesdeIOS(false);
                  setShowHastaIOS(false);
                }}
                style={[s.dropdownInput, { borderColor: M.border, backgroundColor: M.fieldBg }]}
              >
                <Text style={[s.dropdownText, { color: M.text }]} numberOfLines={1}>
                  {proveedorLabel}
                </Text>
                <Text style={[s.dropdownCaret, { color: M.sub }]}>{provOpen ? "▲" : "▼"}</Text>
              </Pressable>

              {provOpen ? (
                <View style={[s.dropdownPanel, { borderColor: M.border, backgroundColor: M.fieldBg }]}>
                  <ScrollView style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled">
                    <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
                      <TextInput
                        value={fProveedorQ}
                        onChangeText={setFProveedorQ}
                        placeholder="Buscar proveedor..."
                        placeholderTextColor={isDark ? "rgba(245,245,247,0.6)" : "rgba(0,0,0,0.5)"}
                        style={[
                          { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, color: M.text, borderColor: M.border },
                          Platform.OS === "web" ? { outlineWidth: 0 } as any : null,
                        ]}
                        autoCapitalize="none"
                        returnKeyType="search"
                      />
                    </View>
                    <DDRow
                      label="Todos"
                      selected={!fProveedorId}
                      onPress={() => { setFProveedorId(null); setProvOpen(false); setFProveedorQ(""); }}
                      isDark={isDark}
                      M={M}
                    />
                    {filteredProveedores.map((p) => (
                      <DDRow
                        key={String(p.id)}
                        label={p.nombre}
                        selected={fProveedorId === p.id}
                        onPress={() => { setFProveedorId(p.id); setProvOpen(false); setFProveedorQ(""); }}
                        isDark={isDark}
                        M={M}
                      />
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              {/* Fechas */}
              <View style={{ height: 10 }} />

              <View style={s.twoCols}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.sectionLabel, { color: M.text }]}>Desde</Text>
                  {Platform.OS === "web" ? (
                    <input
                      type="date"
                      value={fDesde ? fDesde.toISOString().slice(0, 10) : ""}
                      onChange={(e) => {
                        const val = (e.target as HTMLInputElement).value;
                        setFDesde(val ? new Date(`${val}T12:00:00`) : null);
                      }}
                      style={{
                        marginTop: 8,
                        borderWidth: 1,
                        borderStyle: "solid",
                        borderColor: M.border,
                        borderRadius: 12,
                        padding: 12,
                        fontSize: 16,
                        fontWeight: "700",
                        width: "100%",
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
                      onPress={openDesdePicker}
                      style={[s.dateBox, { borderColor: M.border, backgroundColor: M.fieldBg }]}
                    >
                      <Text style={[s.dateTxt, { color: M.text }]}>
                        {fDesde ? fmtDate(fDesde.toISOString()) : "—"}
                      </Text>
                    </Pressable>
                  )}
                </View>

                <View style={{ width: 12 }} />

                <View style={{ flex: 1 }}>
                  <Text style={[s.sectionLabel, { color: M.text }]}>Hasta</Text>
                  {Platform.OS === "web" ? (
                    <input
                      type="date"
                      value={fHasta ? fHasta.toISOString().slice(0, 10) : ""}
                      onChange={(e) => {
                        const val = (e.target as HTMLInputElement).value;
                        setFHasta(val ? new Date(`${val}T12:00:00`) : null);
                      }}
                      style={{
                        marginTop: 8,
                        borderWidth: 1,
                        borderStyle: "solid",
                        borderColor: M.border,
                        borderRadius: 12,
                        padding: 12,
                        fontSize: 16,
                        fontWeight: "700",
                        width: "100%",
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
                      onPress={openHastaPicker}
                      style={[s.dateBox, { borderColor: M.border, backgroundColor: M.fieldBg }]}
                    >
                      <Text style={[s.dateTxt, { color: M.text }]}>
                        {fHasta ? fmtDate(fHasta.toISOString()) : "—"}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>

              {/* iOS inline: cerrar al seleccionar */}
              {Platform.OS === "ios" && showDesdeIOS ? (
                <View style={[s.iosPickerWrap, { borderColor: M.border, backgroundColor: M.fieldBg }]}>
                  <DateTimePicker
                    value={fDesde ?? new Date()}
                    mode="date"
                    display="inline"
                    themeVariant={isDark ? "dark" : "light"}
                    onChange={(_ev, date) => {
                      if (date) {
                        setFDesde(date);
                        setShowDesdeIOS(false); // ✅ CIERRA al escoger
                      }
                    }}
                  />
                </View>
              ) : null}

              {Platform.OS === "ios" && showHastaIOS ? (
                <View style={[s.iosPickerWrap, { borderColor: M.border, backgroundColor: M.fieldBg }]}>
                  <DateTimePicker
                    value={fHasta ?? new Date()}
                    mode="date"
                    display="inline"
                    themeVariant={isDark ? "dark" : "light"}
                    onChange={(_ev, date) => {
                      if (date) {
                        setFHasta(date);
                        setShowHastaIOS(false); // ✅ CIERRA al escoger
                      }
                    }}
                  />
                </View>
              ) : null}

              {/* Estado */}
              <View style={{ height: 10 }} />
              <Text style={[s.sectionLabel, { color: M.text }]}>Estado de pago</Text>

              <View style={s.chipsRow}>
                <Chip text="Todos" active={fPago === "ALL"} onPress={() => setFPago("ALL")} M={M} isDark={isDark} />
                <Chip text="Pagadas" active={fPago === "PAID"} onPress={() => setFPago("PAID")} M={M} isDark={isDark} />
                <Chip text="Pendientes" active={fPago === "PENDING"} onPress={() => setFPago("PENDING")} M={M} isDark={isDark} />
                <Chip text="Vencidas" active={fPago === "OVERDUE"} onPress={() => setFPago("OVERDUE")} M={M} isDark={isDark} />
              </View>

              {/* Acciones */}
              <View style={s.modalActions}>
                <AppButton title="Limpiar" variant="ghost" size="sm" onPress={limpiarFiltros} />
                <AppButton title="Aplicar" variant="primary" size="sm" onPress={aplicarFiltros} />
              </View>
              </ScrollView>
            </View>
            </View>
          </Modal>
        ) : null}
      </SafeAreaView>
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

function Chip({
  text,
  active,
  onPress,
  M,
  isDark,
}: {
  text: string;
  active: boolean;
  onPress: () => void;
  M: { border: string; text: string; primary: any };
  isDark: boolean;
}) {
  const border = active ? M.primary : M.border;
  const bg = active ? (isDark ? "rgba(0,122,255,0.22)" : "rgba(0,122,255,0.12)") : "transparent";
  const txt = active ? M.primary : M.text;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          borderWidth: 1,
          borderColor: border,
          backgroundColor: bg,
          borderRadius: 999,
          paddingHorizontal: 12,
          paddingVertical: 8,
          marginRight: 10,
          marginBottom: 10,
        },
        pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
      ]}
    >
      <Text style={{ fontWeight: "700", color: txt }}>{text}</Text>
    </Pressable>
  );
}

const styles = (colors: any) =>
  StyleSheet.create({
    topRow: { flexDirection: "row", gap: 10, alignItems: "center", marginBottom: 10 },
    stickyTop: {
      paddingHorizontal: 12,
      paddingTop: 12,
      paddingBottom: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      zIndex: 50,
      ...(Platform.OS === "android" ? { elevation: 50 } : null),
    },

    searchWrap: {
      flex: 1,
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
      ...(Platform.OS === "web" ? { outlineWidth: 0 } : null),
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
    sectionHeader: { paddingTop: 8, paddingBottom: 6, alignItems: "flex-end" },
    sectionHeaderText: {
      fontSize: 13,
      fontWeight: "900",
      textAlign: "right",
    },

    card: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: 12,
      borderRadius: 14,
      marginBottom: 10,
    },

    row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
    title: { color: colors.text, fontSize: 13, fontWeight: "700" },
    sub: { color: colors.text + "AA", marginTop: 6, fontSize: 11 },

    badge: {
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      fontSize: 12,
      fontWeight: "900",
      color: colors.text,
      overflow: "hidden",
    },

    // ✅ tus colores exactos
    badgeWarn: { borderColor: "#ffe868", backgroundColor: "#fffd7f", color: "#111111" },
    badgeOverdue: { borderColor: "#ff7e77", backgroundColor: "#FFB3AE", color: "#111111" },
    badgeOk: { borderColor: "#7bfd9b", backgroundColor: "#BBF7D0", color: "#0a2213" },
    badgeMuted: { color: colors.text + "AA", backgroundColor: "transparent" },

    total: { color: colors.text, fontWeight: "900", marginTop: 10, fontSize: 14 },

    saldo: { color: colors.text + "AA", marginTop: 4, fontSize: 11, fontWeight: "800" },

    splitWrap: { flex: 1, flexDirection: "row" as const },
    splitListPane: { width: 420, maxWidth: 420, borderRightWidth: StyleSheet.hairlineWidth },
    splitDetailPane: { flex: 1 },
    splitPlaceholder: {
      flex: 1,
      margin: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 18,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      padding: 24,
    },
    splitPlaceholderText: { fontSize: 15, fontWeight: "800" as const, textAlign: "center" as const },

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

    // Modal
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

    twoCols: { flexDirection: "row", marginTop: 8 },
    dateBox: {
      marginTop: 8,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    dateTxt: { fontSize: 16, fontWeight: "700" },

    iosPickerWrap: { marginTop: 10, borderWidth: 1, borderRadius: 12, overflow: "hidden" },

    chipsRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 10 },

    modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },

    btnGhost: {
      borderWidth: 1,
      borderRadius: 14,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    btnGhostTxt: { fontSize: 16, fontWeight: "800" },

    btnPrimary: { borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12 },
    btnPrimaryTxt: { fontSize: 16, fontWeight: "900", color: "#fff" },
  });
