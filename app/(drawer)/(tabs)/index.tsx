import { useFocusEffect, useTheme } from "@react-navigation/native";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
import { FB_DARK_DANGER } from "../../../src/theme/headerColors";

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
  requiere_receta: boolean;
  receta_cargada: boolean;
};

type AdminData = {
  solicitudes: number;
  recetasPendMes: number;
  ventasHoyTotal: number;
  cxcSaldoTotal: number;
  cxcSaldoVencido: number;
  ventasMesTotal: number;
  ventasMesPorVendedor: VendedorMesTotal[];
  ventasMes: number[]; // 12 values: Ene..Dic (global, todos los vendedores)
};

type VentasData = {
  misVentasHoy: number;
  misClientesCount: number;
  recetasPendMes: number;
  recetasPendList: VentaMini[];
  cxcSaldoTotal: number;
  cxcSaldoVencido: number;
  ventasMes: number[]; // 12 values: Ene..Dic (monto en Q)
  topProductos: { label: string; qty: number }[];
};

type FacturadorData = {
  pendientesCount: number;
  pendientes: VentaMini[];
};

function normalizeUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return String(iso).slice(0, 10);
}

function fmtQ(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `Q ${x.toFixed(2)}`;
}

function safeNumber(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function nowGt() {
  // Usar UTC y aplicar offset fijo Guatemala (-06:00, sin DST)
  const now = new Date();
  return new Date(now.getTime() - (now.getTimezoneOffset() + 360) * 60 * 1000);
}

function gtYearMonth() {
  const gt = nowGt();
  return { year: gt.getUTCFullYear(), month: gt.getUTCMonth() + 1 };
}



function pickNameFromProfile(p: any) {
  const raw =
    p?.full_name ??
    p?.nombre ??
    p?.name ??
    p?.display_name ??
    p?.username ??
    "";
  return String(raw ?? "").trim();
}

function guessNameFromEmail(email: string | null | undefined) {
  const e = (email ?? "").trim();
  if (!e) return "";
  return e.split("@")[0] ?? "";
}

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
              <View style={[s.barFill, { backgroundColor: colors.tint, width: `${Math.round(pct * 100)}%` }]} />
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

function MiniLine({
  values,
  year,
  currentMonthIndex,
  currentMonthLabel,
  colors,
}: {
  values: number[];
  year: number;
  currentMonthIndex: number;
  currentMonthLabel: string;
  colors: DashColors;
}) {
  const [w, setW] = useState(0);
  const H = 140;
  const PAD = 14;
  const pts = useMemo(() => {
    const n = values.length;
    const max = Math.max(1, ...values.map((v) => Number(v) || 0));
    const ww = Math.max(0, w);
    if (n < 2 || ww <= 10) return [] as { x: number; y: number; v: number; i: number }[];
    const innerW = Math.max(1, ww - PAD * 2);
    const innerH = Math.max(1, H - PAD * 2);
    return values.map((vv, i) => {
      const v = Number(vv) || 0;
      const x = PAD + (innerW * i) / (n - 1);
      const y = PAD + (1 - v / max) * innerH;
      return { x, y, v, i };
    });
  }, [values, w]);

  const maxV = useMemo(() => Math.max(0, ...values.map((v) => Number(v) || 0)), [values]);
  const allZero = useMemo(() => maxV === 0, [maxV]);
  const monthTotal = useMemo(
    () => safeNumber(values?.[Math.max(0, Math.min(11, currentMonthIndex))] ?? 0),
    [currentMonthIndex, values]
  );

  const monthLabels = useMemo(
    () => ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
    []
  );

  return (
    <View>
      <View style={s.lineTopRow}>
        <Text style={[s.lineMeta, { color: colors.sub }]}>
          Total {currentMonthLabel} {year}: {fmtQ(monthTotal)}
        </Text>
        <Text style={[s.lineMeta, { color: colors.sub }]}>Max: {fmtQ(maxV)}</Text>
      </View>

      {allZero ? (
        <View style={[s.lineChart, { borderColor: colors.border, backgroundColor: colors.chipBg, justifyContent: "center", alignItems: "center" }]}>
          <Text style={[s.lineMeta, { color: colors.sub }]}>Sin ventas este año</Text>
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
                    {
                      left: p.x - 3,
                      top: p.y - 3,
                      backgroundColor: colors.card,
                      borderColor: colors.tint,
                    },
                  ]}
                />
              ))
            : null}
        </View>
      )}

      <View style={s.lineLabelsRow}>
        {monthLabels.map((m, i) => (
          <View key={`m-${i}`} style={s.lineLabelBox}>
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
          <Pressable onPress={action.onPress} style={({ pressed }) => [pressed ? { opacity: 0.85 } : null]}>
            <Text style={[s.cardAction, { color: colors.tint }]}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function SkeletonDashboard({
  colors,
  isDark,
  insets,
}: {
  colors: DashColors;
  isDark: boolean;
  insets: { bottom: number };
}) {
  const sk =
    alphaColor(String(colors.text), isDark ? 0.1 : 0.08) ||
    (isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)");

  const SkBlock = ({ w, h, r }: { w: number | `${number}%`; h: number; r?: number }) => (
    <View style={{ width: w, height: h, borderRadius: r ?? 10, backgroundColor: sk }} />
  );

  const SkKpi = () => (
    <View style={[s.kpi, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <SkBlock w="62%" h={12} r={8} />
      <View style={{ height: 10 }} />
      <SkBlock w="46%" h={18} r={10} />
      <View style={{ height: 8 }} />
      <SkBlock w="72%" h={12} r={8} />
    </View>
  );

  const SkCard = () => (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <SkBlock w="48%" h={14} r={9} />
      <View style={{ height: 12 }} />
      <SkBlock w="92%" h={12} r={8} />
      <View style={{ height: 10 }} />
      <SkBlock w="86%" h={12} r={8} />
      <View style={{ height: 10 }} />
      <SkBlock w="78%" h={12} r={8} />
    </View>
  );

  return (
    <View style={{ padding: 16, paddingBottom: 16 + insets.bottom }}>
      <View style={s.kpiGrid}>
        <SkKpi />
        <SkKpi />
        <SkKpi />
        <SkKpi />
      </View>
      <SkCard />
      <SkCard />
    </View>
  );
}

export default function Inicio() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  const CACHE_TTL_MS = 60000;

  const C = useMemo(() => {
    const bg = colors.background ?? (isDark ? "#000" : "#fff");
    const card = colors.card ?? (isDark ? "#121214" : "#fff");
    const text = colors.text ?? (isDark ? "#fff" : "#111");
    const border = colors.border ?? (isDark ? "rgba(255,255,255,0.14)" : "#e5e5e5");
    const tint = String(colors.primary ?? "#153c9e");
    const sub =
      alphaColor(String(text), 0.65) || (isDark ? "rgba(255,255,255,0.65)" : "#666");
    const danger = FB_DARK_DANGER;
    const chipBg = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
    return { bg, card, text, sub, border, tint, danger, chipBg };
  }, [colors.background, colors.border, colors.card, colors.primary, colors.text, isDark]);

  const [uid, setUid] = useState<string | null>(null);
  const [userLabel, setUserLabel] = useState<string>("");
  const { role, isReady: roleChecked, refreshRole } = useRole();

  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(false);
  const [bgRefreshing, setBgRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [adminData, setAdminData] = useState<AdminData | null>(null);
  const [ventasData, setVentasData] = useState<VentasData | null>(null);
  const [factData, setFactData] = useState<FacturadorData | null>(null);

  const currentYear = useMemo(() => gtYearMonth().year, []);

  const profileSeqRef = useRef(0);
  const loadSeqRef = useRef(0);
  const bgSeqRef = useRef(0);
  const initSeqRef = useRef(0);
  const cacheRef = useRef<{ role: Role; ts: number; data: any } | null>(null);
  const lastDashboardRoleRef = useRef<Role>("");

  const adminDataRef = useRef<AdminData | null>(null);
  const ventasDataRef = useRef<VentasData | null>(null);
  const factDataRef = useRef<FacturadorData | null>(null);

  useEffect(() => {
    adminDataRef.current = adminData;
  }, [adminData]);
  useEffect(() => {
    ventasDataRef.current = ventasData;
  }, [ventasData]);
  useEffect(() => {
    factDataRef.current = factData;
  }, [factData]);

  const loadProfile = useCallback(async (): Promise<{ uid: string | null; label: string } | null> => {
    const seq = ++profileSeqRef.current;
    setErrorMsg(null);

    try {
      const { data } = await supabase.auth.getSession();
      if (seq !== profileSeqRef.current) return null;
      const u = data?.session?.user;
      const id = u?.id ?? null;
      setUid(id);
      if (!id) {
        setUserLabel("");
        return { uid: null, label: "" };
      }

      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", id)
        .maybeSingle();
      if (seq !== profileSeqRef.current) return null;

      // Preferir full_name; evitar usar codigo en Inicio.
      const label = pickNameFromProfile(prof) || guessNameFromEmail(u?.email) || String(id).slice(0, 8);
      setUserLabel(label);
      return { uid: id, label };
    } catch {
      if (seq !== profileSeqRef.current) return null;
      setUid(null);
      setUserLabel("");
      return { uid: null, label: "" };
    }
  }, []);

  const loadAdmin = useCallback(async () => {
    const { data, error } = await supabase.rpc('rpc_dashboard_admin');
    if (error) throw error;
    const d = data as any;

    // Parse ventas_por_mes global: espera array de 12 números (índice 0=Ene). Fallback a ceros.
    const rawMesAdmin: unknown = d.ventas_por_mes ?? null;
    const parsedMesAdmin: unknown =
      typeof rawMesAdmin === 'string'
        ? (() => { try { return JSON.parse(rawMesAdmin); } catch { return null; } })()
        : rawMesAdmin;
    const ventasMes: number[] =
      Array.isArray(parsedMesAdmin) && parsedMesAdmin.length > 0 && typeof parsedMesAdmin[0] === 'number'
        ? Array.from({ length: 12 }, (_, i) => Number(parsedMesAdmin[i] ?? 0))
        : new Array<number>(12).fill(0);

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
        vendedor_nombre: String(r.vendedor_nombre ?? 'Sin vendedor'),
        monto: Number(r.monto ?? 0),
      })),
      ventasMes,
    } satisfies AdminData;
  }, []);

  const loadVentas = useCallback(async (userId: string) => {
    const { data, error } = await supabase.rpc('rpc_dashboard_ventas', { p_vendedor_id: userId });
    if (error) throw error;
    const d = data as any;

    // Resolves ventas_por_mes from multiple possible keys and formats.
    const rawMesSource: unknown =
      d.ventas_por_mes ??
      d.ventas_mes ??
      d.ventas_mes_por_mes ??
      d.ventasPorMes ??
      null;

    const parsedSource: unknown =
      typeof rawMesSource === 'string'
        ? (() => { try { return JSON.parse(rawMesSource); } catch { return null; } })()
        : rawMesSource;

    const ventasMes = ((): number[] => {
      const out = new Array<number>(12).fill(0);

      // Format 1: plain number array — index 0..11 maps directly to Ene..Dic
      if (Array.isArray(parsedSource) && parsedSource.length > 0 && typeof parsedSource[0] === 'number') {
        for (let i = 0; i < 12; i++) out[i] = Number(parsedSource[i] ?? 0);
        return out;
      }

      // Format 2: object array
      if (Array.isArray(parsedSource) && parsedSource.length > 0) {
        const rows = parsedSource as any[];
        const getMes = (r: any): number => Number(r?.mes ?? r?.m ?? r?.month ?? r?.Month ?? NaN);
        const mesValues = rows.map(getMes).filter((n) => Number.isFinite(n));
        const maxMes = mesValues.length ? Math.max(...mesValues) : -1;
        const nowMonth = new Date().getMonth() + 1; // 1-based calendar month
        // 0-based detection:
        //   a) any row explicitly has mes=0 (January in 0-based), OR
        //   b) the highest mes equals the current calendar month minus 1
        //      AND no row has the 1-based current month value
        //      (handles partial-year data where January has no sales)
        const is0Based =
          mesValues.some((n) => n === 0) ||
          (maxMes === nowMonth - 1 && !mesValues.includes(nowMonth));
        for (const r of rows) {
          let m = getMes(r);
          if (!Number.isFinite(m)) continue;
          if (is0Based) m += 1; // normalise to 1-based
          if (m < 1 || m > 12) continue;
          const v = Number(r?.monto ?? r?.total ?? r?.sum ?? r?.amount ?? 0);
          out[m - 1] = v;
        }
        return out;
      }

      return out;
    })();

    // recetas pendientes: seguir usando rpc_ventas_receta_pendiente_por_mes para obtener la lista
    const { year, month } = gtYearMonth();
    const { data: recRows } = await supabase.rpc('rpc_ventas_receta_pendiente_por_mes', { p_year: year, p_month: month });
    const mine = (recRows ?? [])
      .filter((r: any) => String(r?.vendedor_id ?? '') === userId)
      .filter((r: any) => r?.requiere_receta && !r?.receta_cargada)
      .sort((a: any, b: any) => String(b?.fecha ?? '').localeCompare(String(a?.fecha ?? '')))
      .slice(0, 5);

    return {
      misVentasHoy: Number(d.ventas_hoy ?? 0),
      misClientesCount: Number(d.clientes_activos ?? 0),
      recetasPendMes: Number(d.recetas_pendientes_mes ?? 0),
      recetasPendList: mine.map((r: any) => ({
        id: Number(r?.id ?? 0),
        fecha: r?.fecha ?? null,
        cliente_nombre: r?.cliente_nombre ?? null,
        vendedor_codigo: r?.vendedor_codigo ?? null,
        vendedor_id: r?.vendedor_id ?? null,
        requiere_receta: !!r?.requiere_receta,
        receta_cargada: !!r?.receta_cargada,
      })),
      cxcSaldoTotal: Number(d.cxc_total ?? 0),
      cxcSaldoVencido: Number(d.cxc_vencido ?? 0),
      ventasMes,
      topProductos: (d.top_productos ?? []).map((r: any) => ({
        label: String(r.label ?? 'Producto'),
        qty: Number(r.qty ?? 0),
      })),
    } satisfies VentasData;
  }, []);

  const loadFacturador = useCallback(async () => {
    const { data, error } = await supabase
      .from("ventas")
      .select("id,fecha,cliente_nombre,vendedor_id,vendedor_codigo,requiere_receta,receta_cargada")
      .eq("estado", "NUEVO")
      .order("fecha", { ascending: false })
      .limit(80);
    if (error) throw error;
    const raw = (data ?? []) as any as VentaMini[];
    const ids = raw
      .map((r) => Number(r.id))
      .filter((x) => Number.isFinite(x) && x > 0);

    let anulado = new Set<string>();
    if (ids.length) {
      const { data: trows } = await supabase
        .from("ventas_tags")
        .select("venta_id,tag")
        .in("venta_id", ids)
        .is("removed_at", null);
      (trows ?? []).forEach((tr: any) => {
        const vid = String(tr?.venta_id ?? "");
        const tag = String(tr?.tag ?? "").trim().toUpperCase();
        if (vid && tag === "ANULADO") anulado.add(vid);
      });
    }

    const pendientes = raw.filter((r) => !anulado.has(String(r.id))).slice(0, 12);
    return { pendientesCount: pendientes.length, pendientes } satisfies FacturadorData;
  }, []);

  const loadAll = useCallback(
    async (opts?: {
      force?: boolean;
      roleOverride?: Role;
      uidOverride?: string | null;
      silent?: boolean;
      skipCache?: boolean;
    }) => {
      const force = !!opts?.force;
      const skipCache = !!opts?.skipCache;
      const silent = !!opts?.silent;
      void silent; // UI decides how to show progress; keep signature for callers.
      const seq = ++loadSeqRef.current;
      setErrorMsg(null);
      let hadVisibleDataForRole = false;
      try {
        const r = (opts?.roleOverride ?? (normalizeUpper(role) as Role)) || "";
        const id = opts?.uidOverride ?? uid;

        hadVisibleDataForRole =
          r === "ADMIN"
            ? !!adminDataRef.current
            : r === "VENTAS"
              ? !!ventasDataRef.current
              : r === "FACTURACION"
                ? !!factDataRef.current
                : false;

        // Solo limpiar data si el rol realmente cambió (evitar wipes en revalidación)
        if (r !== lastDashboardRoleRef.current) {
          lastDashboardRoleRef.current = r;
          if (adminDataRef.current) setAdminData(null);
          if (ventasDataRef.current) setVentasData(null);
          if (factDataRef.current) setFactData(null);
        }

        if (!r) {
          return;
        }

        // Cache por rol (stale-while-revalidate: el caller decide si revalidar con skipCache)
        const cached = cacheRef.current;
        const now = Date.now();
        if (!force && !skipCache && cached && cached.role === r && now - cached.ts < CACHE_TTL_MS) {
          if (r === "ADMIN") setAdminData(cached.data as AdminData);
          if (r === "VENTAS") setVentasData(cached.data as VentasData);
          if (r === "FACTURACION") setFactData(cached.data as FacturadorData);
          return;
        }

        if (r === "ADMIN") {
          const data = await loadAdmin();
          if (seq !== loadSeqRef.current) return;
          setAdminData(data);
          if (ventasDataRef.current) setVentasData(null);
          if (factDataRef.current) setFactData(null);
          cacheRef.current = { role: r, ts: Date.now(), data };
          return;
        }

        if (r === "VENTAS") {
          if (!id) throw new Error("Usuario no autenticado");
          const data = await loadVentas(id);
          if (seq !== loadSeqRef.current) return;
          setVentasData(data);
          if (adminDataRef.current) setAdminData(null);
          if (factDataRef.current) setFactData(null);
          cacheRef.current = { role: r, ts: Date.now(), data };
          return;
        }

        if (r === "FACTURACION") {
          const data = await loadFacturador();
          if (seq !== loadSeqRef.current) return;
          setFactData(data);
          if (adminDataRef.current) setAdminData(null);
          if (ventasDataRef.current) setVentasData(null);
          cacheRef.current = { role: r, ts: Date.now(), data };
          return;
        }

        // Otros roles: sin dashboard por ahora
        if (adminDataRef.current) setAdminData(null);
        if (ventasDataRef.current) setVentasData(null);
        if (factDataRef.current) setFactData(null);
      } catch (e: any) {
        if (seq !== loadSeqRef.current) return;
        // Si hay data visible, conservarla y solo mostrar error no invasivo.
        // Si no habia data para el rol, no forzar wipes (initialLoading/skeleton ya cubre la vacio).
        if (!hadVisibleDataForRole) {
          // Dejar estado como esta (normalmente null) para evitar layout jumps.
        }
        setErrorMsg(String(e?.message ?? "No se pudo cargar Inicio"));
      }
    },
    [loadAdmin, loadFacturador, loadVentas, role, uid]
  );

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!alive) return;
        const r = (await refreshRole()) as Role;
        const prof = await loadProfile();
        if (!alive) return;

        if (r === "FACTURACION") {
          router.replace("/ventas" as any);
          return;
        }

        const now = Date.now();
        const cached = cacheRef.current;
        const cacheValid = !!(cached && cached.role === r && now - cached.ts < CACHE_TTL_MS);

        if (cacheValid) {
          // Pintar cache inmediato (sin loading grande) + revalidar en background
          if (r !== lastDashboardRoleRef.current) {
            lastDashboardRoleRef.current = r;
            if (adminDataRef.current) setAdminData(null);
            if (ventasDataRef.current) setVentasData(null);
            if (factDataRef.current) setFactData(null);
          }
          if (r === "ADMIN") setAdminData(cached!.data as AdminData);
          if (r === "VENTAS") setVentasData(cached!.data as VentasData);
          setInitialLoading(false);

          const bgSeq = ++bgSeqRef.current;
          setBgRefreshing(true);
          loadAll({
            roleOverride: r,
            uidOverride: prof?.uid,
            silent: true,
            skipCache: true,
          }).finally(() => {
            if (!alive) return;
            if (bgSeqRef.current === bgSeq) setBgRefreshing(false);
          });
          return;
        }

        // Sin cache: skeleton inicial y carga normal
        setBgRefreshing(false);
        const initSeq = ++initSeqRef.current;
        setInitialLoading(true);
        try {
          await loadAll({
            roleOverride: r,
            uidOverride: prof?.uid,
          });
        } finally {
          if (!alive) return;
          if (initSeqRef.current === initSeq) setInitialLoading(false);
        }
      })();
      return () => {
        alive = false;
      };
    }, [loadAll, loadProfile, refreshRole])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = (await refreshRole()) as Role;
      const prof = await loadProfile();
      await loadAll({
        force: true,
        roleOverride: r,
        uidOverride: prof?.uid,
        silent: true,
        skipCache: true,
      });
    } finally {
      setRefreshing(false);
    }
  }, [loadAll, loadProfile, refreshRole]);

  const Header = (
    <View style={[s.header, { borderBottomColor: C.border }]}> 
      <View style={s.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: C.text }]} numberOfLines={1}>
            {userLabel ? `Hola ${userLabel}` : "Hola"}
          </Text>
          
        </View>
      </View>

      {errorMsg ? (
        <View style={[s.notice, { borderColor: C.border, backgroundColor: C.card }]}> 
          <Text style={[s.noticeTitle, { color: C.text }]}>No se pudo cargar</Text>
          <Text style={[s.noticeSub, { color: C.sub }]}>{errorMsg}</Text>
        </View>
      ) : null}
    </View>
  );

  const renderKpi = (props: { label: string; value: string; hint?: string; onPress?: () => void }) => {
    const clickable = !!props.onPress;
    return (
      <Pressable
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
        <Text style={[s.kpiValue, { color: C.text }]} numberOfLines={1}>
          {props.value}
        </Text>
        {props.hint ? (
          <Text style={[s.kpiHint, { color: C.sub }]} numberOfLines={1}>
            {props.hint}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  const monthAbbr = useMemo(() => ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"], []);

  const renderRowLink = (props: { k: string; title: string; sub?: string; onPress: () => void }) => (
    <Pressable
      key={props.k}
      onPress={props.onPress}
      style={({ pressed }) => [s.rowLink, pressed ? { opacity: 0.85 } : null]}
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

  const renderBody = () => {
    if (!roleChecked) {
      return (
        <View style={{ padding: 16 }}>
          <View style={[s.notice, { borderColor: C.border, backgroundColor: C.card }]}>
            <Text style={[s.noticeTitle, { color: C.text }]}>Cargando...</Text>
            <Text style={[s.noticeSub, { color: C.sub }]}>Preparando tu dashboard</Text>
          </View>
        </View>
      );
    }

    if (!role) {
      return (
        <View style={{ padding: 16 }}>
          <View style={[s.notice, { borderColor: C.border, backgroundColor: C.card }]}>
            <Text style={[s.noticeTitle, { color: C.text }]}>Sesión no disponible</Text>
            <Text style={[s.noticeSub, { color: C.sub }]}>Inicia sesión para ver tu Inicio.</Text>
          </View>
        </View>
      );
    }

    const roleUp = normalizeUpper(role) as Role;

    const hasRoleData =
      roleUp === "ADMIN"
        ? !!adminData
        : roleUp === "VENTAS"
          ? !!ventasData
          : roleUp === "FACTURACION"
            ? !!factData
            : false;
    const showSkeleton = roleChecked && !!roleUp && initialLoading && !refreshing && !hasRoleData;
    if (showSkeleton) return <SkeletonDashboard colors={C} isDark={isDark} insets={insets} />;

    if (roleUp === "ADMIN") {
      const d = adminData;
      const { year, month } = gtYearMonth();
      const mon = monthAbbr[Math.max(0, Math.min(11, month - 1))] ?? String(month);
      return (
        <View style={{ padding: 16, paddingBottom: 16 + insets.bottom }}>
          <View style={s.kpiGrid}>
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
              label: "CxC saldo",
              value: d ? fmtQ(d.cxcSaldoTotal) : "—",
              hint: d ? `Vencido: ${fmtQ(d.cxcSaldoVencido)}` : "",
              onPress: () => router.push("/cxc" as any),
            })}
            {renderKpi({
              label: "Ventas hoy",
              value: d ? String(d.ventasHoyTotal) : "—",
              hint: "Ingresadas hoy",
              onPress: () => router.push("/ventas" as any),
            })}
          </View>

          <ListCard
            title={`Total vendido ${mon} ${year}`}
            action={{ label: "Ventas", onPress: () => router.push("/ventas" as any) }}
            colors={C}
          >
            <Text style={[s.monthTotal, { color: C.sub }]} numberOfLines={1}>
              Total mes: {d ? fmtQ(d.ventasMesTotal) : "—"}
            </Text>
            {(d?.ventasMesPorVendedor ?? []).length ? (
              <Bars
                valueFmt={(n) => fmtQ(n).replace("Q ", "Q")}
                items={(d?.ventasMesPorVendedor ?? []).slice(0, 10).map((r) => ({ label: r.vendedor_nombre, qty: r.monto }))}
                colors={C}
              />
            ) : (
              <Text style={[s.empty, { color: C.sub }]}>{d ? "Sin ventas este mes" : "—"}</Text>
            )}
          </ListCard>

          <ListCard title={`Ventas ${year} (Ene-Dic)`} colors={C}>
            {d ? (
              <MiniLine
                values={d.ventasMes}
                year={year}
                currentMonthIndex={month - 1}
                currentMonthLabel={mon}
                colors={C}
              />
            ) : (
              <Text style={[s.empty, { color: C.sub }]}>—</Text>
            )}
          </ListCard>
        </View>
      );
    }

    if (roleUp === "VENTAS") {
      const d = ventasData;
      const { month } = gtYearMonth();
      const mon = monthAbbr[Math.max(0, Math.min(11, month - 1))] ?? String(month);
      return (
        <View style={{ padding: 16, paddingBottom: 16 + insets.bottom }}>
          <View style={s.kpiGrid}>
            {renderKpi({
              label: "Mis ventas hoy",
              value: d ? String(d.misVentasHoy) : "—",
              hint: "Ingresadas hoy",
              onPress: () => router.push("/ventas" as any),
            })}
            {renderKpi({
              label: "Mis clientes",
              value: d ? String(d.misClientesCount) : "—",
              hint: "Activos asignados",
              onPress: () => router.push("/clientes" as any),
            })}
            {renderKpi({
              label: "Recetas",
              value: d ? String(d.recetasPendMes) : "—",
              hint: "Pendientes del mes",
              onPress: () => router.push("/(drawer)/recetas-pendientes" as any),
            })}
            {renderKpi({
              label: "CxC saldo",
              value: d ? fmtQ(d.cxcSaldoTotal) : "—",
              hint: d ? `Vencido: ${fmtQ(d.cxcSaldoVencido)}` : "",
              onPress: () => router.push("/cxc" as any),
            })}
          </View>

          <ListCard
            title="Recetas pendientes"
            action={{ label: "Ver", onPress: () => router.push("/(drawer)/recetas-pendientes" as any) }}
            colors={C}
          >
            {(d?.recetasPendList ?? []).length ? (
              (d?.recetasPendList ?? []).map((v) =>
                renderRowLink({
                  k: `rec-${v.id}`,
                  title: v.cliente_nombre ?? "—",
                  sub: `Fecha: ${fmtDate(v.fecha)}`,
                  onPress: () => router.push({ pathname: "/venta-detalle", params: { ventaId: String(v.id) } } as any),
                })
              )
            ) : (
              <Text style={[s.empty, { color: C.sub }]}>Sin recetas pendientes</Text>
            )}
          </ListCard>

          <ListCard title={`Ventas ${currentYear} (Ene-Dic)`} colors={C}>
            {d ? (
              <MiniLine
                values={d.ventasMes}
                year={currentYear}
                currentMonthIndex={month - 1}
                currentMonthLabel={mon}
                colors={C}
              />
            ) : (
              <Text style={[s.empty, { color: C.sub }]}>—</Text>
            )}
          </ListCard>

          <ListCard title={`Top productos global (${currentYear})`} colors={C}>
            {(d?.topProductos ?? []).length ? (
              <>
                <Bars items={(d?.topProductos ?? []).map((p) => ({ label: p.label, qty: p.qty }))} colors={C} />
              </>
            ) : (
              <Text style={[s.empty, { color: C.sub }]}>Sin ventas recientes</Text>
            )}
          </ListCard>
        </View>
      );
    }

    if (roleUp === "FACTURACION") {
      const d = factData;
      return (
        <View style={{ padding: 16, paddingBottom: 16 + insets.bottom }}>
          <View style={s.kpiGrid}>
            {renderKpi({
              label: "Pendientes",
              value: d ? String(d.pendientesCount) : "—",
              hint: "NUEVO sin anular",
              onPress: () => router.push("/ventas" as any),
            })}
            {renderKpi({
              label: "Ir a ventas",
              value: "Abrir",
              hint: "Pendiente facturar",
              onPress: () => router.push("/ventas" as any),
            })}
          </View>

          <ListCard title="Nuevos pendientes facturar" action={{ label: "Ventas", onPress: () => router.push("/ventas" as any) }} colors={C}>
            {(d?.pendientes ?? []).length ? (
              (d?.pendientes ?? []).map((v) =>
                renderRowLink({
                  k: `pend-${v.id}`,
                  title: v.cliente_nombre ?? "—",
                  sub: `Fecha: ${fmtDate(v.fecha)} • Vendedor: ${v.vendedor_codigo ?? "—"}`,
                  onPress: () => router.push({ pathname: "/venta-detalle", params: { ventaId: String(v.id) } } as any),
                })
              )
            ) : (
              <Text style={[s.empty, { color: C.sub }]}>Sin pendientes</Text>
            )}
          </ListCard>
        </View>
      );
    }

    return (
      <View style={{ padding: 16 }}>
        <View style={[s.notice, { borderColor: C.border, backgroundColor: C.card }]}> 
          <Text style={[s.noticeTitle, { color: C.text }]}>Sin dashboard</Text>
          <Text style={[s.noticeSub, { color: C.sub }]}>
            Este rol aun no tiene Inicio configurado.
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["bottom"]}>
      <ScrollView
        style={{ flex: 1, backgroundColor: C.bg }}
        contentContainerStyle={{ paddingBottom: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.tint as any} />}
      >
        {Header}
        {bgRefreshing && roleChecked && !refreshing ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <Text style={{ color: C.sub, fontWeight: "800" }}>Actualizando...</Text>
          </View>
        ) : null}
        {renderBody()}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  kicker: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 6,
    fontSize: 22,
    fontWeight: "900",
  },
  sub: { marginTop: 4, fontSize: 13, fontWeight: "700" },

  notice: { marginTop: 12, borderWidth: 1, borderRadius: 16, padding: 14 },
  noticeTitle: { fontSize: 15, fontWeight: "900" },
  noticeSub: { marginTop: 6, fontSize: 13, fontWeight: "700" },

  // Evita gap + % que causaba desalineación en web.
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
  kpiLabel: { fontSize: 12, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
  kpiValue: { marginTop: 8, fontSize: 18, fontWeight: "900" },
  kpiHint: { marginTop: 4, fontSize: 12, fontWeight: "700" },

  card: { marginTop: 12, borderWidth: 1, borderRadius: 16, padding: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: "900" },
  cardAction: { fontSize: 13, fontWeight: "900" },

  sectionKicker: { marginTop: 12, fontSize: 12, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },
  empty: { marginTop: 10, fontSize: 13, fontWeight: "700" },

  rowLink: {
    marginTop: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowTitle: { fontSize: 14, fontWeight: "900" },
  rowSub: { marginTop: 4, fontSize: 12, fontWeight: "700" },
  rowChevron: { fontSize: 20, fontWeight: "900" },

  barRow: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  barLabel: { width: 130, fontSize: 12, fontWeight: "800" },
  barTrack: { flex: 1, height: 10, borderRadius: 999, borderWidth: 1, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 999 },
  barValue: { width: 78, textAlign: "right", fontSize: 12, fontWeight: "900" },

  monthTotal: { marginTop: 10, fontSize: 13, fontWeight: "900" },

  lineTopRow: { marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
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
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  lineLabelBox: { flex: 1, alignItems: "center", justifyContent: "center", height: 40 },
  lineLabelRot: { width: 40, alignItems: "center", justifyContent: "center", transform: [{ rotateZ: "-90deg" }] },
  lineLabelText: { fontSize: 11, fontWeight: "900", textAlign: "center" },

  // (kv styles removed; no longer showing subtotal rows)
});
