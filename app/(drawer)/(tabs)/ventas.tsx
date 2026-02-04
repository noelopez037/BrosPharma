import { useFocusEffect, useTheme } from "@react-navigation/native";
import { router } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../../../components/ui/app-button";
import { supabase } from "../../../lib/supabase";
import { useThemePref } from "../../../lib/themePreference";
import { alphaColor } from "../../../lib/ui";
import { FB_DARK_DANGER } from "../../../src/theme/headerColors";

type Role = "ADMIN" | "BODEGA" | "VENTAS" | "FACTURACION" | "";
type Estado = "NUEVO" | "FACTURADO" | "EN_RUTA" | "ENTREGADO";

type Chip = { label: string; tone: "neutral" | "red" | "amber" };

type VentaRow = {
  id: number;
  fecha: string;
  estado: Estado;
  cliente_id: number | null;
  cliente_nombre: string | null;
  vendedor_id: string | null;
  vendedor_codigo: string | null;
  requiere_receta: boolean;
  receta_cargada: boolean;
};

function normalizeUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return String(iso).slice(0, 10);
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

function shortUid(u: string | null | undefined) {
  const s = String(u ?? "").trim();
  if (!s) return "—";
  return s.slice(0, 8);
}

function tagLabel(tag: string) {
  const t = String(tag ?? "").trim().toUpperCase();
  if (!t) return "";
  if (t === "EDICION_REQUERIDA") return "Edicion en proceso";
  return t.replace(/_/g, " ");
}

function showChip(tag: string) {
  return (
    tag === "ANULACION_REQUERIDA" ||
    tag === "EDICION_REQUERIDA" ||
    tag === "PEND_AUTORIZACION_ADMIN" ||
    tag === "ANULADO"
  );
}

export default function Ventas() {
  const { colors } = useTheme();
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  const C = useMemo(
    () => ({
      bg: colors.background ?? (isDark ? "#000" : "#fff"),
      card: colors.card ?? (isDark ? "#121214" : "#fff"),
      text: colors.text ?? (isDark ? "#fff" : "#111"),
      sub:
        alphaColor(String(colors.text ?? (isDark ? "#ffffff" : "#000000")), 0.65) ||
        (isDark ? "rgba(255,255,255,0.65)" : "#666"),
      border: colors.border ?? (isDark ? "rgba(255,255,255,0.14)" : "#e5e5e5"),
      tint: String(colors.primary ?? "#153c9e"),
      chipBg: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
      chipRedBg: isDark ? "rgba(255,90,90,0.18)" : "rgba(220,0,0,0.10)",
      chipRedText: FB_DARK_DANGER,
      chipAmberBg: isDark ? "rgba(255,201,107,0.18)" : "rgba(255,170,0,0.12)",
      chipAmberText: isDark ? "rgba(255,201,107,0.92)" : "#b25a00",
    }),
    [colors.background, colors.border, colors.card, colors.primary, colors.text, isDark]
  );

  const [role, setRole] = useState<Role>("");
  const canCreate = role === "VENTAS" || role === "ADMIN";

  const [estado, setEstado] = useState<Estado>("NUEVO");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  // filtros (tipo CxC): cliente + rango de fechas
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [clientes, setClientes] = useState<{ id: number; nombre: string }[]>([]);
  const [clienteOpen, setClienteOpen] = useState(false);
  const [fClienteId, setFClienteId] = useState<number | null>(null);
  const [fClienteQ, setFClienteQ] = useState("");
  const [fDesde, setFDesde] = useState<Date | null>(null);
  const [fHasta, setFHasta] = useState<Date | null>(null);
  const [showDesdeIOS, setShowDesdeIOS] = useState(false);
  const [showHastaIOS, setShowHastaIOS] = useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("clientes")
          .select("id,nombre")
          .order("nombre", { ascending: true });
        if (!alive) return;
        if (error) {
          setClientes([]);
          return;
        }
        setClientes(((data ?? []) as any) as { id: number; nombre: string }[]);
      } catch {
        if (alive) setClientes([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(q);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const [rowsRaw, setRowsRaw] = useState<VentaRow[]>([]);
  const [tagsByVenta, setTagsByVenta] = useState<Record<string, string[]>>({});

  // Evita renderizar data vieja cuando la pantalla permanece montada (Tabs)
  // y se entra/cambia de tab antes de que termine el fetch.
  const [loadedEstado, setLoadedEstado] = useState<Estado | null>(null);

  const [initialLoading, setInitialLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const [facturadosAlert, setFacturadosAlert] = useState(false);
  const [nuevosAlert, setNuevosAlert] = useState(false);
  const [facturadoAny, setFacturadoAny] = useState(false);
  const [enRutaAny, setEnRutaAny] = useState(false);

  const dotsReqSeq = useRef(0);

  const cacheRef = useRef<Record<string, { rows: VentaRow[]; tags: Record<string, string[]> }>>({});
  const reqSeq = useRef(0);

  const dotsCacheRef = useRef<{
    data: {
      nuevosAlert: boolean;
      facturadosAlert: boolean;
      facturadoAny: boolean;
      enRutaAny: boolean;
    } | null;
    timestamp: number;
  }>({ data: null, timestamp: 0 });

  const [verseOpen, setVerseOpen] = useState(false);
  const verseOpacity = useRef(new Animated.Value(0)).current;
  const verseTranslateY = useRef(new Animated.Value(18)).current;
  const verseScale = useRef(new Animated.Value(0.96)).current;

  const loadRole = useCallback(async (): Promise<Role> => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) {
      setRole("");
      return "";
    }
    const { data } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
    const r = (normalizeUpper(data?.role) as Role) ?? "";
    setRole(r);
    return r;
  }, []);

  const refreshDots = useCallback(async () => {
    const mySeq = ++dotsReqSeq.current;

    const now = Date.now();
    const cached = dotsCacheRef.current;
    if (cached.data && now - cached.timestamp < 25000) {
      setNuevosAlert(cached.data.nuevosAlert);
      setFacturadosAlert(cached.data.facturadosAlert);
      setFacturadoAny(cached.data.facturadoAny);
      setEnRutaAny(cached.data.enRutaAny);
      return;
    }

    try {
      type Dots = {
        nuevosAlert: unknown;
        facturadosAlert: unknown;
        facturadoAny: unknown;
        enRutaAny: unknown;
      };

      const { data, error } = await supabase.rpc("rpc_ventas_dots", { p_limit: 200 });
      if (mySeq !== dotsReqSeq.current) return;
      if (error) throw error;

      const d = data as any as Partial<Dots>;
      const ok =
        d &&
        typeof d === "object" &&
        "nuevosAlert" in d &&
        "facturadosAlert" in d &&
        "facturadoAny" in d &&
        "enRutaAny" in d;
      if (!ok) throw new Error("Invalid rpc_ventas_dots response");

      const next = {
        nuevosAlert: !!d.nuevosAlert,
        facturadosAlert: !!d.facturadosAlert,
        facturadoAny: !!d.facturadoAny,
        enRutaAny: !!d.enRutaAny,
      };

      setNuevosAlert(next.nuevosAlert);
      setFacturadosAlert(next.facturadosAlert);
      setFacturadoAny(next.facturadoAny);
      setEnRutaAny(next.enRutaAny);

      dotsCacheRef.current = { data: next, timestamp: Date.now() };
    } catch {
      if (mySeq !== dotsReqSeq.current) return;
      // Keep previous dot state on error to avoid flicker.
    }
  }, []);

  const fetchVentas = useCallback(
    async (targetEstado: Estado, opts?: { silent?: boolean }) => {
      const mySeq = ++reqSeq.current;
      const silent = !!opts?.silent;
      if (!silent) {
        setListLoading(true);
        setLoadedEstado(null);
        setRowsRaw([]);
        setTagsByVenta({});
      }

      try {
        const { data, error } = await supabase
          .from("ventas")
          .select(
            "id,fecha,estado,cliente_id,cliente_nombre,vendedor_id,vendedor_codigo,requiere_receta,receta_cargada"
          )
          .eq("estado", targetEstado)
          .order("fecha", { ascending: false })
          .limit(200);
        if (mySeq !== reqSeq.current) return;
        if (error) throw error;

        const rows = (data ?? []) as any as VentaRow[];
        setRowsRaw(rows);

        const ids = rows.map((r) => Number(r.id)).filter((x) => Number.isFinite(x) && x > 0);
        if (!ids.length) {
          setTagsByVenta({});
          cacheRef.current[targetEstado] = { rows, tags: {} };
          setLoadedEstado(targetEstado);
          return;
        }

        const { data: trows, error: terr } = await supabase
          .from("ventas_tags")
          .select("venta_id,tag")
          .in("venta_id", ids)
          .is("removed_at", null);
        if (mySeq !== reqSeq.current) return;
        if (terr) throw terr;

        const map: Record<string, string[]> = {};
        (trows ?? []).forEach((tr: any) => {
          const vid = String(tr.venta_id);
          const tg = String(tr.tag ?? "").trim().toUpperCase();
          if (!vid || !tg) return;
          if (!map[vid]) map[vid] = [];
          map[vid].push(tg);
        });

        setTagsByVenta(map);
        cacheRef.current[targetEstado] = { rows, tags: map };
        setLoadedEstado(targetEstado);
      } catch (e) {
        // Si falla la carga, no dejes la UI pegada en "Cargando...".
        if (mySeq === reqSeq.current && !silent) {
          setLoadedEstado(targetEstado);
        }
        throw e;
      } finally {
        if (!silent && mySeq === reqSeq.current) setListLoading(false);
      }
    },
    []
  );

  const fetchAll = useCallback(async () => {
    const roleP = loadRole();
    const ventasP = fetchVentas(estado);
    await roleP;
    await ventasP;
    await refreshDots();
  }, [estado, fetchVentas, loadRole, refreshDots]);

  const onPullRefresh = useCallback(() => {
    setPullRefreshing(true);
    Promise.allSettled([loadRole(), fetchVentas(estado, { silent: true }), refreshDots()]).finally(() => {
      setPullRefreshing(false);
    });
  }, [estado, fetchVentas, loadRole, refreshDots]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          if (alive) setInitialLoading(true);
          await fetchAll();
        } finally {
          if (alive) setInitialLoading(false);
        }
      })().catch(() => {
        if (alive) setInitialLoading(false);
      });
      return () => {
        alive = false;
      };
    }, [fetchAll])
  );

  const rows = useMemo(() => {
    const search = debouncedQ.trim().toLowerCase();
    const desdeMs = fDesde ? startOfDay(fDesde).getTime() : null;
    const hastaMs = fHasta ? endOfDay(fHasta).getTime() : null;

    const filtered = rowsRaw.filter((r) => {
      const tags = tagsByVenta[String(r.id)] ?? [];
      const isAnulado = tags.includes("ANULADO");
      if (isAnulado) return false;

      if (fClienteId && Number(r.cliente_id ?? 0) !== fClienteId) return false;

      const ymd = r.fecha ? String(r.fecha).slice(0, 10) : "";
      const rowDateMs = ymd ? new Date(`${ymd}T12:00:00`).getTime() : null;
      if (desdeMs && (rowDateMs == null || rowDateMs < desdeMs)) return false;
      if (hastaMs && (rowDateMs == null || rowDateMs > hastaMs)) return false;

      if (!search) return true;
      const id = String(r.id);
      const cliente = String(r.cliente_nombre ?? "").toLowerCase();
      const vcode = String(r.vendedor_codigo ?? "").toLowerCase();
      return id.includes(search) || cliente.includes(search) || vcode.includes(search);
    });
    return filtered;
  }, [debouncedQ, rowsRaw, tagsByVenta, fClienteId, fDesde, fHasta]);

  const filteredClientes = useMemo(() => {
    const qq = (fClienteQ ?? "").trim().toLowerCase();
    if (!qq) return clientes;
    return (clientes ?? []).filter(
      (c) => String(c.nombre ?? "").toLowerCase().includes(qq) || String(c.id ?? "").includes(qq)
    );
  }, [clientes, fClienteQ]);

  const clienteLabel = useMemo(() => {
    if (!fClienteId) return "Todos";
    const c = clientes.find((x) => x.id === fClienteId);
    return c?.nombre ?? "Todos";
  }, [clientes, fClienteId]);

  const openDesdePicker = useCallback(() => {
    setClienteOpen(false);
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
  }, [fDesde]);

  const openHastaPicker = useCallback(() => {
    setClienteOpen(false);
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
  }, [fHasta]);

  const limpiarFiltros = useCallback(() => {
    setFClienteId(null);
    setFClienteQ("");
    setFDesde(null);
    setFHasta(null);
    setClienteOpen(false);
    setShowDesdeIOS(false);
    setShowHastaIOS(false);
  }, []);

  const aplicarFiltros = useCallback(() => {
    setFiltersOpen(false);
    setClienteOpen(false);
    setShowDesdeIOS(false);
    setShowHastaIOS(false);
  }, []);

  const chipsById = useMemo(() => {
    const map: Record<number, Chip[]> = {};

    rowsRaw.forEach((item) => {
      const tags = tagsByVenta[String(item.id)] ?? [];
      const chips: Chip[] = [];

      if (item.requiere_receta && !item.receta_cargada) {
        chips.push({ label: "Falta receta", tone: "amber" });
      }

      tags.filter(showChip).forEach((t) => {
        if (t === "PEND_AUTORIZACION_ADMIN") {
          chips.push({ label: "Pendiente admin", tone: "amber" });
          return;
        }
        if (t === "ANULADO") {
          chips.push({ label: "ANULADO", tone: "red" });
          return;
        }
        if (t.endsWith("_REQUERIDA")) {
          chips.push({ label: tagLabel(t), tone: "red" });
          return;
        }
        chips.push({ label: tagLabel(t), tone: "neutral" });
      });

      map[item.id] = chips;
    });

    return map;
  }, [rowsRaw, tagsByVenta]);

  const visibleRows = loadedEstado === estado ? rows : [];

  const tabs: { key: Estado; label: string }[] = useMemo(
    () => [
      { key: "NUEVO", label: "Nuevos" },
      { key: "FACTURADO", label: "Facturados" },
      { key: "EN_RUTA", label: "En ruta" },
      { key: "ENTREGADO", label: "Entregados" },
    ],
    []
  );

  const keyExtractor = useCallback((it: VentaRow) => String(it.id), []);

  const renderItem = useCallback(
    ({ item }: { item: VentaRow }) => {
      const chips = chipsById[item.id] ?? [];
      const vendedorChip = item.vendedor_codigo ? String(item.vendedor_codigo) : shortUid(item.vendedor_id);

      return (
        <Pressable
          onPress={() => router.push({ pathname: "/venta-detalle", params: { ventaId: String(item.id) } } as any)}
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
            <View style={[s.vendedorPill, { backgroundColor: C.chipBg, borderColor: C.border }]}>
              <Text style={[s.vendedorPillText, { color: C.text }]} numberOfLines={1}>
                {vendedorChip}
              </Text>
            </View>
          </View>
          <Text style={[s.cardSub, { color: C.sub }]} numberOfLines={1}>
            Fecha: {fmtDate(item.fecha)}
          </Text>

          {chips.length ? (
            <View style={s.chipsRow}>
              {chips.slice(0, 4).map((c, idx) => {
                const bg = c.tone === "red" ? C.chipRedBg : c.tone === "amber" ? C.chipAmberBg : C.chipBg;
                const fg = c.tone === "red" ? C.chipRedText : c.tone === "amber" ? C.chipAmberText : C.sub;
                return (
                  <View key={`${item.id}-${idx}`} style={[s.chip, { backgroundColor: bg, borderColor: C.border }]}>
                    <Text style={[s.chipText, { color: fg }]} numberOfLines={1}>
                      {c.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </Pressable>
      );
    },
    [
      C.border,
      C.card,
      C.chipAmberBg,
      C.chipAmberText,
      C.chipBg,
      C.chipRedBg,
      C.chipRedText,
      C.sub,
      C.text,
      chipsById,
    ]
  );

  const listEmptyComponent = useMemo(() => {
    const label = initialLoading || listLoading || loadedEstado !== estado ? "Cargando..." : "Sin ventas";
    return (
      <Text style={{ padding: 16, color: C.sub, fontWeight: "700" }}>
        {label}
      </Text>
    );
  }, [C.sub, estado, initialLoading, listLoading, loadedEstado]);

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
      <View style={[s.header, { backgroundColor: C.bg, borderBottomColor: C.border }]}>
        <View style={s.topRow}>
          <Pressable
            onPress={() => {
              setVerseOpen(true);
              verseOpacity.setValue(0);
              verseTranslateY.setValue(18);
              verseScale.setValue(0.96);
              Animated.parallel([
                Animated.timing(verseOpacity, {
                  toValue: 1,
                  duration: 180,
                  useNativeDriver: true,
                }),
                Animated.timing(verseTranslateY, {
                  toValue: 0,
                  duration: 220,
                  useNativeDriver: true,
                }),
                Animated.timing(verseScale, {
                  toValue: 1,
                  duration: 220,
                  useNativeDriver: true,
                }),
              ]).start();
            }}
            style={({ pressed }) => [pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={[s.title, { color: C.text }]}>Mateo 7:7</Text>
          </Pressable>
          {canCreate ? (
            <AppButton title="+ Nueva venta" size="sm" onPress={() => router.push("/venta-nueva" as any)} />
          ) : null}
        </View>

        <View style={s.tabsRow}>
          {tabs.map((t) => {
            const active = t.key === estado;
            const showDotNuevos = t.key === "NUEVO" && nuevosAlert;
            const showDotFactRed = t.key === "FACTURADO" && facturadosAlert;
            const showDotFactAmber = t.key === "FACTURADO" && !facturadosAlert && facturadoAny;
            const showDotEnRuta = t.key === "EN_RUTA" && enRutaAny;
            const dotColor = showDotFactRed || showDotNuevos
              ? FB_DARK_DANGER
              : (showDotFactAmber || showDotEnRuta)
                ? (isDark ? "rgba(255,201,107,0.92)" : "#ff9500")
                : null;
            return (
              <Pressable
                key={t.key}
                onPress={() => {
                  if (t.key === estado) return;
                  setEstado(t.key);
                  fetchVentas(t.key, { silent: false }).catch(() => {});
                  refreshDots().catch(() => {});
                }}
                style={({ pressed }) => [
                  s.tab,
                  { borderBottomColor: active ? C.tint : "transparent" },
                  pressed ? { opacity: 0.85 } : null,
                ]}
              >
                <View style={s.tabLabelRow}>
                  <Text style={[s.tabText, { color: active ? C.text : C.sub }]} numberOfLines={1}>
                    {t.label}
                  </Text>
                  {dotColor ? (
                    <View style={[s.alertDot, { backgroundColor: dotColor }]} />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={s.filtersRow}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Buscar..."
            placeholderTextColor={C.sub}
            style={[s.search, { borderColor: C.border, backgroundColor: C.card, color: C.text }]}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Pressable
            onPress={() => {
              setFiltersOpen(true);
              setClienteOpen(false);
              setShowDesdeIOS(false);
              setShowHastaIOS(false);
            }}
            style={({ pressed }) => [
              s.filterBtn,
              { borderColor: C.border, backgroundColor: C.card },
              pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
            ]}
          >
            <Text style={[s.filterTxt, { color: C.text }]}>Filtros</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        key={`ventas-${estado}`}
        data={visibleRows}
        keyExtractor={keyExtractor}
        refreshing={pullRefreshing}
        onRefresh={onPullRefresh}
        contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
        initialNumToRender={8}
        maxToRenderPerBatch={5}
        windowSize={7}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews={Platform.OS === "android"}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        renderItem={renderItem}
        ListEmptyComponent={listEmptyComponent}
      />

      {/* Modal filtros */}
      {filtersOpen ? (
        <Modal
          visible={filtersOpen}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setFiltersOpen(false);
            setClienteOpen(false);
            setShowDesdeIOS(false);
            setShowHastaIOS(false);
          }}
        >
          <Pressable
            style={[s.modalBackdrop, { backgroundColor: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)" }]}
            onPress={() => {
              setFiltersOpen(false);
              setClienteOpen(false);
              setShowDesdeIOS(false);
              setShowHastaIOS(false);
            }}
          />

          <View style={[s.modalCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={s.modalHeader}>
            <Text style={[s.modalTitle, { color: C.text }]}>Filtros</Text>
            <Pressable
              onPress={() => {
                setFiltersOpen(false);
                setClienteOpen(false);
                setShowDesdeIOS(false);
                setShowHastaIOS(false);
              }}
              hitSlop={10}
            >
              <Text style={[s.modalClose, { color: C.sub }]}>Cerrar</Text>
            </Pressable>
          </View>

          <Text style={[s.sectionLabel, { color: C.text }]}>Cliente</Text>
          <Pressable
            onPress={() => {
              setClienteOpen((v) => !v);
              setShowDesdeIOS(false);
              setShowHastaIOS(false);
            }}
            style={[s.dropdownInput, { borderColor: C.border, backgroundColor: C.card }]}
          >
            <Text style={[s.dropdownText, { color: C.text }]} numberOfLines={1}>
              {clienteLabel}
            </Text>
            <Text style={[s.dropdownCaret, { color: C.sub }]}>{clienteOpen ? "▲" : "▼"}</Text>
          </Pressable>

          {clienteOpen ? (
            <View style={[s.dropdownPanel, { borderColor: C.border, backgroundColor: C.card }]}
            >
              <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled">
                <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
                  <TextInput
                    value={fClienteQ}
                    onChangeText={setFClienteQ}
                    placeholder="Buscar cliente..."
                    placeholderTextColor={C.sub}
                    style={[
                      s.clientSearchInput,
                      {
                        color: C.text,
                        borderColor: C.border,
                        backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                      },
                    ]}
                    autoCapitalize="none"
                    returnKeyType="search"
                  />
                </View>

                <DDRow
                  label="Todos"
                  selected={!fClienteId}
                  onPress={() => {
                    setFClienteId(null);
                    setClienteOpen(false);
                    setFClienteQ("");
                  }}
                  isDark={isDark}
                  text={C.text}
                  divider={isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)"}
                  tint={C.tint}
                />
                {filteredClientes.map((c) => (
                  <DDRow
                    key={String(c.id)}
                    label={c.nombre}
                    selected={fClienteId === c.id}
                    onPress={() => {
                      setFClienteId(c.id);
                      setClienteOpen(false);
                      setFClienteQ("");
                    }}
                    isDark={isDark}
                    text={C.text}
                    divider={isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)"}
                    tint={C.tint}
                  />
                ))}
              </ScrollView>
            </View>
          ) : null}

          <Text style={{ marginTop: 6, color: C.sub }}>Busca por nombre.</Text>

          <View style={{ height: 10 }} />
          <View style={s.twoCols}>
            <View style={{ flex: 1 }}>
              <Text style={[s.sectionLabel, { color: C.text }]}>Desde</Text>
              <Pressable onPress={openDesdePicker} style={[s.dateBox, { borderColor: C.border, backgroundColor: C.card }]}
              >
                <Text style={[s.dateTxt, { color: C.text }]}>{fDesde ? fmtDate(fDesde.toISOString()) : "—"}</Text>
              </Pressable>
            </View>

            <View style={{ width: 12 }} />

            <View style={{ flex: 1 }}>
              <Text style={[s.sectionLabel, { color: C.text }]}>Hasta</Text>
              <Pressable onPress={openHastaPicker} style={[s.dateBox, { borderColor: C.border, backgroundColor: C.card }]}
              >
                <Text style={[s.dateTxt, { color: C.text }]}>{fHasta ? fmtDate(fHasta.toISOString()) : "—"}</Text>
              </Pressable>
            </View>
          </View>

          {Platform.OS === "ios" && showDesdeIOS ? (
            <View style={[s.iosPickerWrap, { borderColor: C.border, backgroundColor: C.card }]}>
              <DateTimePicker
                value={fDesde ?? new Date()}
                mode="date"
                display="inline"
                themeVariant={isDark ? "dark" : "light"}
                onChange={(_ev, date) => {
                  if (date) {
                    setFDesde(date);
                    setShowDesdeIOS(false);
                  }
                }}
              />
            </View>
          ) : null}

          {Platform.OS === "ios" && showHastaIOS ? (
            <View style={[s.iosPickerWrap, { borderColor: C.border, backgroundColor: C.card }]}>
              <DateTimePicker
                value={fHasta ?? new Date()}
                mode="date"
                display="inline"
                themeVariant={isDark ? "dark" : "light"}
                onChange={(_ev, date) => {
                  if (date) {
                    setFHasta(date);
                    setShowHastaIOS(false);
                  }
                }}
              />
            </View>
          ) : null}

          <View style={s.modalActions}>
            <AppButton title="Limpiar" variant="ghost" size="sm" onPress={limpiarFiltros} />
            <AppButton title="Aplicar" variant="primary" size="sm" onPress={aplicarFiltros} />
          </View>
          </View>
        </Modal>
      ) : null}

      {verseOpen ? (
        <Modal
          visible={verseOpen}
          transparent
          animationType="none"
          onRequestClose={() => {
            Animated.parallel([
              Animated.timing(verseOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
              Animated.timing(verseTranslateY, { toValue: 18, duration: 150, useNativeDriver: true }),
              Animated.timing(verseScale, { toValue: 0.96, duration: 150, useNativeDriver: true }),
            ]).start(() => setVerseOpen(false));
          }}
        >
          <Pressable
            style={[s.verseBackdrop, { backgroundColor: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)" }]}
            onPress={() => {
              Animated.parallel([
                Animated.timing(verseOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
                Animated.timing(verseTranslateY, { toValue: 18, duration: 150, useNativeDriver: true }),
                Animated.timing(verseScale, { toValue: 0.96, duration: 150, useNativeDriver: true }),
              ]).start(() => setVerseOpen(false));
            }}
          />

          <Animated.View
            style={[
              s.verseCard,
              {
                backgroundColor: C.card,
                borderColor: C.border,
                opacity: verseOpacity,
                transform: [{ translateY: verseTranslateY }, { scale: verseScale }],
              },
            ]}
          >
          <Text style={[s.verseKicker, { color: C.sub }]}>Versiculo del dia</Text>
          <Text style={[s.verseTitle, { color: C.text }]}>Mateo 7:7</Text>

          <View style={s.verseQuoteBlock}>
            <View style={{ flex: 1 }}>
              <Text style={[s.verseText, { color: C.text }]}>Pidan a Dios, y el les dara.</Text>
              <Text style={[s.verseText, { color: C.text }]}>Hablen con Dios, y encontraran lo que buscan.</Text>
              <Text style={[s.verseText, { color: C.text }]}>Llamenlo y el los atendera.</Text>
            </View>
          </View>

          <View style={{ height: 12 }} />
          <AppButton
            title="Cerrar"
            variant="outline"
            size="sm"
            onPress={() => {
              Animated.parallel([
                Animated.timing(verseOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
                Animated.timing(verseTranslateY, { toValue: 18, duration: 150, useNativeDriver: true }),
                Animated.timing(verseScale, { toValue: 0.96, duration: 150, useNativeDriver: true }),
              ]).start(() => setVerseOpen(false));
            }}
          />
          </Animated.View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

function DDRow({
  label,
  selected,
  onPress,
  isDark,
  text,
  divider,
  tint,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  isDark: boolean;
  text: string;
  divider: string;
  tint: string;
}) {
  const selBg = alphaColor(tint, isDark ? 0.22 : 0.12) || (isDark ? "rgba(21,60,158,0.22)" : "rgba(21,60,158,0.12)");
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: divider,
          backgroundColor: selected ? selBg : "transparent",
        },
        pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
      ]}
    >
      <Text style={{ fontSize: 16, fontWeight: "600", color: selected ? tint : text }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { fontSize: 22, fontWeight: "900" },

  tabsRow: { marginTop: 12, flexDirection: "row", gap: 0 },
  tab: { flex: 1, paddingVertical: 10, borderBottomWidth: 2, alignItems: "center" },
  tabLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  alertDot: { width: 8, height: 8, borderRadius: 99, marginLeft: 6 },
  tabText: {
    fontSize: 12,
    fontWeight: Platform.OS === "ios" ? "800" : "800",
    letterSpacing: Platform.OS === "ios" ? -0.2 : 0,
  },

  filtersRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  search: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 12, android: 10, default: 10 }),
    fontSize: 16,
    flex: 1,
  },

  filterBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 12, android: 10, default: 10 }),
    alignItems: "center",
    justifyContent: "center",
  },
  filterTxt: { fontWeight: "800" },

  card: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 },
  cardTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: "900" },
  cardSub: { marginTop: 6, fontSize: 13, fontWeight: "700" },

  vendedorPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, maxWidth: 140 },
  vendedorPillText: { fontSize: 12, fontWeight: "900" },

  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: "900" },

  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  modalCard: { position: "absolute", left: 14, right: 14, top: 90, borderRadius: 18, padding: 16, borderWidth: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontSize: 22, fontWeight: "800" },
  modalClose: { fontSize: 15, fontWeight: "700" },
  sectionLabel: { marginTop: 12, fontSize: 15, fontWeight: "800" },
  dropdownInput: { marginTop: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dropdownText: { fontSize: 16, fontWeight: "600", flex: 1, paddingRight: 10 },
  dropdownCaret: { fontSize: 14, fontWeight: "900" },
  dropdownPanel: { marginTop: 10, borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  clientSearchInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  twoCols: { flexDirection: "row", marginTop: 8 },
  dateBox: { marginTop: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
  dateTxt: { fontSize: 16, fontWeight: "700" },
  iosPickerWrap: { marginTop: 10, borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },

  verseBackdrop: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  verseCard: {
    position: "absolute",
    left: 18,
    right: 18,
    top: "28%",
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },

  verseKicker: { fontSize: 12, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase" },
  verseTitle: { marginTop: 6, fontSize: 20, fontWeight: "900" },
  verseQuoteBlock: { marginTop: 14 },
  verseText: { fontSize: 15, fontWeight: "700", lineHeight: 22, marginTop: 6 },
});
