import { useFocusEffect, useTheme } from "@react-navigation/native";
import { router } from "expo-router";
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
import { onAppResumed } from "../../../lib/resumeEvents";
import { FB_DARK_DANGER } from "../../../src/theme/headerColors";

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = "ADMIN" | "VENTAS" | "FACTURACION" | "BODEGA" | "";

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

type AdminData = {
  solicitudes: number;
  recetasPendMes: number;
  ventasHoyTotal: number;
  cxcSaldoTotal: number;
  cxcSaldoVencido: number;
  ventasMesTotal: number;
  ventasMesPorVendedor: VendedorMesTotal[];
  tendencia12m: number[];
};

type VentasData = {
  misVentasHoy: number;
  misClientesCount: number;
  recetasPendMes: number;
  recetasPendList: VentaMini[];
  ventasMes: number[];
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
};

type BodegaData = {
  alertasCount: number;
  alertas: BodegaAlerta[];
  totalProductos: number;
  productosCero: number;
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
  const h = nowGt().getUTCHours();
  const base = h >= 5 && h < 12 ? "Buenos días" : h >= 12 && h < 18 ? "Buenas tardes" : "Buenas noches";
  if (role === "VENTAS") {
    if (typeof ventasHoy === "number" && ventasHoy > 0)
      return name ? `¡Vamos ${name}!` : "¡A seguir vendiendo!";
    return name ? `¡Hoy es un buen día, ${name}!` : "¡Hoy es un buen día!";
  }
  return name ? `${base}, ${name}` : base;
}

function fmtQ(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `Q ${x.toFixed(2)}`;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return String(iso).slice(0, 10);
}

function safeNumber(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function normalizeUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
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

function pad2(n: number) {
  return String(n).padStart(2, "0");
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

function MiniLine({
  values,
  labels,
  colors,
}: {
  values: number[];
  labels?: string[];
  colors: DashColors;
}) {
  const [w, setW] = useState(0);
  const H = 140;
  const PAD = 14;

  const defaultLabels = useMemo(
    () => ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
    []
  );
  const monthLabels = labels ?? defaultLabels;

  const pts = useMemo(() => {
    const n = values.length;
    const max = Math.max(1, ...values.map((v) => Number(v) || 0));
    const ww = Math.max(0, w);
    if (n < 2 || ww <= 10) return [] as { x: number; y: number; i: number }[];
    const innerW = Math.max(1, ww - PAD * 2);
    const innerH = Math.max(1, H - PAD * 2);
    return values.map((vv, i) => {
      const v = Number(vv) || 0;
      const x = PAD + (innerW * i) / (n - 1);
      const y = PAD + (1 - v / max) * innerH;
      return { x, y, i };
    });
  }, [values, w]);

  const maxV = useMemo(() => Math.max(0, ...values.map((v) => Number(v) || 0)), [values]);
  const allZero = maxV === 0;

  return (
    <View>
      <View style={s.lineTopRow}>
        <Text style={[s.lineMeta, { color: colors.sub }]}>Máx: {fmtQ(maxV)}</Text>
      </View>

      {allZero ? (
        <View
          style={[
            s.lineChart,
            { borderColor: colors.border, backgroundColor: colors.chipBg, justifyContent: "center", alignItems: "center" },
          ]}
        >
          <Text style={[s.lineMeta, { color: colors.sub }]}>Sin datos este período</Text>
        </View>
      ) : (
        <View
          style={[s.lineChart, { borderColor: colors.border, backgroundColor: colors.chipBg }]}
          onLayout={(ev) => {
            const next = Math.round(ev.nativeEvent.layout.width);
            if (next !== w) setW(next);
          }}
        >
          {pts.length >= 2
            ? pts.slice(0, -1).map((p, idx) => {
                const q = pts[idx + 1];
                const dx = q.x - p.x;
                const dy = q.y - p.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
                const xm = (p.x + q.x) / 2;
                const ym = (p.y + q.y) / 2;
                return (
                  <View
                    key={`seg-${idx}`}
                    style={[
                      s.lineSeg,
                      {
                        left: xm - dist / 2,
                        top: ym - 1,
                        width: dist,
                        backgroundColor: colors.tint,
                        transform: [{ rotateZ: `${ang}deg` }],
                      },
                    ]}
                  />
                );
              })
            : null}
          {pts.length
            ? pts.map((p) => (
                <View
                  key={`pt-${p.i}`}
                  style={[
                    s.lineDot,
                    { left: p.x - 3, top: p.y - 3, backgroundColor: colors.card, borderColor: colors.tint },
                  ]}
                />
              ))
            : null}
        </View>
      )}

      <View style={s.lineLabelsRow}>
        {monthLabels.map((m, i) => (
          <View key={`ml-${i}`} style={s.lineLabelBox}>
            <View style={s.lineLabelRot}>
              <Text style={[s.lineLabelText, { color: colors.sub }]} numberOfLines={1}>
                {m}
              </Text>
            </View>
          </View>
        ))}
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

  const loadAdmin = useCallback(async (): Promise<AdminData> => {
    const [dash, tend] = await Promise.all([
      supabase.rpc("rpc_dashboard_admin"),
      supabase.rpc("rpc_report_ventas_mensual_12m"),
    ]);
    if (dash.error) throw dash.error;
    const d = dash.data as any;

    const tendRows = ((tend.data ?? []) as any[]).sort((a, b) =>
      String(a?.mes ?? "").localeCompare(String(b?.mes ?? ""))
    );
    const tendencia12m = Array.from({ length: 12 }, (_, i) => Number(tendRows[i]?.monto ?? 0));

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
    };
  }, []);

  const loadVentas = useCallback(async (userId: string): Promise<VentasData> => {
    const { data, error } = await supabase.rpc("rpc_dashboard_ventas", { p_vendedor_id: userId });
    if (error) throw error;
    const d = data as any;

    const rawSource: unknown = d.ventas_por_mes ?? d.ventas_mes ?? null;
    const parsed: unknown =
      typeof rawSource === "string"
        ? (() => { try { return JSON.parse(rawSource); } catch { return null; } })()
        : rawSource;

    const ventasMes = (() => {
      const out = new Array<number>(12).fill(0);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "number") {
        for (let i = 0; i < 12; i++) out[i] = Number(parsed[i] ?? 0);
        return out;
      }
      if (Array.isArray(parsed) && parsed.length > 0) {
        const rows = parsed as any[];
        const getMes = (r: any) => Number(r?.mes ?? r?.m ?? r?.month ?? NaN);
        const mesValues = rows.map(getMes).filter((n) => Number.isFinite(n));
        const nowMonth = new Date().getMonth() + 1;
        const is0Based =
          mesValues.some((n) => n === 0) ||
          (Math.max(...mesValues) === nowMonth - 1 && !mesValues.includes(nowMonth));
        for (const r of rows) {
          let m = getMes(r);
          if (!Number.isFinite(m)) continue;
          if (is0Based) m += 1;
          if (m < 1 || m > 12) continue;
          out[m - 1] = Number(r?.monto ?? r?.total ?? 0);
        }
        return out;
      }
      return out;
    })();

    const { year, month } = gtYearMonth();
    const { data: recRows } = await supabase.rpc("rpc_ventas_receta_pendiente_por_mes", {
      p_year: year,
      p_month: month,
    });
    const recList = ((recRows ?? []) as any[])
      .filter((r) => String(r?.vendedor_id ?? "") === userId && r?.requiere_receta && !r?.receta_cargada)
      .sort((a, b) => String(b?.fecha ?? "").localeCompare(String(a?.fecha ?? "")))
      .slice(0, 5)
      .map((r) => ({
        id: Number(r?.id ?? 0),
        fecha: r?.fecha ?? null,
        cliente_nombre: r?.cliente_nombre ?? null,
        vendedor_codigo: r?.vendedor_codigo ?? null,
        vendedor_id: r?.vendedor_id ?? null,
      }));

    return {
      misVentasHoy: Number(d.ventas_hoy ?? 0),
      misClientesCount: Number(d.clientes_activos ?? 0),
      recetasPendMes: Number(d.recetas_pendientes_mes ?? 0),
      recetasPendList: recList,
      ventasMes,
    };
  }, []);

  const loadFacturador = useCallback(async (): Promise<FacturadorData> => {
    const { data: pendData, error } = await supabase
      .from("ventas")
      .select("id,fecha,cliente_nombre,vendedor_id,vendedor_codigo")
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

  const loadBodega = useCallback(async (): Promise<BodegaData> => {
    const [alertResult, totalResult] = await Promise.all([
      supabase.rpc("rpc_report_inventario_alertas"),
      supabase.from("vw_inventario_productos").select("id", { count: "exact", head: true }),
    ]);
    if (alertResult.error) throw alertResult.error;

    const alertas: BodegaAlerta[] = ((alertResult.data ?? []) as any[]).map((r) => ({
      tipo: String(r.tipo ?? ""),
      producto_id: r.producto_id ?? "",
      producto: String(r.producto ?? ""),
      marca: String(r.marca ?? ""),
      stock_disponible: Number(r.stock_disponible ?? 0),
    }));

    const productosCero = alertas.filter((a) => a.stock_disponible === 0).length;

    return {
      alertasCount: alertas.length,
      alertas: alertas.slice(0, 20),
      totalProductos: Number(totalResult.count ?? 0),
      productosCero,
    };
  }, []);

  // ─── Master loader ────────────────────────────────────────────────────────

  const clearOtherRoleData = useCallback((keep: Role) => {
    if (keep !== "ADMIN" && adminRef.current) setAdminData(null);
    if (keep !== "VENTAS" && ventasRef.current) setVentasData(null);
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
          if (r === "VENTAS") setVentasData(cached.data);
          if (r === "FACTURACION") setFactData(cached.data);
          if (r === "BODEGA") setBodegaData(cached.data);
          return;
        }

        if (r === "ADMIN") {
          const data = await loadAdmin();
          if (seq !== loadSeqRef.current) return;
          setAdminData(data);
          cacheRef.current = { role: r, ts: Date.now(), data };
          return;
        }

        if (r === "VENTAS") {
          if (!id) throw new Error("Usuario no autenticado");
          const data = await loadVentas(id);
          if (seq !== loadSeqRef.current) return;
          setVentasData(data);
          cacheRef.current = { role: r, ts: Date.now(), data };
          return;
        }

        if (r === "FACTURACION") {
          const data = await loadFacturador();
          if (seq !== loadSeqRef.current) return;
          setFactData(data);
          cacheRef.current = { role: r, ts: Date.now(), data };
          return;
        }

        if (r === "BODEGA") {
          const data = await loadBodega();
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
    [clearOtherRoleData, loadAdmin, loadBodega, loadFacturador, loadVentas, role, uid]
  );

  // ─── Focus effect ─────────────────────────────────────────────────────────

  useEffect(() => onAppResumed(() => { void loadAll({}); }), [loadAll]);

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
          if (r === "VENTAS") setVentasData(cached!.data);
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
          pressed && clickable ? { opacity: 0.85 } : null,
        ]}
      >
        <Text style={[s.kpiLabel, { color: C.sub }]} numberOfLines={1}>
          {props.label}
        </Text>
        <Text style={[s.kpiValue, { color: valColor }]} numberOfLines={1}>
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
    const mon = monthAbbr[Math.max(0, Math.min(11, currentMonth - 1))];
    return (
      <View style={{ paddingBottom: 16 + insets.bottom }}>
        {d && d.recetasPendMes > 0 ? (
          <Pressable
            onPress={() => router.push("/(drawer)/recetas-pendientes" as any)}
            style={[s.alertBanner]}
          >
            <Text style={s.alertBannerText}>
              ⚠️  {d.recetasPendMes} receta{d.recetasPendMes !== 1 ? "s" : ""} pendiente{d.recetasPendMes !== 1 ? "s" : ""} este mes
            </Text>
            <Text style={s.alertBannerChevron}>›</Text>
          </Pressable>
        ) : null}

        <View style={{ padding: 16 }}>
          <HeroCard
            bg="#0f2d6e"
            accent="#3b82f6"
            kicker="VENTAS DEL MES"
            bigNum={d ? fmtQ(d.ventasMesTotal) : "—"}
            sub={d ? `${d.ventasHoyTotal} venta${d.ventasHoyTotal !== 1 ? "s" : ""} hoy` : "Cargando..."}
          />

          <View style={[s.kpiGrid, { marginTop: 12 }]}>
            {renderKpi({
              label: "Solicitudes",
              value: d ? String(d.solicitudes) : "—",
              hint: "Pendientes",
              onPress: () => router.push("/(drawer)/ventas-solicitudes" as any),
            })}
            {renderKpi({
              label: "Recetas",
              value: d ? String(d.recetasPendMes) : "—",
              hint: "Pendientes del mes",
              onPress: () => router.push("/(drawer)/recetas-pendientes" as any),
            })}
            {renderKpi({
              label: "CxC Total",
              value: d ? fmtQ(d.cxcSaldoTotal) : "—",
              onPress: () => router.push("/cxc" as any),
            })}
            {renderKpi({
              label: "CxC Vencido",
              value: d ? fmtQ(d.cxcSaldoVencido) : "—",
              danger: !!(d && d.cxcSaldoVencido > 0),
              onPress: () => router.push("/cxc" as any),
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
    const mon = monthAbbr[Math.max(0, Math.min(11, currentMonth - 1))];
    return (
      <View style={{ padding: 16, paddingBottom: 16 + insets.bottom }}>
        <HeroCard
          bg="#0f2d6e"
          accent="#6366f1"
          kicker="MIS VENTAS HOY"
          bigNum={d ? String(d.misVentasHoy) : "—"}
          sub={
            d
              ? `${d.misClientesCount} cliente${d.misClientesCount !== 1 ? "s" : ""} activos`
              : "Cargando..."
          }
        />

        <View style={[s.kpiGrid, { marginTop: 12 }]}>
          {renderKpi({
            label: "Clientes activos",
            value: d ? String(d.misClientesCount) : "—",
            onPress: () => router.push("/clientes" as any),
          })}
          {renderKpi({
            label: "Recetas pendientes",
            value: d ? String(d.recetasPendMes) : "—",
            hint: "del mes",
            onPress: () => router.push("/(drawer)/recetas-pendientes" as any),
          })}
          {renderKpi({
            label: `Ventas ${mon}`,
            value: d ? String(safeNumber(d.ventasMes[currentMonth - 1])) : "—",
            onPress: () => router.push("/ventas" as any),
          })}
          {renderKpi({
            label: "Ir a ventas",
            value: "Abrir →",
            onPress: () => router.push("/ventas" as any),
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
          title="Recetas pendientes"
          action={{ label: "Ver todas", onPress: () => router.push("/(drawer)/recetas-pendientes" as any) }}
          colors={C}
        >
          {(d?.recetasPendList ?? []).length ? (
            (d?.recetasPendList ?? []).map((v) =>
              renderRowLink({
                k: `rec-${v.id}`,
                title: v.cliente_nombre ?? "—",
                sub: `Fecha: ${fmtDate(v.fecha)}`,
                onPress: () =>
                  router.push({
                    pathname: "/venta-detalle",
                    params: { ventaId: String(v.id) },
                  } as any),
              })
            )
          ) : (
            <Text style={[s.empty, { color: C.sub }]}>Sin recetas pendientes ✓</Text>
          )}
        </ListCard>
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
                sub: `${fmtDate(v.fecha)} • ${v.vendedor_codigo ?? "—"}`,
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

    const stockColor = (stock: number) => {
      if (stock === 0) return C.danger;
      if (stock <= 3) return "#f97316";
      return "#eab308";
    };
    const stockLabel = (stock: number) => {
      if (stock === 0) return "CRÍTICO";
      if (stock <= 3) return "BAJO";
      return "PRECAUCIÓN";
    };

    return (
      <View style={{ padding: 16, paddingBottom: 16 + insets.bottom }}>
        <HeroCard
          bg="#1a1a2e"
          accent="#7c3aed"
          kicker="ALERTAS ACTIVAS"
          bigNum={d ? String(d.alertasCount) : "—"}
          sub={
            d
              ? `${d.productosCero} producto${d.productosCero !== 1 ? "s" : ""} en 0 unidades`
              : "Cargando..."
          }
        />

        <View style={[s.kpiGrid, { marginTop: 12 }]}>
          {renderKpi({
            label: "Total alertas",
            value: d ? String(d.alertasCount) : "—",
            danger: !!(d && d.alertasCount > 0),
          })}
          {renderKpi({
            label: "Productos en 0",
            value: d ? String(d.productosCero) : "—",
            danger: !!(d && d.productosCero > 0),
          })}
          {renderKpi({
            label: "Total productos",
            value: d ? String(d.totalProductos) : "—",
          })}
          {renderKpi({
            label: "Bajo / Precaución",
            value: d ? String(d.alertasCount - d.productosCero) : "—",
          })}
        </View>

        <ListCard title="Alertas de stock" colors={C}>
          {(d?.alertas ?? []).length ? (
            (d?.alertas ?? []).map((a, idx) => (
              <View key={`alerta-${a.producto_id}-${idx}`} style={[s.rowLink, { borderTopColor: C.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowTitle, { color: C.text }]} numberOfLines={1}>
                    {a.producto}
                  </Text>
                  <Text style={[s.rowSub, { color: C.sub }]} numberOfLines={1}>
                    {a.marca}
                  </Text>
                </View>
                <View
                  style={[
                    s.stockPill,
                    {
                      backgroundColor:
                        alphaColor(stockColor(a.stock_disponible), 0.15) || "rgba(0,0,0,0.08)",
                      borderColor: stockColor(a.stock_disponible),
                    },
                  ]}
                >
                  <Text style={[s.stockPillText, { color: stockColor(a.stock_disponible) }]}>
                    {a.stock_disponible} · {stockLabel(a.stock_disponible)}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={[s.empty, { color: C.sub }]}>Sin alertas de stock ✓</Text>
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
        : roleUp === "VENTAS"
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
    if (roleUp === "VENTAS") return renderVentas();
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
    if (roleUp === "VENTAS") return buildGreeting(userLabel, "VENTAS", ventasData?.misVentasHoy);
    return buildGreeting(userLabel, roleUp);
  }, [roleUp, userLabel, ventasData?.misVentasHoy]);

  const headerSub = useMemo(() => {
    if (roleUp === "FACTURACION") return "Facturas pendientes";
    if (roleUp === "BODEGA") return "Control de inventario";
    if (roleUp === "ADMIN") return fmtDateLong();
    return null;
  }, [roleUp]);

  // ─── Render ────────────────────────────────────────────────────────────────

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
  cardTitle: { fontSize: 16, fontWeight: "900" },
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
  barValue: { width: 80, textAlign: "right", fontSize: 12, fontWeight: "900" },

  lineTopRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  lineMeta: { fontSize: 12, fontWeight: "800" },
  lineChart: {
    marginTop: 10,
    height: 140,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
  },
  lineSeg: { position: "absolute", height: 2, borderRadius: 2 },
  lineDot: { position: "absolute", width: 6, height: 6, borderRadius: 3, borderWidth: 2 },
  lineLabelsRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  lineLabelBox: { flex: 1, alignItems: "center", justifyContent: "center", height: 38 },
  lineLabelRot: {
    width: 36,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotateZ: "-90deg" }],
  },
  lineLabelText: { fontSize: 10, fontWeight: "900", textAlign: "center" },

  noticeCard: { borderWidth: 1, borderRadius: 16, padding: 16 },
  noticeTitle: { fontSize: 15, fontWeight: "900" },
  noticeSub: { marginTop: 6, fontSize: 13, fontWeight: "700" },
  retryBtn: { marginTop: 12, borderRadius: 10, padding: 12, alignItems: "center" },
  retryBtnText: { color: "#fff", fontSize: 14, fontWeight: "900" },
});
