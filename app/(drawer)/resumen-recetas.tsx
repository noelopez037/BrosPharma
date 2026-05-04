import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { supabase } from "../../lib/supabase";
import { useThemePref } from "../../lib/themePreference";
import { useEmpresaActiva } from "../../lib/useEmpresaActiva";
import { useGoHomeOnBack } from "../../lib/useGoHomeOnBack";
import { useResumeLoad } from "../../lib/useResumeLoad";
import { useRole } from "../../lib/useRole";
import { pad2 } from "../../lib/utils/format";

type ResumenRow = {
  producto_id: number;
  nombre: string;
  stock_inicial: number;
  entradas: number;
  salidas: number;
  stock_final: number;
};

// ─── Helpers de mes ──────────────────────────────────────────────────────────

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

// ─── Tarjeta de producto ─────────────────────────────────────────────────────

type ColVis = { showInicio: boolean; showEntradas: boolean; showVentas: boolean; showFinal: boolean };

const ResumenCard = React.memo(function ResumenCard({
  item,
  s,
  vis,
  onHide,
}: {
  item: ResumenRow;
  s: ReturnType<typeof styles>;
  vis: ColVis;
  onHide: (id: number) => void;
}) {
  return (
    <View style={s.row}>
      <Text style={s.rowName} numberOfLines={1}>{item.nombre}</Text>
      {vis.showInicio   ? <Text style={s.rowNum}>{item.stock_inicial}</Text> : null}
      {vis.showEntradas ? <Text style={[s.rowNum, s.colGreen]}>+{item.entradas}</Text> : null}
      {vis.showVentas   ? <Text style={[s.rowNum, item.salidas > 0 ? s.colRed : null]}>{item.salidas > 0 ? `-${item.salidas}` : "0"}</Text> : null}
      {vis.showFinal    ? <Text style={[s.rowNum, s.colBold]}>{item.stock_final}</Text> : null}
      <Pressable onPress={() => onHide(item.producto_id)} style={s.hideBtn} hitSlop={8}>
        <Text style={s.hideBtnTxt}>×</Text>
      </Pressable>
    </View>
  );
});

// ─── Pantalla principal ───────────────────────────────────────────────────────

export default function ResumenRecetasScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomRail = insets.bottom;
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
      fieldBg: isDark ? "rgba(255,255,255,0.10)" : "#ffffff",
      back: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)",
      primary: String(colors.primary ?? "#153c9e"),
    }),
    [isDark, colors.primary]
  );

  // CSS reset para inputs web
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const styleTag = document.createElement("style");
    styleTag.textContent = "input:focus { outline: none !important; }";
    document.head.appendChild(styleTag);
    return () => { document.head.removeChild(styleTag); };
  }, []);

  // ─── Role & empresa ───────────────────────────────────────────────────────
  const { refreshRole } = useRole();
  const { empresaActivaId, isReady } = useEmpresaActiva();

  useFocusEffect(
    useCallback(() => {
      void refreshRole("focus:resumen-recetas");
    }, [refreshRole])
  );

  // ─── Selector de mes ──────────────────────────────────────────────────────
  const init = useMemo(() => nowGtMonthYear(), []);
  const [selYear, setSelYear] = useState(init.year);
  const [selMonthIndex0, setSelMonthIndex0] = useState(init.monthIndex0);
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

  // ─── Productos ocultos ────────────────────────────────────────────────────
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());
  const hideProduct = useCallback((id: number) =>
    setHiddenIds((prev) => new Set([...prev, id])), []);
  const showAll = useCallback(() => setHiddenIds(new Set()), []);

  // ─── Columnas visibles ────────────────────────────────────────────────────
  const [showInicio, setShowInicio] = useState(true);
  const [showEntradas, setShowEntradas] = useState(true);
  const [showVentas, setShowVentas] = useState(true);
  const [showFinal, setShowFinal] = useState(true);

  // ─── Datos ────────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<ResumenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchResumen = useCallback(async () => {
    if (!isReady) return;
    if (!empresaActivaId) { setRows([]); setLoading(false); return; }

    setLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.rpc("rpc_resumen_recetas_mes", {
        p_empresa_id: empresaActivaId,
        p_desde: desde,
        p_hasta: hasta,
      });
      if (error) throw error;
      setRows((data ?? []) as ResumenRow[]);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [empresaActivaId, isReady, desde, hasta]);

  useEffect(() => { void fetchResumen(); }, [fetchResumen]);
  useResumeLoad(empresaActivaId, () => { void fetchResumen(); });

  // ─── Filas visibles y totales ────────────────────────────────────────────
  const visibleRows = useMemo(
    () => rows.filter((r) => !hiddenIds.has(r.producto_id)),
    [rows, hiddenIds]
  );

  const totales = useMemo(() => {
    return visibleRows.reduce(
      (acc, r) => ({
        stock_inicial: acc.stock_inicial + r.stock_inicial,
        entradas: acc.entradas + r.entradas,
        salidas: acc.salidas + r.salidas,
        stock_final: acc.stock_final + r.stock_final,
      }),
      { stock_inicial: 0, entradas: 0, salidas: 0, stock_final: 0 }
    );
  }, [rows]);

  // ─── Render ───────────────────────────────────────────────────────────────
  const vis: ColVis = { showInicio, showEntradas, showVentas, showFinal };

  const renderItem = useCallback(
    ({ item }: { item: ResumenRow }) => <ResumenCard item={item} s={s} vis={vis} onHide={hideProduct} />,
    [s, showInicio, showEntradas, showVentas, showFinal, hideProduct] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const isWeb = Platform.OS === "web";

  const MonthHeader = (
    <View style={[s.stickyTop, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
      <View style={s.monthRow}>
        <Pressable onPress={prevMonth} style={[s.arrowBtn, { borderColor: M.border, backgroundColor: M.card }]} hitSlop={10}>
          <Text style={[s.arrowTxt, { color: M.text }]}>‹</Text>
        </Pressable>

        {isWeb ? (
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
              borderColor: M.border,
              borderRadius: 12,
              padding: "10px 14px",
              fontSize: 16,
              fontWeight: "800",
              boxSizing: "border-box",
              backgroundColor: M.card,
              color: M.text,
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
              { borderColor: M.border, backgroundColor: M.fieldBg },
              pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
            ]}
          >
            <Text style={[s.monthTxt, { color: M.text }]}>{monthLabel}</Text>
            <Text style={[s.monthCaret, { color: M.sub }]}>▼</Text>
          </Pressable>
        )}

        <Pressable onPress={nextMonth} style={[s.arrowBtn, { borderColor: M.border, backgroundColor: M.card }]} hitSlop={10}>
          <Text style={[s.arrowTxt, { color: M.text }]}>›</Text>
        </Pressable>
      </View>

      {/* Chips para ocultar/mostrar columnas */}
      <View style={s.chipsRow}>
        {(
          [
            { label: "Inicio",   active: showInicio,   toggle: () => setShowInicio((v) => !v) },
            { label: "Entradas", active: showEntradas, toggle: () => setShowEntradas((v) => !v) },
            { label: "Ventas",   active: showVentas,   toggle: () => setShowVentas((v) => !v) },
            { label: "Final",    active: showFinal,    toggle: () => setShowFinal((v) => !v) },
          ] as const
        ).map(({ label, active, toggle }) => (
          <Pressable
            key={label}
            onPress={toggle}
            style={[
              s.chip,
              {
                borderColor: active ? M.primary : M.border,
                backgroundColor: active
                  ? (isDark ? "rgba(0,122,255,0.22)" : "rgba(0,122,255,0.12)")
                  : "transparent",
              },
            ]}
          >
            <Text style={[s.chipTxt, { color: active ? M.primary : M.sub }]}>{label}</Text>
          </Pressable>
        ))}

        {hiddenIds.size > 0 ? (
          <Pressable onPress={showAll} style={[s.chip, { borderColor: M.border }]}>
            <Text style={[s.chipTxt, { color: M.sub }]}>
              Mostrar todos ({hiddenIds.size})
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: "Resumen recetas del mes" }} />

      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["bottom"]}>
        {MonthHeader}

        {/* Encabezado de columnas fijo */}
        <View style={[s.colHeader, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          <Text style={[s.colHeaderName, { color: M.sub }]}>Producto</Text>
          {vis.showInicio   ? <Text style={[s.colHeaderNum, { color: M.sub }]}>Inicio</Text>   : null}
          {vis.showEntradas ? <Text style={[s.colHeaderNum, { color: M.sub }]}>Entradas</Text> : null}
          {vis.showVentas   ? <Text style={[s.colHeaderNum, { color: M.sub }]}>Ventas</Text>   : null}
          {vis.showFinal    ? <Text style={[s.colHeaderNum, { color: M.sub }]}>Final</Text>    : null}
        </View>

        <FlatList<ResumenRow>
          style={{ flex: 1, backgroundColor: colors.background }}
          data={visibleRows}
          keyExtractor={(it) => String(it.producto_id)}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={Platform.OS === "web" ? 999 : 20}
          maxToRenderPerBatch={Platform.OS === "web" ? 999 : 20}
          windowSize={Platform.OS === "web" ? 999 : 7}
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingTop: 4,
            paddingBottom: 16 + bottomRail,
          }}
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator style={{ marginTop: 32 }} />
            ) : (
              <View style={s.center}>
                <Text style={s.empty}>
                  {errorMsg ?? `Sin productos con receta en ${monthLabel}`}
                </Text>
              </View>
            )
          }
          ListFooterComponent={
            rows.length > 0 ? (
              <View style={[s.totalesRow, { borderTopColor: colors.border, backgroundColor: M.card }]}>
                <Text style={[s.rowName, { color: M.text, fontWeight: "900" }]}>TOTALES</Text>
                {vis.showInicio   ? <Text style={[s.rowNum, { color: M.text, fontWeight: "900" }]}>{totales.stock_inicial}</Text> : null}
                {vis.showEntradas ? <Text style={[s.rowNum, s.colGreen, { fontWeight: "900" }]}>+{totales.entradas}</Text> : null}
                {vis.showVentas   ? <Text style={[s.rowNum, totales.salidas > 0 ? s.colRed : { color: M.text }, { fontWeight: "900" }]}>{totales.salidas > 0 ? `-${totales.salidas}` : "0"}</Text> : null}
                {vis.showFinal    ? <Text style={[s.rowNum, { color: M.text, fontWeight: "900" }]}>{totales.stock_final}</Text> : null}
              </View>
            ) : null
          }
        />

        {/* Modal: seleccionar mes (iOS) */}
        {monthOpenIOS && Platform.OS !== "web" ? (
          <Modal
            visible={monthOpenIOS}
            transparent
            animationType="fade"
            onRequestClose={() => setMonthOpenIOS(false)}
          >
            <Pressable
              style={[s.modalBackdrop, { backgroundColor: M.back }]}
              onPress={() => setMonthOpenIOS(false)}
            />
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
      </SafeAreaView>
    </>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = (colors: any) =>
  StyleSheet.create({
    stickyTop: {
      paddingHorizontal: 12,
      paddingTop: 12,
      paddingBottom: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      zIndex: 50,
      ...(Platform.OS === "android" ? { elevation: 50 } : null),
    },
    monthRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    arrowBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
      borderWidth: 1,
    },
    arrowTxt: { fontSize: 22, fontWeight: "900", lineHeight: 26 },
    monthBtn: {
      flex: 1,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    monthTxt: { fontWeight: "800", fontSize: Platform.OS === "web" ? 16 : 14 },
    monthCaret: { fontSize: 14, fontWeight: "900" },
    chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
    chip: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    chipTxt: { fontSize: 12, fontWeight: "700" },

    center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 48 },
    empty: { color: colors.text, textAlign: "center", paddingHorizontal: 24 },

    // Encabezado de columnas
    colHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    colHeaderName: {
      flex: 3,
      fontSize: 10,
      fontWeight: "800",
      textTransform: "uppercase",
    },
    colHeaderNum: {
      width: 64,
      textAlign: "right",
      fontSize: 10,
      fontWeight: "800",
      textTransform: "uppercase",
    },

    // Fila compacta por producto
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 0,
      paddingVertical: 9,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowName: {
      flex: 3,
      color: colors.text,
      fontSize: Platform.OS === "web" ? 13 : 12,
      fontWeight: "600",
    },
    rowNum: {
      width: 64,
      textAlign: "right",
      color: colors.text,
      fontSize: Platform.OS === "web" ? 14 : 13,
      fontWeight: "700",
    },
    colGreen: { color: "#16a34a" },
    colRed: { color: "#dc2626" },
    colBold: { fontWeight: "900" },
    hideBtn: { paddingHorizontal: 6, paddingVertical: 4 },
    hideBtnTxt: { color: colors.text + "44", fontSize: 18, fontWeight: "900", lineHeight: 20 },

    // Fila de totales
    totalesRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 10,
      borderTopWidth: 2,
      marginTop: 2,
      borderRadius: 0,
    },

    modalBackdrop: { ...StyleSheet.absoluteFillObject },
    modalCard: {
      position: "absolute",
      left: 14,
      right: 14,
      borderRadius: 18,
      padding: 16,
      borderWidth: 1,
    },
    modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    modalTitle: { fontSize: Platform.OS === "web" ? 22 : 18, fontWeight: "800" },
    modalClose: { fontSize: Platform.OS === "web" ? 15 : 13, fontWeight: "700" },
    iosPickerWrap: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  });
