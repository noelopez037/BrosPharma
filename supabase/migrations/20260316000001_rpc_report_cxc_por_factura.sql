-- rpc_report_cxc_por_factura
-- Devuelve una fila por cada factura de las ventas con saldo pendiente.
-- Pagos directos (factura_id IS NOT NULL) se aplican a su factura.
-- Pagos sueltos (factura_id IS NULL) se distribuyen proporcionalmente
-- según el peso de cada factura sobre el total de facturas de esa venta
-- (fallback para datos históricos sin factura_id en pagos).
-- Ventas sin ninguna factura registrada aparecen como una sola fila.

CREATE OR REPLACE FUNCTION public.rpc_report_cxc_por_factura(p_empresa_id bigint)
RETURNS TABLE (
  venta_id          bigint,
  fecha             timestamptz,
  fecha_vencimiento date,
  cliente_nombre    text,
  vendedor_codigo   text,
  numero_factura    text,
  monto_total       numeric,
  pagado            numeric,
  saldo             numeric,
  estado            text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rol text;
  v_uid uuid := auth.uid();
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

  RETURN QUERY
  WITH
  -- Ventas válidas (excluye anuladas, igual que vw_cxc_ventas)
  ventas_base AS (
    SELECT
      v.id              AS venta_id,
      v.empresa_id,
      v.fecha,
      v.vendedor_id,
      v.vendedor_codigo,
      v.estado,
      c.nombre          AS cliente_nombre
    FROM ventas v
    JOIN clientes c ON c.empresa_id = v.empresa_id AND c.id = v.cliente_id
    WHERE v.empresa_id = p_empresa_id
      AND v.estado = ANY (ARRAY['FACTURADO','EN_RUTA','ENTREGADO'])
      AND NOT EXISTS (
        SELECT 1 FROM ventas_tags vt
        WHERE vt.empresa_id   = v.empresa_id
          AND vt.venta_id     = v.id
          AND vt.tag          = 'ANULADO'
          AND vt.removed_at   IS NULL
      )
      AND (v_rol = 'ADMIN' OR v.vendedor_id = v_uid)
  ),

  -- Total de cada venta desde ventas_detalle (fallback para ventas sin facturas)
  totales_venta AS (
    SELECT
      vd.empresa_id,
      vd.venta_id,
      COALESCE(SUM(vd.subtotal), 0) AS total
    FROM ventas_detalle vd
    WHERE vd.empresa_id = p_empresa_id
      AND EXISTS (
        SELECT 1 FROM ventas_base vb
        WHERE vb.venta_id = vd.venta_id AND vb.empresa_id = vd.empresa_id
      )
    GROUP BY vd.empresa_id, vd.venta_id
  ),

  -- Facturas con su peso relativo dentro de la venta
  facturas_con_peso AS (
    SELECT
      vf.id                                                                    AS factura_id,
      vf.venta_id,
      vf.empresa_id,
      vf.numero_factura,
      vf.monto_total,
      vf.fecha_vencimiento,
      SUM(vf.monto_total) OVER (PARTITION BY vf.empresa_id, vf.venta_id)      AS total_facturas_venta
    FROM ventas_facturas vf
    WHERE vf.empresa_id = p_empresa_id
      AND EXISTS (
        SELECT 1 FROM ventas_base vb
        WHERE vb.venta_id = vf.venta_id AND vb.empresa_id = vf.empresa_id
      )
  ),

  -- Pagos directos: tienen factura_id
  pagos_directos AS (
    SELECT
      vp.empresa_id,
      vp.factura_id,
      COALESCE(SUM(vp.monto), 0) AS pagado
    FROM ventas_pagos vp
    WHERE vp.empresa_id  = p_empresa_id
      AND vp.factura_id  IS NOT NULL
    GROUP BY vp.empresa_id, vp.factura_id
  ),

  -- Pagos sueltos: sin factura_id, se distribuirán proporcionalmente
  pagos_libres AS (
    SELECT
      vp.empresa_id,
      vp.venta_id,
      COALESCE(SUM(vp.monto), 0) AS pagado_libre
    FROM ventas_pagos vp
    WHERE vp.empresa_id = p_empresa_id
      AND vp.factura_id IS NULL
    GROUP BY vp.empresa_id, vp.venta_id
  )

  -- Caso 1: ventas CON facturas — una fila por factura
  SELECT
    vb.venta_id,
    vb.fecha,
    fp.fecha_vencimiento,
    vb.cliente_nombre,
    vb.vendedor_codigo,
    fp.numero_factura,
    fp.monto_total,
    ROUND(
      COALESCE(pd.pagado, 0)
      + CASE
          WHEN COALESCE(fp.total_facturas_venta, 0) > 0
          THEN COALESCE(pl.pagado_libre, 0) * (fp.monto_total / fp.total_facturas_venta)
          ELSE 0
        END,
    2) AS pagado,
    ROUND(
      fp.monto_total
      - COALESCE(pd.pagado, 0)
      - CASE
          WHEN COALESCE(fp.total_facturas_venta, 0) > 0
          THEN COALESCE(pl.pagado_libre, 0) * (fp.monto_total / fp.total_facturas_venta)
          ELSE 0
        END,
    2) AS saldo,
    vb.estado
  FROM ventas_base vb
  JOIN  facturas_con_peso fp ON fp.empresa_id = vb.empresa_id AND fp.venta_id = vb.venta_id
  LEFT JOIN pagos_directos pd ON pd.empresa_id = fp.empresa_id AND pd.factura_id = fp.factura_id
  LEFT JOIN pagos_libres   pl ON pl.empresa_id = vb.empresa_id AND pl.venta_id  = vb.venta_id

  UNION ALL

  -- Caso 2: ventas SIN facturas — una fila con el total de ventas_detalle
  SELECT
    vb.venta_id,
    vb.fecha,
    NULL::date       AS fecha_vencimiento,
    vb.cliente_nombre,
    vb.vendedor_codigo,
    ''::text         AS numero_factura,
    tv.total         AS monto_total,
    ROUND(COALESCE(pl.pagado_libre, 0), 2) AS pagado,
    ROUND(tv.total - COALESCE(pl.pagado_libre, 0), 2) AS saldo,
    vb.estado
  FROM ventas_base vb
  JOIN  totales_venta tv ON tv.empresa_id = vb.empresa_id AND tv.venta_id = vb.venta_id
  LEFT JOIN pagos_libres pl ON pl.empresa_id = vb.empresa_id AND pl.venta_id = vb.venta_id
  WHERE NOT EXISTS (
    SELECT 1 FROM ventas_facturas vf
    WHERE vf.empresa_id = vb.empresa_id AND vf.venta_id = vb.venta_id
  )

  ORDER BY fecha DESC, venta_id, numero_factura;
END;
$$;
