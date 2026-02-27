const CACHE_TTL_MS = 60_000;

export type ProductoHead = {
  id: number;
  nombre: string;
  marca: string | null;
  image_path: string | null;
  activo: boolean;
  tiene_iva: boolean;
  requiere_receta: boolean;
  precio_min_venta: number | null;
};

export type LoteDetalle = {
  lote_id: number | null;
  lote: string | null;
  fecha_exp: string | null;
  stock_total: number;
  stock_reservado: number;
  stock_disponible: number;
};

export type ProductoDetalle = {
  head: ProductoHead;
  lotes: LoteDetalle[];
};

type CacheEntry = {
  data: ProductoDetalle;
  ts: number;
};

const cache = new Map<number, CacheEntry>();

export function getCached(id: number): ProductoDetalle | null {
  const entry = cache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(id);
    return null;
  }
  return entry.data;
}

export function setCached(id: number, data: ProductoDetalle): void {
  cache.set(id, { data, ts: Date.now() });
}

export function invalidate(id: number): void {
  cache.delete(id);
}

export function invalidateAll(): void {
  cache.clear();
}
