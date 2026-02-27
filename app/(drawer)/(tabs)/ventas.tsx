import { useFocusEffect, useTheme } from "@react-navigation/native";
import { router } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Animated,
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
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../../../components/ui/app-button";
import { VentaDetallePanel } from "../../../components/ventas/VentaDetallePanel";
import { supabase } from "../../../lib/supabase";
import { useRole } from "../../../lib/useRole";
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
  factura_numeros?: string[];
};

type VentasCache = {
  rows: VentaRow[];
  tags: Record<string, string[]>;
  facturas: Record<string, string[]>;
  ts: number;
};

type VentaSection = { title: string; data: VentaRow[] };

const CACHE_TTL_MS = 20000;

function sameRowsQuick(a: VentaRow[] | null | undefined, b: VentaRow[]) {
  if (!a) return false;
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const al = a.length;
  if (!al) return true;
  const a0 = Number(a[0]?.id ?? 0);
  const b0 = Number(b[0]?.id ?? 0);
  if (a0 !== b0) return false;
  const aL = Number(a[al - 1]?.id ?? 0);
  const bL = Number(b[al - 1]?.id ?? 0);
  return aL === bL;
}

function normalizeUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return String(iso).slice(0, 10);
}

function formatYmdEsLong(ymd: string) {
  const raw = String(ymd ?? "").trim();
  if (!raw) return "Sin fecha";

  if (raw.toUpperCase() === "SIN_FECHA") return "Sin fecha";
  if (raw.toLowerCase() === "sin fecha") return "Sin fecha";

  const d = new Date(`${raw.slice(0, 10)}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return raw;

  const fmt = new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return fmt.format(d).toLowerCase().replace(/\./g, "");
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

function groupVentasByDay(list: VentaRow[]): VentaSection[] {
  const buckets = new Map<string, VentaRow[]>();
  list.forEach((venta) => {
    const dateKey = venta?.fecha ? String(venta.fecha).slice(0, 10) : "";
    const title = dateKey || "Sin fecha";
    const bucket = buckets.get(title);
    if (bucket) {
      bucket.push(venta);
    } else {
      buckets.set(title, [venta]);
    }
  });

  const getTs = (key: string) => {
    if (key === "Sin fecha") return Number.NEGATIVE_INFINITY;
    const ts = Date.parse(`${key}T00:00:00`);
    return Number.isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
  };

  return Array.from(buckets.entries())
    .sort((a, b) => getTs(b[0]) - getTs(a[0]))
    .map(([title, data]) => ({ title, data }));
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
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const canSplit = isWeb && width >= 1100;

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

  const { role, refreshRole } = useRole();
  const roleUp = normalizeUpper(role) as Role;
  const canCreate = roleUp === "VENTAS" || roleUp === "ADMIN";

  const [estado, setEstado] = useState<Estado>("NUEVO");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selectedVentaId, setSelectedVentaId] = useState<number | null>(null);

  React.useEffect(() => {
    if (!canSplit) {
      setSelectedVentaId(null);
    }
  }, [canSplit]);

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
  const [facturasByVenta, setFacturasByVenta] = useState<Record<string, string[]>>({});

  // Evita renderizar data vieja cuando la pantalla permanece montada (Tabs)
  // y se entra/cambia de tab antes de que termine el fetch.
  const [loadedEstado, setLoadedEstado] = useState<Estado | null>(null);

  const rowsRawRef = useRef<VentaRow[]>([]);
  const loadedEstadoRef = useRef<Estado | null>(null);
  React.useEffect(() => {
    rowsRawRef.current = rowsRaw;
  }, [rowsRaw]);
  React.useEffect(() => {
    loadedEstadoRef.current = loadedEstado;
  }, [loadedEstado]);

  const [initialLoading, setInitialLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const [facturadosAlert, setFacturadosAlert] = useState(false);
  const [nuevosAlert, setNuevosAlert] = useState(false);
  const [facturadoAny, setFacturadoAny] = useState(false);
  const [enRutaAny, setEnRutaAny] = useState(false);

  const dotsReqSeq = useRef(0);

  const cacheRef = useRef<Record<string, VentasCache>>({});
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

  const [revalidating, setRevalidating] = useState(false);
  const [revalidatingEstado, setRevalidatingEstado] = useState<Estado | null>(null);
  const revalidateSeq = useRef(0);

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
        const prev = loadedEstadoRef.current === targetEstado ? rowsRawRef.current : null;
        if (!sameRowsQuick(prev, rows)) {
          setRowsRaw(rows);
        }

        const ids = rows.map((r) => Number(r.id)).filter((x) => Number.isFinite(x) && x > 0);
        if (!ids.length) {
          setTagsByVenta({});
          setFacturasByVenta({});
          cacheRef.current[targetEstado] = { rows, tags: {}, facturas: {}, ts: Date.now() };
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

        const tagMap: Record<string, string[]> = {};
        (trows ?? []).forEach((tr: any) => {
          const vid = String(tr.venta_id);
          const tg = String(tr.tag ?? "").trim().toUpperCase();
          if (!vid || !tg) return;
          if (!tagMap[vid]) tagMap[vid] = [];
          tagMap[vid].push(tg);
        });

        const { data: frows, error: ferr } = await supabase
          .from("ventas_facturas")
          .select("venta_id,numero_factura")
          .in("venta_id", ids);
        if (mySeq !== reqSeq.current) return;
        if (ferr) throw ferr;

        const facturasMap: Record<string, string[]> = {};
        (frows ?? []).forEach((fr: any) => {
          const vid = String(fr.venta_id ?? "").trim();
          const num = String(fr.numero_factura ?? "").trim();
          if (!vid || !num) return;
          const bucket = facturasMap[vid] ?? (facturasMap[vid] = []);
          if (!bucket.includes(num)) bucket.push(num);
        });

        setTagsByVenta(tagMap);
        setFacturasByVenta(facturasMap);
        cacheRef.current[targetEstado] = { rows, tags: tagMap, facturas: facturasMap, ts: Date.now() };
        setLoadedEstado(targetEstado);
      } catch (e) {
        // Si falla la carga, no dejes la UI pegada en "Cargando...".
        if (mySeq === reqSeq.current) setLoadedEstado(targetEstado);
        throw e;
      } finally {
        if (mySeq === reqSeq.current) setListLoading(false);
      }
    },
    []
  );

  const fetchAll = useCallback(async () => {
    void refreshRole();

    const now = Date.now();
    const cached = cacheRef.current[estado];
    const cacheFresh = !!cached && now - cached.ts <= CACHE_TTL_MS;

    if (cacheFresh) {
      setListLoading(false);
      setRowsRaw(cached.rows);
      setTagsByVenta(cached.tags);
      setFacturasByVenta(cached.facturas ?? {});
      setLoadedEstado(estado);

      const myReval = ++revalidateSeq.current;
      setRevalidatingEstado(estado);
      setRevalidating(true);
      fetchVentas(estado, { silent: true })
        .catch(() => {})
        .finally(() => {
          if (myReval === revalidateSeq.current) {
            setRevalidating(false);
            setRevalidatingEstado(null);
          }
        });
    } else {
      // Cache vencido: evita mostrar data vieja.
      setLoadedEstado(null);
      await fetchVentas(estado, { silent: false });
    }

    // Respeta TTL de dots sin disparar rpc innecesario.
    const dotsCached = dotsCacheRef.current;
    const dotsFresh = !!dotsCached.data && Date.now() - dotsCached.timestamp < 25000;
    if (!dotsFresh) await refreshDots();
  }, [estado, fetchVentas, refreshDots, refreshRole]);

  const onPullRefresh = useCallback(() => {
    setPullRefreshing(true);
    Promise.allSettled([refreshRole(), fetchVentas(estado, { silent: true }), refreshDots()]).finally(() => {
      setPullRefreshing(false);
    });
  }, [estado, fetchVentas, refreshDots, refreshRole]);

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


      const facturas = (facturasByVenta[String(r.id)] ?? []).map((x) => String(x ?? "").toLowerCase());


      const searchDigits = search.replace(/\D+/g, "");
      const facturaMatch =
        facturas.some((n) => n.includes(search)) ||
        (!!searchDigits && facturas.some((n) => n.replace(/\D+/g, "").includes(searchDigits)));


      return id.includes(search) || cliente.includes(search) || vcode.includes(search) || facturaMatch;
    });
    return filtered;
  }, [debouncedQ, rowsRaw, tagsByVenta, facturasByVenta, fClienteId, fDesde, fHasta]);

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

  const visibleRows = useMemo(() => (loadedEstado === estado ? rows : []), [estado, loadedEstado, rows]);
  const sections = useMemo(() => groupVentasByDay(visibleRows), [visibleRows]);

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

  const handleVentaPress = useCallback(
    (id: number) => {
      if (canSplit) {
        setSelectedVentaId(id);
        return;
      }
      router.push({ pathname: "/venta-detalle", params: { ventaId: String(id) } } as any);
    },
    [canSplit]
  );

  const renderItem = useCallback(
    ({ item }: { item: VentaRow }) => {
      const chips = chipsById[item.id] ?? [];
      const vendedorChip = item.vendedor_codigo ? String(item.vendedor_codigo) : shortUid(item.vendedor_id);
      const facturas = facturasByVenta[String(item.id)] ?? [];
      const facturaLabel =
        facturas.length === 1 ? `Factura: ${facturas[0]}` : facturas.length > 1 ? `Facturas: ${facturas.join(", ")}` : null;

      return (
        <Pressable
          onPress={() => handleVentaPress(item.id)}
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
          {facturaLabel ? (
            <Text style={[s.cardSub, { color: C.sub }]} numberOfLines={1}>
              {facturaLabel}
            </Text>
          ) : null}

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
      facturasByVenta,
      handleVentaPress,
    ]
  );

  const listEmptyComponent = useMemo(() => {
    const now = Date.now();
    const cached = cacheRef.current[estado];
    const cacheFresh = !!cached && now - cached.ts <= CACHE_TTL_MS;
    const showSkeleton =
      visibleRows.length === 0 &&
      ((initialLoading && loadedEstado !== estado) || (listLoading && !cacheFresh));

    if (showSkeleton) {
      const skelBg = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)";
      const skelHi = isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.12)";
      const items = Array.from({ length: 7 }).map((_, idx) => (
        <View
          key={`sk-${idx}`}
          style={[
            s.card,
            {
              borderColor: C.border,
              backgroundColor: C.card,
              overflow: "hidden",
            },
          ]}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View
              style={{
                height: 18,
                borderRadius: 10,
                backgroundColor: skelHi,
                flex: 1,
                marginRight: 10,
              }}
            />
            <View style={{ height: 28, width: 88, borderRadius: 999, backgroundColor: skelBg }} />
          </View>
          <View style={{ height: 10 }} />
          <View style={{ height: 14, width: "56%", borderRadius: 8, backgroundColor: skelBg }} />
          <View style={{ height: 12 }} />
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <View style={{ height: 26, width: 110, borderRadius: 999, backgroundColor: skelBg }} />
            <View style={{ height: 26, width: 84, borderRadius: 999, backgroundColor: skelBg }} />
            <View style={{ height: 26, width: 96, borderRadius: 999, backgroundColor: skelBg }} />
          </View>
        </View>
      ));
      return <View>{items}</View>;
    }

    return <Text style={{ padding: 16, color: C.sub, fontWeight: "700" }}>Sin ventas</Text>;
  }, [C.border, C.card, C.sub, estado, initialLoading, isDark, listLoading, loadedEstado, visibleRows.length]);

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => (
      <View style={[s.sectionHeader, { backgroundColor: C.bg, alignItems: "flex-end" }]}>
        <Text style={[s.sectionHeaderText, { color: C.sub, textAlign: "right" }]}>{formatYmdEsLong(section.title)}</Text>
      </View>
    ),
    [C.bg, C.sub]
  );

  const listComponent = (
    <SectionList
      sections={sections}
      keyExtractor={keyExtractor}
      refreshing={pullRefreshing}
      onRefresh={onPullRefresh}
      stickySectionHeadersEnabled
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
      renderSectionHeader={renderSectionHeader}
      ListHeaderComponent={
        <View pointerEvents="none" style={{ height: 18, marginBottom: 8, justifyContent: "center" }}>
          <Text
            style={{
              color: C.sub,
              fontWeight: "800",
              fontSize: 12,
              opacity: revalidating && revalidatingEstado === estado && visibleRows.length ? 1 : 0,
            }}
          >
            Actualizando...
          </Text>
        </View>
      }
      ListEmptyComponent={listEmptyComponent}
      style={{ flex: 1 }}
    />
  );

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

                  const nextEstado = t.key;
                  setEstado(nextEstado);

                  const now = Date.now();
                  const cached = cacheRef.current[nextEstado];
                  const cacheFresh = !!cached && now - cached.ts <= CACHE_TTL_MS;

                  if (cacheFresh) {
                    setListLoading(false);
                    setRowsRaw(cached.rows);
                    setTagsByVenta(cached.tags);
                    setFacturasByVenta(cached.facturas ?? {});
                    setLoadedEstado(nextEstado);

                    const myReval = ++revalidateSeq.current;
                    setRevalidatingEstado(nextEstado);
                    setRevalidating(true);
                    fetchVentas(nextEstado, { silent: true })
                      .catch(() => {})
                      .finally(() => {
                        if (myReval === revalidateSeq.current) {
                          setRevalidating(false);
                          setRevalidatingEstado(null);
                        }
                      });
                  } else {
                    setRevalidating(false);
                    setRevalidatingEstado(null);
                    setLoadedEstado(null);
                    setListLoading(true);
                    fetchVentas(nextEstado, { silent: false }).catch(() => {});
                  }

                  const dotsCached = dotsCacheRef.current;
                  const dotsFresh = !!dotsCached.data && Date.now() - dotsCached.timestamp < 25000;
                  if (!dotsFresh) refreshDots().catch(() => {});
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

      {canSplit ? (
        <View style={[s.splitWrap, { borderTopColor: C.border }]}>
          <View style={[s.splitListPane, { borderRightColor: C.border }]}>{listComponent}</View>
          <View style={s.splitDetailPane}>
            {selectedVentaId ? (
              <VentaDetallePanel ventaId={selectedVentaId} embedded />
            ) : (
              <View style={[s.splitPlaceholder, { borderColor: C.border }]}>
                <Text style={[s.splitPlaceholderText, { color: C.sub }]}>Selecciona una venta para ver detalles</Text>
              </View>
            )}
          </View>
        </View>
      ) : (
        listComponent
      )}

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

  splitWrap: { flex: 1, flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth },
  splitListPane: { width: 520, maxWidth: 520, borderRightWidth: StyleSheet.hairlineWidth },
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
  splitPlaceholderText: { fontSize: 15, fontWeight: "800", textAlign: "center" },

  card: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 },
  cardTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: "900" },
  cardSub: { marginTop: 6, fontSize: 13, fontWeight: "700" },

  vendedorPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, maxWidth: 140 },
  vendedorPillText: { fontSize: 12, fontWeight: "900" },

  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: "900" },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: "transparent",
    zIndex: 10,
    ...(Platform.OS === "android" ? { elevation: 10 } : {}),
  },
  sectionHeaderText: { fontSize: 13, fontWeight: "900", textAlign: "right" },

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
