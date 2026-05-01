import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useFocusEffect, useTheme } from "@react-navigation/native";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { AppButton } from "../../../components/ui/app-button";
import { VentaDetallePanel } from "../../../components/ventas/VentaDetallePanel";
import { VentaNuevaModal } from "../../../components/ventas/VentaNuevaModal";
import { CotizacionModal } from "../../../components/ventas/CotizacionModal";
import { supabase } from "../../../lib/supabase";
import { useThemePref } from "../../../lib/themePreference";
import { alphaColor } from "../../../lib/ui";
import { useRole } from "../../../lib/useRole";
import { useEmpresaActiva } from "../../../lib/useEmpresaActiva";
import { useResumeLoad } from "../../../lib/useResumeLoad";
import { onVentaEstadoChanged, emitVentaEstadoChanged } from "../../../lib/ventaEstadoEvents";
import { normalizeUpper, safeIlike } from "../../../lib/utils/text";
import { fmtDate, toGTDateKey } from "../../../lib/utils/format";
import { FB_DARK_DANGER } from "../../../src/theme/headerColors";

type Role = "ADMIN" | "BODEGA" | "VENTAS" | "FACTURACION" | "MENSAJERO" | "";
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
  en_ruta_nota?: string | null;
  en_ruta_by?: string | null;
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

function fmtDateCardEs(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ymd = toGTDateKey(iso) || String(iso).slice(0, 10);
  const d = new Date(`${ymd}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return ymd;
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" })
    .format(d)
    .toLowerCase()
    .replace(/\./g, "");
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
    const dateKey = venta?.fecha ? toGTDateKey(venta.fecha) : "";
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

type Colors = {
  bg: string;
  card: string;
  text: string;
  sub: string;
  border: string;
  tint: string;
  chipBg: string;
  chipRedBg: string;
  chipRedText: string;
  chipAmberBg: string;
  chipAmberText: string;
};

const EMPTY_CHIPS: Chip[] = [];
const EMPTY_FACTURAS: string[] = [];

type VentaCardProps = {
  item: VentaRow;
  chips: Chip[];
  facturas: string[];
  onPress: (id: number) => void;
  C: Colors;
  hasUrgent?: boolean;
  isSelected?: boolean;
};

const VentaCard = React.memo(
  ({ item, chips, facturas, onPress, C, hasUrgent, isSelected }: VentaCardProps) => {
    const vendedorChip = item.vendedor_codigo ? String(item.vendedor_codigo) : shortUid(item.vendedor_id);
    const facturaLabel =
      facturas.length === 1 ? `Factura: ${facturas[0]}` : facturas.length > 1 ? `Facturas: ${facturas.join(", ")}` : null;

    return (
      <Pressable
        onPress={() => onPress(item.id)}
        style={({ pressed }) => [
          s.card,
          { borderColor: C.border, backgroundColor: C.card },
          isSelected ? { borderColor: C.tint, borderWidth: 2 } : null,
          hasUrgent ? { borderLeftColor: FB_DARK_DANGER, borderLeftWidth: 3 } : null,
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
        {item.fecha ? (
          <Text style={[s.cardSub, { color: C.sub }]} numberOfLines={1}>
            {fmtDateCardEs(item.fecha)}
          </Text>
        ) : null}
        {facturaLabel ? (
          <Text style={[s.cardSub, { color: C.sub }]} numberOfLines={1}>
            {facturaLabel}
          </Text>
        ) : null}
        {item.estado === "EN_RUTA" && item.en_ruta_nota ? (
          <View style={[s.notaRow, { backgroundColor: C.chipAmberBg }]}>
            <Text style={[s.notaLabel, { color: C.chipAmberText }]}>Nota: </Text>
            <Text style={[s.notaTxt, { color: C.chipAmberText }]} numberOfLines={2}>
              {item.en_ruta_nota}{item.en_ruta_by ? ` — ${item.en_ruta_by}` : ""}
            </Text>
          </View>
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
  (prev, next) =>
    prev.item.id === next.item.id &&
    prev.item.en_ruta_nota === next.item.en_ruta_nota &&
    prev.chips === next.chips &&
    prev.facturas === next.facturas &&
    prev.onPress === next.onPress &&
    prev.C === next.C &&
    prev.hasUrgent === next.hasUrgent &&
    prev.isSelected === next.isSelected
);

type VentasListEmptyProps = {
  isLoading: boolean;
  initialLoading: boolean;
  loadedEstado: Estado | null;
  estado: Estado;
  visibleCount: number;
  isDark: boolean;
  C: Colors;
};

function VentasListEmpty({ isLoading, initialLoading, loadedEstado, estado, visibleCount, isDark, C }: VentasListEmptyProps) {
  const showSkeleton = visibleCount === 0 && (isLoading || (initialLoading && loadedEstado !== estado));

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
}

export default function Ventas() {
  const { colors } = useTheme();
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const canSplit = isWeb && width >= 1100;
  const insets = useSafeAreaInsets();

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
  const { empresaActivaId } = useEmpresaActiva();
  const roleUp = normalizeUpper(role) as Role;
  const canCreate = roleUp === "VENTAS" || roleUp === "ADMIN" || roleUp === "MENSAJERO";

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
  const [nuevaVentaOpen, setNuevaVentaOpen] = useState(false);
  const [cotizacionOpen, setCotizacionOpen] = useState(false);
  const [editingVentaId, setEditingVentaId] = useState<number | null>(null);
  const [detalleRefreshKey, setDetalleRefreshKey] = useState(0);
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
        if (!empresaActivaId) return;
        const { data, error } = await supabase
          .from("clientes")
          .select("id,nombre")
          .eq("empresa_id", empresaActivaId)
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
  }, [empresaActivaId]);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(q);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  // [búsqueda server-side] cuando hay texto en el buscador, consulta Supabase directamente
  React.useEffect(() => {
    const trimmed = debouncedQ.trim();
    if (!trimmed) {
      // Sin texto → volver a resultados en memoria (limpiar búsqueda)
      setSearchRows(null);
      setSearchTagsByVenta({});
      setSearchFacturasByVenta({});
      setSearchLoading(false);
      return;
    }

    const mySeq = ++searchSeq.current;
    setSearchLoading(true);

    (async () => {
      try {
        if (!empresaActivaId) { setSearchRows([]); return; }

        const searchSelectFields = `id,fecha,estado,cliente_id,cliente_nombre,vendedor_id,vendedor_codigo,requiere_receta,receta_cargada,
          ventas_tags!ventas_tags_venta_id_fkey(tag,removed_at),
          ventas_facturas!ventas_facturas_venta_id_fkey(numero_factura)`;

        // Buscar venta_ids por número de factura y por nombre de producto (en paralelo)
        const [{ data: facturaMatches }, { data: productoMatches }] = await Promise.all([
          supabase
            .from("ventas_facturas")
            .select("venta_id")
            .eq("empresa_id", empresaActivaId)
            .ilike("numero_factura", `%${safeIlike(trimmed)}%`),
          supabase
            .from("ventas_detalle")
            .select("venta_id, productos!inner(nombre)")
            .eq("empresa_id", empresaActivaId)
            .ilike("productos.nombre", `%${safeIlike(trimmed)}%`),
        ]);
        const facturaVentaIds = (facturaMatches ?? []).map((f: any) => f.venta_id as number);
        const productoVentaIds = (productoMatches ?? []).map((d: any) => d.venta_id as number);

        // Construir el filtro OR: nombre de cliente + facturas + productos + id exacto si es numérico
        const isNumeric = /^\d+$/.test(trimmed);
        const extraIds = [...new Set([...facturaVentaIds, ...productoVentaIds])];
        const orParts = [`cliente_nombre.ilike.%${safeIlike(trimmed)}%`];
        if (isNumeric) orParts.push(`id.eq.${trimmed}`);
        if (extraIds.length > 0) orParts.push(`id.in.(${extraIds.join(",")})`);

        const { data, error } = await supabase
          .from("ventas")
          .select(searchSelectFields)
          .eq("empresa_id", empresaActivaId)
          .eq("estado", estado)
          .or(orParts.join(","))
          .order("fecha", { ascending: false });
        if (mySeq !== searchSeq.current) return;
        if (error) throw error;

        const raw = (data ?? []) as any[];
        const rows: VentaRow[] = raw.map(({ ventas_tags: _t, ventas_facturas: _f, ...rest }) => rest as VentaRow);

        const tagMap: Record<string, string[]> = {};
        const facturasMap: Record<string, string[]> = {};
        raw.forEach((r: any) => {
          const vid = String(r.id);
          (r.ventas_tags ?? []).forEach((tr: any) => {
            if (tr.removed_at != null) return;
            const tg = String(tr.tag ?? "").trim().toUpperCase();
            if (!tg) return;
            if (!tagMap[vid]) tagMap[vid] = [];
            tagMap[vid].push(tg);
          });
          (r.ventas_facturas ?? []).forEach((fr: any) => {
            const num = String(fr.numero_factura ?? "").trim();
            if (!num) return;
            const bucket = facturasMap[vid] ?? (facturasMap[vid] = []);
            if (!bucket.includes(num)) bucket.push(num);
          });
        });

        setSearchRows(rows);
        setSearchTagsByVenta(tagMap);
        setSearchFacturasByVenta(facturasMap);
      } catch {
        if (mySeq === searchSeq.current) { setSearchRows([]); setSearchTagsByVenta({}); setSearchFacturasByVenta({}); }
      } finally {
        if (mySeq === searchSeq.current) setSearchLoading(false);
      }
    })();
  }, [debouncedQ, estado, empresaActivaId]);

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
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const PAGE_SIZE = 50;

  // [búsqueda server-side] estado separado para no interferir con listLoading
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchRows, setSearchRows] = useState<VentaRow[] | null>(null);
  const [searchTagsByVenta, setSearchTagsByVenta] = useState<Record<string, string[]>>({});
  const [searchFacturasByVenta, setSearchFacturasByVenta] = useState<Record<string, string[]>>({});
  const searchSeq = useRef(0);

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

      const { data, error } = await supabase.rpc("rpc_ventas_dots", { p_empresa_id: empresaActivaId, p_limit: 200 });
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
  }, [empresaActivaId]);

  const fetchVentas = useCallback(
    async (targetEstado: Estado, opts?: { silent?: boolean }) => {
      const mySeq = ++reqSeq.current;
      const silent = !!opts?.silent;
      if (!silent) {
        setListLoading(true);
      }

      try {
        if (!empresaActivaId) return;
        const selectFields = targetEstado === "EN_RUTA"
          ? `id,fecha,estado,cliente_id,cliente_nombre,vendedor_id,vendedor_codigo,requiere_receta,receta_cargada,
            ventas_tags!ventas_tags_venta_id_fkey(tag,removed_at),
            ventas_facturas!ventas_facturas_venta_id_fkey(numero_factura),
            ventas_eventos!ventas_eventos_venta_id_fkey(tipo,nota,profiles!ventas_eventos_creado_por_fkey(full_name))`
          : `id,fecha,estado,cliente_id,cliente_nombre,vendedor_id,vendedor_codigo,requiere_receta,receta_cargada,
            ventas_tags!ventas_tags_venta_id_fkey(tag,removed_at),
            ventas_facturas!ventas_facturas_venta_id_fkey(numero_factura)`;
        const { data, error } = await supabase
          .from("ventas")
          .select(selectFields)
          .eq("empresa_id", empresaActivaId)
          .eq("estado", targetEstado)
          .order("fecha", { ascending: false })
          .range(0, PAGE_SIZE - 1);
        if (mySeq !== reqSeq.current) return;
        if (error) throw error;

        const raw = (data ?? []) as any[];
        const rows: VentaRow[] = raw.map(({ ventas_tags: _t, ventas_facturas: _f, ventas_eventos: _e, ...rest }) => {
          const enRutaEvento = (_e ?? []).find((ev: any) => ev.tipo === "EN_RUTA");
          return { ...rest, en_ruta_nota: enRutaEvento?.nota ?? null, en_ruta_by: (enRutaEvento as any)?.profiles?.full_name ?? null } as VentaRow;
        });
        const prev = loadedEstadoRef.current === targetEstado ? rowsRawRef.current : null;
        if (!sameRowsQuick(prev, rows)) {
          setRowsRaw(rows);
        }
        setHasMore(raw.length === PAGE_SIZE);

        const tagMap: Record<string, string[]> = {};
        const facturasMap: Record<string, string[]> = {};
        raw.forEach((r: any) => {
          const vid = String(r.id);
          (r.ventas_tags ?? []).forEach((tr: any) => {
            if (tr.removed_at != null) return;
            const tg = String(tr.tag ?? "").trim().toUpperCase();
            if (!tg) return;
            if (!tagMap[vid]) tagMap[vid] = [];
            tagMap[vid].push(tg);
          });
          (r.ventas_facturas ?? []).forEach((fr: any) => {
            const num = String(fr.numero_factura ?? "").trim();
            if (!num) return;
            const bucket = facturasMap[vid] ?? (facturasMap[vid] = []);
            if (!bucket.includes(num)) bucket.push(num);
          });
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
    [empresaActivaId]
  );

  const loadMoreVentas = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current || debouncedQ.trim()) return;
    if (!empresaActivaId) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const offset = rowsRawRef.current.length;
    const currentEstado = loadedEstadoRef.current;
    try {
      const moreSelectFields = currentEstado === "EN_RUTA"
        ? `id,fecha,estado,cliente_id,cliente_nombre,vendedor_id,vendedor_codigo,requiere_receta,receta_cargada,
          ventas_tags!ventas_tags_venta_id_fkey(tag,removed_at),
          ventas_facturas!ventas_facturas_venta_id_fkey(numero_factura),
          ventas_eventos!ventas_eventos_venta_id_fkey(tipo,nota)`
        : `id,fecha,estado,cliente_id,cliente_nombre,vendedor_id,vendedor_codigo,requiere_receta,receta_cargada,
          ventas_tags!ventas_tags_venta_id_fkey(tag,removed_at),
          ventas_facturas!ventas_facturas_venta_id_fkey(numero_factura)`;
      const { data, error } = await supabase
        .from("ventas")
        .select(moreSelectFields)
        .eq("empresa_id", empresaActivaId)
        .eq("estado", currentEstado!)
        .order("fecha", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;

      const raw = (data ?? []) as any[];
      const newRows: VentaRow[] = raw.map(({ ventas_tags: _t, ventas_facturas: _f, ventas_eventos: _e, ...rest }) => {
        const enRutaEvento = (_e ?? []).find((ev: any) => ev.tipo === "EN_RUTA");
        return { ...rest, en_ruta_nota: enRutaEvento?.nota ?? null } as VentaRow;
      });

      const newTagMap: Record<string, string[]> = {};
      const newFacturasMap: Record<string, string[]> = {};
      raw.forEach((r: any) => {
        const vid = String(r.id);
        (r.ventas_tags ?? []).forEach((tr: any) => {
          if (tr.removed_at != null) return;
          const tg = String(tr.tag ?? "").trim().toUpperCase();
          if (!tg) return;
          if (!newTagMap[vid]) newTagMap[vid] = [];
          newTagMap[vid].push(tg);
        });
        (r.ventas_facturas ?? []).forEach((fr: any) => {
          const num = String(fr.numero_factura ?? "").trim();
          if (!num) return;
          const bucket = newFacturasMap[vid] ?? (newFacturasMap[vid] = []);
          if (!bucket.includes(num)) bucket.push(num);
        });
      });

      setRowsRaw((prev) => [...prev, ...newRows]);
      setTagsByVenta((prev) => ({ ...prev, ...newTagMap }));
      setFacturasByVenta((prev) => ({ ...prev, ...newFacturasMap }));
      setHasMore(raw.length === PAGE_SIZE);
    } catch {
      // silencioso — el usuario puede seguir viendo lo que ya cargó
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, debouncedQ, empresaActivaId, PAGE_SIZE]);

  const loadEstado = useCallback(
    (targetEstado: Estado): Promise<void> => {
      const now = Date.now();
      const cached = cacheRef.current[targetEstado];
      const cacheFresh = !!cached && now - cached.ts <= CACHE_TTL_MS;

      if (cacheFresh) {
        setListLoading(false);
        setRowsRaw(cached.rows);
        setTagsByVenta(cached.tags);
        setFacturasByVenta(cached.facturas ?? {});
        setLoadedEstado(targetEstado);

        const myReval = ++revalidateSeq.current;
        setRevalidatingEstado(targetEstado);
        setRevalidating(true);
        fetchVentas(targetEstado, { silent: true })
          .catch(() => {})
          .finally(() => {
            if (myReval === revalidateSeq.current) {
              setRevalidating(false);
              setRevalidatingEstado(null);
            }
          });
        return Promise.resolve();
      } else {
        setRevalidating(false);
        setRevalidatingEstado(null);
        setLoadedEstado(null);
        return fetchVentas(targetEstado, { silent: false });
      }
    },
    [fetchVentas]
  );

  const fetchAll = useCallback(async () => {
    void refreshRole();
    await loadEstado(estado);
    // Respeta TTL de dots sin disparar rpc innecesario.
    const dotsCached = dotsCacheRef.current;
    const dotsFresh = !!dotsCached.data && Date.now() - dotsCached.timestamp < 25000;
    if (!dotsFresh) await refreshDots();
  }, [estado, loadEstado, refreshDots, refreshRole]);

  const onPullRefresh = useCallback(() => {
    setPullRefreshing(true);
    dotsCacheRef.current = { data: null, timestamp: 0 };
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

  useResumeLoad(empresaActivaId, () => {
    cacheRef.current = {};
    dotsCacheRef.current = { data: null, timestamp: 0 };
    void fetchAll();
  });

  // Recargar cuando el usuario cambia de empresa activa
  useEffect(() => {
    if (!empresaActivaId) return;
    cacheRef.current = {};
    dotsCacheRef.current = { data: null, timestamp: 0 };
    void fetchAll();
  }, [empresaActivaId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: escucha cambios en ventas de esta empresa y refresca automáticamente
  useEffect(() => {
    if (!empresaActivaId) return;
    const forceRefresh = () => {
      dotsCacheRef.current = { data: null, timestamp: 0 };
      void fetchVentas(estado, { silent: true });
      void refreshDots();
    };
    const channel = supabase
      .channel(`ventas_realtime_${empresaActivaId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "ventas", filter: `empresa_id=eq.${empresaActivaId}` },
        () => { emitVentaEstadoChanged(); }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ventas", filter: `empresa_id=eq.${empresaActivaId}` },
        () => { emitVentaEstadoChanged(); }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ventas_tags", filter: `empresa_id=eq.${empresaActivaId}` },
        () => { emitVentaEstadoChanged(); }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "ventas_tags", filter: `empresa_id=eq.${empresaActivaId}` },
        () => { emitVentaEstadoChanged(); }
      )
      .subscribe((status) => {
        // Si el canal se cierra o falla en web, forzar recarga para no quedar desactualizado
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          forceRefresh();
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, [empresaActivaId, estado, fetchVentas, refreshDots]);

  // En web: cuando el tab vuelve a ser visible, refrescar datos porque el WebSocket pudo haberse caído
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handleVisibility = () => {
      if (!document.hidden) {
        dotsCacheRef.current = { data: null, timestamp: 0 };
        void fetchVentas(estado, { silent: true });
        void refreshDots();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [estado, fetchVentas, refreshDots]);

  useEffect(() => onVentaEstadoChanged(() => {
    delete cacheRef.current[estado];
    dotsCacheRef.current = { data: null, timestamp: 0 };
    void fetchVentas(estado, { silent: true });
    void refreshDots();
    // No cerrar el detalle seleccionado — el refresh es silencioso y el
    // usuario puede estar viendo una venta en el panel derecho.
  }), [estado, fetchVentas, refreshDots]);

  // Cuando hay búsqueda activa, usar resultados del servidor; si no, los cargados localmente
  const activeTagsByVenta = searchRows !== null ? searchTagsByVenta : tagsByVenta;
  const activeFacturasByVenta = searchRows !== null ? searchFacturasByVenta : facturasByVenta;

  const rows = useMemo(() => {
    const desdeMs = fDesde ? startOfDay(fDesde).getTime() : null;
    const hastaMs = fHasta ? endOfDay(fHasta).getTime() : null;
    const baseRows = searchRows !== null ? searchRows : rowsRaw;

    const filtered = baseRows.filter((r) => {
      const tags = activeTagsByVenta[String(r.id)] ?? [];
      const isAnulado = tags.includes("ANULADO");
      if (isAnulado) return false;

      if (fClienteId && Number(r.cliente_id ?? 0) !== fClienteId) return false;

      const ymd = r.fecha ? toGTDateKey(r.fecha) : "";
      const rowDateMs = ymd ? new Date(`${ymd}T12:00:00`).getTime() : null;
      if (desdeMs && (rowDateMs == null || rowDateMs < desdeMs)) return false;
      if (hastaMs && (rowDateMs == null || rowDateMs > hastaMs)) return false;

      // El filtro de texto ya lo hizo el servidor; solo aplicar filtro local cuando no hay búsqueda
      if (searchRows !== null) return true;

      const search = debouncedQ.trim().toLowerCase();
      if (!search) return true;

      const id = String(r.id);
      const cliente = String(r.cliente_nombre ?? "").toLowerCase();
      const vcode = String(r.vendedor_codigo ?? "").toLowerCase();
      const facturas = (activeFacturasByVenta[String(r.id)] ?? []).map((x) => String(x ?? "").toLowerCase());
      const searchDigits = search.replace(/\D+/g, "");
      const facturaMatch =
        facturas.some((n) => n.includes(search)) ||
        (!!searchDigits && facturas.some((n) => n.replace(/\D+/g, "").includes(searchDigits)));

      return id.includes(search) || cliente.includes(search) || vcode.includes(search) || facturaMatch;
    });
    return filtered;
  }, [debouncedQ, rowsRaw, searchRows, activeTagsByVenta, activeFacturasByVenta, fClienteId, fDesde, fHasta]);

  const filteredClientes = useMemo(() => {
    const qq = (fClienteQ ?? "").trim().toLowerCase();
    if (!qq) return clientes;
    return (clientes ?? []).filter(
      (c) => String(c.nombre ?? "").toLowerCase().includes(qq) || String(c.id ?? "").includes(qq)
    );
  }, [clientes, fClienteQ]);

  const hasActiveFilters = !!(fClienteId || fDesde || fHasta);

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

  const visibleRows = useMemo(() => {
    if (searchRows !== null) return rows; // búsqueda server-side: mostrar siempre
    return loadedEstado === estado ? rows : [];
  }, [estado, loadedEstado, rows, searchRows]);

  // Si la venta seleccionada ya no está en la lista (cambió de estado), limpiar el panel
  React.useEffect(() => {
    if (!canSplit || selectedVentaId === null) return;
    if (!visibleRows.some((r) => r.id === selectedVentaId)) {
      setSelectedVentaId(null);
    }
  }, [visibleRows, canSplit, selectedVentaId]);

  const chipsById = useMemo(() => {
    const map: Record<number, Chip[]> = {};

    visibleRows.forEach((item) => {
      const tags = activeTagsByVenta[String(item.id)] ?? [];
      const chips: Chip[] = [];

      if (item.requiere_receta && !item.receta_cargada && item.estado !== "FACTURADO") {
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
  }, [visibleRows, tagsByVenta]);

  const urgentIds = useMemo(() => {
    if (estado !== "FACTURADO") return new Set<number>();
    const ids = new Set<number>();
    visibleRows.forEach((r) => {
      if ((activeTagsByVenta[String(r.id)] ?? []).includes("ANULACION_REQUERIDA")) ids.add(r.id);
    });
    return ids;
  }, [estado, visibleRows, activeTagsByVenta]);

  const sections = useMemo(() => {
    if (urgentIds.size === 0) return groupVentasByDay(visibleRows);
    const urgentes = visibleRows.filter((r) => urgentIds.has(r.id));
    const resto = visibleRows.filter((r) => !urgentIds.has(r.id));
    return [
      { title: "__ANULACION_URGENTE__", data: urgentes },
      ...groupVentasByDay(resto),
    ];
  }, [visibleRows, urgentIds]);

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
    ({ item }: { item: VentaRow }) => (
      <VentaCard
        item={item}
        chips={chipsById[item.id] ?? EMPTY_CHIPS}
        facturas={activeFacturasByVenta[String(item.id)] ?? EMPTY_FACTURAS}
        onPress={handleVentaPress}
        C={C}
        hasUrgent={urgentIds.has(item.id)}
        isSelected={selectedVentaId === item.id}
      />
    ),
    [C, chipsById, activeFacturasByVenta, handleVentaPress, urgentIds, selectedVentaId]
  );

  const listEmptyComponent = (
    <VentasListEmpty
      isLoading={listLoading}
      initialLoading={initialLoading}
      loadedEstado={loadedEstado}
      estado={estado}
      visibleCount={visibleRows.length}
      isDark={isDark}
      C={C}
    />
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => {
      if (section.title === "__ANULACION_URGENTE__") {
        return (
          <View style={[s.sectionHeader, { backgroundColor: C.bg, alignItems: "flex-end" }]}>
            <Text style={[s.sectionHeaderText, { color: FB_DARK_DANGER, textAlign: "right" }]}>
              Requieren anulación
            </Text>
          </View>
        );
      }
      return (
        <View style={[s.sectionHeader, { backgroundColor: C.bg, alignItems: "flex-end" }]}>
          <Text style={[s.sectionHeaderText, { color: C.sub, textAlign: "right" }]}>{formatYmdEsLong(section.title)}</Text>
        </View>
      );
    },
    [C.bg, C.sub]
  );

  const listComponent = (
    <SectionList
      sections={sections}
      keyExtractor={keyExtractor}
      refreshing={pullRefreshing}
      onRefresh={onPullRefresh}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28 }}
      initialNumToRender={Platform.OS === "web" ? 999 : 8}
      maxToRenderPerBatch={Platform.OS === "web" ? 999 : 5}
      windowSize={Platform.OS === "web" ? 999 : 7}
      updateCellsBatchingPeriod={50}
      removeClippedSubviews={Platform.OS === "android"}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
      renderItem={renderItem}
      renderSectionHeader={renderSectionHeader}
      onEndReached={loadMoreVentas}
      onEndReachedThreshold={0.3}
      ListFooterComponent={
        loadingMore ? (
          <ActivityIndicator size="small" color={C.tint} style={{ marginVertical: 16 }} />
        ) : null
      }
      ListHeaderComponent={
        searchLoading ? (
          <View style={{ paddingVertical: 14, alignItems: "center" }}>
            <ActivityIndicator size="small" color={C.tint} />
          </View>
        ) : revalidating && revalidatingEstado === estado && visibleRows.length ? (
          <View pointerEvents="none" style={{ height: 18, marginBottom: 8, justifyContent: "center" }}>
            <Text style={{ color: C.sub, fontWeight: "800", fontSize: 12 }}>
              Actualizando...
            </Text>
          </View>
        ) : null
      }
      ListEmptyComponent={listEmptyComponent}
      style={{ flex: 1 }}
    />
  );

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
      <View style={[s.header, { backgroundColor: C.bg, borderBottomColor: C.border }]}>
        {canCreate ? (
          <View style={s.topRow}>
            <AppButton
              title="+ Cotización"
              size="sm"
              variant="ghost"
              onPress={() => {
                if (Platform.OS === "web") {
                  setCotizacionOpen(true);
                } else {
                  router.push("/cotizacion-nueva" as any);
                }
              }}
            />
            <AppButton
              title="+ Nueva venta"
              size="sm"
              onPress={() => {
                if (Platform.OS === "web") {
                  setEditingVentaId(null);
                  setNuevaVentaOpen(true);
                } else {
                  router.push("/venta-nueva" as any);
                }
              }}
            />
          </View>
        ) : null}

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
                  setSelectedVentaId(null);
                  loadEstado(nextEstado).catch(() => {});
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
              { borderColor: hasActiveFilters ? FB_DARK_DANGER : C.border, backgroundColor: C.card },
              pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
            ]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={[s.filterTxt, { color: hasActiveFilters ? FB_DARK_DANGER : C.text }]}>Filtros</Text>
              {hasActiveFilters ? (
                <View style={[s.filterDot, { backgroundColor: FB_DARK_DANGER }]} />
              ) : null}
            </View>
          </Pressable>
        </View>
      </View>

      {canSplit ? (
        <View style={[s.splitWrap, { borderTopColor: C.border }]}>
          <View style={[s.splitListPane, { borderRightColor: C.border }]}>{listComponent}</View>
          <View style={s.splitDetailPane}>
            {selectedVentaId ? (
              <VentaDetallePanel
                ventaId={selectedVentaId}
                embedded
                onEditWeb={(id) => { setEditingVentaId(id); setNuevaVentaOpen(true); }}
                refreshKey={detalleRefreshKey}
              />
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
                    paddingTop: Math.max(insets.top + 8, 48),
                  }
            }
          >
          <View
            style={[
              s.modalCard,
              { backgroundColor: C.card, borderColor: C.border },
              Platform.OS === "web"
                ? { width: "100%", maxWidth: 480, marginHorizontal: 0 }
                : null,
            ]}
          >
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
                    borderColor: C.border,
                    borderRadius: 12,
                    padding: 12,
                    fontSize: 16,
                    fontWeight: "700",
                    width: "100%",
                    boxSizing: "border-box",
                    backgroundColor: C.card,
                    color: C.text,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    outline: "none",
                    colorScheme: isDark ? "dark" : "light",
                  } as any}
                />
              ) : (
                <Pressable onPress={openDesdePicker} style={[s.dateBox, { borderColor: C.border, backgroundColor: C.card }]}>
                  <Text style={[s.dateTxt, { color: C.text }]}>{fDesde ? fmtDate(fDesde.toISOString()) : "—"}</Text>
                </Pressable>
              )}
            </View>

            <View style={{ width: 12 }} />

            <View style={{ flex: 1 }}>
              <Text style={[s.sectionLabel, { color: C.text }]}>Hasta</Text>
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
                    borderColor: C.border,
                    borderRadius: 12,
                    padding: 12,
                    fontSize: 16,
                    fontWeight: "700",
                    width: "100%",
                    boxSizing: "border-box",
                    backgroundColor: C.card,
                    color: C.text,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    outline: "none",
                    colorScheme: isDark ? "dark" : "light",
                  } as any}
                />
              ) : (
                <Pressable onPress={openHastaPicker} style={[s.dateBox, { borderColor: C.border, backgroundColor: C.card }]}>
                  <Text style={[s.dateTxt, { color: C.text }]}>{fHasta ? fmtDate(fHasta.toISOString()) : "—"}</Text>
                </Pressable>
              )}
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
          </View>
        </Modal>

      <VentaNuevaModal
        visible={nuevaVentaOpen}
        onClose={() => { setNuevaVentaOpen(false); setEditingVentaId(null); }}
        onDone={() => { const wasEdit = !!editingVentaId; setNuevaVentaOpen(false); setEditingVentaId(null); loadEstado(estado).catch(() => {}); if (wasEdit) setDetalleRefreshKey((k) => k + 1); }}
        isDark={isDark}
        colors={{ card: C.card, text: C.text, border: C.border, sub: C.sub }}
        mode={editingVentaId ? "edit" : "create"}
        ventaId={editingVentaId}
      />
      <CotizacionModal
        visible={cotizacionOpen}
        onClose={() => setCotizacionOpen(false)}
        onDone={() => setCotizacionOpen(false)}
        isDark={isDark}
        colors={{ card: C.card, text: C.text, border: C.border, sub: C.sub }}
      />
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
      <Text style={{ fontSize: Platform.OS === "web" ? 16 : 13, fontWeight: "600", color: selected ? tint : text }} numberOfLines={1}>
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
    fontSize: Platform.OS === "web" ? 15 : 12,
    fontWeight: Platform.OS === "ios" ? "800" : "800",
    letterSpacing: Platform.OS === "ios" ? -0.2 : 0,
  },

  filtersRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  search: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 12, android: 10, default: 10 }),
    fontSize: Platform.OS === "web" ? 16 : 14,
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
  filterDot: { width: 8, height: 8, borderRadius: 99 },

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
  cardTitle: { fontSize: Platform.OS === "web" ? 13 : 12, fontWeight: "700" },
  cardSub: { marginTop: 6, fontSize: 11, fontWeight: "700" },
  notaRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 8, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  notaLabel: { fontSize: 11, fontWeight: "900" },
  notaTxt: { fontSize: 11, fontWeight: "700", flex: 1 },

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
  },
  sectionHeaderText: { fontSize: 13, fontWeight: "900", textAlign: "right" },

  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  modalCard: { marginHorizontal: 14, borderRadius: 18, padding: 16, borderWidth: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontSize: Platform.OS === "web" ? 22 : 18, fontWeight: "800" },
  modalClose: { fontSize: Platform.OS === "web" ? 15 : 13, fontWeight: "700" },
  sectionLabel: { marginTop: 12, fontSize: Platform.OS === "web" ? 15 : 13, fontWeight: "800" },
  dropdownInput: { marginTop: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dropdownText: { fontSize: Platform.OS === "web" ? 16 : 14, fontWeight: "600", flex: 1, paddingRight: 10 },
  dropdownCaret: { fontSize: 14, fontWeight: "900" },
  dropdownPanel: { marginTop: 10, borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  clientSearchInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  twoCols: { flexDirection: "row", marginTop: 8 },
  dateBox: { marginTop: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
  dateTxt: { fontSize: Platform.OS === "web" ? 16 : 14, fontWeight: "700" },
  iosPickerWrap: { marginTop: 10, borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },
});
