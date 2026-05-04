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

const ResumenCard = React.memo(function ResumenCard({
  item,
  s,
}: {
  item: ResumenRow;
  s: ReturnType<typeof styles>;
}) {
  return (
    <View style={s.card}>
      <Text style={s.cardName} numberOfLines={2}>{item.nombre}</Text>
      <View style={s.cardCols}>
        <View style={s.col}>
          <Text style={s.colLabel}>Inicio</Text>
          <Text style={s.colValue}>{item.stock_inicial}</Text>
        </View>
        <View style={s.colDivider} />
        <View style={s.col}>
          <Text style={s.colLabel}>Entradas</Text>
          <Text style={[s.colValue, s.colGreen]}>+{item.entradas}</Text>
        </View>
        <View style={s.colDivider} />
        <View style={s.col}>
          <Text style={s.colLabel}>Ventas</Text>
          <Text style={[s.colValue, item.salidas > 0 ? s.colRed : null]}>
            {item.salidas > 0 ? `-${item.salidas}` : "0"}
          </Text>
        </View>
        <View style={s.colDivider} />
        <View style={s.col}>
          <Text style={s.colLabel}>Final</Text>
          <Text style={[s.colValue, s.colBold]}>{item.stock_final}</Text>
        </View>
      </View>
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
    }),
    [isDark]
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

  // ─── Totales ──────────────────────────────────────────────────────────────
  const totales = useMemo(() => {
    return rows.reduce(
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
  const renderItem = useCallback(
    ({ item }: { item: ResumenRow }) => <ResumenCard item={item} s={s} />,
    [s]
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
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: "Resumen recetas del mes" }} />

      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["bottom"]}>
        {MonthHeader}

        <FlatList<ResumenRow>
          style={{ flex: 1, backgroundColor: colors.background }}
          data={rows}
          keyExtractor={(it) => String(it.producto_id)}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={Platform.OS === "web" ? 999 : 15}
          maxToRenderPerBatch={Platform.OS === "web" ? 999 : 15}
          windowSize={Platform.OS === "web" ? 999 : 7}
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingTop: 12,
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
              <View style={[s.totalesCard, { borderColor: M.border, backgroundColor: M.card }]}>
                <Text style={[s.totalesTitle, { color: M.text }]}>Totales</Text>
                <View style={s.cardCols}>
                  <View style={s.col}>
                    <Text style={[s.colLabel, { color: M.sub }]}>Inicio</Text>
                    <Text style={[s.colValue, { color: M.text }]}>{totales.stock_inicial}</Text>
                  </View>
                  <View style={[s.colDivider, { backgroundColor: M.border }]} />
                  <View style={s.col}>
                    <Text style={[s.colLabel, { color: M.sub }]}>Entradas</Text>
                    <Text style={[s.colValue, s.colGreen]}>+{totales.entradas}</Text>
                  </View>
                  <View style={[s.colDivider, { backgroundColor: M.border }]} />
                  <View style={s.col}>
                    <Text style={[s.colLabel, { color: M.sub }]}>Ventas</Text>
                    <Text style={[s.colValue, totales.salidas > 0 ? s.colRed : { color: M.text }]}>
                      {totales.salidas > 0 ? `-${totales.salidas}` : "0"}
                    </Text>
                  </View>
                  <View style={[s.colDivider, { backgroundColor: M.border }]} />
                  <View style={s.col}>
                    <Text style={[s.colLabel, { color: M.sub }]}>Final</Text>
                    <Text style={[s.colValue, s.colBold, { color: M.text }]}>{totales.stock_final}</Text>
                  </View>
                </View>
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

    center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 48 },
    empty: { color: colors.text, textAlign: "center", paddingHorizontal: 24 },

    card: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: 12,
      borderRadius: 14,
      marginBottom: 10,
    },
    cardName: {
      color: colors.text,
      fontWeight: "700",
      fontSize: Platform.OS === "web" ? 14 : 13,
      marginBottom: 10,
    },
    cardCols: { flexDirection: "row", alignItems: "center" },
    col: { flex: 1, alignItems: "center" },
    colDivider: {
      width: StyleSheet.hairlineWidth,
      height: 36,
      backgroundColor: colors.border,
    },
    colLabel: {
      color: colors.text + "AA",
      fontSize: 10,
      fontWeight: "700",
      marginBottom: 4,
      textTransform: "uppercase",
    },
    colValue: {
      color: colors.text,
      fontSize: Platform.OS === "web" ? 16 : 15,
      fontWeight: "800",
    },
    colGreen: { color: "#16a34a" },
    colRed: { color: "#dc2626" },
    colBold: { fontWeight: "900" },

    totalesCard: {
      borderWidth: 2,
      borderRadius: 14,
      padding: 12,
      marginTop: 4,
      marginBottom: 10,
    },
    totalesTitle: {
      fontWeight: "900",
      fontSize: Platform.OS === "web" ? 15 : 13,
      marginBottom: 10,
      textTransform: "uppercase",
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
