import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { HeaderBackButton } from "@react-navigation/elements";
import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack, router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton } from "../../components/ui/app-button";
import { goHome } from "../../lib/goHome";
import { supabase } from "../../lib/supabase";
import { useGoHomeOnBack } from "../../lib/useGoHomeOnBack";
import { useThemePref } from "../../lib/themePreference";

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

function fmtDateYmd(iso: string | null | undefined) {
  if (!iso) return "—";
  return String(iso).slice(0, 10);
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

  // role and uid
  const [role, setRole] = useState<string>("");
  const [roleChecked, setRoleChecked] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const user = auth.user;
        if (!user) return;
        if (mounted) setUid(user.id);
        const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
        if (mounted) setRole(normalizeUpper(data?.role));
      } catch {
        if (mounted) setRole("");
      } finally {
        if (mounted) setRoleChecked(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const roleUp = normalizeUpper(role);
  const isAdmin = roleUp === "ADMIN";
  const isVentas = roleUp === "VENTAS";
  const isAllowed = roleChecked && (isAdmin || isVentas);

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

  const openMonthPicker = () => {
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
  };

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

        const ms = r?.fecha ? new Date(r.fecha).getTime() : NaN;
        if (!Number.isFinite(ms)) return false;
        if (ms < fromMs || ms > toMs) return false;

        const vid = String(r?.vendedor_id ?? "").trim();
        if (isVentasLocal && uid && vid && vid !== uid) return false;
        if (isAdminLocal && fVendedorId && vid && vid !== fVendedorId) return false;

        return true;
      })
      .sort((a, b) => {
        const ad = a.fecha ? String(a.fecha) : "";
        const bd = b.fecha ? String(b.fecha) : "";
        if (ad === bd) return 0;
        return ad < bd ? 1 : -1;
      });

    return rows;
  }, [desde, hasta, fVendedorId, role, uid]);

  useFocusEffect(
    useCallback(() => {
      const token = ++fetchTokenRef.current;
      const showLoading = !hasLoadedOnceRef.current && !hasAnyRowsRef.current;

      // Nunca cargar ni renderizar data antes de resolver el rol.
      if (!roleChecked) {
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
    }, [fetchRows, fetchVentasPagadas, fVendedorId, isAdmin, isAllowed, roleChecked, uid])
  );

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
    (vendedoresCache.length > 0 ? vendedoresCache : rows).forEach((r: any) => {
      const id = String(r.vendedor_id ?? "").trim();
      const code = String(r.vendedor_codigo ?? "").trim();
      if (id) map.set(id, code || id.slice(0, 8));
    });
    return map;
  }, [rows, vendedoresCache]);

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

  const renderRow = ({ item }: { item: RpcComisionRow }) => {
    const code = String(item.vendedor_codigo ?? "").trim() || "—";
    return (
      <View style={s.card}>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>
              {code}
            </Text>
            <Text style={s.sub}>Total sin IVA: {fmtQ(item.total_sin_iva)}</Text>
            <Text style={s.sub}>Comisión: {fmtQ(item.comision_mes)}</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderVentaPagada = ({ item }: { item: CxCVentaRow }) => {
    const fact = Array.isArray(item.facturas) ? item.facturas.filter(Boolean).join(" · ") : "—";
    const saldo0 = Math.max(0, safeNumber(item.saldo));
    return (
      <Pressable
        onPress={() =>
          router.push({ pathname: "/cxc-venta-detalle", params: { ventaId: String(item.venta_id) } } as any)
        }
        style={({ pressed }) => [s.card, pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null]}
      >
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>
              {item.cliente_nombre ?? "Cliente"}
            </Text>
            <Text style={s.sub}>Facturas: {fact}</Text>
            <Text style={s.sub}>Fecha: {fmtDateYmd(item.fecha)}</Text>
            <Text style={s.sub}>Total: {fmtQ(item.total)} · Pagado: {fmtQ(item.pagado)}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.paidBadge}>PAGADA</Text>
            <Text style={s.total}>{fmtQ(saldo0)}</Text>
          </View>
        </View>
      </Pressable>
    );
  };

  type ListItem =
    | { kind: "COMISION"; key: string; row: RpcComisionRow }
    | { kind: "VENTA_PAGADA"; key: string; row: CxCVentaRow }
    | { kind: "SECTION"; key: string; title: string; subtitle?: string }
    | { kind: "EMPTY"; key: string; text: string };

  const listData = useMemo<ListItem[]>(() => {
    if (initialLoading && rowsRaw.length === 0 && ventasPagadasRaw.length === 0) return [];

    const out: ListItem[] = [];

    if (!isVentas) {
      if (rows.length === 0) {
        out.push({ kind: "EMPTY", key: "empty-comisiones", text: "No hay comisiones en este mes" });
      } else {
        rows.forEach((r, idx) => {
          const k = String(r.vendedor_id ?? r.vendedor_codigo ?? idx);
          out.push({ kind: "COMISION", key: `c-${k}`, row: r });
        });
      }
    }

    out.push({
      kind: "SECTION",
      key: "sec-paid",
      title: "Ventas pagadas",
      subtitle: `Mes: ${monthLabel}`,
    });

    if (ventasPagadasRaw.length === 0) {
      out.push({ kind: "EMPTY", key: "empty-paid", text: "No hay ventas pagadas en este mes" });
    } else {
      ventasPagadasRaw.forEach((v) => {
        out.push({ kind: "VENTA_PAGADA", key: `v-${String(v.venta_id)}`, row: v });
      });
    }

    return out;
  }, [initialLoading, isVentas, monthLabel, rows, rowsRaw.length, ventasPagadasRaw]);

  const renderListItem = ({ item }: { item: ListItem }) => {
    if (item.kind === "COMISION") return renderRow({ item: item.row });
    if (item.kind === "VENTA_PAGADA") return renderVentaPagada({ item: item.row });
    if (item.kind === "EMPTY") {
      return (
        <View style={s.card}>
          <Text style={s.empty}>{item.text}</Text>
        </View>
      );
    }
    if (item.kind === "SECTION") {
      return (
        <View style={[s.card, { paddingVertical: 10 }]}>
          <Text style={s.sectionTitle}>{item.title}</Text>
          {item.subtitle ? <Text style={s.sub}>{item.subtitle}</Text> : null}
        </View>
      );
    }
    return null;
  };

  const ListHeader = (
    <>
      <View style={s.topRow}>
        <Pressable
          onPress={openMonthPicker}
          style={({ pressed }) => [s.searchWrap, pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null]}
        >
          <Text style={s.monthTxt} numberOfLines={1}>
            {monthLabel}
          </Text>
          <Text style={s.monthCaret}>▼</Text>
        </Pressable>

        {isAdmin ? (
          <Pressable
            onPress={() => setFiltersOpen(true)}
            style={({ pressed }) => [s.filterBtn, pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null]}
          >
            <Text style={s.filterTxt}>Filtros</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Cards resumen */}
      {isVentas ? (
        <View style={s.card}>
          <Text style={s.title}>Comisión del mes</Text>
          <Text style={s.total}>{fmtQ(totals.totalComision)}</Text>
          <Text style={s.sub}>Mes: {monthLabel}</Text>
        </View>
      ) : (
        <View style={s.summaryGrid}>
          <View style={[s.card, s.summaryCard]}>
            <Text style={s.title}>Total sin IVA</Text>
            <Text style={s.total}>{fmtQ(totals.totalSinIva)}</Text>
            <Text style={s.sub}>Mes: {monthLabel}</Text>
          </View>
          <View style={[s.card, s.summaryCard]}>
            <Text style={s.title}>Total comisión</Text>
            <Text style={s.total}>{fmtQ(totals.totalComision)}</Text>
            <Text style={s.sub}>Mes: {monthLabel}</Text>
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
    </>
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Comisiones",
          headerBackTitle: "Atrás",
          gestureEnabled: false,
          headerBackVisible: false,
          headerBackButtonMenuEnabled: false,
          headerLeft: (props: any) => <HeaderBackButton {...props} label="Atrás" onPress={() => goHome("/(drawer)/(tabs)")} />,
        }}
      />

      {/* Route protection (sin flash) */}
      {!roleChecked ? (
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["bottom"]}>
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 18 }}>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>Cargando...</Text>
          </View>
        </SafeAreaView>
      ) : !isAllowed ? (
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["bottom"]}>
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 18 }}>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 18 }}>Acceso denegado</Text>
            <Text style={{ color: colors.text + "AA", marginTop: 6, textAlign: "center" }}>
              No tienes permiso para ver Comisiones.
            </Text>
            <View style={{ height: 12 }} />
            <AppButton title="Volver" onPress={() => goHome("/(drawer)/(tabs)")} />
          </View>
        </SafeAreaView>
      ) : (
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["bottom"]}>
          <FlatList
            style={{ backgroundColor: colors.background }}
            data={listData}
            keyExtractor={(it) => it.key}
            renderItem={renderListItem}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={{
              paddingHorizontal: 12,
              paddingTop: 12,
              paddingBottom: 16 + insets.bottom,
            }}
            ListHeaderComponent={ListHeader}
          />

          {/* Modal: seleccionar mes (iOS) */}
          {monthOpenIOS ? (
            <Modal visible={monthOpenIOS} transparent animationType="fade" onRequestClose={() => setMonthOpenIOS(false)}>
              <Pressable style={[s.modalBackdrop, { backgroundColor: M.back }]} onPress={() => setMonthOpenIOS(false)} />
              <View style={[s.modalCard, { backgroundColor: M.card, borderColor: M.border }]}>
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

              <View style={[s.modalCard, { backgroundColor: M.card, borderColor: M.border }]}>
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
            </Modal>
          ) : null}
        </SafeAreaView>
      )}
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

    summaryGrid: { flexDirection: "row", gap: 10 },
    summaryCard: { flex: 1 },

    modalBackdrop: { ...StyleSheet.absoluteFillObject },
    modalCard: {
      position: "absolute",
      left: 14,
      right: 14,
      top: 90,
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
