import type { VentaSolicitudAdminAccion } from "./pushPayload";

type RouterLike = {
  push: (href: any) => void;
  replace: (href: any) => void;
};

export function navigateToVentaFromNotif(
  router: RouterLike,
  ventaId: number,
  extra?: {
    ensureBaseRoute?: boolean;
    baseRoute?: string;
    notif?: "VENTA_SOLICITUD_ADMIN";
    accion?: VentaSolicitudAdminAccion | null;
    nota?: string | null;
    clienteNombre?: string | null;
    vendedorCodigo?: string | null;
  }
): void {
  const id = Number(ventaId);
  if (!Number.isFinite(id) || id <= 0) return;

  const ensureBaseRoute = extra?.ensureBaseRoute ?? false;
  const baseRoute = String(extra?.baseRoute ?? "").trim() || "/(drawer)/(tabs)/ventas";
  if (ensureBaseRoute) {
    router.replace(baseRoute as any);
  }

  const params: Record<string, string> = { ventaId: String(id) };
  if (extra?.notif) params.notif = String(extra.notif);
  if (extra?.accion) params.accion = String(extra.accion);
  if (extra?.nota) params.nota = String(extra.nota);
  if (extra?.clienteNombre) params.clienteNombre = String(extra.clienteNombre);
  if (extra?.vendedorCodigo) params.vendedorCodigo = String(extra.vendedorCodigo);

  router.push({ pathname: "/venta-detalle", params } as any);
}
