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
  // Forzar referencia a Guatemala (-06) sin depender del tz del dispositivo.
  return new Date(Date.now() - 6 * 60 * 60 * 1000);
}

function gtYearMonth() {
  const gt = nowGt();
  return { year: gt.getUTCFullYear(), month: gt.getUTCMonth() + 1 };
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function gtTodayRangeIso() {
  const gt = nowGt();
  const y = gt.getUTCFullYear();
  const m = pad2(gt.getUTCMonth() + 1);
  const d = pad2(gt.getUTCDate());
  // Force Guatemala offset to match other screens.
  const base = `${y}-${m}-${d}`;
  return {
    desde: `${base}T00:00:00-06:00`,
    hasta: `${base}T23:59:59-06:00`,
  };
}

function gtMonthRangeIso(year: number, month: number) {
  const y = Number(year);
  const m = Math.max(1, Math.min(12, Number(month)));
  const mm = pad2(m);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dd = pad2(lastDay);
  const baseStart = `${y}-${mm}-01`;
  const baseEnd = `${y}-${mm}-${dd}`;
  return {
    desde: `${baseStart}T00:00:00-06:00`,
    hasta: `${baseEnd}T23:59:59-06:00`,
  };
}

function isoCutoffDaysFromNowGt(days: number) {
  const gt = nowGt();
  const d = new Date(Date.UTC(gt.getUTCFullYear(), gt.getUTCMonth(), gt.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  // Postgres usually accepts YYYY-MM-DD
  return d.toISOString().slice(0, 10);
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
    const { year, month } = gtYearMonth();
    const { desde: hoyDesde, hasta: hoyHasta } = gtTodayRangeIso();

    const { desde: mesDesde, hasta: mesHasta } = gtMonthRangeIso(year, month);

    const [solRes, recRes, cxcRes, hoyTotalRes, ventasMesRes] =
      await Promise.allSettled([
        supabase
          .from("vw_ventas_solicitudes_pendientes_admin")
          .select("venta_id", { head: true, count: "exact" }),
        supabase.rpc("rpc_ventas_receta_pendiente_por_mes", { p_year: year, p_month: month }),
        supabase.rpc("rpc_cxc_ventas"),
        supabase
          .from("ventas")
          .select("id", { head: true, count: "exact" })
          .gte("fecha", hoyDesde)
          .lte("fecha", hoyHasta),
        supabase
          .from("ventas")
          .select("id,vendedor_id,vendedor_codigo,fecha")
          .gte("fecha", mesDesde)
          .lte("fecha", mesHasta)
          .order("fecha", { ascending: false })
          .limit(5000),
      ]);

    // solicitudes
    const solicitudes =
      solRes.status === "fulfilled" ? Number(solRes.value?.count ?? 0) : 0;

    // recetas del mes
    let recetasPendMes = 0;
    if (recRes.status === "fulfilled") {
      const rows = (recRes.value?.data ?? []) as any[];
      recetasPendMes = (rows ?? []).filter((r: any) => r?.requiere_receta && !r?.receta_cargada).length;
    }

    // CxC totals
    let cxcSaldoTotal = 0;
    let cxcSaldoVencido = 0;
    if (cxcRes.status === "fulfilled") {
      const rows = (cxcRes.value?.data ?? []) as any[];
      const todayIso = isoCutoffDaysFromNowGt(0);
      (rows ?? []).forEach((r: any) => {
        const saldo = safeNumber(r?.saldo);
        cxcSaldoTotal += saldo;
        const fv = String(r?.fecha_vencimiento ?? "").slice(0, 10);
        if (saldo > 0 && fv && fv < todayIso) cxcSaldoVencido += saldo;
      });
    }

    const getCount = (res: any) => (res?.status === "fulfilled" ? Number(res.value?.count ?? 0) : 0);
    const ventasHoyTotal = getCount(hoyTotalRes);

    // Total vendido del mes (por vendedor) - excluye ANULADO, sin filtrar por estado
    const ventasMesRaw = ventasMesRes.status === "fulfilled" ? ((ventasMesRes.value?.data ?? []) as any[]) : [];
    const ventaMeta = new Map<number, { vendedor_id: string | null; vendedor_codigo: string | null }>();
    const idsAll = (ventasMesRaw ?? [])
      .map((r: any) => {
        const id = Number(r?.id);
        if (!Number.isFinite(id) || id <= 0) return null;
        const vendedor_id = r?.vendedor_id != null ? String(r.vendedor_id) : null;
        const vendedor_codigo = r?.vendedor_codigo != null ? String(r.vendedor_codigo) : null;
        ventaMeta.set(id, { vendedor_id, vendedor_codigo });
        return id;
      })
      .filter((x) => x != null) as number[];

    let ids = idsAll;
    if (idsAll.length) {
      const anulado = new Set<number>();
      const CHUNK = 650;
      for (let i = 0; i < idsAll.length; i += CHUNK) {
        const part = idsAll.slice(i, i + CHUNK);
        const { data: trows } = await supabase
          .from("ventas_tags")
          .select("venta_id,tag")
          .in("venta_id", part)
          .is("removed_at", null);

        (trows ?? []).forEach((tr: any) => {
          const vid = Number(tr?.venta_id);
          const tag = String(tr?.tag ?? "").trim().toUpperCase();
          if (Number.isFinite(vid) && vid > 0 && tag === "ANULADO") anulado.add(vid);
        });
      }
      if (anulado.size) ids = idsAll.filter((x) => !anulado.has(x));
    }

    const montoByVendor = new Map<string, { monto: number; vendedor_id: string | null; vendedor_codigo: string | null }>();
    const keyOf = (vendedor_id: string | null) => (vendedor_id ? vendedor_id : "__NONE__");

    if (ids.length) {
      const CHUNK = 650;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const part = ids.slice(i, i + CHUNK);
        const { data: drows, error } = await supabase
          .from("ventas_detalle")
          .select("venta_id,subtotal,cantidad,precio_venta_unit")
          .in("venta_id", part);
        if (error) throw error;
        (drows ?? []).forEach((dr: any) => {
          const vid = Number(dr?.venta_id);
          if (!Number.isFinite(vid) || vid <= 0) return;
          const meta = ventaMeta.get(vid);
          const vendedor_id = meta?.vendedor_id ?? null;
          const vendedor_codigo = meta?.vendedor_codigo ?? null;
          const key = keyOf(vendedor_id);
          const sub = dr?.subtotal;
          const amount = sub != null ? safeNumber(sub) : safeNumber(dr?.cantidad) * safeNumber(dr?.precio_venta_unit);
          const prev = montoByVendor.get(key) ?? { monto: 0, vendedor_id, vendedor_codigo };
          prev.monto = safeNumber(prev.monto) + safeNumber(amount);
          if (!prev.vendedor_codigo && vendedor_codigo) prev.vendedor_codigo = vendedor_codigo;
          montoByVendor.set(key, prev);
        });
      }
    }

    const vendorIds = Array.from(montoByVendor.values())
      .map((x) => x.vendedor_id)
      .filter((x): x is string => !!x);
    const uniqueVendorIds = Array.from(new Set(vendorIds));

    const nameById = new Map<string, string>();
    if (uniqueVendorIds.length) {
      const CHUNK = 350;
      for (let i = 0; i < uniqueVendorIds.length; i += CHUNK) {
        const part = uniqueVendorIds.slice(i, i + CHUNK);
        const { data } = await supabase.from("profiles").select("id,full_name").in("id", part);
        (data ?? []).forEach((p: any) => {
          const id = String(p?.id ?? "");
          const nm = pickNameFromProfile(p);
          if (id && nm) nameById.set(id, nm);
        });
      }
    }

    const ventasMesPorVendedor: VendedorMesTotal[] = Array.from(montoByVendor.values())
      .map((x) => {
        const vendedor_id = x.vendedor_id;
        const vendedor_codigo = x.vendedor_codigo ?? null;
        const nombre =
          (vendedor_id ? nameById.get(vendedor_id) : "") ||
          (vendedor_codigo ? String(vendedor_codigo) : "") ||
          (vendedor_id ? String(vendedor_id).slice(0, 8) : "") ||
          "Sin vendedor";
        return {
          vendedor_id,
          vendedor_codigo,
          vendedor_nombre: nombre,
          monto: safeNumber(x.monto),
        };
      })
      .filter((r) => r.monto > 0)
      .sort((a, b) => b.monto - a.monto);

    const ventasMesTotal = ventasMesPorVendedor.reduce((acc, r) => acc + safeNumber(r.monto), 0);

    const out: AdminData = {
      solicitudes,
      recetasPendMes,
      ventasHoyTotal,
      cxcSaldoTotal,
      cxcSaldoVencido,
      ventasMesTotal,
      ventasMesPorVendedor,
    };
    return out;
  }, []);

  const loadVentas = useCallback(async (userId: string) => {
    const { year, month } = gtYearMonth();
    const { desde: hoyDesde, hasta: hoyHasta } = gtTodayRangeIso();

    const yearStart = `${year}-01-01T00:00:00-06:00`;
    const yearEnd = `${year}-12-31T23:59:59-06:00`;

    const [ventasHoyRes, clientesCountRes, cxcRes, recRes, yearVentasRes] = await Promise.allSettled([
      supabase
        .from("ventas")
        .select("id", { head: true, count: "exact" })
        .eq("vendedor_id", userId)
        .gte("fecha", hoyDesde)
        .lte("fecha", hoyHasta),
      supabase
        .from("clientes")
        .select("id", { head: true, count: "exact" })
        .eq("activo", true)
        .eq("vendedor_id", userId),
      supabase.rpc("rpc_cxc_ventas", { p_vendedor_id: userId }),
      supabase.rpc("rpc_ventas_receta_pendiente_por_mes", { p_year: year, p_month: month }),
      supabase
        .from("ventas")
        .select("id,fecha")
        .eq("vendedor_id", userId)
        .gte("fecha", yearStart)
        .lte("fecha", yearEnd)
        .order("fecha", { ascending: false })
        .limit(5000),
    ]);

    const misVentasHoy =
      ventasHoyRes.status === "fulfilled" ? Number(ventasHoyRes.value?.count ?? 0) : 0;

    const misClientesCount =
      clientesCountRes.status === "fulfilled" ? Number(clientesCountRes.value?.count ?? 0) : 0;

    // Totales por mes (monto) - anio en curso
    const ventasMes = Array.from({ length: 12 }).map(() => 0);
    if (yearVentasRes.status === "fulfilled") {
      const vrows = (yearVentasRes.value?.data ?? []) as any[];
      const mapMonth = new Map<number, number>();
      const idsAll = (vrows ?? [])
        .map((r) => {
          const id = Number(r?.id);
          const fecha = String(r?.fecha ?? "");
          if (Number.isFinite(id) && id > 0 && fecha.length >= 7) {
            const mm = Number(fecha.slice(5, 7));
            const idx = Number.isFinite(mm) && mm >= 1 && mm <= 12 ? mm - 1 : null;
            if (idx != null) mapMonth.set(id, idx);
          }
          return Number(r?.id);
        })
        .filter((id) => Number.isFinite(id) && id > 0) as number[];

      // Excluir ANULADO (si existe tag)
      let ids = idsAll;
      if (idsAll.length) {
        const { data: trows } = await supabase
          .from("ventas_tags")
          .select("venta_id,tag")
          .in("venta_id", idsAll)
          .is("removed_at", null);

        const anulado = new Set<number>();
        (trows ?? []).forEach((tr: any) => {
          const vid = Number(tr?.venta_id);
          const tag = String(tr?.tag ?? "").trim().toUpperCase();
          if (Number.isFinite(vid) && vid > 0 && tag === "ANULADO") anulado.add(vid);
        });
        if (anulado.size) ids = idsAll.filter((x) => !anulado.has(x));
      }

      if (ids.length) {
        const { data: drows } = await supabase
          .from("ventas_detalle")
          .select("venta_id,subtotal,cantidad,precio_venta_unit")
          .in("venta_id", ids);

        (drows ?? []).forEach((dr: any) => {
          const vid = Number(dr?.venta_id);
          const midx = mapMonth.get(vid);
          if (midx == null) return;
          const sub = dr?.subtotal;
          const amount = sub != null
            ? safeNumber(sub)
            : safeNumber(dr?.cantidad) * safeNumber(dr?.precio_venta_unit);
          ventasMes[midx] = safeNumber(ventasMes[midx]) + safeNumber(amount);
        });
      }
    }

    let cxcSaldoTotal = 0;
    let cxcSaldoVencido = 0;
    if (cxcRes.status === "fulfilled") {
      const rows = (cxcRes.value?.data ?? []) as any[];
      const todayIso = isoCutoffDaysFromNowGt(0);
      (rows ?? []).forEach((r: any) => {
        const saldo = safeNumber(r?.saldo);
        cxcSaldoTotal += saldo;
        const fv = String(r?.fecha_vencimiento ?? "").slice(0, 10);
        if (saldo > 0 && fv && fv < todayIso) cxcSaldoVencido += saldo;
      });
    }

    let recetasPendMes = 0;
    let recetasPendList: VentaMini[] = [];
    if (recRes.status === "fulfilled") {
      const rows = (recRes.value?.data ?? []) as any[];
      const mine = (rows ?? [])
        .filter((r: any) => String(r?.vendedor_id ?? "") === userId)
        .filter((r: any) => r?.requiere_receta && !r?.receta_cargada);
      recetasPendMes = mine.length;
      recetasPendList = mine
        .sort((a: any, b: any) => String(b?.fecha ?? "").localeCompare(String(a?.fecha ?? "")))
        .slice(0, 5)
        .map((r: any) => ({
          id: Number(r?.id ?? 0),
          fecha: r?.fecha ?? null,
          cliente_nombre: r?.cliente_nombre ?? null,
          vendedor_codigo: r?.vendedor_codigo ?? null,
          vendedor_id: r?.vendedor_id ?? null,
          requiere_receta: !!r?.requiere_receta,
          receta_cargada: !!r?.receta_cargada,
        }));
    }

    // Top productos global (anio en curso)
    let topProductos: { label: string; qty: number }[] = [];
    {
      const PAGE = 4000;
      const MAX_PAGES = 6; // hard cap: 24k rows
      const agg = new Map<string, { label: string; qty: number }>();

      for (let page = 0; page < MAX_PAGES; page++) {
        const from = page * PAGE;
        const to = from + PAGE - 1;

        // Join ventas_detalle -> ventas para filtrar por fecha.
        // Nota: depende de FK ventas_detalle.venta_id -> ventas.id.
        const { data: drows, error } = await supabase
          .from("ventas_detalle")
          .select("producto_id,cantidad,productos(nombre,marcas(nombre)),ventas!inner(fecha)")
          .gte("ventas.fecha", yearStart)
          .lte("ventas.fecha", yearEnd)
          .range(from, to);

        if (error) throw error;
        const rows = (drows ?? []) as any[];
        if (!rows.length) break;

        rows.forEach((r: any) => {
          const pname = String(r?.productos?.nombre ?? "").trim();
          const marca = String(r?.productos?.marcas?.nombre ?? "").trim();
          const label = pname ? `${pname}${marca ? ` • ${marca}` : ""}` : "Producto";
          const key = String(r?.producto_id ?? label);
          const prev = agg.get(key) ?? { label, qty: 0 };
          prev.qty += safeNumber(r?.cantidad);
          agg.set(key, prev);
        });

        if (rows.length < PAGE) break;
      }

      topProductos = Array.from(agg.values())
        .filter((x) => x.qty > 0)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 10);
    }

    const out: VentasData = {
      misVentasHoy,
      misClientesCount,
      recetasPendMes,
      recetasPendList,
      cxcSaldoTotal,
      cxcSaldoVencido,
      ventasMes,
      topProductos,
    };
    return out;
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

  const Bars = ({ items, valueFmt }: { items: { label: string; qty: number }[]; valueFmt?: (n: number) => string }) => {
    const max = Math.max(1, ...items.map((i) => i.qty));
    return (
      <View style={{ marginTop: 10 }}>
        {items.map((it, idx) => {
          const pct = Math.max(0, Math.min(1, it.qty / max));
          return (
            <View key={`${it.label}-${idx}`} style={s.barRow}>
              <Text style={[s.barLabel, { color: C.sub }]} numberOfLines={1}>
                {it.label}
              </Text>
              <View style={[s.barTrack, { backgroundColor: C.chipBg, borderColor: C.border }]}> 
                <View style={[s.barFill, { backgroundColor: C.tint, width: `${Math.round(pct * 100)}%` }]} />
              </View>
              <Text style={[s.barValue, { color: C.text }]} numberOfLines={1}>
                {valueFmt ? valueFmt(it.qty) : it.qty}
              </Text>
            </View>
          );
        })}
      </View>
    );
  };

  const MiniLine = ({
    values,
    year,
    currentMonthIndex,
    currentMonthLabel,
  }: {
    values: number[];
    year: number;
    currentMonthIndex: number;
    currentMonthLabel: string;
  }) => {
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
          <Text style={[s.lineMeta, { color: C.sub }]}>
            Total {currentMonthLabel} {year}: {fmtQ(monthTotal)}
          </Text>
          <Text style={[s.lineMeta, { color: C.sub }]}>Max: {fmtQ(maxV)}</Text>
        </View>

        <View
          style={[s.lineChart, { borderColor: C.border, backgroundColor: C.chipBg }]}
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
                        backgroundColor: C.tint,
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
                      backgroundColor: C.card,
                      borderColor: C.tint,
                    },
                  ]}
                />
              ))
            : null}
        </View>

        <View style={s.lineLabelsRow}>
          {monthLabels.map((m, i) => (
            <View key={`m-${i}`} style={s.lineLabelBox}>
              <View style={s.lineLabelRot}>
                <Text style={[s.lineLabelText, { color: C.sub }]} numberOfLines={1}>
                  {m}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  };

  const monthAbbr = useMemo(() => ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"], []);

  const ListCard = ({
    title,
    action,
    children,
  }: {
    title: string;
    action?: { label: string; onPress: () => void };
    children: React.ReactNode;
  }) => (
    <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}> 
      <View style={s.cardHeader}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.cardTitle, { color: C.text }]} numberOfLines={1} ellipsizeMode="tail">
            {title}
          </Text>
        </View>
        {action ? (
          <Pressable onPress={action.onPress} style={({ pressed }) => [pressed ? { opacity: 0.85 } : null]}>
            <Text style={[s.cardAction, { color: C.tint }]}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );

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

  const renderSkeleton = () => {
    const sk =
      alphaColor(String(C.text), isDark ? 0.1 : 0.08) ||
      (isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)");

    const SkBlock = ({ w, h, r }: { w: number | `${number}%`; h: number; r?: number }) => (
      <View
        style={{
          width: w,
          height: h,
          borderRadius: r ?? 10,
          backgroundColor: sk,
        }}
      />
    );

    const SkKpi = () => (
      <View style={[s.kpi, { borderColor: C.border, backgroundColor: C.card }]}>
        <SkBlock w="62%" h={12} r={8} />
        <View style={{ height: 10 }} />
        <SkBlock w="46%" h={18} r={10} />
        <View style={{ height: 8 }} />
        <SkBlock w="72%" h={12} r={8} />
      </View>
    );

    const SkCard = () => (
      <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
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
  };

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
    if (showSkeleton) return renderSkeleton();

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
              onPress: () => router.push("/ventas-solicitudes" as any),
            })}
            {renderKpi({
              label: "Recetas",
              value: d ? String(d.recetasPendMes) : "—",
              hint: "Pendientes del mes",
              onPress: () => router.push("/recetas-pendientes" as any),
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
          >
            <Text style={[s.monthTotal, { color: C.sub }]} numberOfLines={1}>
              Total mes: {d ? fmtQ(d.ventasMesTotal) : "—"}
            </Text>
            {(d?.ventasMesPorVendedor ?? []).length ? (
              <Bars
                valueFmt={(n) => fmtQ(n).replace("Q ", "Q")}
                items={(d?.ventasMesPorVendedor ?? []).slice(0, 10).map((r) => ({ label: r.vendedor_nombre, qty: r.monto }))}
              />
            ) : (
              <Text style={[s.empty, { color: C.sub }]}>{d ? "Sin ventas este mes" : "—"}</Text>
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
              onPress: () => router.push("/recetas-pendientes" as any),
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
            action={{ label: "Ver", onPress: () => router.push("/recetas-pendientes" as any) }}
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

          <ListCard title={`Ventas ${currentYear} (Ene-Dic)`}>
            {d ? (
              <MiniLine
                values={d.ventasMes}
                year={currentYear}
                currentMonthIndex={month - 1}
                currentMonthLabel={mon}
              />
            ) : (
              <Text style={[s.empty, { color: C.sub }]}>—</Text>
            )}
          </ListCard>

          <ListCard title={`Top productos global (${currentYear})`}>
            {(d?.topProductos ?? []).length ? (
              <>
                <Bars items={(d?.topProductos ?? []).map((p) => ({ label: p.label, qty: p.qty }))} />
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

          <ListCard title="Nuevos pendientes facturar" action={{ label: "Ventas", onPress: () => router.push("/ventas" as any) }}>
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
