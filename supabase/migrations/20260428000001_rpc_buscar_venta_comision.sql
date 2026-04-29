-- Búsqueda de ventas pagadas por número de factura o nombre de cliente.
-- Usado desde la pantalla Comisiones para localizar una venta sin conocer el mes.
CREATE OR REPLACE FUNCTION public.rpc_buscar_venta_comision(
  p_empresa_id bigint,
  p_busqueda   text
)
RETURNS SETOF public.vw_cxc_ventas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rol text;
  v_uid uuid := auth.uid();
  v_q   text := '%' || lower(trim(p_busqueda)) || '%';
BEGIN
  IF NOT public.tiene_membresia_activa(p_empresa_id) THEN
    RAISE EXCEPTION 'NO_MEMBRESIA';
  END IF;

  SELECT upper(coalesce(eu.rol_empresa, ''))
    INTO v_rol
  FROM public.empresa_usuarios eu
  WHERE eu.user_id    = v_uid
    AND eu.empresa_id = p_empresa_id
    AND eu.estado     = 'ACTIVO'
  LIMIT 1;

  IF v_rol = 'ADMIN' THEN
    RETURN QUERY
      SELECT * FROM public.vw_cxc_ventas v
      WHERE v.empresa_id = p_empresa_id
        AND v.saldo      <= 0
        AND (
          lower(v.cliente_nombre) LIKE v_q
          OR EXISTS (
            SELECT 1 FROM public.ventas_facturas vf
            WHERE vf.empresa_id      = p_empresa_id
              AND vf.venta_id        = v.venta_id
              AND lower(vf.numero_factura) LIKE v_q
          )
        )
      ORDER BY v.fecha_ultimo_pago DESC
      LIMIT 100;
  ELSE
    RETURN QUERY
      SELECT * FROM public.vw_cxc_ventas v
      WHERE v.empresa_id  = p_empresa_id
        AND v.saldo       <= 0
        AND v.vendedor_id = v_uid
        AND (
          lower(v.cliente_nombre) LIKE v_q
          OR EXISTS (
            SELECT 1 FROM public.ventas_facturas vf
            WHERE vf.empresa_id      = p_empresa_id
              AND vf.venta_id        = v.venta_id
              AND lower(vf.numero_factura) LIKE v_q
          )
        )
      ORDER BY v.fecha_ultimo_pago DESC
      LIMIT 100;
  END IF;
END;
$$;
