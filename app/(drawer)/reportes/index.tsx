import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Calendar, DateData } from "react-native-calendars";
import { SafeAreaView } from "react-native-safe-area-context";

import { RoleGate } from "@/components/auth/RoleGate";
import { ReportCard } from "@/components/reporting/ReportCard";
import { AppButton } from "@/components/ui/app-button";
import { exportSimpleXlsx } from "@/lib/reporting/exportXlsx";
import { fmtDateYmd } from "@/lib/reporting/share";
import { supabase } from "@/lib/supabase";
import { useGoHomeOnBack } from "@/lib/useGoHomeOnBack";
import { useRole } from "@/lib/useRole";
import { useEmpresaActiva } from "@/lib/useEmpresaActiva";

type AuditLogRow = {
  registrado: string;
  action: string | null;
  actor_nombre: string | null;
  cliente_nombre: string | null;
  monto: number | null;
  metodo: string | null;
  referencia: string | null;
  comentario: string | null;
  factura_numero: string | null;
};

type UtilidadRow = {
  producto_nombre: string | null;
  marca_nombre: string | null;
  unidades_vendidas: number | string | null;
  total_ventas: number | string | null;
  costo_total: number | string | null;
  utilidad_bruta: number | string | null;
  margen_pct: number | string | null;
  participacion_utilidad_pct: number | string | null;
};

type UtilidadExportRow = {
  producto_nombre: string;
  marca_nombre: string;
  unidades_vendidas: number | null;
  total_ventas: number | null;
  costo_total: number | null;
  utilidad_bruta: number | null;
  margen_pct: number | null;
  participacion_utilidad_pct: number | null;
};

type UtilidadGlobalRow = {
  total_ventas: number | null;
  costo_total: number | null;
  utilidad_bruta: number | null;
  margen_pct: number | null;
};

type BajoMovimientoRow = {
  producto_id: number | null;
  producto_nombre: string | null;
  marca_nombre: string | null;
  stock_disponible: number | string | null;
  ultima_venta: string | null;
  dias_sin_movimiento: number | string | null;
  ultimo_costo_unit: number | string | null;
  valor_inventario: number | string | null;
};

type BajoMovimientoExportRow = {
  producto_nombre: string;
  marca_nombre: string;
  stock_disponible: number | null;
  ultima_venta: string;
  dias_sin_movimiento: number | null;
  ultimo_costo_unit: number | null;
  valor_inventario: number | null;
};

// Returned by rpc_report_cxc_por_factura — one row per factura
type CxcPorFacturaRow = {
  venta_id: number;
  fecha: string | null;
  fecha_vencimiento: string | null;
  cliente_nombre: string | null;
  vendedor_codigo: string | null;
  numero_factura: string | null;
  monto_total: number | string | null;
  pagado: number | string | null;
  saldo: number | string | null;
  estado: string | null;
};

type CxcReportExportRow = {
  fecha: string;
  fecha_vencimiento: string;
  cliente_nombre: string;
  numero_factura: string;
  vendedor: string;
  monto_total: number | null;
  pagado: number | null;
  saldo: number | null;
  estado_pago: string;
  estado_venta: string;
};

type CxpRow = {
  id: number;
  fecha: string | null;
  proveedor: string | null;
  numero_factura: string | null;
  tipo_pago: string | null;
  fecha_vencimiento: string | null;
  monto_total: number | string | null;
  saldo_pendiente: number | string | null;
  estado: string | null;
};

type CxpExportRow = {
  fecha: string;
  fecha_vencimiento: string;
  proveedor: string;
  numero_factura: string;
  tipo_pago: string;
  monto_total: number | null;
  pagado: number | null;
  saldo: number | null;
  estado_pago: string;
  estado_compra: string;
};

type FooterState = {
  error: string | null;
  warning: string | null;
  info: string | null;
};

const MAX_ROWS = 5000;
const MIN_DIAS_OPTIONS = [7, 15, 30, 60];
const CXC_ESTADO_OPTIONS: { value: "ALL" | "PENDIENTE" | "VENCIDA"; label: string }[] = [
  { value: "ALL", label: "Todas" },
  { value: "PENDIENTE", label: "Pendientes" },
  { value: "VENCIDA", label: "Vencidas" },
];
const CXP_ESTADO_OPTIONS: { value: "ALL" | "PENDIENTE" | "VENCIDA"; label: string }[] = [
  { value: "ALL", label: "Todas" },
  { value: "PENDIENTE", label: "Pendientes" },
  { value: "VENCIDA", label: "Vencidas" },
];

function makeEmptyStatus(): FooterState {
  return { error: null, warning: null, info: null };
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function lastDaysRange(days: number) {
  const today = new Date();
  const hasta = endOfDay(today);
  const desde = startOfDay(new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
  return { desde, hasta };
}

function fmtDateLabel(date: Date | null) {
  if (!date) return "—";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${d}/${m}/${y}`;
}

function fmtCalendarDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseCalendarDate(dateString: string) {
  const [y, m, d] = dateString.split("-").map((v) => Number(v));
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function safeNumber(value: any) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundToTwoDecimals(value: any) {
  const n = safeNumber(value);
  if (n === null) return null;
  return Number(n.toFixed(2));
}

function isPostgrestError(error: any) {
  return (
    !!error &&
    typeof error === "object" &&
    ("code" in error || "details" in error || "hint" in error)
  );
}

export default function ReportesScreen() {
  const { colors, dark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const calendarTheme = useMemo(
    () => ({
      backgroundColor: colors.card,
      calendarBackground: colors.card,
      dayTextColor: colors.text,
      monthTextColor: colors.text,
      textSectionTitleColor: colors.text,
      textDisabledColor: colors.border,
      arrowColor: colors.primary,
      todayTextColor: colors.primary,
      selectedDayBackgroundColor: colors.primary,
      selectedDayTextColor: "#fff",
    }),
    [colors]
  );
  const pickerThemeVariant = dark ? "dark" : "light";

  useGoHomeOnBack(true, "/(drawer)/(tabs)");

  const { refreshRole } = useRole();
  const { empresaActivaId } = useEmpresaActiva();
  useFocusEffect(
    useCallback(() => {
      void refreshRole("focus:reportes");
    }, [refreshRole])
  );

  const initialRange = useMemo(() => lastDaysRange(7), []);
  const [desde, setDesde] = useState<Date>(initialRange.desde);
  const [hasta, setHasta] = useState<Date>(initialRange.hasta);
  const [activePicker, setActivePicker] = useState<"desde" | "hasta" | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatingUtilidad, setGeneratingUtilidad] = useState(false);
  const [generatingBajoMovimiento, setGeneratingBajoMovimiento] = useState(false);
  const [minDias, setMinDias] = useState<number>(15);
  const [auditStatus, setAuditStatus] = useState<FooterState>(() => makeEmptyStatus());
  const [utilidadStatus, setUtilidadStatus] = useState<FooterState>(() => makeEmptyStatus());
  const [bajoMovimientoStatus, setBajoMovimientoStatus] = useState<FooterState>(() => makeEmptyStatus());
  const [generatingCxc, setGeneratingCxc] = useState(false);
  const [cxcStatus, setCxcStatus] = useState<FooterState>(() => makeEmptyStatus());
  const [cxcEstado, setCxcEstado] = useState<"ALL" | "PENDIENTE" | "VENCIDA">("ALL");
  const [cxcSummary, setCxcSummary] = useState<{ count: number; saldo: number } | null>(null);
  const [generatingCxp, setGeneratingCxp] = useState(false);
  const [cxpStatus, setCxpStatus] = useState<FooterState>(() => makeEmptyStatus());
  const [cxpEstado, setCxpEstado] = useState<"ALL" | "PENDIENTE" | "VENCIDA">("ALL");
  const [cxpSummary, setCxpSummary] = useState<{ count: number; saldo: number } | null>(null);
  const [utilidadGlobal, setUtilidadGlobal] = useState<UtilidadGlobalRow | null>(null);
  const [utilidadGlobalAttempted, setUtilidadGlobalAttempted] = useState(false);

  useEffect(() => {
    setUtilidadGlobal(null);
    setUtilidadGlobalAttempted(false);
  }, [desde, hasta]);

  const openPicker = (target: "desde" | "hasta") => {
    if (Platform.OS === "android") {
      const currentValue = target === "desde" ? desde : hasta;
      const androidOptions: any = {
        value: currentValue,
        mode: "date",
        onChange: (_event: unknown, date?: Date) => {
          if (!date) return;
          if (target === "desde") {
            const next = startOfDay(date);
            setDesde(next);
            if (next.getTime() > hasta.getTime()) {
              setHasta(endOfDay(date));
            }
          } else {
            const next = endOfDay(date);
            setHasta(next);
            if (next.getTime() < desde.getTime()) {
              setDesde(startOfDay(date));
            }
          }
        },
        themeVariant: pickerThemeVariant,
      };
      DateTimePickerAndroid.open(androidOptions);
      return;
    }
    setActivePicker(target);
  };

  const closePicker = () => setActivePicker(null);

  const handleCalendarSelect = (day: DateData) => {
    if (!activePicker) return;
    const selected = parseCalendarDate(day.dateString);
    if (activePicker === "desde") {
      const next = startOfDay(selected);
      setDesde(next);
      if (next.getTime() > hasta.getTime()) {
        setHasta(endOfDay(selected));
      }
    } else {
      const next = endOfDay(selected);
      setHasta(next);
      if (next.getTime() < desde.getTime()) {
        setDesde(startOfDay(selected));
      }
    }
    closePicker();
  };

  const handleDownload = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setAuditStatus(makeEmptyStatus());

    const fromIso = startOfDay(desde).toISOString();
    const toIso = endOfDay(hasta).toISOString();

    try {
      if (!empresaActivaId) return;
      const { data, error } = await supabase
        .from("vw_ventas_pagos_log")
        .select(
          "registrado,action,actor_nombre,cliente_nombre,monto,metodo,referencia,comentario,factura_numero"
        )
        .eq("empresa_id", empresaActivaId)
        .gte("registrado", fromIso)
        .lte("registrado", toIso)
        .order("registrado", { ascending: false })
        .limit(MAX_ROWS + 1);

      if (error) throw error;

      const rows = (data ?? []) as AuditLogRow[];
      if (rows.length === 0) {
        setAuditStatus({ error: "No hay movimientos en ese rango.", warning: null, info: null });
        return;
      }

      const truncated = rows.length > MAX_ROWS;
      const trimmed = truncated ? rows.slice(0, MAX_ROWS) : rows;

      const formatted = trimmed.map((row) => ({
        ...row,
        monto: safeNumber(row.monto),
      }));

      const fileStem = `reporte_auditoria_pagos_${fmtDateYmd(desde)}_${fmtDateYmd(hasta)}`;

      await exportSimpleXlsx<AuditLogRow>({
        title: "Auditoría pagos",
        fileName: fileStem,
        sheetName: "Pagos",
        columns: [
          { key: "registrado", header: "Registrado", value: (r) => fmtDateTime(r.registrado) },
          { key: "action", header: "Acción", value: (r) => String(r.action ?? "") },
          { key: "cliente_nombre", header: "Cliente", value: (r) => r.cliente_nombre ?? "" },
          { key: "factura_numero", header: "Factura", value: (r) => r.factura_numero ?? "" },
          { key: "monto", header: "Monto", value: (r) => r.monto ?? "" },
          { key: "metodo", header: "Método", value: (r) => r.metodo ?? "" },
          { key: "referencia", header: "Referencia", value: (r) => r.referencia ?? "" },
          { key: "comentario", header: "Comentario", value: (r) => r.comentario ?? "" },
          { key: "actor_nombre", header: "Usuario", value: (r) => r.actor_nombre ?? "" },
        ],
        rows: formatted,
      });

      setAuditStatus({
        error: null,
        info: `Se exportaron ${trimmed.length} movimientos.`,
        warning: truncated
          ? `Se limitó el resultado a ${MAX_ROWS} filas. Ajusta el rango si necesitas todo.`
          : null,
      });
    } catch (e: any) {
      if (__DEV__) console.log("[reportes] error exportando auditoría", e);
      if (isPostgrestError(e)) {
        setAuditStatus({ error: `${e.code ?? ""} - ${e.message ?? ""}`, warning: null, info: null });
      } else {
        setAuditStatus({ error: e?.message ?? "Error desconocido", warning: null, info: null });
      }
    } finally {
      setGenerating(false);
    }
  }, [desde, hasta, generating, empresaActivaId]);

  const handleDownloadUtilidad = useCallback(async () => {
    if (generatingUtilidad) return;
    setGeneratingUtilidad(true);
    setUtilidadStatus(makeEmptyStatus());

    const fromIso = startOfDay(desde).toISOString();
    const toIso = endOfDay(hasta).toISOString();

    try {
      if (!empresaActivaId) return;
      const [productosResult, globalResult] = await Promise.all([
        supabase.rpc("rpc_reporte_utilidad_productos_v3", { p_empresa_id: empresaActivaId, p_desde: fromIso, p_hasta: toIso }),
        supabase.rpc("rpc_reporte_utilidad_global_v1", { p_empresa_id: empresaActivaId, p_desde: fromIso, p_hasta: toIso }),
      ]);

      if (productosResult.error) throw productosResult.error;

      // Parse global summary — never blocks product export if it fails
      let globalSummary: UtilidadGlobalRow | null = null;
      if (!globalResult.error && globalResult.data) {
        const raw = Array.isArray(globalResult.data) ? globalResult.data[0] : globalResult.data;
        if (raw) {
          const r = raw as Record<string, unknown>;
          globalSummary = {
            total_ventas: safeNumber(r.total_ventas),
            costo_total: safeNumber(r.costo_total),
            utilidad_bruta: safeNumber(r.utilidad_bruta),
            margen_pct: safeNumber(r.margen_pct),
          };
        }
      }
      setUtilidadGlobal(globalSummary);
      setUtilidadGlobalAttempted(true);

      const rows = (productosResult.data ?? []) as UtilidadRow[];
      if (rows.length === 0) {
        setUtilidadStatus({ error: "No hay datos en ese rango.", warning: null, info: null });
        return;
      }

      const truncated = rows.length > MAX_ROWS;
      const trimmed = truncated ? rows.slice(0, MAX_ROWS) : rows;

      const formatted: UtilidadExportRow[] = trimmed.map((row) => ({
        producto_nombre: row.producto_nombre ?? "",
        marca_nombre: row.marca_nombre ?? "",
        unidades_vendidas: safeNumber(row.unidades_vendidas),
        total_ventas: safeNumber(row.total_ventas),
        costo_total: safeNumber(row.costo_total),
        utilidad_bruta: safeNumber(row.utilidad_bruta),
        margen_pct: roundToTwoDecimals(row.margen_pct),
        participacion_utilidad_pct: roundToTwoDecimals(row.participacion_utilidad_pct),
      }));

      const exportRows: UtilidadExportRow[] = [...formatted];
      if (globalSummary) {
        exportRows.push({
          producto_nombre: "TOTAL",
          marca_nombre: "",
          unidades_vendidas: null,
          total_ventas: globalSummary.total_ventas,
          costo_total: globalSummary.costo_total,
          utilidad_bruta: globalSummary.utilidad_bruta,
          margen_pct: roundToTwoDecimals(globalSummary.margen_pct),
          participacion_utilidad_pct: null,
        });
      }

      const fileStem = `reporte_utilidad_productos_${fmtDateYmd(desde)}_${fmtDateYmd(hasta)}`;

      await exportSimpleXlsx<UtilidadExportRow>({
        title: "Utilidad por producto",
        fileName: fileStem,
        sheetName: "Utilidad",
        columns: [
          { key: "producto_nombre", header: "Producto", value: (r) => r.producto_nombre },
          { key: "marca_nombre", header: "Marca", value: (r) => r.marca_nombre },
          { key: "unidades_vendidas", header: "Unidades vendidas", value: (r) => r.unidades_vendidas ?? "" },
          { key: "total_ventas", header: "Total ventas", value: (r) => r.total_ventas ?? "" },
          { key: "costo_total", header: "Costo total", value: (r) => r.costo_total ?? "" },
          { key: "utilidad_bruta", header: "Utilidad bruta", value: (r) => r.utilidad_bruta ?? "" },
          { key: "margen_pct", header: "Margen %", value: (r) => r.margen_pct ?? "" },
          {
            key: "participacion_utilidad_pct",
            header: "% Participación utilidad",
            value: (r) => r.participacion_utilidad_pct ?? "",
          },
        ],
        rows: exportRows,
      });

      setUtilidadStatus({
        error: null,
        info: `Se exportaron ${trimmed.length} productos.`,
        warning: truncated
          ? `Se limitó el resultado a ${MAX_ROWS} filas. Ajusta el rango si necesitas todo.`
          : null,
      });
    } catch (e: any) {
      if (__DEV__) console.log("[reportes] error exportando utilidad productos", e);
      if (isPostgrestError(e)) {
        setUtilidadStatus({ error: `${e.code ?? ""} - ${e.message ?? ""}`, warning: null, info: null });
      } else {
        setUtilidadStatus({ error: e?.message ?? "Error desconocido", warning: null, info: null });
      }
    } finally {
      setGeneratingUtilidad(false);
    }
  }, [desde, empresaActivaId, hasta, generatingUtilidad]);

  const handleDownloadBajoMovimiento = useCallback(async () => {
    if (generatingBajoMovimiento) return;
    setGeneratingBajoMovimiento(true);
    setBajoMovimientoStatus(makeEmptyStatus());

    const toIso = endOfDay(hasta).toISOString();

    try {
      if (!empresaActivaId) return;
      const { data, error } = await supabase.rpc("rpc_reporte_bajo_movimiento", {
        p_empresa_id: empresaActivaId,
        p_hasta: toIso,
        p_min_dias: minDias,
      });

      if (error) throw error;

      const rows = (data ?? []) as BajoMovimientoRow[];
      if (rows.length === 0) {
        setBajoMovimientoStatus({
          error: "No hay productos con stock y sin movimiento para ese filtro.",
          warning: null,
          info: null,
        });
        return;
      }

      const truncated = rows.length > MAX_ROWS;
      const trimmed = truncated ? rows.slice(0, MAX_ROWS) : rows;

      const formatted: BajoMovimientoExportRow[] = trimmed.map((row) => ({
        producto_nombre: row.producto_nombre ?? "",
        marca_nombre: row.marca_nombre ?? "",
        stock_disponible: safeNumber(row.stock_disponible),
        ultima_venta: fmtDateTime(row.ultima_venta),
        dias_sin_movimiento: safeNumber(row.dias_sin_movimiento),
        ultimo_costo_unit: safeNumber(row.ultimo_costo_unit),
        valor_inventario: safeNumber(row.valor_inventario),
      }));

      const fileStem = `reporte_bajo_movimiento_${fmtDateYmd(desde)}_${fmtDateYmd(hasta)}_${minDias}d`;

      await exportSimpleXlsx<BajoMovimientoExportRow>({
        title: "Productos con bajo movimiento",
        fileName: fileStem,
        sheetName: "Bajo movimiento",
        columns: [
          { key: "producto_nombre", header: "Producto", value: (r) => r.producto_nombre },
          { key: "marca_nombre", header: "Marca", value: (r) => r.marca_nombre },
          { key: "stock_disponible", header: "Stock", value: (r) => r.stock_disponible ?? "" },
          { key: "ultima_venta", header: "Última venta", value: (r) => r.ultima_venta },
          {
            key: "dias_sin_movimiento",
            header: "Días sin movimiento",
            value: (r) => r.dias_sin_movimiento ?? "",
          },
          {
            key: "ultimo_costo_unit",
            header: "Último costo unit",
            value: (r) => r.ultimo_costo_unit ?? "",
          },
          {
            key: "valor_inventario",
            header: "Valor inventario",
            value: (r) => r.valor_inventario ?? "",
          },
        ],
        rows: formatted,
      });

      setBajoMovimientoStatus({
        error: null,
        info: `Se exportaron ${trimmed.length} productos.`,
        warning: truncated
          ? `Se limitó el resultado a ${MAX_ROWS} filas. Ajusta el rango si necesitas todo.`
          : null,
      });
    } catch (e: any) {
      if (__DEV__) console.log("[reportes] error exportando bajo movimiento", e);
      if (isPostgrestError(e)) {
        setBajoMovimientoStatus({
          error: `${e.code ?? ""} - ${e.message ?? ""}`,
          warning: null,
          info: null,
        });
      } else {
        setBajoMovimientoStatus({
          error: e?.message ?? "Error desconocido",
          warning: null,
          info: null,
        });
      }
    } finally {
      setGeneratingBajoMovimiento(false);
    }
  }, [desde, empresaActivaId, hasta, generatingBajoMovimiento, minDias]);

  const handleDownloadCxc = useCallback(async () => {
    if (generatingCxc) return;
    setGeneratingCxc(true);
    setCxcStatus(makeEmptyStatus());
    setCxcSummary(null);

    try {
      if (!empresaActivaId) return;

      const { data, error } = await supabase.rpc("rpc_report_cxc_por_factura", {
        p_empresa_id: empresaActivaId,
      });

      if (error) throw error;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const fromTime = startOfDay(desde).getTime();
      const toTime = endOfDay(hasta).getTime();

      let rows = (data ?? []) as CxcPorFacturaRow[];

      // Filtrar por rango de fechas
      rows = rows.filter((r) => {
        if (!r.fecha) return false;
        const t = new Date(r.fecha).getTime();
        return t >= fromTime && t <= toTime;
      });

      // Filtrar por estado de pago
      if (cxcEstado !== "ALL") {
        rows = rows.filter((r) => {
          const saldo = safeNumber(r.saldo) ?? 0;
          if (saldo <= 0) return false; // ya pagada
          if (cxcEstado === "VENCIDA") {
            const vence = r.fecha_vencimiento ? new Date(r.fecha_vencimiento) : null;
            return vence != null && vence.getTime() < today.getTime();
          }
          // PENDIENTE = saldo > 0 y no vencida
          const vence = r.fecha_vencimiento ? new Date(r.fecha_vencimiento) : null;
          return vence == null || vence.getTime() >= today.getTime();
        });
      }

      if (rows.length === 0) {
        setCxcStatus({ error: "No hay cuentas por cobrar en ese rango.", warning: null, info: null });
        return;
      }

      const totalSaldo = rows.reduce((acc, r) => acc + (safeNumber(r.saldo) ?? 0), 0);
      setCxcSummary({ count: rows.length, saldo: totalSaldo });

      const truncated = rows.length > MAX_ROWS;
      const trimmed = truncated ? rows.slice(0, MAX_ROWS) : rows;

      const formatted: CxcReportExportRow[] = trimmed.map((r) => {
        const saldo = safeNumber(r.saldo) ?? 0;
        const vence = r.fecha_vencimiento ? new Date(r.fecha_vencimiento) : null;
        let estadoPago = "PAGADA";
        if (saldo > 0) {
          estadoPago = vence && vence.getTime() < today.getTime() ? "VENCIDA" : "PENDIENTE";
        }
        return {
          fecha: r.fecha ? fmtDateTime(r.fecha) : "",
          fecha_vencimiento: r.fecha_vencimiento ? fmtDateTime(r.fecha_vencimiento) : "",
          cliente_nombre: r.cliente_nombre ?? "",
          numero_factura: r.numero_factura ?? "",
          vendedor: r.vendedor_codigo ?? "",
          monto_total: safeNumber(r.monto_total),
          pagado: safeNumber(r.pagado),
          saldo: safeNumber(r.saldo),
          estado_pago: estadoPago,
          estado_venta: r.estado ?? "",
        };
      });

      const fileStem = `reporte_cxc_${fmtDateYmd(desde)}_${fmtDateYmd(hasta)}`;

      await exportSimpleXlsx<CxcReportExportRow>({
        title: "Cuentas por cobrar",
        fileName: fileStem,
        sheetName: "CxC",
        columns: [
          { key: "fecha",             header: "Fecha venta",    value: (r) => r.fecha },
          { key: "fecha_vencimiento", header: "Fecha vence",    value: (r) => r.fecha_vencimiento },
          { key: "cliente_nombre",    header: "Cliente",        value: (r) => r.cliente_nombre },
          { key: "numero_factura",    header: "Factura",        value: (r) => r.numero_factura },
          { key: "vendedor",          header: "Vendedor",       value: (r) => r.vendedor },
          { key: "monto_total",       header: "Total factura",  value: (r) => r.monto_total ?? "" },
          { key: "pagado",            header: "Pagado",         value: (r) => r.pagado ?? "" },
          { key: "saldo",             header: "Saldo pendiente",value: (r) => r.saldo ?? "" },
          { key: "estado_pago",       header: "Estado pago",    value: (r) => r.estado_pago },
          { key: "estado_venta",      header: "Estado venta",   value: (r) => r.estado_venta },
        ],
        rows: formatted,
      });

      setCxcStatus({
        error: null,
        info: `Se exportaron ${trimmed.length} filas. Saldo total: Q ${totalSaldo.toFixed(2)}`,
        warning: truncated
          ? `Se limitó el resultado a ${MAX_ROWS} filas. Ajusta el rango si necesitas todo.`
          : null,
      });
    } catch (e: any) {
      if (__DEV__) console.log("[reportes] error exportando CxC", e);
      if (isPostgrestError(e)) {
        setCxcStatus({ error: `${e.code ?? ""} - ${e.message ?? ""}`, warning: null, info: null });
      } else {
        setCxcStatus({ error: e?.message ?? "Error desconocido", warning: null, info: null });
      }
    } finally {
      setGeneratingCxc(false);
    }
  }, [generatingCxc, empresaActivaId, desde, hasta, cxcEstado]);

  const handleDownloadCxp = useCallback(async () => {
    if (generatingCxp) return;
    setGeneratingCxp(true);
    setCxpStatus(makeEmptyStatus());
    setCxpSummary(null);

    try {
      if (!empresaActivaId) return;

      const fromIso = startOfDay(desde).toISOString();
      const toIso = endOfDay(hasta).toISOString();

      const { data, error } = await supabase
        .from("compras")
        .select("id,fecha,proveedor,numero_factura,tipo_pago,fecha_vencimiento,monto_total,saldo_pendiente,estado")
        .eq("empresa_id", empresaActivaId)
        .gte("fecha", fromIso)
        .lte("fecha", toIso)
        .order("fecha", { ascending: false })
        .limit(MAX_ROWS + 1);

      if (error) throw error;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let rows = (data ?? []) as CxpRow[];

      // Filtrar por estado de pago
      if (cxpEstado !== "ALL") {
        rows = rows.filter((r) => {
          const saldo = safeNumber(r.saldo_pendiente) ?? 0;
          if (saldo <= 0) return false;
          if (cxpEstado === "VENCIDA") {
            const vence = r.fecha_vencimiento ? new Date(r.fecha_vencimiento) : null;
            return vence != null && vence.getTime() < today.getTime();
          }
          // PENDIENTE = saldo > 0 y no vencida
          const vence = r.fecha_vencimiento ? new Date(r.fecha_vencimiento) : null;
          return vence == null || vence.getTime() >= today.getTime();
        });
      }

      if (rows.length === 0) {
        setCxpStatus({ error: "No hay cuentas por pagar en ese rango.", warning: null, info: null });
        return;
      }

      const totalSaldo = rows.reduce((acc, r) => acc + (safeNumber(r.saldo_pendiente) ?? 0), 0);
      setCxpSummary({ count: rows.length, saldo: totalSaldo });

      const truncated = rows.length > MAX_ROWS;
      const trimmed = truncated ? rows.slice(0, MAX_ROWS) : rows;

      const formatted: CxpExportRow[] = trimmed.map((r) => {
        const saldo = safeNumber(r.saldo_pendiente) ?? 0;
        const total = safeNumber(r.monto_total) ?? 0;
        const vence = r.fecha_vencimiento ? new Date(r.fecha_vencimiento) : null;
        let estadoPago = "PAGADA";
        if (saldo > 0) {
          estadoPago = vence && vence.getTime() < today.getTime() ? "VENCIDA" : "PENDIENTE";
        }
        return {
          fecha: r.fecha ? fmtDateTime(r.fecha) : "",
          fecha_vencimiento: r.fecha_vencimiento ? fmtDateTime(r.fecha_vencimiento) : "",
          proveedor: r.proveedor ?? "",
          numero_factura: r.numero_factura ?? "",
          tipo_pago: r.tipo_pago ?? "",
          monto_total: roundToTwoDecimals(total),
          pagado: roundToTwoDecimals(total - saldo),
          saldo: roundToTwoDecimals(saldo),
          estado_pago: estadoPago,
          estado_compra: r.estado ?? "",
        };
      });

      const fileStem = `reporte_cxp_${fmtDateYmd(desde)}_${fmtDateYmd(hasta)}`;

      await exportSimpleXlsx<CxpExportRow>({
        title: "Cuentas por pagar",
        fileName: fileStem,
        sheetName: "CxP",
        columns: [
          { key: "fecha",             header: "Fecha compra",    value: (r) => r.fecha },
          { key: "fecha_vencimiento", header: "Fecha vence",     value: (r) => r.fecha_vencimiento },
          { key: "proveedor",         header: "Proveedor",       value: (r) => r.proveedor },
          { key: "numero_factura",    header: "No. factura",     value: (r) => r.numero_factura },
          { key: "tipo_pago",         header: "Tipo pago",       value: (r) => r.tipo_pago },
          { key: "monto_total",       header: "Total compra",    value: (r) => r.monto_total ?? "" },
          { key: "pagado",            header: "Pagado",          value: (r) => r.pagado ?? "" },
          { key: "saldo",             header: "Saldo pendiente", value: (r) => r.saldo ?? "" },
          { key: "estado_pago",       header: "Estado pago",     value: (r) => r.estado_pago },
          { key: "estado_compra",     header: "Estado compra",   value: (r) => r.estado_compra },
        ],
        rows: formatted,
      });

      setCxpStatus({
        error: null,
        info: `Se exportaron ${trimmed.length} filas. Saldo total: Q ${totalSaldo.toFixed(2)}`,
        warning: truncated
          ? `Se limitó el resultado a ${MAX_ROWS} filas. Ajusta el rango si necesitas todo.`
          : null,
      });
    } catch (e: any) {
      if (__DEV__) console.log("[reportes] error exportando CxP", e);
      if (isPostgrestError(e)) {
        setCxpStatus({ error: `${e.code ?? ""} - ${e.message ?? ""}`, warning: null, info: null });
      } else {
        setCxpStatus({ error: e?.message ?? "Error desconocido", warning: null, info: null });
      }
    } finally {
      setGeneratingCxp(false);
    }
  }, [generatingCxp, empresaActivaId, desde, hasta, cxpEstado]);

  const renderFooter = (status: FooterState) => (
    <>
      <Text style={styles.caption}>Máximo 5,000 registros</Text>
      {status.error ? <Text style={[styles.status, styles.statusError]}>{status.error}</Text> : null}
      {status.warning ? (
        <Text style={[styles.status, styles.statusWarning]}>{status.warning}</Text>
      ) : null}
      {status.info ? <Text style={[styles.status, styles.statusInfo]}>{status.info}</Text> : null}
    </>
  );

  const auditFooter = renderFooter(auditStatus);
  const utilidadFooter = renderFooter(utilidadStatus);
  const bajoMovimientoFooter = renderFooter(bajoMovimientoStatus);
  const cxcFooter = renderFooter(cxcStatus);
  const cxpFooter = renderFooter(cxpStatus);

  const DateRangeFields = () => (
    <View style={styles.rangeRow}>
      <View style={styles.field}>
        <Text style={styles.label}>Desde</Text>
        {Platform.OS === "web" ? (
          <input
            type="date"
            value={desde.toISOString().slice(0, 10)}
            onChange={(e) => {
              const val = (e.target as HTMLInputElement).value;
              if (val) {
                const next = startOfDay(new Date(`${val}T12:00:00`));
                setDesde(next);
                if (next.getTime() > hasta.getTime()) setHasta(endOfDay(new Date(`${val}T12:00:00`)));
              }
            }}
            style={{
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: colors.border,
              borderRadius: 12,
              padding: 8,
              fontSize: 15,
              fontWeight: "700",
              width: "100%",
              boxSizing: "border-box",
              backgroundColor: colors.card,
              color: colors.text,
              fontFamily: "inherit",
              cursor: "pointer",
              outline: "none",
            } as any}
          />
        ) : (
          <Pressable style={styles.dateInput} onPress={() => openPicker("desde")} accessibilityRole="button">
            <Text style={styles.dateText}>{fmtDateLabel(desde)}</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Hasta</Text>
        {Platform.OS === "web" ? (
          <input
            type="date"
            value={hasta.toISOString().slice(0, 10)}
            onChange={(e) => {
              const val = (e.target as HTMLInputElement).value;
              if (val) {
                const next = endOfDay(new Date(`${val}T12:00:00`));
                setHasta(next);
                if (next.getTime() < desde.getTime()) setDesde(startOfDay(new Date(`${val}T12:00:00`)));
              }
            }}
            style={{
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: colors.border,
              borderRadius: 12,
              padding: 8,
              fontSize: 15,
              fontWeight: "700",
              width: "100%",
              boxSizing: "border-box",
              backgroundColor: colors.card,
              color: colors.text,
              fontFamily: "inherit",
              cursor: "pointer",
              outline: "none",
            } as any}
          />
        ) : (
          <Pressable style={styles.dateInput} onPress={() => openPicker("hasta")} accessibilityRole="button">
            <Text style={styles.dateText}>{fmtDateLabel(hasta)}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  const MinDiasSelector = () => (
    <View style={styles.minDiasBlock}>
      <Text style={styles.label}>Días sin movimiento</Text>
      <View style={styles.minDiasRow}>
        {MIN_DIAS_OPTIONS.map((option) => {
          const selected = option === minDias;
          return (
            <Pressable
              key={option}
              style={[styles.minDiasButton, selected && styles.minDiasButtonSelected]}
              onPress={() => setMinDias(option)}
              accessibilityRole="button"
            >
              <Text
                style={[styles.minDiasButtonText, selected && styles.minDiasButtonTextSelected]}
              >
                {option} d
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const CxpEstadoSelector = () => (
    <View style={styles.minDiasBlock}>
      <Text style={styles.label}>Filtrar por estado de pago</Text>
      <View style={styles.minDiasRow}>
        {CXP_ESTADO_OPTIONS.map((opt) => {
          const selected = opt.value === cxpEstado;
          return (
            <Pressable
              key={opt.value}
              style={[styles.minDiasButton, selected && styles.minDiasButtonSelected]}
              onPress={() => setCxpEstado(opt.value)}
              accessibilityRole="button"
            >
              <Text style={[styles.minDiasButtonText, selected && styles.minDiasButtonTextSelected]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const CxcEstadoSelector = () => (
    <View style={styles.minDiasBlock}>
      <Text style={styles.label}>Filtrar por estado de pago</Text>
      <View style={styles.minDiasRow}>
        {CXC_ESTADO_OPTIONS.map((opt) => {
          const selected = opt.value === cxcEstado;
          return (
            <Pressable
              key={opt.value}
              style={[styles.minDiasButton, selected && styles.minDiasButtonSelected]}
              onPress={() => setCxcEstado(opt.value)}
              accessibilityRole="button"
            >
              <Text style={[styles.minDiasButtonText, selected && styles.minDiasButtonTextSelected]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const iosSelectedDate = activePicker ? (activePicker === "desde" ? desde : hasta) : null;
  const iosMarkedDates = iosSelectedDate
    ? {
        [fmtCalendarDate(iosSelectedDate)]: {
          selected: true,
          disableTouchEvent: true,
          selectedColor: colors.primary,
          selectedTextColor: "#fff",
        },
      }
    : undefined;

  return (
    <>
      <Stack.Screen options={{ title: "Reportes" }} />
      <RoleGate
        allow={["ADMIN"]}
        title="Reportes"
        deniedTitle="Sin permiso"
        deniedText="Solo administradores pueden ver los reportes."
        loadingText="Cargando permisos..."
        backHref="/(drawer)/(tabs)"
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["bottom"]}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            style={{ flex: 1 }}
          >
            <View style={styles.stack}>
              <View style={styles.cardWrapper}>
                <ReportCard
                  title="Auditoría pagos"
                  description="Descarga los movimientos de pagos registrados por los triggers de auditoría."
                  onExport={handleDownload}
                  loading={generating}
                  disabled={generating}
                  footer={auditFooter}
                  exportButtonVariant="excel"
                  style={styles.cardFill}
                >
                  <DateRangeFields />
                </ReportCard>
              </View>
              <View style={styles.cardWrapper}>
                <ReportCard
                  title="Utilidad por producto"
                  description="Descarga la utilidad, margen y participación por producto en el rango seleccionado."
                  onExport={handleDownloadUtilidad}
                  loading={generatingUtilidad}
                  disabled={generatingUtilidad}
                  footer={utilidadFooter}
                  exportButtonVariant="excel"
                  style={styles.cardFill}
                >
                  <DateRangeFields />
                  {utilidadGlobalAttempted ? (
                    utilidadGlobal ? (
                      <View style={styles.globalSummary}>
                        <View style={styles.globalSummaryRow}>
                          <Text style={styles.globalSummaryKey}>Ventas totales</Text>
                          <Text style={styles.globalSummaryVal}>Q {(utilidadGlobal.total_ventas ?? 0).toFixed(2)}</Text>
                        </View>
                        <View style={styles.globalSummaryRow}>
                          <Text style={styles.globalSummaryKey}>Costo total</Text>
                          <Text style={styles.globalSummaryVal}>Q {(utilidadGlobal.costo_total ?? 0).toFixed(2)}</Text>
                        </View>
                        <View style={styles.globalSummaryRow}>
                          <Text style={styles.globalSummaryKey}>Utilidad bruta</Text>
                          <Text style={styles.globalSummaryVal}>Q {(utilidadGlobal.utilidad_bruta ?? 0).toFixed(2)}</Text>
                        </View>
                        <View style={styles.globalSummaryRow}>
                          <Text style={styles.globalSummaryKey}>Margen</Text>
                          <Text style={styles.globalSummaryVal}>{(utilidadGlobal.margen_pct ?? 0).toFixed(2)}%</Text>
                        </View>
                      </View>
                    ) : (
                      <Text style={styles.globalSummaryFallback}>Sin resumen disponible</Text>
                    )
                  ) : null}
                </ReportCard>
              </View>
              <View style={styles.cardWrapper}>
                <ReportCard
                  title="Productos con bajo movimiento"
                  description="Identifica productos con stock disponible y sin ventas recientes."
                  onExport={handleDownloadBajoMovimiento}
                  loading={generatingBajoMovimiento}
                  disabled={generatingBajoMovimiento}
                  footer={bajoMovimientoFooter}
                  exportButtonVariant="excel"
                  style={styles.cardFill}
                >
                  <DateRangeFields />
                  <MinDiasSelector />
                </ReportCard>
              </View>

              <View style={styles.cardWrapper}>
                <ReportCard
                  title="Cuentas por cobrar"
                  description="Exporta las ventas con saldo pendiente en el rango de fechas seleccionado."
                  onExport={handleDownloadCxc}
                  loading={generatingCxc}
                  disabled={generatingCxc}
                  footer={cxcFooter}
                  exportButtonVariant="excel"
                  style={styles.cardFill}
                >
                  <DateRangeFields />
                  <CxcEstadoSelector />
                  {cxcSummary ? (
                    <View style={styles.globalSummary}>
                      <View style={styles.globalSummaryRow}>
                        <Text style={styles.globalSummaryKey}>Registros exportados</Text>
                        <Text style={styles.globalSummaryVal}>{cxcSummary.count}</Text>
                      </View>
                      <View style={styles.globalSummaryRow}>
                        <Text style={styles.globalSummaryKey}>Saldo total pendiente</Text>
                        <Text style={styles.globalSummaryVal}>Q {cxcSummary.saldo.toFixed(2)}</Text>
                      </View>
                    </View>
                  ) : null}
                </ReportCard>
              </View>

              <View style={styles.cardWrapper}>
                <ReportCard
                  title="Cuentas por pagar"
                  description="Exporta las compras con saldo pendiente en el rango de fechas seleccionado."
                  onExport={handleDownloadCxp}
                  loading={generatingCxp}
                  disabled={generatingCxp}
                  footer={cxpFooter}
                  exportButtonVariant="excel"
                  style={styles.cardFill}
                >
                  <DateRangeFields />
                  <CxpEstadoSelector />
                  {cxpSummary ? (
                    <View style={styles.globalSummary}>
                      <View style={styles.globalSummaryRow}>
                        <Text style={styles.globalSummaryKey}>Registros exportados</Text>
                        <Text style={styles.globalSummaryVal}>{cxpSummary.count}</Text>
                      </View>
                      <View style={styles.globalSummaryRow}>
                        <Text style={styles.globalSummaryKey}>Saldo total pendiente</Text>
                        <Text style={styles.globalSummaryVal}>Q {cxpSummary.saldo.toFixed(2)}</Text>
                      </View>
                    </View>
                  ) : null}
                </ReportCard>
              </View>
            </View>
          </ScrollView>

          {Platform.OS === "ios" ? (
            <Modal
              visible={!!activePicker}
              transparent
              animationType="fade"
              onRequestClose={closePicker}
            >
              <View style={styles.modalBackdrop}>
                <View style={styles.modalCard}>
                  <Text style={styles.modalTitle}>
                    {activePicker === "hasta" ? "Selecciona la fecha final" : "Selecciona la fecha inicial"}
                  </Text>
                  <Calendar
                    style={styles.calendar}
                    theme={calendarTheme}
                    onDayPress={handleCalendarSelect}
                    current={iosSelectedDate ? fmtCalendarDate(iosSelectedDate) : undefined}
                    markedDates={iosMarkedDates}
                    enableSwipeMonths
                  />
                  <AppButton title="Cerrar" variant="ghost" size="sm" onPress={closePicker} />
                </View>
              </View>
            </Modal>
          ) : null}
        </SafeAreaView>
      </RoleGate>
    </>
  );
}

const makeStyles = (colors: any) =>
  StyleSheet.create({
    scroll: {
      padding: 16,
    },
    stack: {
      flex: 1,
      gap: 16,
      ...(Platform.OS === "web" ? { flexDirection: "row" as const, flexWrap: "wrap" as const } : {}),
    },
    cardWrapper: {
      ...(Platform.OS === "web" ? { width: "calc(50% - 8px)" as any } : {}),
    },
    cardFill: {
      ...(Platform.OS === "web" ? { flex: 1 } : {}),
    },
    rangeRow: {
      flexDirection: "row",
      gap: 12,
      flexWrap: "wrap",
    },
    field: {
      flex: 1,
      minWidth: 150,
      gap: 4,
    },
    label: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.text,
    },
    minDiasBlock: {
      marginTop: 12,
      gap: 8,
    },
    minDiasRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    minDiasButton: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingVertical: 8,
      paddingHorizontal: 14,
      backgroundColor: colors.card,
    },
    minDiasButtonSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    minDiasButtonText: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.text,
    },
    minDiasButtonTextSelected: {
      color: "#fff",
    },
    dateInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingVertical: 8,
      paddingHorizontal: 12,
      backgroundColor: colors.card,
      minHeight: 40,
      justifyContent: "center",
    },
    dateText: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.text,
    },
    caption: {
      fontSize: 12,
      color: colors.text + "88",
    },
    status: {
      fontSize: 13,
      fontWeight: "600",
      marginTop: 6,
    },
    statusError: {
      color: colors.notification ?? "#ff3b30",
    },
    statusWarning: {
      color: "#b45309",
    },
    statusInfo: {
      color: colors.primary,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "center",
      padding: 24,
    },
    modalCard: {
      backgroundColor: colors.card,
      borderRadius: 18,
      padding: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      gap: 16,
    },
    modalTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.text,
      textAlign: "center",
    },
    calendar: {
      borderRadius: 12,
      overflow: "hidden",
      backgroundColor: colors.card,
    },
    globalSummary: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: 10,
      gap: 6,
    },
    globalSummaryRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    globalSummaryKey: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.text + "AA",
    },
    globalSummaryVal: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
    },
    globalSummaryFallback: {
      fontSize: 13,
      color: colors.text + "88",
      fontStyle: "italic",
    },
  });
