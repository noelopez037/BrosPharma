import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
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

type FooterState = {
  error: string | null;
  warning: string | null;
  info: string | null;
};

const MAX_ROWS = 5000;
const MIN_DIAS_OPTIONS = [7, 15, 30, 60];

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
      const { data, error } = await supabase
        .from("vw_ventas_pagos_log")
        .select(
          "registrado,action,actor_nombre,cliente_nombre,monto,metodo,referencia,comentario,factura_numero"
        )
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
      console.log("[reportes] error exportando auditoría", e);
      if (isPostgrestError(e)) {
        console.log("POSTGREST ERROR:", e);
        setAuditStatus({ error: `${e.code ?? ""} - ${e.message ?? ""}`, warning: null, info: null });
      } else {
        console.log("UNKNOWN ERROR:", e);
        setAuditStatus({ error: e?.message ?? "Error desconocido", warning: null, info: null });
      }
    } finally {
      setGenerating(false);
    }
  }, [desde, hasta, generating]);

  const handleDownloadUtilidad = useCallback(async () => {
    if (generatingUtilidad) return;
    setGeneratingUtilidad(true);
    setUtilidadStatus(makeEmptyStatus());

    const fromIso = startOfDay(desde).toISOString();
    const toIso = endOfDay(hasta).toISOString();

    try {
      const { data, error } = await supabase.rpc("rpc_reporte_utilidad_productos_v3", {
        p_desde: fromIso,
        p_hasta: toIso,
      });

      if (error) throw error;

      const rows = (data ?? []) as UtilidadRow[];
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
        rows: formatted,
      });

      setUtilidadStatus({
        error: null,
        info: `Se exportaron ${trimmed.length} productos.`,
        warning: truncated
          ? `Se limitó el resultado a ${MAX_ROWS} filas. Ajusta el rango si necesitas todo.`
          : null,
      });
    } catch (e: any) {
      console.log("[reportes] error exportando utilidad productos", e);
      if (isPostgrestError(e)) {
        console.log("POSTGREST ERROR:", e);
        setUtilidadStatus({ error: `${e.code ?? ""} - ${e.message ?? ""}`, warning: null, info: null });
      } else {
        console.log("UNKNOWN ERROR:", e);
        setUtilidadStatus({ error: e?.message ?? "Error desconocido", warning: null, info: null });
      }
    } finally {
      setGeneratingUtilidad(false);
    }
  }, [desde, hasta, generatingUtilidad]);

  const handleDownloadBajoMovimiento = useCallback(async () => {
    if (generatingBajoMovimiento) return;
    setGeneratingBajoMovimiento(true);
    setBajoMovimientoStatus(makeEmptyStatus());

    const toIso = endOfDay(hasta).toISOString();

    try {
      const { data, error } = await supabase.rpc("rpc_reporte_bajo_movimiento", {
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
      console.log("[reportes] error exportando bajo movimiento", e);
      if (isPostgrestError(e)) {
        console.log("POSTGREST ERROR:", e);
        setBajoMovimientoStatus({
          error: `${e.code ?? ""} - ${e.message ?? ""}`,
          warning: null,
          info: null,
        });
      } else {
        console.log("UNKNOWN ERROR:", e);
        setBajoMovimientoStatus({
          error: e?.message ?? "Error desconocido",
          warning: null,
          info: null,
        });
      }
    } finally {
      setGeneratingBajoMovimiento(false);
    }
  }, [desde, hasta, generatingBajoMovimiento, minDias]);

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

  const DateRangeFields = () => (
    <View style={styles.rangeRow}>
      <View style={styles.field}>
        <Text style={styles.label}>Desde</Text>
        <Pressable style={styles.dateInput} onPress={() => openPicker("desde")} accessibilityRole="button">
          <Text style={styles.dateText}>{fmtDateLabel(desde)}</Text>
        </Pressable>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Hasta</Text>
        <Pressable style={styles.dateInput} onPress={() => openPicker("hasta")} accessibilityRole="button">
          <Text style={styles.dateText}>{fmtDateLabel(hasta)}</Text>
        </Pressable>
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
              <ReportCard
                title="Auditoría pagos"
                description="Descarga los movimientos de pagos registrados por los triggers de auditoría."
                onExport={handleDownload}
                loading={generating}
                disabled={generating}
                footer={auditFooter}
                exportButtonVariant="excel"
              >
                <DateRangeFields />
              </ReportCard>
              <ReportCard
                title="Utilidad por producto"
                description="Descarga la utilidad, margen y participación por producto en el rango seleccionado."
                onExport={handleDownloadUtilidad}
                loading={generatingUtilidad}
                disabled={generatingUtilidad}
                footer={utilidadFooter}
                exportButtonVariant="excel"
              >
                <DateRangeFields />
              </ReportCard>
              <ReportCard
                title="Productos con bajo movimiento"
                description="Identifica productos con stock disponible y sin ventas recientes."
                onExport={handleDownloadBajoMovimiento}
                loading={generatingBajoMovimiento}
                disabled={generatingBajoMovimiento}
                footer={bajoMovimientoFooter}
                exportButtonVariant="excel"
              >
                <DateRangeFields />
                <MinDiasSelector />
              </ReportCard>
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
  });
