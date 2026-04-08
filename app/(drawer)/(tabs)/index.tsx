import Svg, { Path, Circle, Defs, LinearGradient, Stop, Text as SvgText } from "react-native-svg";
import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Redirect, router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { supabase } from "../../../lib/supabase";
import { useThemePref } from "../../../lib/themePreference";
import { alphaColor } from "../../../lib/ui";
import { useRole } from "../../../lib/useRole";
import { useEmpresaActiva } from "../../../lib/useEmpresaActiva";
import { useResumeLoad } from "../../../lib/useResumeLoad";
import { fmtQ, fmtDate, pad2, toGTDateKey } from "../../../lib/utils/format";
import { normalizeUpper } from "../../../lib/utils/text";
import { FB_DARK_DANGER } from "../../../src/theme/headerColors";

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = "ADMIN" | "VENTAS" | "FACTURACION" | "BODEGA" | "MENSAJERO" | "";

type VendedorMesTotal = {
  vendedor_id: string | null;
  vendedor_codigo: string | null;
  vendedor_nombre: string;
  monto: number;
};

type VentaMini = {
  id: number;
  fecha: string | null;
  cliente_nombre: string | null;
  vendedor_codigo: string | null;
  vendedor_id: string | null;
};

type CxcVencidaRow = {
  venta_id: number;
  cliente_nombre: string | null;
  saldo: number;
  diasVencida: number;
  vendedor_codigo: string | null;
};

type CxcPorVencerRow = {
  venta_id: number;
  cliente_nombre: string | null;
  saldo: number;
  diasRestantes: number;
  vendedor_codigo: string | null;
};

type AdminData = {
  solicitudes: number;
  recetasPendMes: number;
  ventasHoyTotal: number;
  cxcSaldoTotal: number;
  cxcSaldoVencido: number;
  ventasMesTotal: number;
  ventasMesPorVendedor: VendedorMesTotal[];
  tendencia12m: number[];
  cxcVencidas: CxcVencidaRow[];
  cxcPorVencer: CxcPorVencerRow[];
};

type VentasData = {
  misVentasHoy: number;
  misClientesCount: number;
  recetasPendMes: number;
  recetasPendList: VentaMini[];
  ventasMes: number[];
  cxcSaldo: number;
  cxcVencidas: CxcVencidaRow[];
  cxcPorVencer: CxcPorVencerRow[];
};

type FacturadorData = {
  pendientesCount: number;
  pendientes: VentaMini[];
  facturadosHoy: number;
};

type BodegaAlerta = {
  tipo: string;
  producto_id: string | number;
  producto: string;
  marca: string;
  stock_disponible: number;
  fecha_exp: string | null;
  lote: string | null;
};

type BodegaData = {
  criticos: BodegaAlerta[];
  porVencer: BodegaAlerta[];
  productosCero: number;
  porVencerCount: number;
};

type DashColors = {
  bg: string;
  card: string;
  text: string;
  sub: string;
  border: string;
  tint: string;
  danger: string;
  chipBg: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowGt() {
  const now = new Date();
  return new Date(now.getTime() - (now.getTimezoneOffset() + 360) * 60 * 1000);
}

function gtYearMonth() {
  const gt = nowGt();
  return { year: gt.getUTCFullYear(), month: gt.getUTCMonth() + 1 };
}

function fmtDateLong(): string {
  const gt = nowGt();
  const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  return `${days[gt.getUTCDay()]}, ${gt.getUTCDate()} de ${months[gt.getUTCMonth()]}`;
}

function buildGreeting(name: string, role: string, ventasHoy?: number): string {
  if (role === "VENTAS") {
    return name ? `Hola ${name}!` : "¡Hola!";
  }
  return name ? `Hola ${name}` : "Hola";
}

function safeNumber(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function dayDiffFromToday(isoYmd: string) {
  const due = new Date(`${String(isoYmd).slice(0, 10)}T12:00:00`);
  const now = new Date();
  const today = new Date(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T12:00:00`
  );
  return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function pickName(p: any) {
  const raw = p?.full_name ?? p?.nombre ?? p?.name ?? "";
  return String(raw ?? "").trim();
}

function nameFromEmail(email: string | null | undefined) {
  const e = (email ?? "").trim();
  if (!e) return "";
  return e.split("@")[0] ?? "";
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonDashboard({
  colors,
  isDark,
  insets,
}: {
  colors: DashColors;
  isDark: boolean;
  insets: { bottom: number };
}) {
  const anim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  const skColor = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)";

  const sb = (w: number | `${number}%`, h: number, r = 10) => (
    <Animated.View style={{ width: w, height: h, borderRadius: r, backgroundColor: skColor, opacity: anim }} />
  );

  return (
    <View style={{ padding: 16, paddingBottom: 16 + insets.bottom }}>
      {/* Hero */}
      <Animated.View style={[s.hero, { backgroundColor: skColor, opacity: anim, marginBottom: 4 }]} />

      {/* KPIs */}
      <View style={[s.kpiGrid, { marginTop: 12 }]}>
        {[0, 1, 2, 3].map((i) => (
          <Animated.View
            key={i}
            style={[s.kpi, { backgroundColor: skColor, borderColor: "transparent", opacity: anim }]}
          >
            {sb("60%", 11, 8)}
            <View style={{ height: 8 }} />
            {sb("44%", 20, 10)}
            <View style={{ height: 6 }} />
            {sb("70%", 11, 8)}
          </Animated.View>
        ))}
      </View>

      {/* Cards */}
      {[0, 1].map((i) => (
        <Animated.View
          key={i}
          style={[s.card, { backgroundColor: skColor, borderColor: "transparent", opacity: anim, marginTop: 12 }]}
        >
          {sb("44%", 14, 9)}
          <View style={{ height: 10 }} />
          {sb("90%", 12, 8)}
          <View style={{ height: 8 }} />
          {sb("80%", 12, 8)}
          <View style={{ height: 8 }} />
          {sb("72%", 12, 8)}
        </Animated.View>
      ))}
    </View>
  );
}

// ─── HeroCard ─────────────────────────────────────────────────────────────────

function HeroCard({
  bg,
  accent,
  kicker,
  bigNum,
  sub,
  children,
}: {
  bg: string;
  accent?: string;
  kicker: string;
  bigNum: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={[s.hero, { backgroundColor: bg }]}>
      {accent ? (
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: accent, opacity: 0.28, borderRadius: 20 }]}
          pointerEvents="none"
        />
      ) : null}
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: "#000", opacity: 0.07, borderRadius: 20 }]}
        pointerEvents="none"
      />
      <Text style={s.heroKicker}>{kicker}</Text>
      <Text style={s.heroNumber}>{bigNum}</Text>
      {sub ? <Text style={s.heroSub}>{sub}</Text> : null}
      {children}
    </View>
  );
}

// ─── Bars ─────────────────────────────────────────────────────────────────────

function Bars({
  items,
  valueFmt,
  colors,
}: {
  items: { label: string; qty: number }[];
  valueFmt?: (n: number) => string;
  colors: DashColors;
}) {
  const max = Math.max(1, ...items.map((i) => i.qty));
  return (
    <View style={{ marginTop: 10 }}>
      {items.map((it, idx) => {
        const pct = Math.max(0, Math.min(1, it.qty / max));
        return (
          <View key={`${it.label}-${idx}`} style={s.barRow}>
            <Text style={[s.barLabel, { color: colors.sub }]} numberOfLines={1}>
              {it.label}
            </Text>
            <View style={[s.barTrack, { backgroundColor: colors.chipBg, borderColor: colors.border }]}>
              <View
                style={[
                  s.barFill,
                  { backgroundColor: colors.tint, width: `${Math.round(pct * 100)}%` as any },
                ]}
              />
            </View>
            <Text style={[s.barValue, { color: colors.text }]} numberOfLines={1}>
              {valueFmt ? valueFmt(it.qty) : it.qty}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── MiniLine ─────────────────────────────────────────────────────────────────

// Genera path SVG con curva cardinal suave
function smoothPath(pts: { x: number; y: number }[], tension = 0.4): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + ((p2.x - p0.x) * tension) / 2;
    const cp1y = p1.y + ((p2.y - p0.y) * tension) / 2;
    const cp2x = p2.x - ((p3.x - p1.x) * tension) / 2;
    const cp2y = p2.y - ((p3.y - p1.y) * tension) / 2;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function MiniLine({
  values,
  labels,
  colors,
}: {
  values: number[];
  labels?: string[];
  colors: DashColors;
}) {
  const [chartW, setChartW] = useState(0);
  const H = 180;
  const PAD_X = 12;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 36; // espacio para etiquetas dentro del SVG

  const defaultLabels = useMemo(
    () => ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
    []
  );
  const monthLabels = labels ?? defaultLabels;

  const maxV = useMemo(() => Math.max(0, ...values.map((v) => Number(v) || 0)), [values]);
  const allZero = maxV === 0;

  const pts = useMemo(() => {
    if (allZero || chartW <= 0 || values.length < 2) return [];
    const n = values.length;
    const innerW = chartW - PAD_X * 2;
    const innerH = H - PAD_TOP - PAD_BOTTOM;
    return values.map((v, i) => ({
      x: PAD_X + (innerW * i) / (n - 1),
      y: PAD_TOP + (1 - (Number(v) || 0) / maxV) * innerH,
    }));
  }, [values, chartW, maxV, allZero]);

  const linePath = useMemo(() => smoothPath(pts), [pts]);
  const areaPath = useMemo(() => {
    if (!pts.length) return "";
    const bottom = H - PAD_BOTTOM;
    return `${linePath} L ${pts[pts.length - 1].x} ${bottom} L ${pts[0].x} ${bottom} Z`;
  }, [linePath, pts]);

  if (allZero) {
    return (
      <View
        style={[
          s.lineChart,
          { borderColor: colors.border, backgroundColor: colors.chipBg, justifyContent: "center", alignItems: "center" },
        ]}
      >
        <Text style={[s.lineMeta, { color: colors.sub }]}>Sin datos este período</Text>
      </View>
    );
  }

  return (
    <View>
      <View style={s.lineTopRow}>
        <Text style={[s.lineMeta, { color: colors.sub }]}>Máx: {fmtQ(maxV)}</Text>
      </View>

      <View
        style={[s.lineChart, { borderColor: colors.border, backgroundColor: colors.chipBg }]}
        onLayout={(e) => setChartW(Math.round(e.nativeEvent.layout.width))}
      >
        {chartW > 0 && pts.length >= 2 && (
          <Svg width={chartW} height={H}>
            <Defs>
              <LinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={colors.tint} stopOpacity={0.3} />
                <Stop offset="100%" stopColor={colors.tint} stopOpacity={0.0} />
              </LinearGradient>
            </Defs>
            {/* Area fill */}
            <Path d={areaPath} fill="url(#areaGrad)" />
            {/* Line */}
            <Path
              d={linePath}
              stroke={colors.tint}
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Dots */}
            {pts.map((p, i) => (
              <Circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={3.5}
                fill={colors.card}
                stroke={colors.tint}
                strokeWidth={2}
              />
            ))}
            {/* Month labels alineadas con cada punto */}
            {pts.map((p, i) => (
              <SvgText
                key={`lbl-${i}`}
                x={p.x}
                y={H - 8}
                textAnchor="middle"
                fontSize={10}
                fontWeight="600"
                fill={colors.sub}
              >
                {monthLabels[i] ?? ""}
              </SvgText>
            ))}
          </Svg>
        )}
      </View>
    </View>
  );
}

// ─── ListCard ────────────────────────────────────────────────────────────────

function ListCard({
  title,
  action,
  children,
  colors,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
  colors: DashColors;
}) {
  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={s.cardHeader}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.cardTitle, { color: colors.text }]} numberOfLines={1} ellipsizeMode="tail">
            {title}
          </Text>
        </View>
        {action ? (
          <Pressable
            onPress={action.onPress}
            style={({ pressed }) => (pressed ? { opacity: 0.8 } : undefined)}
          >
            <Text style={[s.cardAction, { color: colors.tint }]}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Inicio() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";
  const { role, uid, isReady: roleChecked, refreshRole } = useRole();
  const { empresaActivaId } = useEmpresaActiva();

  const CACHE_TTL_MS = 60_000;

  const C = useMemo<DashColors>(() => {
    const bg = colors.background ?? (isDark ? "#000" : "#fff");
    const card = colors.card ?? (isDark ? "#121214" : "#fff");
    const text = colors.text ?? (isDark ? "#fff" : "#111");
    const border = colors.border ?? (isDark ? "rgba(255,255,255,0.14)" : "#e5e5e5");
    const tint = String(colors.primary ?? "#153c9e");
    const sub = alphaColor(String(text), 0.65) || (isDark ? "rgba(255,255,255,0.65)" : "#666");
    const danger = FB_DARK_DANGER;
    const chipBg = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
    return { bg, card, text, sub, border, tint, danger, chipBg };
  }, [colors.background, colors.border, colors.card, colors.primary, colors.text, isDark]);

  const [userLabel, setUserLabel] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(false);
  const [bgRefreshing, setBgRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [adminData, setAdminData] = useState<AdminData | null>(null);
  const [ventasData, setVentasData] = useState<VentasData | null>(null);
  const [factData, setFactData] = useState<FacturadorData | null>(null);
  const [bodegaData, setBodegaData] = useState<BodegaData | null>(null);

  const profileSeqRef = useRef(0);
  const loadSeqRef = useRef(0);
  const bgSeqRef = useRef(0);
  const initSeqRef = useRef(0);
  const cacheRef = useRef<{ role: Role; ts: number; data: any } | null>(null);
  const lastRoleRef = useRef<Role>("");

  const adminRef = useRef<AdminData | null>(null);
  const ventasRef = useRef<VentasData | null>(null);
  const factRef = useRef<FacturadorData | null>(null);
  const bodegaRef = useRef<BodegaData | null>(null);

  useEffect(() => { adminRef.current = adminData; }, [adminData]);
  useEffect(() => { ventasRef.current = ventasData; }, [ventasData]);
  useEffect(() => { factRef.current = factData; }, [factData]);
  useEffect(() => { bodegaRef.current = bodegaData; }, [bodegaData]);

  const { year: currentYear, month: currentMonth } = useMemo(() => gtYearMonth(), []);

  const monthAbbr = useMemo(
    () => ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
    []
  );
  const monthFull = useMemo(
    () => ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"],
    []
  );

  // Last 12 months labels rolling from current month (oldest → newest)
  const last12Labels = useMemo(() => {
    const result: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const m = ((currentMonth - 1 - i) % 12 + 12) % 12;
      result.push(monthAbbr[m]);
    }
    return result;
  }, [currentMonth, monthAbbr]);

  // ─── Profile loader ────────────────────────────────────────────────────────

  const loadProfile = useCallback(async (): Promise<{ uid: string | null; label: string }> => {
    const seq = ++profileSeqRef.current;
    try {
      const { data } = await supabase.auth.getSession();
      if (seq !== profileSeqRef.current) return { uid: null, label: "" };
      const u = data?.session?.user;
      const id = u?.id ?? null;
      if (!id) { setUserLabel(""); return { uid: null, label: "" }; }
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", id)
        .maybeSingle();
      if (seq !== profileSeqRef.current) return { uid: null, label: "" };
      const label = pickName(prof) || nameFromEmail(u?.email) || String(id).slice(0, 8);
      setUserLabel(label);
      return { uid: id, label };
    } catch {
      if (seq !== profileSeqRef.current) return { uid: null, label: "" };
      setUserLabel("");
      return { uid: null, label: "" };
    }
  }, []);

  // ─── Data loaders ──────────────────────────────────────────────────────────

  const loadAdmin = useCallback(async (empresaId: number): Promise<AdminData> => {
    const [dash, tend, cxcResp] = await Promise.all([
      supabase.rpc("rpc_dashboard_admin", { p_empresa_id: empresaId }),
      supabase.rpc("rpc_report_ventas_mensual_12m", { p_empresa_id: empresaId }),
      supabase.rpc("rpc_cxc_ventas", { p_empresa_id: empresaId }),
    ]);
    if (dash.error) throw dash.error;
    const d = dash.data as any;

    const tendRows = ((tend.data ?? []) as any[]).sort((a, b) =>
      String(a?.mes ?? "").localeCompare(String(b?.mes ?? ""))
    );
    const tendencia12m = Array.from({ length: 12 }, (_, i) => Number(tendRows[i]?.monto ?? 0));

    const cxcRows = (cxcResp.data ?? []) as any[];

    const cxcVencidas: CxcVencidaRow[] = cxcRows
      .filter((r) => {
        const saldo = Number(r.saldo ?? 0);
        if (saldo <= 0) return false;
        if (!r.fecha_vencimiento) return false;
        return dayDiffFromToday(r.fecha_vencimiento) <= -30;
      })
      .map((r) => ({
        venta_id: Number(r.venta_id),
        cliente_nombre: r.cliente_nombre ?? null,
        saldo: Number(r.saldo ?? 0),
        diasVencida: Math.abs(dayDiffFromToday(r.fecha_vencimiento)),
        vendedor_codigo: r.vendedor_codigo ?? null,
      }))
      .sort((a, b) => b.diasVencida - a.diasVencida);

    const cxcPorVencer: CxcPorVencerRow[] = cxcRows
      .filter((r) => {
        const saldo = Number(r.saldo ?? 0);
        if (saldo <= 0) return false;
        if (!r.fecha_vencimiento) return false;
        const diff = dayDiffFromToday(r.fecha_vencimiento);
        return diff >= 0 && diff <= 7;
      })
      .map((r) => ({
        venta_id: Number(r.venta_id),
        cliente_nombre: r.cliente_nombre ?? null,
        saldo: Number(r.saldo ?? 0),
        diasRestantes: dayDiffFromToday(r.fecha_vencimiento),
        vendedor_codigo: r.vendedor_codigo ?? null,
      }))
      .sort((a, b) => a.diasRestantes - b.diasRestantes);

    return {
      solicitudes: Number(d.solicitudes ?? 0),
      recetasPendMes: Number(d.recetas_pendientes_mes ?? 0),
      ventasHoyTotal: Number(d.ventas_hoy ?? 0),
      cxcSaldoTotal: Number(d.cxc_total ?? 0),
      cxcSaldoVencido: Number(d.cxc_vencido ?? 0),
      ventasMesTotal: Number(d.ventas_mes_total ?? 0),
      ventasMesPorVendedor: (d.ventas_mes_por_vendedor ?? []).map((r: any) => ({
        vendedor_id: r.vendedor_id ?? null,
        vendedor_codigo: r.vendedor_codigo ?? null,
        vendedor_nombre: String(r.vendedor_nombre ?? "Sin vendedor"),
        monto: Number(r.monto ?? 0),
      })),
      tendencia12m,
      cxcVencidas,
      cxcPorVencer,
    };
  }, []);

  const loadVentas = useCallback(async (userId: string, empresaId: number): Promise<VentasData> => {
    const now = new Date();
    const year = now.getFullYear();
    const inicioAno = new Date(year, 0, 1).toISOString();
    const finAno = new Date(year + 1, 0, 1).toISOString();
    const hoyStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(now);

    // 1. Ventas del año para calcular misVentasHoy y el gráfico de 12 meses
    const { data: ventasAnoRaw, error: v1Err } = await supabase
      .from("ventas")
      .select("id, fecha")
      .eq("empresa_id", empresaId)
      .eq("vendedor_id", userId)
      .gte("fecha", inicioAno)
      .lt("fecha", finAno);
    if (v1Err) throw v1Err;

    // Excluir ventas con tag ANULADO activo (el sistema usa tags, no el campo estado)
    const rawIds = (ventasAnoRaw ?? []).map((v: any) => Number(v.id));
    let anuladasIds = new Set<number>();
    if (rawIds.length > 0) {
      const { data: tagsAnuladas } = await supabase
        .from("ventas_tags")
        .select("venta_id")
        .eq("empresa_id", empresaId)
        .in("venta_id", rawIds)
        .eq("tag", "ANULADO")
        .is("removed_at", null);
      (tagsAnuladas ?? []).forEach((t: any) => anuladasIds.add(Number(t.venta_id)));
    }
    const ventasAno = (ventasAnoRaw ?? []).filter((v: any) => !anuladasIds.has(Number(v.id)));

    const misVentasHoy = ventasAno.filter(
      (v: any) => toGTDateKey(v.fecha ?? "") === hoyStr
    ).length;

    const ventasIds = ventasAno.map((v: any) => Number(v.id));

    // 2. Detalle de ventas para sumar por mes (gráfico)
    const ventasMes = new Array<number>(12).fill(0);
    if (ventasIds.length > 0) {
      const { data: detalles } = await supabase
        .from("ventas_detalle")
        .select("venta_id, subtotal")
        .eq("empresa_id", empresaId)
        .in("venta_id", ventasIds);

      const fechaMap: Record<number, string> = {};
      (ventasAno ?? []).forEach((v: any) => {
        fechaMap[Number(v.id)] = String(v.fecha ?? "");
      });

      (detalles ?? []).forEach((d: any) => {
        const fecha = fechaMap[Number(d.venta_id)];
        if (!fecha) return;
        const m = new Date(`${toGTDateKey(fecha) || fecha.slice(0, 10)}T12:00:00`).getMonth(); // 0-indexed, GT
        if (m >= 0 && m < 12) ventasMes[m] += Number(d.subtotal ?? 0);
      });
    }

    // 3. Clientes activos de este vendedor
    const { count: clientesCount } = await supabase
      .from("clientes")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .eq("vendedor_id", userId)
      .eq("activo", true);

    // 4. CxC saldo pendiente de mis clientes
    const { data: misClientes } = await supabase
      .from("clientes")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("vendedor_id", userId)
      .eq("activo", true);

    const misClientesIds = (misClientes ?? []).map((c: any) => Number(c.id));
    let cxcSaldo = 0;

    if (misClientesIds.length > 0) {
      const { data: ventasCxCRaw } = await supabase
        .from("ventas")
        .select("id")
        .eq("empresa_id", empresaId)
        .in("cliente_id", misClientesIds);

      const cxcRawIds = (ventasCxCRaw ?? []).map((v: any) => Number(v.id));
      let cxcAnuladasIds = new Set<number>();
      if (cxcRawIds.length > 0) {
        const { data: cxcTags } = await supabase
          .from("ventas_tags")
          .select("venta_id")
          .eq("empresa_id", empresaId)
          .in("venta_id", cxcRawIds)
          .eq("tag", "ANULADO")
          .is("removed_at", null);
        (cxcTags ?? []).forEach((t: any) => cxcAnuladasIds.add(Number(t.venta_id)));
      }
      const ventasCxCIds = cxcRawIds.filter((id) => !cxcAnuladasIds.has(id));

      if (ventasCxCIds.length > 0) {
        const { data: facturas } = await supabase
          .from("ventas_facturas")
          .select("id, monto_total")
          .eq("empresa_id", empresaId)
          .in("venta_id", ventasCxCIds);

        const facturasIds = (facturas ?? []).map((f: any) => Number(f.id));
        let pagados = 0;

        if (facturasIds.length > 0) {
          const { data: pagos } = await supabase
            .from("ventas_pagos")
            .select("factura_id, monto")
            .eq("empresa_id", empresaId)
            .in("factura_id", facturasIds);
          pagados = (pagos ?? []).reduce(
            (acc: number, p: any) => acc + Number(p.monto ?? 0), 0
          );
        }

        const totalFacturado = (facturas ?? []).reduce(
          (acc: number, f: any) => acc + Number(f.monto_total ?? 0), 0
        );
        cxcSaldo = Math.max(0, totalFacturado - pagados);
      }
    }

    // 5. CxC vencidas y por vencer de mis clientes
    const cxcResp = await supabase.rpc("rpc_cxc_ventas", { p_empresa_id: empresaId });
    const cxcRows = (cxcResp.data ?? []) as any[];

    const cxcVencidas: CxcVencidaRow[] = cxcRows
      .filter((r) => {
        const saldo = Number(r.saldo ?? 0);
        if (saldo <= 0) return false;
        if (!r.fecha_vencimiento) return false;
        return dayDiffFromToday(r.fecha_vencimiento) <= -30;
      })
      .map((r) => ({
        venta_id: Number(r.venta_id),
        cliente_nombre: r.cliente_nombre ?? null,
        saldo: Number(r.saldo ?? 0),
        diasVencida: Math.abs(dayDiffFromToday(r.fecha_vencimiento)),
        vendedor_codigo: r.vendedor_codigo ?? null,
      }))
      .sort((a, b) => b.diasVencida - a.diasVencida);

    const cxcPorVencer: CxcPorVencerRow[] = cxcRows
      .filter((r) => {
        const saldo = Number(r.saldo ?? 0);
        if (saldo <= 0) return false;
        if (!r.fecha_vencimiento) return false;
        const diff = dayDiffFromToday(r.fecha_vencimiento);
        return diff >= 0 && diff <= 7;
      })
      .map((r) => ({
        venta_id: Number(r.venta_id),
        cliente_nombre: r.cliente_nombre ?? null,
        saldo: Number(r.saldo ?? 0),
        diasRestantes: dayDiffFromToday(r.fecha_vencimiento),
        vendedor_codigo: r.vendedor_codigo ?? null,
      }))
      .sort((a, b) => a.diasRestantes - b.diasRestantes);

    return {
      misVentasHoy,
      misClientesCount: clientesCount ?? 0,
      recetasPendMes: 0,
      recetasPendList: [],
      ventasMes,
      cxcSaldo,
      cxcVencidas,
      cxcPorVencer,
    };
  }, []);

  const loadFacturador = useCallback(async (empresaId: number): Promise<FacturadorData> => {
    const { data: pendData, error } = await supabase
      .from("ventas")
      .select("id,fecha,cliente_nombre,vendedor_id,vendedor_codigo")
      .eq("empresa_id", empresaId)
      .eq("estado", "NUEVO")
      .order("fecha", { ascending: true })
      .limit(15);
    if (error) throw error;

    const gt = nowGt();
    const todayStr = `${gt.getUTCFullYear()}-${pad2(gt.getUTCMonth() + 1)}-${pad2(gt.getUTCDate())}`;
    const tmr = new Date(gt.getTime() + 86_400_000);
    const tmrStr = `${tmr.getUTCFullYear()}-${pad2(tmr.getUTCMonth() + 1)}-${pad2(tmr.getUTCDate())}`;

    const { count: facturadosHoy } = await supabase
      .from("ventas")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .eq("estado", "FACTURADO")
      .gte("fecha", todayStr)
      .lt("fecha", tmrStr);

    const pendientes = ((pendData ?? []) as any[]).map((r) => ({
      id: Number(r.id ?? 0),
      fecha: r.fecha ?? null,
      cliente_nombre: r.cliente_nombre ?? null,
      vendedor_codigo: r.vendedor_codigo ?? null,
      vendedor_id: r.vendedor_id ?? null,
    }));

    return {
      pendientesCount: pendientes.length,
      pendientes,
      facturadosHoy: Number(facturadosHoy ?? 0),
    };
  }, []);

  const loadBodega = useCallback(async (empresaId: number): Promise<BodegaData> => {
    const today = nowGt();
    const in30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const todayStr = `${today.getUTCFullYear()}-${pad2(today.getUTCMonth() + 1)}-${pad2(today.getUTCDate())}`;
    const in30Str = `${in30.getUTCFullYear()}-${pad2(in30.getUTCMonth() + 1)}-${pad2(in30.getUTCDate())}`;

    // vw_inventario_productos agrega stock real por producto (no por lote)
    const [ceroResult, expResult] = await Promise.all([
      supabase
        .from("vw_inventario_productos")
        .select("id, nombre, marca, stock_disponible")
        .eq("empresa_id", empresaId)
        .eq("activo", true)
        .eq("stock_disponible", 0)
        .order("nombre", { ascending: true })
        .limit(20),
      supabase.rpc("rpc_report_inventario_alertas", {
        p_empresa_id: empresaId,
        p_exp_dias: 30,
        p_stock_bajo: 99999,
      }),
    ]);
    if (ceroResult.error) throw ceroResult.error;

    const criticos: BodegaAlerta[] = ((ceroResult.data ?? []) as any[]).map((r) => ({
      tipo: "CERO",
      producto_id: r.id ?? "",
      producto: String(r.nombre ?? ""),
      marca: String(r.marca ?? ""),
      stock_disponible: 0,
      fecha_exp: null,
      lote: null,
    }));

    const expAlertas: BodegaAlerta[] = ((expResult.data ?? []) as any[])
      .map((r) => ({
        tipo: String(r.tipo ?? ""),
        producto_id: r.producto_id ?? "",
        producto: String(r.producto ?? ""),
        marca: String(r.marca ?? ""),
        stock_disponible: Number(r.stock_disponible_lote ?? 0),
        fecha_exp: r.fecha_exp ? String(r.fecha_exp).slice(0, 10) : null,
        lote: r.lote ? String(r.lote) : null,
      }))
      .filter((a) => a.fecha_exp && a.fecha_exp >= todayStr && a.fecha_exp <= in30Str)
      .sort((a, b) => (a.fecha_exp ?? "").localeCompare(b.fecha_exp ?? ""))
      .slice(0, 20);

    return {
      criticos,
      porVencer: expAlertas,
      productosCero: criticos.length,
      porVencerCount: expAlertas.length,
    };
  }, []);

  // ─── Master loader ────────────────────────────────────────────────────────

  const clearOtherRoleData = useCallback((keep: Role) => {
    if (keep !== "ADMIN" && adminRef.current) setAdminData(null);
    if (keep !== "VENTAS" && keep !== "MENSAJERO" && ventasRef.current) setVentasData(null);
    if (keep !== "FACTURACION" && factRef.current) setFactData(null);
    if (keep !== "BODEGA" && bodegaRef.current) setBodegaData(null);
  }, []);

  const loadAll = useCallback(
    async (opts?: {
      force?: boolean;
      roleOverride?: Role;
      uidOverride?: string | null;
      skipCache?: boolean;
    }) => {
      const force = !!opts?.force;
      const skipCache = !!opts?.skipCache;
      const seq = ++loadSeqRef.current;
      setErrorMsg(null);

      try {
        const r = (opts?.roleOverride ?? normalizeUpper(role)) as Role;
        const id = opts?.uidOverride ?? uid;

        if (r !== lastRoleRef.current) {
          lastRoleRef.current = r;
          clearOtherRoleData(r);
        }
        if (!r) return;

        const cached = cacheRef.current;
        const now = Date.now();
        if (!force && !skipCache && cached && cached.role === r && now - cached.ts < CACHE_TTL_MS) {
          if (r === "ADMIN") setAdminData(cached.data);
          if (r === "VENTAS" || r === "MENSAJERO") setVentasData(cached.data);
          if (r === "FACTURACION") setFactData(cached.data);
          if (r === "BODEGA") setBodegaData(cached.data);
          return;
        }

        if (r === "ADMIN") {
          if (!empresaActivaId) throw new Error("Sin empresa activa");
          const data = await loadAdmin(empresaActivaId);
          if (seq !== loadSeqRef.current) return;
          setAdminData(data);
          cacheRef.current = { role: r, ts: Date.now(), data };
          return;
        }

        if (r === "VENTAS" || r === "MENSAJERO") {
          if (!id) throw new Error("Usuario no autenticado");
          if (!empresaActivaId) throw new Error("Sin empresa activa");
          const data = await loadVentas(id, empresaActivaId);
          if (seq !== loadSeqRef.current) return;
          setVentasData(data);
          cacheRef.current = { role: r, ts: Date.now(), data };
          return;
        }

        if (r === "FACTURACION") {
          if (!empresaActivaId) throw new Error("Sin empresa activa");
          const data = await loadFacturador(empresaActivaId);
          if (seq !== loadSeqRef.current) return;
          setFactData(data);
          cacheRef.current = { role: r, ts: Date.now(), data };
          return;
        }

        if (r === "BODEGA") {
          if (!empresaActivaId) throw new Error("Sin empresa activa");
          const data = await loadBodega(empresaActivaId);
          if (seq !== loadSeqRef.current) return;
          setBodegaData(data);
          cacheRef.current = { role: r, ts: Date.now(), data };
          return;
        }
      } catch (e: any) {
        if (seq !== loadSeqRef.current) return;
        setErrorMsg(String(e?.message ?? "No se pudo cargar Inicio"));
      }
    },
    [clearOtherRoleData, loadAdmin, loadBodega, loadFacturador, loadVentas, role, uid, empresaActivaId]
  );

  // ─── Focus effect ─────────────────────────────────────────────────────────

  useResumeLoad(empresaActivaId, () => { void loadAll({ skipCache: true }); });

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!alive) return;
        const r = (await refreshRole()) as Role;
        const prof = await loadProfile();
        if (!alive) return;

        const now = Date.now();
        const cached = cacheRef.current;
        const cacheValid = !!(cached && cached.role === r && now - cached.ts < CACHE_TTL_MS);

        if (cacheValid) {
          if (r !== lastRoleRef.current) {
            lastRoleRef.current = r;
            clearOtherRoleData(r);
          }
          if (r === "ADMIN") setAdminData(cached!.data);
          if (r === "VENTAS" || r === "MENSAJERO") setVentasData(cached!.data);
          if (r === "FACTURACION") setFactData(cached!.data);
          if (r === "BODEGA") setBodegaData(cached!.data);
          setInitialLoading(false);

          const bgSeq = ++bgSeqRef.current;
          setBgRefreshing(true);
          loadAll({ roleOverride: r, uidOverride: prof?.uid, skipCache: true }).finally(() => {
            if (!alive) return;
            if (bgSeqRef.current === bgSeq) setBgRefreshing(false);
          });
          return;
        }

        setBgRefreshing(false);
        const initSeq = ++initSeqRef.current;
        setInitialLoading(true);
        try {
          await loadAll({ roleOverride: r, uidOverride: prof?.uid });
        } finally {
          if (!alive) return;
          if (initSeqRef.current === initSeq) setInitialLoading(false);
        }
      })();
      return () => { alive = false; };
    }, [clearOtherRoleData, loadAll, loadProfile, refreshRole])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = (await refreshRole()) as Role;
      const prof = await loadProfile();
      await loadAll({ force: true, roleOverride: r, uidOverride: prof?.uid, skipCache: true });
    } finally {
      setRefreshing(false);
    }
  }, [loadAll, loadProfile, refreshRole]);

  // ─── Render helpers ───────────────────────────────────────────────────────

  const renderKpi = (props: {
    label: string;
    value: string;
    hint?: string;
    danger?: boolean;
    onPress?: () => void;
    style?: object;
    valueSize?: number;
  }) => {
    const clickable = !!props.onPress;
    const valColor = props.danger ? C.danger : C.text;
    return (
      <Pressable
        key={props.label}
        onPress={props.onPress}
        disabled={!clickable}
        style={({ pressed }) => [
          s.kpi,
          { borderColor: C.border, backgroundColor: C.card },
          props.style ?? null,
          pressed && clickable ? { opacity: 0.85 } : null,
        ]}
      >
        <View style={{ minHeight: 30 }}>
          <Text style={[s.kpiLabel, { color: C.sub }]} numberOfLines={2}>
            {props.label}
          </Text>
        </View>
        <Text
          style={[s.kpiValue, { color: valColor }, props.valueSize ? { fontSize: props.valueSize } : null]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.55}
        >
          {props.value}
        </Text>
        {props.hint ? (
          <Text style={[s.kpiHint, { color: props.danger ? C.danger : C.sub }]} numberOfLines={1}>
            {props.hint}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  const renderRowLink = (props: {
    k: string;
    title: string;
    sub?: string;
    onPress: () => void;
  }) => (
    <Pressable
      key={props.k}
      onPress={props.onPress}
      style={({ pressed }) => [
        s.rowLink,
        { borderTopColor: C.border },
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[s.rowTitle, { color: C.text }]} numberOfLines={1}>
          {props.title}
        </Text>
        {props.sub ? (
          <Text style={[s.rowSub, { color: C.sub }]} numberOfLines={1}>
            {props.sub}
          </Text>
        ) : null}
      </View>
      <Text style={[s.rowChevron, { color: C.sub }]}>›</Text>
    </Pressable>
  );

  // ─── Role dashboards ──────────────────────────────────────────────────────

  const renderAdmin = () => {
    const d = adminData;
    const mon = monthFull[Math.max(0, Math.min(11, currentMonth - 1))];
    return (
      <View style={{ paddingBottom: 16 + insets.bottom }}>
        <View style={{ padding: 16 }}>
          <View style={[s.kpiGrid, { marginTop: 12 }]}>
            {renderKpi({
              label: `Ventas ${mon}`,
              value: d ? fmtQ(d.ventasMesTotal) : "—",
              style: { flexBasis: "31%" },
              valueSize: 14,
            })}
            {renderKpi({
              label: "CxC Total",
              value: d ? fmtQ(d.cxcSaldoTotal) : "—",
              onPress: () => router.push("/cxc" as any),
              style: { flexBasis: "31%" },
              valueSize: 14,
            })}
            {renderKpi({
              label: "CxC Vencido",
              value: d ? fmtQ(d.cxcSaldoVencido) : "—",
              danger: !!(d && d.cxcSaldoVencido > 0),
              onPress: () => router.push("/cxc" as any),
              style: { flexBasis: "31%" },
              valueSize: 14,
            })}
          </View>

          <ListCard title="Tendencia 12 meses" colors={C}>
            {d ? (
              <MiniLine values={d.tendencia12m} labels={last12Labels} colors={C} />
            ) : (
              <Text style={[s.empty, { color: C.sub }]}>—</Text>
            )}
          </ListCard>

          <ListCard
            title={`Vendedores — ${mon} ${currentYear}`}
            action={{ label: "Ventas", onPress: () => router.push("/ventas" as any) }}
            colors={C}
          >
            {(d?.ventasMesPorVendedor ?? []).length ? (
              <Bars
                valueFmt={(n) => fmtQ(n)}
                items={(d?.ventasMesPorVendedor ?? [])
                  .slice(0, 10)
                  .map((r) => ({ label: r.vendedor_nombre, qty: r.monto }))}
                colors={C}
              />
            ) : (
              <Text style={[s.empty, { color: C.sub }]}>{d ? "Sin ventas este mes" : "—"}</Text>
            )}
          </ListCard>

        </View>

      </View>
    );
  };

  const renderVentas = () => {
    const d = ventasData;
    const monFull = monthFull[Math.max(0, Math.min(11, currentMonth - 1))];
    return (
      <View style={{ paddingBottom: 16 + insets.bottom }}>
        <View style={{ padding: 16 }}>
        <View style={[s.kpiGrid, { marginTop: 4 }]}>
          {renderKpi({
            label: "Clientes activos",
            value: d ? String(d.misClientesCount) : "—",
            onPress: () => router.push("/clientes" as any),
            style: { flexBasis: "31%" },
            valueSize: 14,
          })}
          {renderKpi({
            label: `Ventas ${monFull}`,
            value: d ? fmtQ(d.ventasMes[currentMonth - 1]) : "—",
            onPress: () => router.push("/ventas" as any),
            style: { flexBasis: "31%" },
            valueSize: 14,
          })}
          {renderKpi({
            label: "CxC pendiente",
            value: d ? fmtQ(d.cxcSaldo) : "—",
            onPress: () => router.push("/(drawer)/cxc" as any),
            style: { flexBasis: "31%" },
            valueSize: 14,
          })}
        </View>

        <ListCard title={`Mi año ${currentYear}`} colors={C}>
          {d ? (
            <MiniLine values={d.ventasMes} colors={C} />
          ) : (
            <Text style={[s.empty, { color: C.sub }]}>—</Text>
          )}
        </ListCard>

        <ListCard
          title="Cuentas que se vencen esta semana"
          colors={C}
        >
          {(d?.cxcPorVencer ?? []).length ? (
            (d?.cxcPorVencer ?? []).slice(0, 10).map((v) => (
              <Pressable
                key={`cxcpv-${v.venta_id}`}
                onPress={() =>
                  router.push({
                    pathname: "/cxc-venta-detalle",
                    params: { ventaId: String(v.venta_id) },
                  } as any)
                }
                style={({ pressed }) => [
                  s.rowLink,
                  { borderTopColor: C.border },
                  pressed ? { opacity: 0.85 } : null,
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowTitle, { color: C.text }]} numberOfLines={1}>
                    {v.cliente_nombre ?? "—"}
                  </Text>
                  <Text style={[s.rowSub, { color: C.sub }]} numberOfLines={1}>
                    {v.diasRestantes === 0 ? "Vence hoy" : `Vence en ${v.diasRestantes}d`}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Text style={[s.rowTitle, { color: C.text, fontSize: 14 }]} numberOfLines={1}>
                    {fmtQ(v.saldo)}
                  </Text>
                  <View style={s.warnPill}>
                    <Text style={s.warnPillText}>{v.diasRestantes === 0 ? "HOY" : `${v.diasRestantes}d`}</Text>
                  </View>
                </View>
              </Pressable>
            ))
          ) : (
            <Text style={[s.empty, { color: C.sub }]}>{d ? "Sin cuentas por vencer ✓" : "—"}</Text>
          )}
        </ListCard>

        <ListCard
          title="Cuentas vencidas +30 días"
          colors={C}
        >
          {(d?.cxcVencidas ?? []).length ? (
            (d?.cxcVencidas ?? []).slice(0, 10).map((v) => (
              <Pressable
                key={`cxcv-${v.venta_id}`}
                onPress={() =>
                  router.push({
                    pathname: "/cxc-venta-detalle",
                    params: { ventaId: String(v.venta_id) },
                  } as any)
                }
                style={({ pressed }) => [
                  s.rowLink,
                  { borderTopColor: C.border },
                  pressed ? { opacity: 0.85 } : null,
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowTitle, { color: C.text }]} numberOfLines={1}>
                    {v.cliente_nombre ?? "—"}
                  </Text>
                  <Text style={[s.rowSub, { color: C.sub }]} numberOfLines={1}>
                    Vencida hace {v.diasVencida}d
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Text style={[s.rowTitle, { color: C.danger, fontSize: 14 }]} numberOfLines={1}>
                    {fmtQ(v.saldo)}
                  </Text>
                  <View style={s.overduePill}>
                    <Text style={s.overduePillText}>{v.diasVencida}d</Text>
                  </View>
                </View>
              </Pressable>
            ))
          ) : (
            <Text style={[s.empty, { color: C.sub }]}>{d ? "Sin cuentas vencidas ✓" : "—"}</Text>
          )}
        </ListCard>
        </View>
      </View>
    );
  };

  const renderFacturacion = () => {
    const d = factData;
    return (
      <View style={{ padding: 16, paddingBottom: 16 + insets.bottom }}>
        <HeroCard
          bg="#7f1d1d"
          accent="#ef4444"
          kicker="FACTURAS PENDIENTES"
          bigNum={d ? String(d.pendientesCount) : "—"}
          sub={
            d
              ? `${d.facturadosHoy} facturada${d.facturadosHoy !== 1 ? "s" : ""} hoy`
              : "Cargando..."
          }
        />

        <View style={[s.kpiGrid, { marginTop: 12 }]}>
          {renderKpi({
            label: "Pendientes NUEVO",
            value: d ? String(d.pendientesCount) : "—",
            danger: !!(d && d.pendientesCount > 0),
            onPress: () => router.push("/ventas" as any),
          })}
          {renderKpi({
            label: "Facturadas hoy",
            value: d ? String(d.facturadosHoy) : "—",
            onPress: () => router.push("/ventas" as any),
          })}
        </View>

        <ListCard
          title="Pendientes de facturar"
          action={{ label: "Ver ventas", onPress: () => router.push("/ventas" as any) }}
          colors={C}
        >
          {(d?.pendientes ?? []).length ? (
            (d?.pendientes ?? []).map((v) =>
              renderRowLink({
                k: `pend-${v.id}`,
                title: v.cliente_nombre ?? "—",
                sub: `${toGTDateKey(v.fecha) || "—"} • ${v.vendedor_codigo ?? "—"}`,
                onPress: () =>
                  router.push({
                    pathname: "/venta-detalle",
                    params: { ventaId: String(v.id) },
                  } as any),
              })
            )
          ) : (
            <Text style={[s.empty, { color: C.sub }]}>Sin pendientes ✓</Text>
          )}
        </ListCard>
      </View>
    );
  };

  const renderBodega = () => {
    const d = bodegaData;
    return (
      <View style={{ padding: 16, paddingBottom: 16 + insets.bottom }}>
        <View style={[s.kpiGrid, { marginTop: 4 }]}>
          {renderKpi({
            label: "Stock en 0",
            value: d ? String(d.productosCero) : "—",
            danger: !!(d && d.productosCero > 0),
          })}
          {renderKpi({
            label: "Vencen en 30d",
            value: d ? String(d.porVencerCount) : "—",
            danger: !!(d && d.porVencerCount > 0),
          })}
        </View>

        <ListCard title="Productos en stock 0" colors={C}>
          {(d?.criticos ?? []).length ? (
            (d?.criticos ?? []).map((a, idx) => (
              <View key={`crit-${a.producto_id}-${idx}`} style={[s.rowLink, { borderTopColor: C.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowTitle, { color: C.text }]} numberOfLines={1}>{a.producto}</Text>
                  <Text style={[s.rowSub, { color: C.sub }]} numberOfLines={1}>{a.marca}</Text>
                </View>
                <View style={[s.overduePill]}>
                  <Text style={s.overduePillText}>CRÍTICO</Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={[s.empty, { color: C.sub }]}>{d ? "Sin productos en 0 ✓" : "—"}</Text>
          )}
        </ListCard>

        <ListCard title="Próximos a vencer (30 días)" colors={C}>
          {(d?.porVencer ?? []).length ? (
            (d?.porVencer ?? []).map((a, idx) => (
              <View key={`exp-${a.producto_id}-${idx}`} style={[s.rowLink, { borderTopColor: C.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowTitle, { color: C.text }]} numberOfLines={1}>{a.producto}</Text>
                  <Text style={[s.rowSub, { color: C.sub }]} numberOfLines={1}>
                    {a.marca}{a.lote ? ` · Lote ${a.lote}` : ""}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Text style={[s.rowSub, { color: C.sub }]}>{a.fecha_exp ?? "—"}</Text>
                  <View style={s.warnPill}>
                    <Text style={s.warnPillText}>
                      {a.fecha_exp ? `${Math.max(0, dayDiffFromToday(a.fecha_exp))}d` : "—"}
                    </Text>
                  </View>
                </View>
              </View>
            ))
          ) : (
            <Text style={[s.empty, { color: C.sub }]}>{d ? "Sin vencimientos próximos ✓" : "—"}</Text>
          )}
        </ListCard>
      </View>
    );
  };

  // ─── Body ─────────────────────────────────────────────────────────────────

  const renderBody = () => {
    if (!roleChecked) {
      return (
        <View style={{ padding: 16 }}>
          <View style={[s.noticeCard, { borderColor: C.border, backgroundColor: C.card }]}>
            <Text style={[s.noticeTitle, { color: C.text }]}>Preparando...</Text>
          </View>
        </View>
      );
    }
    if (!role) {
      return (
        <View style={{ padding: 16 }}>
          <View style={[s.noticeCard, { borderColor: C.border, backgroundColor: C.card }]}>
            <Text style={[s.noticeTitle, { color: C.text }]}>Sesión no disponible</Text>
            <Text style={[s.noticeSub, { color: C.sub }]}>Inicia sesión para ver tu inicio.</Text>
          </View>
        </View>
      );
    }

    const roleUp = normalizeUpper(role) as Role;
    const hasData =
      roleUp === "ADMIN"
        ? !!adminData
        : roleUp === "VENTAS" || roleUp === "MENSAJERO"
          ? !!ventasData
          : roleUp === "FACTURACION"
            ? !!factData
            : roleUp === "BODEGA"
              ? !!bodegaData
              : false;

    if (initialLoading && !refreshing && !hasData) {
      return <SkeletonDashboard colors={C} isDark={isDark} insets={insets} />;
    }

    if (!hasData && errorMsg) {
      return (
        <View style={{ padding: 16 }}>
          <View style={[s.noticeCard, { borderColor: C.border, backgroundColor: C.card }]}>
            <Text style={[s.noticeTitle, { color: C.text }]}>Error al cargar</Text>
            <Text style={[s.noticeSub, { color: C.sub }]}>{errorMsg}</Text>
            <Pressable
              onPress={onRefresh}
              style={({ pressed }) => [
                s.retryBtn,
                { backgroundColor: C.tint, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={s.retryBtnText}>Reintentar</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    if (roleUp === "ADMIN") return renderAdmin();
    if (roleUp === "VENTAS" || roleUp === "MENSAJERO") return renderVentas();
    if (roleUp === "FACTURACION") return renderFacturacion();
    if (roleUp === "BODEGA") return renderBodega();

    return (
      <View style={{ padding: 16 }}>
        <View style={[s.noticeCard, { borderColor: C.border, backgroundColor: C.card }]}>
          <Text style={[s.noticeTitle, { color: C.text }]}>Sin dashboard</Text>
          <Text style={[s.noticeSub, { color: C.sub }]}>Rol sin inicio configurado ({role}).</Text>
        </View>
      </View>
    );
  };

  // ─── Header computed values ────────────────────────────────────────────────

  const roleUp = normalizeUpper(role) as Role;

  const greetText = useMemo(() => {
    if (roleUp === "VENTAS" || roleUp === "MENSAJERO") return buildGreeting(userLabel, "VENTAS", ventasData?.misVentasHoy);
    return buildGreeting(userLabel, roleUp);
  }, [roleUp, userLabel, ventasData?.misVentasHoy]);

  const headerSub = useMemo(() => {
    if (roleUp === "FACTURACION") return "Facturas pendientes";
    if (roleUp === "BODEGA") return fmtDateLong();
    if (roleUp === "ADMIN") return fmtDateLong();
    return null;
  }, [roleUp]);

  // ─── Render ────────────────────────────────────────────────────────────────

  if (roleChecked && role === "FACTURACION") {
    return <Redirect href="/(drawer)/(tabs)/ventas" />;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["bottom"]}>
      <ScrollView
        style={{ flex: 1, backgroundColor: C.bg }}
        contentContainerStyle={{ paddingBottom: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.tint as any}
          />
        }
      >
        {/* Header */}
        <View style={[s.header, { borderBottomColor: C.border }]}>
          <Text style={[s.headerTitle, { color: C.text }]} numberOfLines={1}>
            {greetText}
          </Text>
          {headerSub ? (
            <Text style={[s.headerSub, { color: C.sub }]} numberOfLines={1}>
              {headerSub}
            </Text>
          ) : null}
          {bgRefreshing && !refreshing ? (
            <Text style={[s.bgRefreshLabel, { color: C.sub }]}>Actualizando...</Text>
          ) : null}
          {errorMsg && (adminData ?? ventasData ?? factData ?? bodegaData) ? (
            <View style={[s.errorBanner, { borderColor: C.border }]}>
              <Text style={[s.errorBannerText, { color: C.danger }]} numberOfLines={2}>
                {errorMsg}
              </Text>
            </View>
          ) : null}
        </View>

        {renderBody()}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 22, fontWeight: "900" },
  headerSub: { marginTop: 4, fontSize: 13, fontWeight: "700" },
  bgRefreshLabel: { marginTop: 4, fontSize: 12, fontWeight: "700" },
  errorBanner: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  errorBannerText: { fontSize: 12, fontWeight: "800" },

  alertBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#fbbf24",
    justifyContent: "space-between",
  },
  alertBannerText: { fontSize: 13, fontWeight: "900", color: "#1c1700", flex: 1 },
  alertBannerChevron: { fontSize: 20, fontWeight: "900", color: "#1c1700" },

  hero: {
    borderRadius: 20,
    padding: 20,
    minHeight: 148,
    justifyContent: "center",
    overflow: "hidden",
  },
  heroKicker: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
    color: "rgba(255,255,255,0.72)",
    textTransform: "uppercase",
  },
  heroNumber: {
    fontSize: 56,
    fontWeight: "900",
    color: "#fff",
    marginTop: 4,
    letterSpacing: -1,
  },
  heroSub: {
    fontSize: 14,
    fontWeight: "700",
    color: "rgba(255,255,255,0.8)",
    marginTop: 4,
  },

  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  kpi: {
    flexBasis: "48%" as any,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    minHeight: 84,
    marginBottom: 12,
  },
  kpiLabel: { fontSize: 11, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
  kpiValue: { marginTop: 8, fontSize: 18, fontWeight: "900" },
  kpiHint: { marginTop: 4, fontSize: 11, fontWeight: "700" },

  card: { marginTop: 12, borderWidth: 1, borderRadius: 16, padding: 14 },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTitle: { fontSize: 13, fontWeight: "900" },
  cardAction: { fontSize: 13, fontWeight: "900" },
  empty: { marginTop: 10, fontSize: 13, fontWeight: "700" },

  rowLink: {
    marginTop: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowTitle: { fontSize: 14, fontWeight: "900" },
  rowSub: { marginTop: 2, fontSize: 12, fontWeight: "700" },
  rowChevron: { fontSize: 20, fontWeight: "900" },

  stockPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  stockPillText: { fontSize: 11, fontWeight: "900" },

  barRow: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  barLabel: { width: 120, fontSize: 12, fontWeight: "800" },
  barTrack: { flex: 1, height: 10, borderRadius: 999, borderWidth: 1, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 999 },
  barValue: { minWidth: 90, textAlign: "right", fontSize: 12, fontWeight: "900" },

  lineTopRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  lineMeta: { fontSize: 12, fontWeight: "800" },
  lineChart: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  lineLabelText: { fontSize: 10, fontWeight: "600", textAlign: "center" },

  noticeCard: { borderWidth: 1, borderRadius: 16, padding: 16 },
  noticeTitle: { fontSize: 15, fontWeight: "900" },
  noticeSub: { marginTop: 6, fontSize: 13, fontWeight: "700" },
  retryBtn: { marginTop: 12, borderRadius: 10, padding: 12, alignItems: "center" },
  retryBtnText: { color: "#fff", fontSize: 14, fontWeight: "900" },

  overduePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderColor: "#ef4444",
    backgroundColor: "rgba(239,68,68,0.12)",
  },
  overduePillText: { fontSize: 11, fontWeight: "900", color: "#ef4444" },

  warnPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderColor: "#f59e0b",
    backgroundColor: "rgba(245,158,11,0.12)",
  },
  warnPillText: { fontSize: 11, fontWeight: "900", color: "#b45309" },
});
