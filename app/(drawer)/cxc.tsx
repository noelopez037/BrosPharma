import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack, router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { RoleGate } from "../../components/auth/RoleGate";
import { CxcDetallePanel } from "../../components/cxc/CxcDetallePanel";
import { AppButton } from "../../components/ui/app-button";
import { supabase } from "../../lib/supabase";
import { useThemePref } from "../../lib/themePreference";
import { useGoHomeOnBack } from "../../lib/useGoHomeOnBack";
import { useRole } from "../../lib/useRole";
import { useEmpresaActiva } from "../../lib/useEmpresaActiva";
import { useResumeLoad } from "../../lib/useResumeLoad";
import { fmtQ, fmtDateLongEs } from "../../lib/utils/format";
import { normalizeUpper } from "../../lib/utils/text";
import { FB_DARK_DANGER } from "../../src/theme/headerColors";

type CxCRow = {
  venta_id: number;
  fecha: string | null;
  fecha_vencimiento: string | null;
  cliente_id: number | null;
  cliente_nombre: string | null;
  vendedor_id: string | null;
  vendedor_codigo: string | null;
  total: number | null;
  pagado: number | null;
  saldo: number | null;
  facturas: string[] | null;
  estado: string | null;
};

type CxcSection = { title: string; data: CxCRow[] };

type VendedorRow = { vendedor_id: string; vendedor_codigo: string };
type PayFilter = "ALL" | "PENDING" | "OVERDUE";
type RpcVendedorRow = { id: string; full_name: string | null; role: string | null };

function shortId(u: string | null | undefined) {
  const s = String(u ?? "").trim();
  if (!s) return "—";
  return s.slice(0, 8);
}

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

export default function CuentasPorCobrarScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => styles(colors), [colors]);

  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

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

  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q.trim(), 250);

  const [rowsRaw, setRowsRaw] = useState<CxCRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchTokenRef = useRef(0);

  const hasLoadedOnceRef = useRef(false);
  const hasAnyRowsRef = useRef(false);
  useEffect(() => {
    hasAnyRowsRef.current = rowsRaw.length > 0;
  }, [rowsRaw.length]);

  // filters
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [vendedores, setVendedores] = useState<VendedorRow[]>([]);
  const [vendedorOpen, setVendedorOpen] = useState(false);
  const [clientes, setClientes] = useState<{ id: number; nombre: string }[]>([]);
  const [clienteOpen, setClienteOpen] = useState(false);
  const [fClienteQ, setFClienteQ] = useState("");

  const [fVendedorId, setFVendedorId] = useState<string | null>(null);
  const [fClienteId, setFClienteId] = useState<number | null>(null);
  const [fDesde, setFDesde] = useState<Date | null>(null);
  const [fHasta, setFHasta] = useState<Date | null>(null);
  const [fPago, setFPago] = useState<PayFilter>("ALL");

  const [showDesdeIOS, setShowDesdeIOS] = useState(false);
  const [showHastaIOS, setShowHastaIOS] = useState(false);

  useFocusEffect(
    useCallback(() => {
      return () => {
        setQ("");
        setVendedorOpen(false);
        setClienteOpen(false);
        setShowDesdeIOS(false);
        setShowHastaIOS(false);
        setFiltersOpen(false);
        setFVendedorId(null);
        setFClienteId(null);
        setFDesde(null);
        setFHasta(null);
        setFPago("ALL");
      };
    }, [])
  );

  const { role, uid, isReady, refreshRole } = useRole();
  const { empresaActivaId } = useEmpresaActiva();
  const roleUp = normalizeUpper(role);

  useFocusEffect(
    useCallback(() => {
      void refreshRole("focus:cxc");
    }, [refreshRole])
  );

  // vendedores list (ADMIN + VENTAS roles from profiles)
  useEffect(() => {
    if (roleUp !== "ADMIN") {
      setVendedores([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("rpc_cxc_vendedores", { p_empresa_id: empresaActivaId });
        if (error) {
          if (alive) setVendedores([]);
          return;
        }
        const out = ((data ?? []) as RpcVendedorRow[])
          .map((r) => {
            const id = String((r as any)?.id ?? "").trim();
            if (!id) return null;
            const nombre = String((r as any)?.full_name ?? "").trim();
            const label = nombre || shortId(id);
            return { vendedor_id: id, vendedor_codigo: label };
          })
          .filter(Boolean) as VendedorRow[];
        out.sort((a, b) => String(a.vendedor_codigo).localeCompare(String(b.vendedor_codigo)));
        if (alive) setVendedores(out);
      } catch {
        if (alive) setVendedores([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [empresaActivaId, roleUp]);

  // clientes list for dropdown
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!empresaActivaId) { if (alive) setClientes([]); return; }
        const { data, error } = await supabase.from("clientes").select("id,nombre").eq("empresa_id", empresaActivaId).order("nombre", { ascending: true });
        if (error || !data || (data as any[]).length === 0) {
          // fallback: derive distinct clientes from CxC RPC
          try {
            const { data: vdata, error: verr } = await supabase.rpc("rpc_cxc_ventas", { p_empresa_id: empresaActivaId });
            if (verr) {
              if (alive) setClientes([]);
              return;
            }
            const map = new Map<number, string>();
            (vdata ?? []).forEach((r: any) => {
              const id = Number(r?.cliente_id ?? 0);
              const nombre = String(r?.cliente_nombre ?? "").trim();
              if (!id || !nombre) return;
              if (!map.has(id)) map.set(id, nombre);
            });
            const out = Array.from(map.entries())
              .map(([id, nombre]) => ({ id, nombre }))
              .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
            if (alive) setClientes(out);
            return;
          } catch {
            if (alive) setClientes([]);
            return;
          }
        }
        if (alive) setClientes((data ?? []) as any);
      } catch {
        if (alive) setClientes([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [empresaActivaId]);

  const filteredClientes = useMemo(() => {
    const q = (fClienteQ ?? "").trim().toLowerCase();
    if (!q) return [];
    return (clientes ?? []).filter((c) => String(c.nombre ?? "").toLowerCase().includes(q) || String(c.id ?? "").includes(q));
  }, [clientes, fClienteQ]);

  const fetchRows = useCallback(async (): Promise<CxCRow[]> => {
    if (!uid) return [];

    const { data, error } =
      roleUp === "ADMIN"
        ? await supabase.rpc("rpc_cxc_ventas", { p_empresa_id: empresaActivaId, p_vendedor_id: fVendedorId })
        : await supabase.rpc("rpc_cxc_ventas", { p_empresa_id: empresaActivaId });

    if (error) throw error;
    return (data ?? []) as CxCRow[];
  }, [empresaActivaId, fVendedorId, roleUp, uid]);

  useFocusEffect(
    useCallback(() => {
      const token = ++fetchTokenRef.current;
      const showLoading = !hasLoadedOnceRef.current && !hasAnyRowsRef.current;

      if (!isReady) {
        setLoadError(null);
        setInitialLoading(true);
        return () => {
          fetchTokenRef.current++;
        };
      }

      // Wait for auth session restoration.
      if (!uid) {
        setLoadError(null);
        setInitialLoading(true);
        return () => {
          fetchTokenRef.current++;
        };
      }

      (async () => {
        try {
          if (showLoading) setInitialLoading(true);
          setLoadError(null);
          const next = await fetchRows();
          if (fetchTokenRef.current !== token) return;
          setRowsRaw(next);
          hasLoadedOnceRef.current = true;
        } finally {
          if (fetchTokenRef.current === token) setInitialLoading(false);
        }
      })().catch((e: any) => {
        if (fetchTokenRef.current !== token) return;
        const msg = String(e?.message ?? e?.error_description ?? e ?? "Error cargando cuentas");
        setLoadError(msg);
        Alert.alert("Cuentas por cobrar", msg);
      });

      return () => {
        // invalidate any in-flight request so stale responses don't affect UI
        fetchTokenRef.current++;
      };
    }, [fetchRows, isReady, uid])
  );

  useResumeLoad(empresaActivaId, () => {
    void (async () => {
      try {
        const next = await fetchRows();
        setRowsRaw(next);
      } catch (e: any) {
        if (__DEV__) console.warn("[cxc] resume fetch error:", e?.message ?? e);
      }
    })();
  });

  const badge = (c: CxCRow) => {
    const saldoNum = Number(c.saldo);
    const saldo = Number.isFinite(saldoNum) ? saldoNum : null;
    if (saldo != null && saldo <= 0) return { text: "PAGADA", kind: "ok" as const };
    if (c.fecha_vencimiento) {
      const d = dayDiffFromToday(c.fecha_vencimiento);
      if (d < 0) return { text: `VENCIDA • ${Math.abs(d)}d`, kind: "overdue" as const };
      if (d === 0) return { text: "PENDIENTE • HOY", kind: "warn" as const };
      return { text: `PENDIENTE • ${d}d`, kind: "warn" as const };
    }
    return { text: "PENDIENTE", kind: "warn" as const };
  };

  // filtro client-side: estado pago + búsqueda por texto
  const rows = useMemo(() => {
    const desdeMs = fDesde ? startOfDay(fDesde).getTime() : null;
    const hastaMs = fHasta ? endOfDay(fHasta).getTime() : null;

    const filtered = rowsRaw.filter((r) => {
      if (fClienteId && Number(r.cliente_id ?? 0) !== fClienteId) return false;

      const rowDateMs = r.fecha ? new Date(r.fecha).getTime() : null;
      if (desdeMs && (rowDateMs == null || rowDateMs < desdeMs)) return false;
      if (hastaMs && (rowDateMs == null || rowDateMs > hastaMs)) return false;

      return true;
    });

    // Esta pantalla es solo "por cobrar": excluir pagadas siempre.
    const unpaid = filtered.filter((r) => {
      const saldoNum = Number(r.saldo);
      const saldo = Number.isFinite(saldoNum) ? saldoNum : null;
      return saldo == null ? true : saldo > 0;
    });

    let result = fPago === "ALL" ? unpaid : unpaid.filter((r) => {
      if (!r.fecha_vencimiento) return fPago === "PENDING";
      const d = dayDiffFromToday(r.fecha_vencimiento);
      if (fPago === "OVERDUE") return d < 0;
      if (fPago === "PENDING") return d >= 0;
      return true;
    });

    if (dq) {
      const qlow = dq.toLowerCase();
      result = result.filter((r) => {
        if ((r.cliente_nombre ?? "").toLowerCase().includes(qlow)) return true;
        const arr = Array.isArray(r.facturas) ? r.facturas.map(String) : [];
        return arr.some((f) => f.toLowerCase().includes(qlow));
      });
    }

    return result;
  }, [rowsRaw, fPago, fClienteId, fDesde, fHasta, dq]);

  const sections = useMemo<CxcSection[]>(() => {
    const map = new Map<string, CxCRow[]>();
    (rows ?? []).forEach((r) => {
      const key = r.fecha ? String(r.fecha).slice(0, 10) : "SIN_FECHA";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });

    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === "SIN_FECHA") return 1;
      if (b === "SIN_FECHA") return -1;
      return a < b ? 1 : -1;
    });

    return keys.map((k) => ({ title: k, data: map.get(k)! }));
  }, [rows]);

  const vendedoresDropdown = useMemo(() => {
    if (vendedores && vendedores.length > 0) return vendedores;
    // fallback: derive vendedores from currently loaded rows
    const map = new Map<string, string>();
    (rowsRaw ?? []).forEach((r: any) => {
      const id = String(r.vendedor_id ?? "").trim();
      if (!id) return;
      const label = String(r.vendedor_codigo ?? "").trim() || id.slice(0, 8);
      if (!map.has(id)) map.set(id, label);
    });
    return Array.from(map.entries()).map(([vendedor_id, vendedor_codigo]) => ({ vendedor_id, vendedor_codigo }));
  }, [vendedores, rowsRaw]);

  const vendedorLabelById = useMemo(() => {
    const map = new Map<string, string>();
    (vendedoresDropdown ?? []).forEach((v) => {
      const id = String(v.vendedor_id ?? "").trim();
      const label = String(v.vendedor_codigo ?? "").trim();
      if (id) map.set(id, label || shortId(id));
    });
    return map;
  }, [vendedoresDropdown]);

  const renderItem = useCallback(({ item }: { item: CxCRow }) => {
    const b = badge(item);
    const fact = Array.isArray(item.facturas) ? item.facturas.filter(Boolean).join(" · ") : "—";
    const vid = String(item.vendedor_id ?? "").trim();
    const vendedorTxt =
      String(item.vendedor_codigo ?? "").trim() ||
      (vid ? vendedorLabelById.get(vid) : "") ||
      (vid ? shortId(vid) : "—");
    const estadoUp = String(item.estado ?? "").toUpperCase();
    const estadoStyle = estadoUp === "FACTURADO"
      ? s.estadoFacturado
      : estadoUp === "EN_RUTA"
      ? s.estadoEnRuta
      : s.estadoEntregado;
    const estadoLabel = estadoUp === "FACTURADO" ? "Facturado" : estadoUp === "EN_RUTA" ? "En ruta" : "Entregado";
    return (
      <Pressable
        style={[
          s.card,
          canSplit && selectedId === item.venta_id ? { borderColor: colors.primary, borderWidth: 2 } : null,
        ]}
        onPress={() => {
          if (canSplit) {
            setSelectedId(item.venta_id);
          } else {
            router.push({ pathname: "/cxc-venta-detalle", params: { ventaId: String(item.venta_id) } } as any);
          }
        }}
      >
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Text style={s.title}>{item.cliente_nombre ?? "Cliente"}</Text>
              <Text style={[s.estadoPill, estadoStyle]}>{estadoLabel}</Text>
            </View>
            <Text style={s.sub}>Facturas: {fact}</Text>
            <Text style={s.sub}>Fecha: {fmtDateLongEs(item.fecha)}</Text>
            <Text style={s.sub}>Vendedor: {vendedorTxt}</Text>
          </View>

          <View style={{ alignItems: "flex-end" }}>
            <Text style={[s.badge, b.kind === "ok" && s.badgeOk, b.kind === "warn" && s.badgeWarn, b.kind === "overdue" && s.badgeOverdue]} numberOfLines={1}>
              {b.text}
            </Text>

            <Text style={s.total}>{fmtQ(item.saldo)}</Text>
          </View>
        </View>
      </Pressable>
    );
  }, [s, M, vendedorLabelById, canSplit, selectedId, colors.primary]);

  const vendedorLabel = useMemo(() => {
    if (!fVendedorId) return "Todos";
    const p = vendedores.find((x) => x.vendedor_id === fVendedorId);
    return p?.vendedor_codigo ?? "Todos";
  }, [fVendedorId, vendedores]);

  const clienteLabel = useMemo(() => {
    if (!fClienteId) return "Todos";
    const c = clientes.find((x) => x.id === fClienteId);
    return c?.nombre ?? "Todos";
  }, [fClienteId, clientes]);

  const openDesdePicker = () => {
    setVendedorOpen(false);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({ value: fDesde ?? new Date(), mode: "date", onChange: (_ev, date) => { if (date) setFDesde(date); } });
    } else {
      setShowDesdeIOS(true);
      setShowHastaIOS(false);
    }
  };

  const openHastaPicker = () => {
    setVendedorOpen(false);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({ value: fHasta ?? new Date(), mode: "date", onChange: (_ev, date) => { if (date) setFHasta(date); } });
    } else {
      setShowHastaIOS(true);
      setShowDesdeIOS(false);
    }
  };

  const limpiarFiltros = () => {
    setFVendedorId(null);
    setFClienteId(null);
    setFDesde(null);
    setFHasta(null);
    setFPago("ALL");
    setVendedorOpen(false);
    setClienteOpen(false);
    setShowDesdeIOS(false);
    setShowHastaIOS(false);
  };

  const aplicarFiltros = () => {
    setFiltersOpen(false);
    setVendedorOpen(false);
    setClienteOpen(false);
    setShowDesdeIOS(false);
    setShowHastaIOS(false);
    // fetchRows se dispara por deps
  };

  const hasActiveFilters = !!(fVendedorId || fClienteId || fDesde || fHasta || fPago !== "ALL");

  const stickyTopContent = (
    <>
      <View style={s.topRow}>
        <View style={s.searchWrap}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Buscar por cliente o factura..."
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
            {hasActiveFilters ? (
              <View style={[s.filterDot, { backgroundColor: FB_DARK_DANGER }]} />
            ) : null}
          </View>
        </Pressable>
      </View>

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
          title: "Cuentas por cobrar",
        }}
      />

      <RoleGate
        allow={["ADMIN", "VENTAS", "MENSAJERO"]}
        deniedText="No tienes permiso para ver Cuentas por cobrar."
        backHref="/(drawer)/(tabs)"
      >
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["bottom"]}>
        {canSplit ? (
          <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.background }}>
            <View style={{ width: 420, maxWidth: 420, flex: 1, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border, backgroundColor: colors.background }}>
              <View style={[s.stickyTop, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
                {stickyTopContent}
              </View>
              <SectionList<CxCRow, CxcSection>
                style={[s.list, { backgroundColor: colors.background }]}
                sections={sections}
                keyExtractor={(it) => String(it.venta_id)}
                renderItem={renderItem}
                stickySectionHeadersEnabled={Platform.OS !== "web"}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                automaticallyAdjustKeyboardInsets
                contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 16 + insets.bottom }}
                initialNumToRender={Platform.OS === "web" ? 999 : 12}
                maxToRenderPerBatch={Platform.OS === "web" ? 999 : 10}
                updateCellsBatchingPeriod={50}
                windowSize={Platform.OS === "web" ? 999 : 21}
                removeClippedSubviews={Platform.OS === "android"}

                renderSectionHeader={({ section }) => (
                  <View style={[s.sectionHeader, { backgroundColor: colors.background, alignItems: "flex-end" }]}>
                    <Text style={[s.sectionHeaderText, { color: M.sub, textAlign: "right" }]}>
                      {section.title === "SIN_FECHA" ? "Sin fecha" : fmtDateLongEs(section.title)}
                    </Text>
                  </View>
                )}
                ListEmptyComponent={!initialLoading && !loadError ? (
                  <View style={s.center}><Text style={s.empty}>Sin cuentas por cobrar</Text></View>
                ) : null}
              />
            </View>
            <View style={{ flex: 1 }}>
              {selectedId ? (
                <CxcDetallePanel ventaId={selectedId} embedded />
              ) : (
                <View style={{ flex: 1, margin: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, borderColor: colors.border, alignItems: "center", justifyContent: "center", padding: 24 }}>
                  <Text style={{ fontSize: 15, fontWeight: "800", textAlign: "center", color: colors.text + "99" }}>
                    Selecciona una cuenta para ver detalles
                  </Text>
                </View>
              )}
            </View>
          </View>
        ) : (
          <>
            <View style={[s.stickyTop, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
              {stickyTopContent}
            </View>
            <SectionList<CxCRow, CxcSection>
              style={[s.list, { backgroundColor: colors.background }]}
              sections={sections}
              keyExtractor={(it) => String(it.venta_id)}
              renderItem={renderItem}
              stickySectionHeadersEnabled={Platform.OS !== "web"}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 16 + insets.bottom }}
              initialNumToRender={Platform.OS === "web" ? 999 : 12}
              maxToRenderPerBatch={Platform.OS === "web" ? 999 : 10}
              updateCellsBatchingPeriod={50}
              windowSize={Platform.OS === "web" ? 999 : 21}
              removeClippedSubviews={Platform.OS === "android"}
              renderSectionHeader={({ section }) => (
                <View style={[s.sectionHeader, { backgroundColor: colors.background, alignItems: "flex-end" }]}>
                  <Text style={[s.sectionHeaderText, { color: M.sub, textAlign: "right" }]}>
                    {section.title === "SIN_FECHA" ? "Sin fecha" : fmtDateLongEs(section.title)}
                  </Text>
                </View>
              )}
              ListEmptyComponent={!initialLoading && !loadError ? (
                <View style={s.center}><Text style={s.empty}>Sin cuentas por cobrar</Text></View>
              ) : null}
            />
          </>
        )}

        {/* Modal filtros */}
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
                      paddingTop: 90,
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
                <Pressable onPress={() => setFiltersOpen(false)} hitSlop={10}><Text style={[s.modalClose, { color: M.sub }]}>Cerrar</Text></Pressable>
              </View>

            <Text style={[s.sectionLabel, { color: M.text }]}>Cliente</Text>
            <Pressable
              onPress={() => { setClienteOpen((v) => !v); setVendedorOpen(false); setShowDesdeIOS(false); setShowHastaIOS(false); }}
              style={[s.dropdownInput, { borderColor: M.border, backgroundColor: M.fieldBg }]}
            >
              <Text style={[s.dropdownText, { color: M.text }]} numberOfLines={1}>{clienteLabel}</Text>
              <Text style={[s.dropdownCaret, { color: M.sub }]}>{clienteOpen ? "▲" : "▼"}</Text>
            </Pressable>
            {clienteOpen ? (
              <View style={[s.dropdownPanel, { borderColor: M.border, backgroundColor: M.fieldBg }]}>
                  <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled">
                    <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
                      <TextInput
                        value={fClienteQ}
                        onChangeText={setFClienteQ}
                        placeholder="Buscar cliente..."
                        placeholderTextColor={isDark ? "rgba(245,245,247,0.6)" : "rgba(0,0,0,0.5)"}
                        style={{ borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, color: M.text }}
                        autoCapitalize="none"
                        returnKeyType="search"
                      />
                    </View>
                    <DDRow label="Todos" selected={!fClienteId} onPress={() => { setFClienteId(null); setClienteOpen(false); setFClienteQ(""); }} isDark={isDark} M={M} />
                    {filteredClientes.map((c) => (
                      <DDRow key={String(c.id)} label={c.nombre} selected={fClienteId === c.id} onPress={() => { setFClienteId(c.id); setClienteOpen(false); setFClienteQ(""); }} isDark={isDark} M={M} />
                    ))}
                  </ScrollView>
              </View>
            ) : null}
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
                  <Pressable onPress={openDesdePicker} style={[s.dateBox, { borderColor: M.border, backgroundColor: M.fieldBg }]}>
                    <Text style={[s.dateTxt, { color: M.text }]}>{fDesde ? fmtDateLongEs(fDesde.toISOString()) : "—"}</Text>
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
                  <Pressable onPress={openHastaPicker} style={[s.dateBox, { borderColor: M.border, backgroundColor: M.fieldBg }]}>
                    <Text style={[s.dateTxt, { color: M.text }]}>{fHasta ? fmtDateLongEs(fHasta.toISOString()) : "—"}</Text>
                  </Pressable>
                )}
              </View>
            </View>

            {Platform.OS === "ios" && showDesdeIOS ? (
              <View style={[s.iosPickerWrap, { borderColor: M.border, backgroundColor: M.fieldBg }]}>
                <DateTimePicker value={fDesde ?? new Date()} mode="date" display="inline" themeVariant={isDark ? "dark" : "light"} onChange={(_ev, date) => { if (date) { setFDesde(date); setShowDesdeIOS(false); } }} />
              </View>
            ) : null}

            {Platform.OS === "ios" && showHastaIOS ? (
              <View style={[s.iosPickerWrap, { borderColor: M.border, backgroundColor: M.fieldBg }]}>
                <DateTimePicker value={fHasta ?? new Date()} mode="date" display="inline" themeVariant={isDark ? "dark" : "light"} onChange={(_ev, date) => { if (date) { setFHasta(date); setShowHastaIOS(false); } }} />
              </View>
            ) : null}

            <View style={{ height: 10 }} />
            <Text style={[s.sectionLabel, { color: M.text }]}>Estado de pago</Text>
              <View style={s.chipsRow}>
              <Chip text="Por cobrar" active={fPago === "ALL"} onPress={() => setFPago("ALL")} M={M} isDark={isDark} />
              <Chip text="Pendientes" active={fPago === "PENDING"} onPress={() => setFPago("PENDING")} M={M} isDark={isDark} />
              <Chip text="Vencidas" active={fPago === "OVERDUE"} onPress={() => setFPago("OVERDUE")} M={M} isDark={isDark} />
            </View>

            {/* Vendedor (ADMIN only) */}
            {normalizeUpper(role) === "ADMIN" ? (
              <>
                <Text style={[s.sectionLabel, { color: M.text }]}>Vendedor</Text>
                <Pressable onPress={() => { setVendedorOpen((v) => !v); setClienteOpen(false); setShowDesdeIOS(false); setShowHastaIOS(false); }} style={[s.dropdownInput, { borderColor: M.border, backgroundColor: M.fieldBg }]}>
                  <Text style={[s.dropdownText, { color: M.text }]} numberOfLines={1}>{vendedorLabel}</Text>
                  <Text style={[s.dropdownCaret, { color: M.sub }]}>{vendedorOpen ? "▲" : "▼"}</Text>
                </Pressable>
                {vendedorOpen ? (
                  <View style={[s.dropdownPanel, { borderColor: M.border, backgroundColor: M.fieldBg }]}>
                      <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled">
                        <DDRow label="Todos" selected={!fVendedorId} onPress={() => { setFVendedorId(null); setVendedorOpen(false); }} isDark={isDark} M={M} />
                        {vendedoresDropdown.map((v) => (
                          <DDRow key={String(v.vendedor_id)} label={v.vendedor_codigo} selected={fVendedorId === v.vendedor_id} onPress={() => { setFVendedorId(v.vendedor_id); setVendedorOpen(false); }} isDark={isDark} M={M} />
                        ))}
                      </ScrollView>
                  </View>
                ) : null}
              </>
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

function DDRow({ label, selected, onPress, isDark, M }: { label: string; selected: boolean; onPress: () => void; isDark: boolean; M: { text: string; primary: any; divider: string } }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: M.divider, backgroundColor: selected ? (isDark ? "rgba(0,122,255,0.22)" : "rgba(0,122,255,0.12)") : "transparent" }, pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null]}>
      <Text style={{ fontSize: Platform.OS === "web" ? 16 : 13, fontWeight: "600", color: selected ? M.primary : M.text }} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function Chip({ text, active, onPress, M, isDark }: { text: string; active: boolean; onPress: () => void; M: { border: string; text: string; primary: any }; isDark: boolean; }) {
  const border = active ? M.primary : M.border;
  const bg = active ? (isDark ? "rgba(0,122,255,0.22)" : "rgba(0,122,255,0.12)") : "transparent";
  const txt = active ? M.primary : M.text;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ borderWidth: 1, borderColor: border, backgroundColor: bg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, marginRight: 10, marginBottom: 10 }, pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null]}>
      <Text style={{ fontWeight: "700", color: txt }}>{text}</Text>
    </Pressable>
  );
}

const styles = (colors: any) =>
  StyleSheet.create({
    topRow: { flexDirection: "row", gap: 10, alignItems: "center", marginBottom: 10 },
    searchWrap: { flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center" },
    searchInput: { flex: 1, color: colors.text, paddingVertical: 10, fontSize: 16 },
    clearBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
    clearTxt: { color: colors.text + "88", fontSize: 22, fontWeight: "900", lineHeight: 22, marginTop: -1 },
    filterBtn: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    filterTxt: { color: colors.text, fontWeight: "800" },
    filterDot: { width: 8, height: 8, borderRadius: 99 },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    empty: { color: colors.text },
    stickyTop: {
      paddingHorizontal: 12,
      paddingTop: 12,
      paddingBottom: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      zIndex: 50,
      ...(Platform.OS === "android" ? { elevation: 50 } : null),
    },
    list: { flex: 1 },
    sectionHeader: {
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 6,
      zIndex: 10,
      ...(Platform.OS === "android" ? { elevation: 10 } : null),
    },
    sectionHeaderText: { fontSize: 13, fontWeight: "900", textAlign: "right" },
    card: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12, borderRadius: 14, marginBottom: 10 },
    row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
    title: { color: colors.text, fontSize: 13, fontWeight: "700" },
    sub: { color: colors.text + "AA", marginTop: 6, fontSize: 11 },
    badge: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, fontSize: 12, fontWeight: "900", color: colors.text, overflow: "hidden" },
    badgeWarn: { borderColor: "#ffe868", backgroundColor: "#fffd7f", color: "#111111" },
    badgeOverdue: { borderColor: "#ff7e77", backgroundColor: "#FFB3AE", color: "#111111" },
    badgeOk: { borderColor: "#7bfd9b", backgroundColor: "#BBF7D0", color: "#0a2213" },
    badgeMuted: { color: colors.text + "AA", backgroundColor: "transparent" },
    total: { color: colors.text, fontWeight: "900", marginTop: 10, fontSize: Platform.OS === "web" ? 14 : 13 },
    modalBackdrop: { ...StyleSheet.absoluteFillObject },
    modalCard: { marginHorizontal: 14, borderRadius: 18, padding: 16, borderWidth: 1 },
    modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    modalTitle: { fontSize: Platform.OS === "web" ? 22 : 13, fontWeight: "800" },
    modalClose: { fontSize: Platform.OS === "web" ? 15 : 13, fontWeight: "700" },
    sectionLabel: { marginTop: 12, fontSize: Platform.OS === "web" ? 15 : 13, fontWeight: "800" },
    dropdownInput: { marginTop: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    dropdownText: { fontSize: Platform.OS === "web" ? 16 : 13, fontWeight: "600", flex: 1, paddingRight: 10 },
    dropdownCaret: { fontSize: Platform.OS === "web" ? 14 : 13, fontWeight: "900" },
    dropdownPanel: { marginTop: 10, borderWidth: 1, borderRadius: 12, overflow: "hidden" },
    clientSearchInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
    twoCols: { flexDirection: "row", marginTop: 8 },
    dateBox: { marginTop: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
    dateTxt: { fontSize: Platform.OS === "web" ? 16 : 13, fontWeight: "700" },
    iosPickerWrap: { marginTop: 10, borderWidth: 1, borderRadius: 12, overflow: "hidden" },
    chipsRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 10 },
    modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },
    estadoPill: { fontSize: 11, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
    estadoFacturado: { backgroundColor: "#ddd6fe", color: "#3b0764" },
    estadoEnRuta: { backgroundColor: "#fed7aa", color: "#7c2d12" },
    estadoEntregado: { backgroundColor: "#bbf7d0", color: "#052e16" },
  });
