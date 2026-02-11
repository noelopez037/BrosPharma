export type VentaSolicitudAdminAccion = "ANULACION" | "EDICION" | "REFACTURACION";

export type VentaSolicitudAdminNotifParsed = {
  type: "VENTA_SOLICITUD_ADMIN";
  ventaId: number;
  accion: VentaSolicitudAdminAccion | null;
  nota: string | null;
  tag: string | null;
  estado: string | null;
  clienteNombre: string | null;
  vendedorCodigo: string | null;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === "object" && v != null && !Array.isArray(v);
}

function normalizeUpper(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

function pickStr(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function pickNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

function extractType(raw: unknown): string {
  if (!isRecord(raw)) return "";
  const d = raw;
  const payload = isRecord(d.payload) ? d.payload : null;

  return (
    pickStr(d.type) ||
    pickStr(d.kind) ||
    pickStr(d.notificationType) ||
    (payload ? pickStr(payload.type) || pickStr(payload.kind) || pickStr(payload.notificationType) : null) ||
    ""
  );
}

export function parseVentaSolicitudAdminNotifData(raw: unknown): VentaSolicitudAdminNotifParsed | null {
  const t0 = normalizeUpper(extractType(raw));
  if (t0 !== "VENTA_SOLICITUD_ADMIN") return null;
  if (!isRecord(raw)) return null;

  const d = raw;
  const payload = isRecord(d.payload) ? d.payload : null;

  const ventaId =
    pickNumber(d.venta_id) ??
    (payload ? pickNumber(payload.venta_id) : null) ??
    pickNumber(d.ventaId) ??
    (payload ? pickNumber(payload.ventaId) : null);

  if (!ventaId || ventaId <= 0) return null;

  const accionRaw =
    (payload ? pickStr(payload.accion) : null) ??
    pickStr(d.accion) ??
    (payload ? pickStr(payload.action) : null) ??
    pickStr(d.action);

  const accionUp = normalizeUpper(accionRaw);
  const accion: VentaSolicitudAdminAccion | null =
    accionUp === "ANULACION"
      ? "ANULACION"
      : accionUp === "EDICION"
        ? "EDICION"
        : accionUp === "REFACTURACION"
          ? "REFACTURACION"
          : null;

  const nota =
    (payload ? pickStr(payload.nota) : null) ??
    pickStr(d.nota) ??
    (payload ? pickStr(payload.note) : null) ??
    pickStr(d.note);

  const tag = (payload ? pickStr(payload.tag) : null) ?? pickStr(d.tag) ?? (payload ? pickStr(payload.solicitud_tag) : null) ?? pickStr(d.solicitud_tag);
  const estado = (payload ? pickStr(payload.estado) : null) ?? pickStr(d.estado);
  const clienteNombre =
    (payload ? pickStr(payload.cliente_nombre) : null) ??
    pickStr(d.cliente_nombre) ??
    (payload ? pickStr(payload.clienteNombre) : null) ??
    pickStr(d.clienteNombre);
  const vendedorCodigo =
    (payload ? pickStr(payload.vendedor_codigo) : null) ??
    pickStr(d.vendedor_codigo) ??
    (payload ? pickStr(payload.vendedorCodigo) : null) ??
    pickStr(d.vendedorCodigo);

  return {
    type: "VENTA_SOLICITUD_ADMIN",
    ventaId: Number(ventaId),
    accion,
    nota,
    tag,
    estado,
    clienteNombre,
    vendedorCodigo,
  };
}
