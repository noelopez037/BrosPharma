/** Formatea un valor numérico como moneda guatemalteca: "Q 1,234.56". Retorna "—" si nulo/NaN. */
export function fmtQ(n: string | number | null | undefined): string {
  if (n == null) return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `Q ${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Extrae YYYY-MM-DD de un ISO string. Retorna "—" si vacío. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return String(iso).slice(0, 10);
}

/** Convierte un timestamp UTC a fecha local Guatemala (YYYY-MM-DD).
 *  Guatemala siempre es UTC-6 sin DST.
 *  Normaliza el formato de Supabase ("2026-04-06 03:00:57+00") antes de parsear.
 */
export function toGTDateKey(iso: string | null | undefined): string {
  if (!iso) return "";
  // Supabase returns "2026-04-06 03:00:57.123456+00" — normalize to valid ISO 8601
  const normalized = String(iso)
    .replace(" ", "T")          // space → T
    .replace(/\+00$/, "+00:00") // +00 → +00:00
    .replace(/\+00:00:00$/, "+00:00"); // just in case
  const d = new Date(normalized);
  if (!Number.isFinite(d.getTime())) return String(iso).slice(0, 10);
  // Guatemala = UTC-6, no DST — subtract 6 hours then read UTC date
  const gt = new Date(d.getTime() - 6 * 60 * 60 * 1000);
  return gt.toISOString().slice(0, 10);
}

/** Formatea ISO datetime como "YYYY-MM-DD HH:MM". Retorna "—" si vacío. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = String(iso).replace("T", " ");
  return s.slice(0, 16);
}

/** Formatea un ISO/YMD como fecha larga en español: "lunes, 01 de ene de 2025". */
export function fmtDateLongEs(isoOrYmd: string | null | undefined): string {
  if (!isoOrYmd) return "—";
  const raw = String(isoOrYmd).trim();
  if (!raw) return "—";
  if (raw.toUpperCase() === "SIN_FECHA" || raw.toLowerCase() === "sin fecha") return "Sin fecha";
  const ymd = raw.slice(0, 10);
  const d = new Date(`${ymd}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
    .format(d)
    .toLowerCase()
    .replace(/\./g, "");
}

/** Rellena con cero a la izquierda hasta 2 dígitos. */
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Parsea un string a entero, eliminando caracteres no numéricos. Retorna 0 si inválido. */
export function parseIntSafe(s: string): number {
  const n = Number(String(s ?? "").replace(/[^0-9]/g, ""));
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

/** Parsea un string a decimal, eliminando caracteres no numéricos (excepto punto). Retorna 0 si inválido. */
export function parseDecimalSafe(s: string): number {
  const n = Number(String(s ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
