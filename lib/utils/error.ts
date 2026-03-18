/** Sanitiza mensajes de error de Supabase/PostgreSQL para no exponer detalles internos al usuario. */
export function userMsg(e: unknown, fallback: string): string {
  if (!e) return fallback;
  const raw = typeof e === "object" && e !== null && "message" in e
    ? String((e as any).message ?? "")
    : String(e ?? "");

  // Patrones que exponen estructura interna de la BD
  if (
    raw.includes("violates row-level security") ||
    raw.includes("violates unique constraint") ||
    raw.includes("violates foreign key") ||
    raw.includes("violates check constraint") ||
    raw.includes("violates not-null constraint") ||
    raw.includes("permission denied") ||
    raw.includes("relation \"") ||
    raw.includes("function ") && raw.includes("does not exist") ||
    raw.includes("column \"") ||
    raw.includes("syntax error")
  ) {
    // Casos específicos que podemos traducir
    if (raw.includes("ux_clientes_nit")) return "Ese NIT ya existe.";
    if (raw.includes("violates row-level security")) return "No tienes permiso para esta operación.";
    if (raw.includes("violates unique constraint")) return "Este registro ya existe.";
    return fallback;
  }

  return raw || fallback;
}
