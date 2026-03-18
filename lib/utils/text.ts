/** Normaliza un valor a string uppercase sin espacios extras. */
export function normalizeUpper(v: string | number | null | undefined): string {
  return String(v ?? "").trim().toUpperCase();
}

/** Escapa caracteres especiales de LIKE/ILIKE (%, _) y limpia paréntesis/comas para uso seguro en queries Supabase. */
export function safeIlike(input: string): string {
  return String(input ?? "")
    .replace(/[%_]/g, "\\$&")
    .replace(/[(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
