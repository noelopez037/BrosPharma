import { supabase } from "../supabase";
import type { ReportDefinition } from "./types";
import { fmtDateYmd, fmtMoneyPdf, fmtMonthKey, fmtMonthLabelEs, makeStamp, safeFileName } from "./share";

type VentaMensualRow = {
  mes: string;
  ventas_count: number | null;
  unidades: number | null;
  monto: number | null;
};

type TopProductoRow = {
  producto_id: number;
  producto: string | null;
  marca: string | null;
  ventas_count: number | null;
  unidades: number | null;
  monto: number | null;
};

type ProductoPromRow = {
  mes: string;
  ventas_count: number | null;
  unidades: number | null;
  monto: number | null;
  precio_promedio?: number | null;
};

type ComprasMensualRow = {
  mes: string;
  compras_count: number | null;
  total_comprado: number | null;
  saldo_pendiente: number | null;
  vencidas_count: number | null;
  saldo_vencido: number | null;
};

type PagosProvMensualRow = {
  mes: string;
  metodo: string | null;
  pagos_count: number | null;
  monto: number | null;
};

type InventarioAlertaRow = {
  tipo: "STOCK_BAJO" | "PROX_VENCER" | string;
  producto_id: number | null;
  producto: string | null;
  marca: string | null;
  stock_disponible?: number | null;
  lote?: string | null;
  fecha_exp?: string | null;
  fecha_exp_proxima?: string | null;
};

type KardexRow = {
  fecha: string | null;
  tipo: string | null;
  ref: string | null;
  entrada: number | null;
  salida: number | null;
  saldo: number | null;
};

export type ReportBaseFilters = {
  end_date: string; // YYYY-MM-DD
  months: number;
};

export type VentasMensualFilters = ReportBaseFilters & {
  vendedor_id?: string | null;
  estado?: string | null;
};

export type TopProductosFilters = ReportBaseFilters & {
  limit: number;
  order_by: "MONTO" | "UNIDADES";
  vendedor_id?: string | null;
  estado?: string | null;
};

export type ProductoPromFilters = ReportBaseFilters & {
  producto_id: number | null;
  producto_label?: string;
  vendedor_id?: string | null;
  estado?: string | null;
};

export type ComprasMensualFilters = ReportBaseFilters & {
  proveedor_id?: number | null;
  proveedor_label?: string;
};

export type PagosProvMensualFilters = ReportBaseFilters & {
  proveedor_id?: number | null;
  proveedor_label?: string;
};

export type InventarioAlertasFilters = {
  stock_bajo: number;
  exp_dias: number;
  incluir_inactivos: boolean;
};

export type KardexFilters = {
  producto_id: number | null;
  producto_label?: string;
  desde: string; // YYYY-MM-DD
  hasta: string; // YYYY-MM-DD
  incluir_anuladas: boolean;
};

function titleWithStamp(stem: string) {
  const s = safeFileName(stem) || "reporte";
  return `${s}-${makeStamp()}`;
}

function buildSubtitleBase(f: ReportBaseFilters) {
  return `Ultimos ${f.months} meses • Fin: ${fmtDateYmd(f.end_date)}`;
}

function avg(values: number[]) {
  if (!values.length) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

export const REPORTS = [
  {
    id: "ventas_mensual_12m",
    title: "Ventas mensual (12m)",
    description: "Ventas, unidades y monto por mes.",
    defaultFilters: {
      end_date: fmtDateYmd(new Date()),
      months: 12,
      vendedor_id: null,
      estado: null,
    } as VentasMensualFilters,
    buildSubtitle: (f: VentasMensualFilters) => {
      const base = buildSubtitleBase(f);
      const v = f.vendedor_id ? ` • Vendedor: ${String(f.vendedor_id).slice(0, 8)}` : "";
      const e = f.estado ? ` • Estado: ${f.estado}` : "";
      return `${base}${v}${e}`;
    },
    buildFileNameStem: () => titleWithStamp("ventas-mensual-12m"),
    columns: [
      { key: "mes", label: "Mes", kind: "month" },
      { key: "ventas_count", label: "Ventas", kind: "int", align: "right" },
      { key: "unidades", label: "Unidades", kind: "int", align: "right" },
      { key: "monto", label: "Monto", kind: "money", align: "right" },
    ],
    fetchRows: async (f: VentasMensualFilters) => {
      const args: any = {
        p_end_date: f.end_date,
        p_months: f.months,
      };
      if (f.vendedor_id) args.p_vendedor_id = f.vendedor_id;
      if (f.estado) args.p_estado = f.estado;
      const { data, error } = await supabase.rpc("rpc_report_ventas_mensual_12m", args);
      if (error) throw error;
      return { rows: (data ?? []) as VentaMensualRow[] };
    },
  },

  {
    id: "top_productos_12m",
    title: "Top productos (12m)",
    description: "Ranking por monto o unidades.",
    defaultFilters: {
      end_date: fmtDateYmd(new Date()),
      months: 12,
      limit: 30,
      order_by: "MONTO",
      vendedor_id: null,
      estado: null,
    } as TopProductosFilters,
    buildSubtitle: (f: TopProductosFilters) => {
      const base = buildSubtitleBase(f);
      const ord = ` • Orden: ${f.order_by}`;
      const lim = ` • Top: ${f.limit}`;
      const v = f.vendedor_id ? ` • Vendedor: ${String(f.vendedor_id).slice(0, 8)}` : "";
      const e = f.estado ? ` • Estado: ${f.estado}` : "";
      return `${base}${ord}${lim}${v}${e}`;
    },
    buildFileNameStem: () => titleWithStamp("top-productos-12m"),
    columns: [
      { key: "producto", label: "Producto", kind: "text" },
      { key: "marca", label: "Marca", kind: "text" },
      { key: "ventas_count", label: "Ventas", kind: "int", align: "right" },
      { key: "unidades", label: "Unidades", kind: "int", align: "right" },
      { key: "monto", label: "Monto", kind: "money", align: "right" },
    ],
    fetchRows: async (f: TopProductosFilters) => {
      const args: any = {
        p_end_date: f.end_date,
        p_months: f.months,
        p_limit: f.limit,
        p_order_by: f.order_by,
      };
      if (f.vendedor_id) args.p_vendedor_id = f.vendedor_id;
      if (f.estado) args.p_estado = f.estado;
      const { data, error } = await supabase.rpc("rpc_report_top_productos_12m", args);
      if (error) throw error;
      return { rows: (data ?? []) as TopProductoRow[] };
    },
  },

  {
    id: "producto_promedio_mensual_12m",
    title: "Promedio mensual por producto (12m)",
    description: "Serie mensual (incluye meses en 0) y promedios.",
    defaultFilters: {
      end_date: fmtDateYmd(new Date()),
      months: 12,
      producto_id: null,
      producto_label: "",
      vendedor_id: null,
      estado: null,
    } as ProductoPromFilters,
    requires: (f: ProductoPromFilters) => (!f.producto_id ? "Selecciona un producto" : null),
    buildSubtitle: (f: ProductoPromFilters) => {
      const base = buildSubtitleBase(f);
      const p = f.producto_label ? ` • Producto: ${f.producto_label}` : "";
      const v = f.vendedor_id ? ` • Vendedor: ${String(f.vendedor_id).slice(0, 8)}` : "";
      const e = f.estado ? ` • Estado: ${f.estado}` : "";
      return `${base}${p}${v}${e}`;
    },
    buildFileNameStem: (f: ProductoPromFilters) =>
      titleWithStamp(`producto-promedio-mensual-12m-${f.producto_id ?? ""}`),
    columns: [
      { key: "mes", label: "Mes", kind: "month" },
      { key: "ventas_count", label: "Ventas", kind: "int", align: "right" },
      { key: "unidades", label: "Unidades", kind: "int", align: "right" },
      { key: "monto", label: "Monto", kind: "money", align: "right" },
      {
        key: "precio_promedio",
        label: "Precio prom.",
        kind: "money",
        align: "right",
        value: (r: ProductoPromRow) => {
          if (r?.precio_promedio != null) return r.precio_promedio;
          const u = Number(r?.unidades ?? 0);
          const m = Number(r?.monto ?? 0);
          if (!Number.isFinite(u) || u <= 0) return 0;
          return Number.isFinite(m) ? m / u : 0;
        },
      },
    ],
    fetchRows: async (f: ProductoPromFilters) => {
      const args: any = {
        p_producto_id: f.producto_id,
        p_end_date: f.end_date,
        p_months: f.months,
      };
      if (f.vendedor_id) args.p_vendedor_id = f.vendedor_id;
      if (f.estado) args.p_estado = f.estado;
      const { data, error } = await supabase.rpc("rpc_report_producto_promedio_mensual_12m", args);
      if (error) throw error;
      const rows = (data ?? []) as ProductoPromRow[];

      const units = rows.map((r) => Number(r?.unidades ?? 0)).filter((n) => Number.isFinite(n));
      const amounts = rows.map((r) => Number(r?.monto ?? 0)).filter((n) => Number.isFinite(n));
      const sumU = units.reduce((a, b) => a + b, 0);
      const sumM = amounts.reduce((a, b) => a + b, 0);
      const summary = [
        { label: "Prom. unidades/mes", value: String(avg(units).toFixed(2)) },
        { label: "Prom. monto/mes", value: fmtMoneyPdf(avg(amounts)) },
        { label: "Precio prom. 12m", value: fmtMoneyPdf(sumU > 0 ? sumM / sumU : 0) },
      ];

      return { rows, summary };
    },
  },

  {
    id: "compras_mensual_12m",
    title: "Compras mensual (12m)",
    description: "Compras y saldos por mes.",
    defaultFilters: {
      end_date: fmtDateYmd(new Date()),
      months: 12,
      proveedor_id: null,
      proveedor_label: "",
    } as ComprasMensualFilters,
    buildSubtitle: (f: ComprasMensualFilters) => {
      const base = buildSubtitleBase(f);
      const p = f.proveedor_label ? ` • Proveedor: ${f.proveedor_label}` : "";
      return `${base}${p}`;
    },
    buildFileNameStem: (f: ComprasMensualFilters) =>
      titleWithStamp(`compras-mensual-12m${f.proveedor_id ? `-${f.proveedor_id}` : ""}`),
    columns: [
      { key: "mes", label: "Mes", kind: "month" },
      { key: "compras_count", label: "Compras", kind: "int", align: "right" },
      { key: "total_comprado", label: "Total comprado", kind: "money", align: "right" },
      { key: "saldo_pendiente", label: "Saldo pendiente", kind: "money", align: "right" },
      { key: "vencidas_count", label: "Vencidas", kind: "int", align: "right" },
      { key: "saldo_vencido", label: "Saldo vencido", kind: "money", align: "right" },
    ],
    fetchRows: async (f: ComprasMensualFilters) => {
      const args: any = { p_end_date: f.end_date, p_months: f.months };
      if (f.proveedor_id) args.p_proveedor_id = f.proveedor_id;
      const { data, error } = await supabase.rpc("rpc_report_compras_mensual_12m", args);
      if (error) throw error;
      return { rows: (data ?? []) as ComprasMensualRow[] };
    },
  },

  {
    id: "pagos_proveedores_mensual_12m",
    title: "Pagos a proveedores (12m)",
    description: "Pagos por metodo y mes.",
    defaultFilters: {
      end_date: fmtDateYmd(new Date()),
      months: 12,
      proveedor_id: null,
      proveedor_label: "",
    } as PagosProvMensualFilters,
    buildSubtitle: (f: PagosProvMensualFilters) => {
      const base = buildSubtitleBase(f);
      const p = f.proveedor_label ? ` • Proveedor: ${f.proveedor_label}` : "";
      return `${base}${p}`;
    },
    buildFileNameStem: (f: PagosProvMensualFilters) =>
      titleWithStamp(`pagos-proveedores-12m${f.proveedor_id ? `-${f.proveedor_id}` : ""}`),
    columns: [
      { key: "mes", label: "Mes", kind: "month" },
      { key: "metodo", label: "Metodo", kind: "text" },
      { key: "pagos_count", label: "Pagos", kind: "int", align: "right" },
      { key: "monto", label: "Monto", kind: "money", align: "right" },
    ],
    fetchRows: async (f: PagosProvMensualFilters) => {
      const args: any = { p_end_date: f.end_date, p_months: f.months };
      if (f.proveedor_id) args.p_proveedor_id = f.proveedor_id;
      const { data, error } = await supabase.rpc("rpc_report_pagos_proveedores_mensual_12m", args);
      if (error) throw error;
      return { rows: (data ?? []) as PagosProvMensualRow[] };
    },
  },

  {
    id: "inventario_alertas",
    title: "Inventario alertas",
    description: "Stock bajo y proximos a vencer.",
    defaultFilters: {
      stock_bajo: 5,
      exp_dias: 30,
      incluir_inactivos: false,
    } as InventarioAlertasFilters,
    buildSubtitle: (f: InventarioAlertasFilters) => `Stock bajo <= ${f.stock_bajo} • Vence en <= ${f.exp_dias} dias`,
    buildFileNameStem: () => titleWithStamp("inventario-alertas"),
    columns: [
      { key: "tipo", label: "Tipo", kind: "text" },
      { key: "producto", label: "Producto", kind: "text" },
      { key: "marca", label: "Marca", kind: "text" },
      { key: "stock_disponible", label: "Stock", kind: "int", align: "right" },
      { key: "lote", label: "Lote", kind: "text" },
      {
        key: "fecha_exp",
        label: "Expira",
        kind: "date",
        value: (r: InventarioAlertaRow) => r.fecha_exp ?? r.fecha_exp_proxima ?? null,
      },
    ],
    fetchRows: async (f: InventarioAlertasFilters) => {
      const args: any = {
        p_stock_bajo: f.stock_bajo,
        p_exp_dias: f.exp_dias,
        p_incluir_inactivos: !!f.incluir_inactivos,
      };
      const { data, error } = await supabase.rpc("rpc_report_inventario_alertas", args);
      if (error) throw error;
      return { rows: (data ?? []) as InventarioAlertaRow[] };
    },
  },

  {
    id: "kardex_producto",
    title: "Kardex por producto",
    description: "Movimientos con saldo acumulado.",
    defaultFilters: {
      producto_id: null,
      producto_label: "",
      desde: fmtDateYmd(new Date(new Date().setFullYear(new Date().getFullYear() - 1))),
      hasta: fmtDateYmd(new Date()),
      incluir_anuladas: false,
    } as KardexFilters,
    requires: (f: KardexFilters) => (!f.producto_id ? "Selecciona un producto" : null),
    buildSubtitle: (f: KardexFilters) => {
      const p = f.producto_label ? `Producto: ${f.producto_label}` : "Producto";
      return `${p} • ${f.desde} → ${f.hasta}`;
    },
    buildFileNameStem: (f: KardexFilters) => titleWithStamp(`kardex-producto-${f.producto_id ?? ""}`),
    columns: [
      { key: "fecha", label: "Fecha", kind: "date" },
      { key: "tipo", label: "Tipo", kind: "text" },
      { key: "ref", label: "Ref", kind: "text" },
      { key: "entrada", label: "Entrada", kind: "int", align: "right" },
      { key: "salida", label: "Salida", kind: "int", align: "right" },
      { key: "saldo", label: "Saldo", kind: "int", align: "right" },
    ],
    fetchRows: async (f: KardexFilters) => {
      const args: any = {
        p_producto_id: f.producto_id,
        p_desde: f.desde,
        p_hasta: f.hasta,
        p_incluir_anuladas: !!f.incluir_anuladas,
      };
      const { data, error } = await supabase.rpc("rpc_report_kardex_producto_consolidado", args);
      if (error) throw error;
      return { rows: (data ?? []) as KardexRow[] };
    },
  },
] as const satisfies ReadonlyArray<ReportDefinition<any, any>>;

export type AnyReport = (typeof REPORTS)[number];
