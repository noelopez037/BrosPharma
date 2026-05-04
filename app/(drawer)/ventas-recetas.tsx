import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack, router } from "expo-router";
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
  useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { VentaDetallePanel } from "../../components/ventas/VentaDetallePanel";
import { supabase } from "../../lib/supabase";
import { useThemePref } from "../../lib/themePreference";
import { useEmpresaActiva } from "../../lib/useEmpresaActiva";
import { useGoHomeOnBack } from "../../lib/useGoHomeOnBack";
import { useResumeLoad } from "../../lib/useResumeLoad";
import { useRole } from "../../lib/useRole";
import { pad2, toGTDateKey } from "../../lib/utils/format";
import { normalizeUpper } from "../../lib/utils/text";

type VentaRow = {
  id: number;
  fecha: string | null;
  cliente_nombre: string | null;
  estado: string | null;
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

// ─── Badge de estado ─────────────────────────────────────────────────────────

function estadoStyle(estado: string | null) {
  const e = normalizeUpper(estado ?? "");
  if (e === "FACTURADO") return { bg: "#BBF7D0", text: "#0a2213", border: "#7bfd9b" };
  if (e === "PENDIENTE") return { bg: "#fffd7f", text: "#111111", border: "#ffe868" };
  return { bg: "transparent", text: "#888888", border: "#aaaaaa" };
}

// ─── Card memoizada ───────────────────────────────────────────────────────────

const VentaCard = React.memo(function VentaCard({
  item,
  s,
  selected,
  tint,
  onPress,
}: {
  item: VentaRow;
  s: ReturnType<typeof styles>;
  selected: boolean;
  tint: string;
  onPress: (id: number) => void;
}) {
  const ec = estadoStyle(item.estado);
  return (
    <Pressable
      style={[s.card, selected ? { borderColor: tint, borderWidth: 2 } : null]}
      onPress={() => onPress(item.id)}
    >
      <View style={s.cardRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle} numberOfLines={2}>
            {item.cliente_nombre ?? "Cliente"}
          </Text>
          <Text style={s.cardSub}>{toGTDateKey(item.fecha) || "—"}</Text>
          <Text style={[s.cardSub, { marginTop: 2 }]}>venta-{item.id}</Text>
        </View>
        <View style={{ alignItems: "flex-end", justifyContent: "flex-start" }}>
          <Text
            style={[
              s.cardBadge,
              { backgroundColor: ec.bg, color: ec.text, borderColor: ec.border },
            ]}
          >
            {item.estado ?? "—"}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});

// ─── Pantalla principal ───────────────────────────────────────────────────────

export default function VentasRecetasScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomRail = insets.bottom;
  const s = useMemo(() => styles(colors), [colors]);

  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const canSplit = isWeb && width >= 1100;

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
  const { role, refreshRole } = useRole();
  const { empresaActivaId, isReady } = useEmpresaActiva();

  useFocusEffect(
    useCallback(() => {
      void refreshRole("focus:ventas-recetas");
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
  const [rows, setRows] = useState<VentaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detalleRefreshKey, setDetalleRefreshKey] = useState(0);

  useEffect(() => {
    if (!canSplit) setSelectedId(null);
  }, [canSplit]);

  const fetchVentas = useCallback(async () => {
    if (!isReady) return;
    if (!empresaActivaId) { setRows([]); setLoading(false); return; }

    setLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase
        .from("ventas")
        .select("id, fecha, cliente_nombre, estado")
        .eq("empresa_id", empresaActivaId)
        .eq("receta_cargada", true)
        .neq("estado", "ANULADO")
        .gte("fecha", desde)
        .lt("fecha", hasta)
        .order("fecha", { ascending: true });

      if (error) throw error;
      setRows((data ?? []) as VentaRow[]);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [empresaActivaId, isReady, desde, hasta]);

  useEffect(() => { void fetchVentas(); }, [fetchVentas]);
  useResumeLoad(empresaActivaId, () => { void fetchVentas(); });

  const handleSelect = useCallback((id: number) => {
    if (canSplit) {
      setSelectedId((prev) => {
        if (prev === id) { setDetalleRefreshKey((k) => k + 1); return id; }
        return id;
      });
    } else {
      router.push({ pathname: "/venta-detalle", params: { ventaId: String(id) } } as any);
    }
  }, [canSplit]);

  // ─── Render item ─────────────────────────────────────────────────────────
  const tint = String(colors.primary ?? "#153c9e");

  const renderItem = useCallback(
    ({ item }: { item: VentaRow }) => (
      <VentaCard
        item={item}
        s={s}
        selected={selectedId === item.id}
        tint={tint}
        onPress={handleSelect}
      />
    ),
    [s, selectedId, tint, handleSelect]
  );

  // ─── Header del selector de mes ──────────────────────────────────────────
  const MonthHeader = (
    <View style={[s.stickyTop, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
      <View style={s.monthRow}>
        <Pressable onPress={prevMonth} style={s.arrowBtn} hitSlop={10}>
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

        <Pressable onPress={nextMonth} style={s.arrowBtn} hitSlop={10}>
          <Text style={[s.arrowTxt, { color: M.text }]}>›</Text>
        </Pressable>
      </View>
    </View>
  );

  // ─── Lista ────────────────────────────────────────────────────────────────
  const ListContent = (
    <>
      {MonthHeader}
      <FlatList<VentaRow>
        style={{ flex: 1, backgroundColor: colors.background }}
        data={rows}
        keyExtractor={(it) => String(it.id)}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
                {errorMsg ?? `Sin ventas con receta en ${monthLabel}`}
              </Text>
            </View>
          )
        }
      />
    </>
  );

  // ─── Layout ───────────────────────────────────────────────────────────────
  return (
    <>
      <Stack.Screen options={{ title: "Recetas del mes" }} />

      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["bottom"]}>
        {canSplit ? (
          <View style={s.splitWrap}>
            <View style={[s.splitListPane, { borderRightColor: colors.border }]}>
              {ListContent}
            </View>
            <View style={s.splitDetailPane}>
              {selectedId ? (
                <VentaDetallePanel
                  ventaId={selectedId}
                  embedded
                  refreshKey={detalleRefreshKey}
                />
              ) : (
                <View style={[s.splitPlaceholder, { borderColor: colors.border }]}>
                  <Text style={[s.splitPlaceholderTxt, { color: M.sub }]}>
                    Selecciona una venta para ver receta y factura
                  </Text>
                </View>
              )}
            </View>
          </View>
        ) : (
          ListContent
        )}

        {/* Modal: seleccionar mes (iOS/Android) */}
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
    monthRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    arrowBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    arrowTxt: {
      fontSize: 22,
      fontWeight: "900",
      lineHeight: 26,
    },
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
    monthTxt: {
      fontWeight: "800",
      fontSize: Platform.OS === "web" ? 16 : 14,
    },
    monthCaret: {
      fontSize: 14,
      fontWeight: "900",
    },

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
    cardRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
    cardTitle: {
      color: colors.text,
      fontSize: Platform.OS === "web" ? 13 : 12,
      fontWeight: "700",
    },
    cardSub: {
      color: colors.text + "AA",
      marginTop: 4,
      fontSize: 11,
    },
    cardBadge: {
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      fontSize: 11,
      fontWeight: "900",
      overflow: "hidden",
    },

    splitWrap: { flex: 1, flexDirection: "row" },
    splitListPane: {
      width: 420,
      maxWidth: 420,
      borderRightWidth: StyleSheet.hairlineWidth,
    },
    splitDetailPane: { flex: 1 },
    splitPlaceholder: {
      flex: 1,
      margin: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    splitPlaceholderTxt: {
      fontSize: 15,
      fontWeight: "800",
      textAlign: "center",
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
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    modalTitle: { fontSize: Platform.OS === "web" ? 22 : 18, fontWeight: "800" },
    modalClose: { fontSize: Platform.OS === "web" ? 15 : 13, fontWeight: "700" },
    iosPickerWrap: {
      borderRadius: 14,
      borderWidth: 1,
      overflow: "hidden",
    },
  });
