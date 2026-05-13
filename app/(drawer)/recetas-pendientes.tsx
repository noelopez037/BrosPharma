import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack, router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useRole } from "../../lib/useRole";
import { useEmpresaActiva } from "../../lib/useEmpresaActiva";
import { useThemePref } from "../../lib/themePreference";
import { AppButton } from "../../components/ui/app-button";
import { VentaDetallePanel } from "../../components/ventas/VentaDetallePanel";
import { useGoHomeOnBack } from "../../lib/useGoHomeOnBack";
import { useResumeLoad } from "../../lib/useResumeLoad";
import { onVentaEstadoChanged } from "../../lib/ventaEstadoEvents";
import { normalizeUpper } from "../../lib/utils/text";
import { pad2, toGTDateKey } from "../../lib/utils/format";

// ─── Helpers de mes ───────────────────────────────────────────────────────────

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
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function nowGtMonthYear() {
  const gt = new Date(Date.now() - 6 * 60 * 60 * 1000);
  return { year: gt.getUTCFullYear(), monthIndex0: gt.getUTCMonth() };
}

type Colors = {
  bg: string; card: string; text: string; sub: string;
  border: string; tint: string;
  chipAmberBg: string; chipAmberText: string;
  badgeNuevo: string; badgeFacturado: string; badgeEnRuta: string;
};

type VentaRow = {
  id: number;
  fecha: string | null;
  estado: string;
  cliente_nombre: string | null;
  vendedor_id: string | null;
  vendedor_codigo: string | null;
};

type VendedorRow = { id: string; label: string };

function shortUid(u: string | null | undefined) {
  const s = String(u ?? "").trim();
  return s ? s.slice(0, 8) : "—";
}

function estadoLabel(estado: string) {
  switch (normalizeUpper(estado)) {
    case "NUEVO": return "NUEVO";
    case "FACTURADO": return "FACTURADO";
    case "EN_RUTA": return "EN RUTA";
    case "ENTREGADO": return "ENTREGADO";
    default: return normalizeUpper(estado) || "—";
  }
}

const RecetaCard = React.memo(function RecetaCard({
  item,
  vendedorLabel,
  C,
  onPress,
}: {
  item: VentaRow;
  vendedorLabel: string;
  C: Colors;
  onPress: () => void;
}) {
  const estado = normalizeUpper(item.estado);
  const badgeColor =
    estado === "NUEVO" ? C.badgeNuevo :
    estado === "FACTURADO" ? C.badgeFacturado :
    estado === "EN_RUTA" ? C.badgeEnRuta :
    C.sub;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.card,
        { borderColor: C.border, backgroundColor: C.card },
        pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
      ]}
    >
      <View style={s.cardTopRow}>
        <Text style={[s.cardTitle, { color: C.text, flex: 1 }]} numberOfLines={2}>
          {item.cliente_nombre ?? "—"}
        </Text>
        <View style={[s.badge, { borderColor: badgeColor }]}>
          <Text style={[s.badgeText, { color: badgeColor }]}>{estadoLabel(item.estado)}</Text>
        </View>
      </View>
      <Text style={[s.cardSub, { color: C.sub }]}>
        #{item.id} · {toGTDateKey(item.fecha) || "—"}
      </Text>
      <Text style={[s.cardSub, { color: C.sub }]}>Vendedor: {vendedorLabel}</Text>
      <View style={s.chipsRow}>
        <View style={[s.chip, { backgroundColor: C.chipAmberBg, borderColor: C.border }]}>
          <Text style={[s.chipText, { color: C.chipAmberText }]}>Falta receta</Text>
        </View>
      </View>
    </Pressable>
  );
});

export default function RecetasPendientesScreen() {
  const { colors } = useTheme();
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";
  const { width } = useWindowDimensions();
  const canSplit = Platform.OS === "web" && width >= 1100;

  useGoHomeOnBack(true, "/(drawer)/(tabs)");
  const insets = useSafeAreaInsets();

  const { role, uid, isReady, refreshRole } = useRole();
  const { empresaActivaId } = useEmpresaActiva();
  const roleUp = normalizeUpper(role ?? "");
  const isAdmin = isReady && roleUp === "ADMIN";
  const isSelf = isReady && (roleUp === "VENTAS" || roleUp === "MENSAJERO");

  useFocusEffect(
    useCallback(() => {
      void refreshRole("focus:recetas-pendientes");
    }, [refreshRole])
  );

  const C = useMemo<Colors>(
    () => ({
      bg: colors.background ?? (isDark ? "#000" : "#fff"),
      card: colors.card ?? (isDark ? "#121214" : "#fff"),
      text: colors.text ?? (isDark ? "#fff" : "#111"),
      sub: colors.text ? colors.text + "66" : isDark ? "rgba(255,255,255,0.65)" : "#666",
      border: colors.border ?? (isDark ? "rgba(255,255,255,0.14)" : "#e5e5e5"),
      tint: String(colors.primary ?? "#153c9e"),
      chipAmberBg: isDark ? "rgba(255,201,107,0.18)" : "rgba(255,170,0,0.12)",
      chipAmberText: isDark ? "rgba(255,201,107,0.92)" : "#b25a00",
      badgeNuevo: isDark ? "#6b9fff" : "#153c9e",
      badgeFacturado: isDark ? "#7be07b" : "#196b19",
      badgeEnRuta: isDark ? "#ffb84d" : "#b25a00",
    }),
    [colors, isDark]
  );

  // ─── Selector de mes ────────────────────────────────────────────────────────
  const initMonth = useMemo(() => nowGtMonthYear(), []);
  const [selYear, setSelYear] = useState(initMonth.year);
  const [selMonthIndex0, setSelMonthIndex0] = useState(initMonth.monthIndex0);
  const [monthOpenIOS, setMonthOpenIOS] = useState(false);

  const monthLabel = useMemo(
    () => `${MONTHS_ES[selMonthIndex0] ?? "Mes"} ${selYear}`,
    [selMonthIndex0, selYear]
  );

  const { desde, hasta } = useMemo(
    () => monthRangeGtIso(selYear, selMonthIndex0),
    [selYear, selMonthIndex0]
  );

  const prevMonth = useCallback(() => {
    setSelMonthIndex0((m) => {
      if (m === 0) { setSelYear((y) => y - 1); return 11; }
      return m - 1;
    });
  }, []);

  const nextMonth = useCallback(() => {
    setSelMonthIndex0((m) => {
      if (m === 11) { setSelYear((y) => y + 1); return 0; }
      return m + 1;
    });
  }, []);

  const openMonthPicker = useCallback(() => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: new Date(selYear, selMonthIndex0, 1),
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

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tmpVendedorId, setTmpVendedorId] = useState<string | null>(null);
  const [selectedVendedorId, setSelectedVendedorId] = useState<string | null>(null);
  const [vendedorOpen, setVendedorOpen] = useState(false);

  const [selectedVentaId, setSelectedVentaId] = useState<number | null>(null);

  React.useEffect(() => {
    if (!canSplit) setSelectedVentaId(null);
  }, [canSplit]);

  const [rows, setRows] = useState<VentaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [vendedores, setVendedores] = useState<VendedorRow[]>([]);
  const [vendedoresMap, setVendedoresMap] = useState<Map<string, string>>(new Map());
  const [selfLabel, setSelfLabel] = useState("");

  // Label propio
  useEffect(() => {
    if (!uid) { setSelfLabel(""); return; }
    let alive = true;
    (async () => {
      const { data } = await supabase.from("profiles").select("codigo,full_name").eq("id", uid).maybeSingle();
      if (!alive) return;
      setSelfLabel(
        String(data?.codigo ?? "").trim() || String(data?.full_name ?? "").trim() || shortUid(uid)
      );
    })();
    return () => { alive = false; };
  }, [uid]);

  // Vendedores (solo admin)
  useEffect(() => {
    if (!isAdmin || !empresaActivaId) { setVendedores([]); return; }
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id,codigo,full_name,role")
        .not("role", "is", null)
        .order("codigo", { ascending: true });
      if (!alive) return;
      const out: VendedorRow[] = (data ?? [])
        .filter((x: any) => ["ADMIN", "VENTAS", "MENSAJERO"].includes(normalizeUpper(x?.role)))
        .map((x: any) => {
          const id = String(x.id ?? "").trim();
          if (!id) return null;
          const label = String(x.codigo ?? "").trim() || String(x.full_name ?? "").trim() || id.slice(0, 8);
          return { id, label };
        })
        .filter(Boolean) as VendedorRow[];
      const map = new Map<string, string>();
      out.forEach((v) => map.set(v.id, v.label));
      if (alive) { setVendedores(out); setVendedoresMap(map); }
    })();
    return () => { alive = false; };
  }, [isAdmin, empresaActivaId]);

  const fetchRows = useCallback(
    async (vendedorId: string | null) => {
      if (!empresaActivaId) return [] as VentaRow[];
      setErrorMsg(null);

      let query = supabase
        .from("ventas")
        .select("id,fecha,estado,cliente_nombre,vendedor_id,vendedor_codigo")
        .eq("empresa_id", empresaActivaId)
        .eq("requiere_receta", true)
        .eq("receta_cargada", false)
        .neq("estado", "ANULADO")
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha", { ascending: false })
        .order("id", { ascending: false });

      if (isSelf && uid) {
        query = query.eq("vendedor_id", uid);
      } else if (isAdmin && vendedorId) {
        query = query.eq("vendedor_id", vendedorId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as VentaRow[];
    },
    [empresaActivaId, isAdmin, isSelf, uid, desde, hasta]
  );

  const load = useCallback(
    async (vendedorId: string | null, silent = false) => {
      if (!silent) setLoading(true);
      try {
        setRows(await fetchRows(vendedorId));
      } catch (e: any) {
        setErrorMsg(e?.message ?? "Error al cargar");
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [fetchRows]
  );

  useFocusEffect(
    useCallback(() => {
      void load(selectedVendedorId);
    }, [load, selectedVendedorId])
  );

  useResumeLoad(empresaActivaId, () => { void load(selectedVendedorId, true); });

  useEffect(() => {
    return onVentaEstadoChanged(() => { void load(selectedVendedorId); });
  }, [load, selectedVendedorId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { setRows(await fetchRows(selectedVendedorId)); }
    catch (e: any) { setErrorMsg(e?.message ?? "Error"); }
    finally { setRefreshing(false); }
  }, [fetchRows, selectedVendedorId]);

  const openFilters = useCallback(() => {
    setTmpVendedorId(selectedVendedorId);
    setVendedorOpen(false);
    setFiltersOpen(true);
  }, [selectedVendedorId]);

  const aplicarFiltros = useCallback(() => {
    const vid = isAdmin ? tmpVendedorId : null;
    setSelectedVendedorId(vid);
    setFiltersOpen(false);
    setVendedorOpen(false);
    setLoading(true);
    (async () => {
      try { setRows(await fetchRows(vid)); }
      catch (e: any) { setErrorMsg(e?.message ?? "Error"); setRows([]); }
      finally { setLoading(false); }
    })();
  }, [fetchRows, isAdmin, tmpVendedorId]);

  const openDetail = useCallback((id: number) => {
    if (canSplit) {
      setSelectedVentaId(id);
      return;
    }
    router.push({
      pathname: "/venta-detalle",
      params: { ventaId: String(id), returnTo: "/(drawer)/recetas-pendientes" },
    } as any);
  }, [canSplit]);

  const getVendedorLabel = useCallback(
    (item: VentaRow) => {
      if (item.vendedor_codigo) return String(item.vendedor_codigo).trim();
      if (!item.vendedor_id) return "—";
      if (item.vendedor_id === uid) return selfLabel || shortUid(item.vendedor_id);
      return vendedoresMap.get(item.vendedor_id) ?? shortUid(item.vendedor_id);
    },
    [uid, selfLabel, vendedoresMap]
  );

  const renderItem = useCallback(
    ({ item }: { item: VentaRow }) => (
      <RecetaCard
        item={item}
        vendedorLabel={getVendedorLabel(item)}
        C={C}
        onPress={() => openDetail(item.id)}
      />
    ),
    [C, getVendedorLabel, openDetail]
  );

  const selectedVendedorLabel = selectedVendedorId
    ? (vendedores.find((v) => v.id === selectedVendedorId)?.label ?? selectedVendedorId.slice(0, 8))
    : null;

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Recetas pendientes",
          headerBackTitle: "Atrás",
          gestureEnabled: false,
        }}
      />

      {/* Barra superior */}
      <View style={[s.header, { backgroundColor: C.bg, borderBottomColor: C.border }]}>
        {/* Selector de mes */}
        <View style={s.monthRow}>
          <Pressable onPress={prevMonth} style={[s.arrowBtn, { borderColor: C.border, backgroundColor: C.card }]} hitSlop={10}>
            <Text style={[s.arrowTxt, { color: C.text }]}>‹</Text>
          </Pressable>

          {Platform.OS === "web" ? (
            <input
              type="month"
              value={`${selYear}-${pad2(selMonthIndex0 + 1)}`}
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
                borderColor: C.border,
                borderRadius: 12,
                padding: "10px 14px",
                fontSize: 15,
                fontWeight: "800",
                boxSizing: "border-box",
                backgroundColor: C.card,
                color: C.text,
                fontFamily: "inherit",
                cursor: "pointer",
                outline: "none",
                colorScheme: isDark ? "dark" : "light",
                textAlign: "center",
              } as any}
            />
          ) : (
            <Pressable
              onPress={openMonthPicker}
              style={({ pressed }) => [
                s.monthBtn,
                { borderColor: C.border, backgroundColor: C.card },
                pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
              ]}
            >
              <Text style={[s.monthTxt, { color: C.text }]}>{monthLabel}</Text>
              <Text style={[s.monthCaret, { color: C.sub }]}>▼</Text>
            </Pressable>
          )}

          <Pressable onPress={nextMonth} style={[s.arrowBtn, { borderColor: C.border, backgroundColor: C.card }]} hitSlop={10}>
            <Text style={[s.arrowTxt, { color: C.text }]}>›</Text>
          </Pressable>
        </View>

        <View style={[s.topRow, { marginTop: 8 }]}>
          <View style={{ flex: 1 }}>
            {isSelf && selfLabel ? (
              <Text style={[s.selfLabel, { color: C.sub }]}>Mostrando solo: {selfLabel}</Text>
            ) : selectedVendedorLabel ? (
              <Text style={[s.selfLabel, { color: C.sub }]}>Vendedor: {selectedVendedorLabel}</Text>
            ) : isAdmin ? (
              <Text style={[s.selfLabel, { color: C.sub }]}>Todos los vendedores</Text>
            ) : null}
            {errorMsg ? (
              <Text style={[s.errorText, { color: "#e53e3e" }]}>{errorMsg}</Text>
            ) : null}
          </View>
          {isAdmin ? (
            <Pressable
              onPress={openFilters}
              style={({ pressed }) => [
                s.filterBtn,
                { borderColor: C.border, backgroundColor: C.card },
                pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
              ]}
            >
              <Text style={[s.filterTxt, { color: C.text }]}>Filtros</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Modal vendedor (solo admin) */}
      <Modal
        visible={filtersOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFiltersOpen(false)}
      >
        <Pressable
          style={[s.backdrop, { backgroundColor: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)" }]}
          onPress={() => { setFiltersOpen(false); setVendedorOpen(false); }}
        />
        <View style={[s.modalCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={s.modalHeader}>
            <Text style={[s.modalTitle, { color: C.text }]}>Filtrar por vendedor</Text>
            <Pressable onPress={() => setFiltersOpen(false)} hitSlop={10}>
              <Text style={[s.modalClose, { color: C.sub }]}>Cerrar</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() => setVendedorOpen((v) => !v)}
            style={[s.dropdown, { borderColor: C.border, backgroundColor: C.bg }]}
          >
            <Text style={[s.dropdownTxt, { color: C.text }]} numberOfLines={1}>
              {tmpVendedorId
                ? (vendedores.find((v) => v.id === tmpVendedorId)?.label ?? "Vendedor")
                : "Todos"}
            </Text>
            <Text style={[s.caret, { color: C.sub }]}>{vendedorOpen ? "▲" : "▼"}</Text>
          </Pressable>

          {vendedorOpen ? (
            <View style={[s.ddPanel, { borderColor: C.border, backgroundColor: C.bg }]}>
              <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled">
                <Pressable onPress={() => { setTmpVendedorId(null); setVendedorOpen(false); }} style={s.ddRow}>
                  <Text style={[s.ddTxt, { color: C.text }]}>Todos</Text>
                </Pressable>
                {vendedores.map((v) => (
                  <Pressable key={v.id} onPress={() => { setTmpVendedorId(v.id); setVendedorOpen(false); }} style={s.ddRow}>
                    <Text style={[s.ddTxt, { color: C.text }]}>{v.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={s.modalActions}>
            <AppButton title="Todos" variant="ghost" size="sm" onPress={() => { setTmpVendedorId(null); setVendedorOpen(false); }} />
            <AppButton title="Aplicar" size="sm" onPress={aplicarFiltros} />
          </View>
        </View>
      </Modal>

      {/* Modal: seleccionar mes (iOS) */}
      {monthOpenIOS && Platform.OS !== "web" ? (
        <Modal
          visible={monthOpenIOS}
          transparent
          animationType="fade"
          onRequestClose={() => setMonthOpenIOS(false)}
        >
          <Pressable
            style={[s.backdrop, { backgroundColor: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)" }]}
            onPress={() => setMonthOpenIOS(false)}
          />
          <View style={[s.modalCard, { top: 14 + insets.top, backgroundColor: C.card, borderColor: C.border }]}>
            <View style={s.modalHeader}>
              <Text style={[s.modalTitle, { color: C.text }]}>Mes</Text>
              <Pressable onPress={() => setMonthOpenIOS(false)} hitSlop={10}>
                <Text style={[s.modalClose, { color: C.sub }]}>Cerrar</Text>
              </Pressable>
            </View>
            <View style={[s.iosPickerWrap, { borderColor: C.border, backgroundColor: C.bg, marginTop: 12 }]}>
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

      {canSplit ? (
        <View style={[s.splitWrap, { borderTopColor: C.border }]}>
          <View style={[s.splitListPane, { borderRightColor: C.border }]}>
            <FlatList
              data={rows}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
              keyboardShouldPersistTaps="handled"
              renderItem={renderItem}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.tint} colors={[C.tint]} />
              }
              initialNumToRender={999}
              maxToRenderPerBatch={999}
              windowSize={999}
              ListEmptyComponent={
                <Text style={[s.emptyTxt, { color: C.sub }]}>
                  {loading ? "Cargando..." : "Sin ventas con receta pendiente"}
                </Text>
              }
            />
          </View>
          <View style={s.splitDetailPane}>
            {selectedVentaId ? (
              <VentaDetallePanel ventaId={selectedVentaId} embedded />
            ) : (
              <View style={[s.splitPlaceholder, { borderColor: C.border }]}>
                <Text style={[s.splitPlaceholderText, { color: C.sub }]}>
                  Selecciona una venta para ver detalles
                </Text>
              </View>
            )}
          </View>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.tint} colors={[C.tint]} />
          }
          initialNumToRender={14}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews={Platform.OS === "android"}
          ListEmptyComponent={
            <Text style={[s.emptyTxt, { color: C.sub }]}>
              {loading ? "Cargando..." : "Sin ventas con receta pendiente"}
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  selfLabel: { fontSize: 12, fontWeight: "700" },
  errorText: { marginTop: 4, fontSize: 12, fontWeight: "700" },
  filterBtn: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  filterTxt: { fontWeight: "800", fontSize: 13 },

  monthRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  arrowBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 10, borderWidth: 1 },
  arrowTxt: { fontSize: 22, fontWeight: "900", lineHeight: 26 },
  monthBtn: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthTxt: { fontWeight: "800", fontSize: Platform.OS === "web" ? 15 : 14 },
  monthCaret: { fontSize: 14, fontWeight: "900" },
  iosPickerWrap: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },

  backdrop: { ...StyleSheet.absoluteFillObject },
  modalCard: { position: "absolute", left: 14, right: 14, top: 90, borderRadius: 18, padding: 16, borderWidth: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  modalTitle: { fontSize: Platform.OS === "web" ? 20 : 17, fontWeight: "800" },
  modalClose: { fontSize: 13, fontWeight: "700" },
  dropdown: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dropdownTxt: { fontSize: 14, fontWeight: "600", flex: 1, paddingRight: 10 },
  caret: { fontSize: 14, fontWeight: "900" },
  ddPanel: { marginTop: 8, borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  ddRow: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  ddTxt: { fontSize: 13, fontWeight: "600" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },

  splitWrap: { flex: 1, flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth },
  splitListPane: { width: 520, maxWidth: 520, borderRightWidth: StyleSheet.hairlineWidth },
  splitDetailPane: { flex: 1 },
  splitPlaceholder: { flex: 1, margin: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, alignItems: "center", justifyContent: "center", padding: 24 },
  splitPlaceholderText: { fontSize: 15, fontWeight: "800", textAlign: "center" },

  card: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 },
  cardTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardTitle: { fontSize: 13, fontWeight: "900" },
  cardSub: { marginTop: 5, fontSize: 11, fontWeight: "700" },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "900" },
  chipsRow: { flexDirection: "row", marginTop: 10 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontSize: 11, fontWeight: "900" },
  emptyTxt: { padding: 16, fontWeight: "700" },
});
