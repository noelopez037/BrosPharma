// lib/ventaDraft.tsx
// Draft local para crear una venta (no toca BD hasta Guardar).

import React, { createContext, useContext, useMemo, useState } from "react";

export type Cliente = {
  id: number;
  nombre: string;
  nit: string | null;
  telefono: string | null;
  direccion: string | null;
};

export type VentaLinea = {
  key: string;

  producto_id: number | null;
  producto_label: string;

  // snapshots para validar y para no depender de cambios posteriores
  stock_disponible: number | null;
  precio_min_venta: number | null;
  tiene_iva: boolean | null;
  requiere_receta: boolean | null;

  cantidad: string; // entero
  precio_unit: string; // decimal
};

export type VentaDraft = {
  cliente: Cliente | null;
  comentarios: string;
  receta_uri: string | null; // preview local (se sube al guardar)
  lineas: VentaLinea[];
};

const initialDraft: VentaDraft = {
  cliente: null,
  comentarios: "",
  receta_uri: null,
  lineas: [
    {
      key: "l1",
      producto_id: null,
      producto_label: "",
      stock_disponible: null,
      precio_min_venta: null,
      tiene_iva: null,
      requiere_receta: null,
      cantidad: "1",
      precio_unit: "",
    },
  ],
};

type Ctx = {
  draft: VentaDraft;

  setCliente: (c: Cliente | null) => void;
  setComentarios: (s: string) => void;
  setRecetaUri: (uri: string | null) => void;

  addLinea: () => void;
  removeLinea: (key: string) => void;
  updateLinea: (key: string, patch: Partial<VentaLinea>) => void;
  setProductoEnLinea: (args: {
    lineKey: string;
    producto_id: number;
    producto_label: string;
    stock_disponible: number;
    precio_min_venta: number | null;
    tiene_iva: boolean;
    requiere_receta: boolean;
  }) => void;

  reset: () => void;
};

const VentaDraftContext = createContext<Ctx | null>(null);

function fmtMoney2(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return "";
  return Number(n).toFixed(2);
}

export function VentaDraftProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<VentaDraft>(initialDraft);

  const api = useMemo<Ctx>(() => {
    return {
      draft,

      setCliente: (c) => setDraft((d) => ({ ...d, cliente: c })),
      setComentarios: (s) => setDraft((d) => ({ ...d, comentarios: s })),
      setRecetaUri: (uri) => setDraft((d) => ({ ...d, receta_uri: uri })),

      addLinea: () =>
        setDraft((d) => ({
          ...d,
          lineas: [
            ...d.lineas,
            {
              key: `l${d.lineas.length + 1}-${Date.now()}`,
              producto_id: null,
              producto_label: "",
              stock_disponible: null,
              precio_min_venta: null,
              tiene_iva: null,
              requiere_receta: null,
              cantidad: "1",
              precio_unit: "",
            },
          ],
        })),

      removeLinea: (key) =>
        setDraft((d) => {
          const exists = d.lineas.some((l) => l.key === key);
          if (!exists) return d;

          if (d.lineas.length === 1) {
            const only = d.lineas[0];
            if (only.key !== key) return d;
            return {
              ...d,
              lineas: [
                {
                  ...only,
                  producto_id: null,
                  producto_label: "",
                  stock_disponible: null,
                  precio_min_venta: null,
                  tiene_iva: null,
                  requiere_receta: null,
                  cantidad: "1",
                  precio_unit: "",
                },
              ],
            };
          }

          return { ...d, lineas: d.lineas.filter((l) => l.key !== key) };
        }),

      updateLinea: (key, patch) =>
        setDraft((d) => ({
          ...d,
          lineas: d.lineas.map((l) => (l.key === key ? { ...l, ...patch } : l)),
        })),

      setProductoEnLinea: ({
        lineKey,
        producto_id,
        producto_label,
        stock_disponible,
        precio_min_venta,
        tiene_iva,
        requiere_receta,
      }) =>
        setDraft((d) => ({
          ...d,
          lineas: d.lineas.map((l) =>
            l.key === lineKey
              ? {
                  ...l,
                  producto_id,
                  producto_label,
                  stock_disponible,
                  precio_min_venta,
                  tiene_iva,
                  requiere_receta,
                  // UX: autollenar con el minimo (editable)
                  precio_unit: fmtMoney2(precio_min_venta),
                }
              : l
          ),
        })),

      reset: () => setDraft(initialDraft),
    };
  }, [draft]);

  return <VentaDraftContext.Provider value={api}>{children}</VentaDraftContext.Provider>;
}

export function useVentaDraft() {
  const ctx = useContext(VentaDraftContext);
  if (!ctx) throw new Error("useVentaDraft debe usarse dentro de VentaDraftProvider");
  return ctx;
}
