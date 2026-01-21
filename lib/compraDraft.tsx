// lib/compraDraft.tsx
// ✅ CAMBIO: removeLinea() ahora si solo queda 1 línea, la “limpia” en vez de no hacer nada.
// (Esto hace que el botón Eliminar “funcione” incluso con una sola línea.)

import React, { createContext, useContext, useMemo, useState } from "react";

export type Proveedor = {
  id: number;
  nombre: string;
  telefono?: string | null;
  activo?: boolean;
};

export type Linea = {
  key: string;
  producto_id: number | null;
  producto_label: string;
  lote: string;
  fecha_exp: string | null; // YYYY-MM-DD
  cantidad: string;
  precio: string;

  // ✅ NUEVO: para foto tomada desde “nueva compra”
  image_path: string | null; // path en Supabase Storage (bucket "productos")
  image_uri: string | null; // uri local (preview), no se manda al RPC
};

export type CompraDraft = {
  proveedor: Proveedor | null;
  numeroFactura: string;
  tipoPago: "CONTADO" | "CREDITO";
  comentarios: string;
  fechaVenc: string | null;
  lineas: Linea[];
};

const initialDraft: CompraDraft = {
  proveedor: null,
  numeroFactura: "",
  tipoPago: "CONTADO",
  comentarios: "",
  fechaVenc: null,
  lineas: [
    {
      key: "l1",
      producto_id: null,
      producto_label: "",
      lote: "",
      fecha_exp: null,
      cantidad: "1",
      precio: "0",
      image_path: null,
      image_uri: null,
    },
  ],
};

type Ctx = {
  draft: CompraDraft;

  setProveedor: (p: Proveedor | null) => void;
  setNumeroFactura: (s: string) => void;
  setTipoPago: (t: "CONTADO" | "CREDITO") => void;
  setComentarios: (s: string) => void;
  setFechaVenc: (s: string | null) => void;

  addLinea: () => void;
  removeLinea: (key: string) => void;
  updateLinea: (key: string, patch: Partial<Linea>) => void;
  setProductoEnLinea: (lineKey: string, producto_id: number, producto_label: string) => void;

  reset: () => void;
};

const CompraDraftContext = createContext<Ctx | null>(null);

export function CompraDraftProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<CompraDraft>(initialDraft);

  const api = useMemo<Ctx>(() => {
    return {
      draft,

      setProveedor: (p) => setDraft((d) => ({ ...d, proveedor: p })),
      setNumeroFactura: (s) => setDraft((d) => ({ ...d, numeroFactura: s })),
      setTipoPago: (t) =>
        setDraft((d) => ({
          ...d,
          tipoPago: t,
          fechaVenc: t === "CREDITO" ? d.fechaVenc : null,
        })),
      setComentarios: (s) => setDraft((d) => ({ ...d, comentarios: s })),
      setFechaVenc: (s) => setDraft((d) => ({ ...d, fechaVenc: s })),

      addLinea: () =>
        setDraft((d) => ({
          ...d,
          lineas: [
            ...d.lineas,
            {
              key: `l${d.lineas.length + 1}-${Date.now()}`,
              producto_id: null,
              producto_label: "",
              lote: "",
              fecha_exp: null,
              cantidad: "1",
              precio: "0",
              image_path: null,
              image_uri: null,
            },
          ],
        })),

      removeLinea: (key) =>
        setDraft((d) => {
          const exists = d.lineas.some((l) => l.key === key);
          if (!exists) return d;

          if (d.lineas.length === 1) {
            // ✅ antes: no hacía nada
            // ✅ ahora: limpia la única línea
            const only = d.lineas[0];
            if (only.key !== key) return d;
            return {
              ...d,
              lineas: [
                {
                  ...only,
                  producto_id: null,
                  producto_label: "",
                  lote: "",
                  fecha_exp: null,
                  cantidad: "1",
                  precio: "0",
                  image_path: null,
                  image_uri: null,
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

      setProductoEnLinea: (lineKey, producto_id, producto_label) =>
        setDraft((d) => ({
          ...d,
          lineas: d.lineas.map((l) =>
            l.key === lineKey
              ? {
                  ...l,
                  producto_id,
                  producto_label,
                  // ✅ si cambian de producto, limpiar foto anterior
                  image_path: null,
                  image_uri: null,
                }
              : l
          ),
        })),

      reset: () => setDraft(initialDraft),
    };
  }, [draft]);

  return <CompraDraftContext.Provider value={api}>{children}</CompraDraftContext.Provider>;
}

export function useCompraDraft() {
  const ctx = useContext(CompraDraftContext);
  if (!ctx) throw new Error("useCompraDraft debe usarse dentro de CompraDraftProvider");
  return ctx;
}
