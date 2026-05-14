-- Agrega columna `productos` (array de nombres) a vw_cxc_ventas
-- para permitir búsqueda por producto en la pantalla CxC.
CREATE OR REPLACE VIEW public.vw_cxc_ventas AS
WITH totales AS (
  SELECT v1.id AS venta_id,
    v1.empresa_id,
    COALESCE(sum(vd.subtotal), 0::numeric) AS total
  FROM ventas v1
    JOIN ventas_detalle vd ON vd.empresa_id = v1.empresa_id AND vd.venta_id = v1.id
  WHERE (v1.estado = ANY (ARRAY['FACTURADO'::text, 'EN_RUTA'::text, 'ENTREGADO'::text]))
    AND NOT (EXISTS (
      SELECT 1 FROM ventas_tags vt
      WHERE vt.empresa_id = v1.empresa_id AND vt.venta_id = v1.id AND vt.tag = 'ANULADO'::text AND vt.removed_at IS NULL
    ))
  GROUP BY v1.id, v1.empresa_id
), pagos AS (
  SELECT vp.venta_id,
    vp.empresa_id,
    COALESCE(sum(vp.monto), 0::numeric) AS pagado,
    min(vp.fecha) AS fecha_primer_pago,
    max(vp.fecha) AS fecha_ultimo_pago
  FROM ventas_pagos vp
  GROUP BY vp.venta_id, vp.empresa_id
), facturas AS (
  SELECT vf.venta_id,
    vf.empresa_id,
    array_agg(vf.numero_factura ORDER BY vf.numero_factura) AS facturas
  FROM ventas_facturas vf
  WHERE vf.numero_factura IS NOT NULL
  GROUP BY vf.venta_id, vf.empresa_id
), prods AS (
  SELECT vd.venta_id,
    vd.empresa_id,
    array_agg(DISTINCT p.nombre ORDER BY p.nombre) AS productos
  FROM ventas_detalle vd
    JOIN productos p ON p.empresa_id = vd.empresa_id AND p.id = vd.producto_id
  GROUP BY vd.venta_id, vd.empresa_id
)
SELECT v.id AS venta_id,
  v.fecha,
  v.fecha + '30 days'::interval AS fecha_vencimiento,
  c.id AS cliente_id,
  c.nombre AS cliente_nombre,
  v.vendedor_id,
  v.vendedor_codigo,
  t.total,
  COALESCE(p.pagado, 0::numeric) AS pagado,
  t.total - COALESCE(p.pagado, 0::numeric) AS saldo,
  f.facturas,
  p.fecha_primer_pago,
  p.fecha_ultimo_pago,
  v.empresa_id,
  v.estado,
  pr.productos
FROM ventas v
  JOIN clientes c ON c.empresa_id = v.empresa_id AND c.id = v.cliente_id
  JOIN totales t ON t.empresa_id = v.empresa_id AND t.venta_id = v.id
  LEFT JOIN pagos p ON p.empresa_id = v.empresa_id AND p.venta_id = v.id
  LEFT JOIN facturas f ON f.empresa_id = v.empresa_id AND f.venta_id = v.id
  LEFT JOIN prods pr ON pr.empresa_id = v.empresa_id AND pr.venta_id = v.id
WHERE (v.estado = ANY (ARRAY['FACTURADO'::text, 'EN_RUTA'::text, 'ENTREGADO'::text]))
  AND NOT (EXISTS (
    SELECT 1 FROM ventas_tags vt
    WHERE vt.empresa_id = v.empresa_id AND vt.venta_id = v.id AND vt.tag = 'ANULADO'::text AND vt.removed_at IS NULL
  ));
