-- Fix: fan-out en JOINs de utilidad por (lote_id, producto_id)
-- El JOIN directo a compras_detalle produce duplicados cuando el mismo lote tiene
-- varias filas en compras_detalle. DISTINCT ON garantiza una sola fila por lote/producto.
-- Afecta: rpc_reporte_utilidad_productos_v3, rpc_reporte_utilidad_resumen
-- (v1 y v2 son versiones obsoletas pero también se corrigen por consistencia)

CREATE OR REPLACE FUNCTION "public"."rpc_reporte_utilidad_productos_v3"(
  "p_desde" timestamp with time zone,
  "p_hasta" timestamp with time zone
)
RETURNS TABLE(
  "producto_id"              bigint,
  "producto_nombre"          text,
  "marca_id"                 bigint,
  "marca_nombre"             text,
  "unidades_vendidas"        bigint,
  "total_ventas"             numeric,
  "costo_total"              numeric,
  "utilidad_bruta"           numeric,
  "margen_pct"               numeric,
  "participacion_utilidad_pct" numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  with base as (
    select
      d.producto_id,
      p.nombre as producto_nombre,
      p.marca_id,
      m.nombre as marca_nombre,
      sum(d.cantidad)::bigint                  as unidades_vendidas,
      sum(d.cantidad * d.precio_venta_unit)    as total_ventas,
      sum(d.cantidad * cd.precio_compra_unit)  as costo_total
    from public.ventas_detalle d
    join public.ventas v on v.id = d.venta_id
    join (
      select distinct on (lote_id, producto_id)
        lote_id, producto_id, precio_compra_unit
      from public.compras_detalle
      order by lote_id, producto_id, id
    ) cd on cd.lote_id    = d.lote_id
        and cd.producto_id = d.producto_id
    join public.productos p on p.id = d.producto_id
    left join public.marcas m on m.id = p.marca_id
    where v.created_at >= p_desde
      and v.created_at <  p_hasta
      and not exists (
        select 1
        from public.ventas_tags vt
        where vt.venta_id = v.id
          and vt.tag = 'ANULADO'
          and vt.removed_at is null
      )
    group by d.producto_id, p.nombre, p.marca_id, m.nombre
  ),
  totales as (
    select sum(total_ventas - costo_total) as utilidad_total
    from base
  )
  select
    b.producto_id,
    b.producto_nombre,
    b.marca_id,
    b.marca_nombre,
    b.unidades_vendidas,
    b.total_ventas,
    b.costo_total,
    (b.total_ventas - b.costo_total) as utilidad_bruta,
    case when b.total_ventas = 0 then null
      else ((b.total_ventas - b.costo_total) / b.total_ventas) * 100
    end as margen_pct,
    case when t.utilidad_total = 0 then null
      else ((b.total_ventas - b.costo_total) / t.utilidad_total) * 100
    end as participacion_utilidad_pct
  from base b
  cross join totales t
  order by utilidad_bruta desc;
$$;

-- Fix same fan-out in rpc_reporte_utilidad_resumen
CREATE OR REPLACE FUNCTION "public"."rpc_reporte_utilidad_resumen"(
  "p_desde" timestamp with time zone,
  "p_hasta" timestamp with time zone
)
RETURNS TABLE(
  "unidades_vendidas" bigint,
  "total_ventas"      numeric,
  "costo_total"       numeric,
  "utilidad_bruta"    numeric,
  "margen"            numeric,
  "margen_pct"        numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  with base as (
    select
      d.cantidad::bigint              as unidades,
      (d.cantidad * d.precio_venta_unit)   as venta,
      (d.cantidad * cd.precio_compra_unit) as costo
    from public.ventas_detalle d
    join public.ventas v on v.id = d.venta_id
    join (
      select distinct on (lote_id, producto_id)
        lote_id, producto_id, precio_compra_unit
      from public.compras_detalle
      order by lote_id, producto_id, id
    ) cd on cd.lote_id    = d.lote_id
        and cd.producto_id = d.producto_id
    where v.created_at >= p_desde
      and v.created_at <  p_hasta
      and not exists (
        select 1
        from public.ventas_tags vt
        where vt.venta_id = v.id
          and vt.tag = 'ANULADO'
          and vt.removed_at is null
      )
  )
  select
    sum(unidades) as unidades_vendidas,
    sum(venta) as total_ventas,
    sum(costo) as costo_total,
    sum(venta) - sum(costo) as utilidad_bruta,
    case when sum(venta) = 0 then null else (sum(venta) - sum(costo)) / sum(venta) end as margen,
    case when sum(venta) = 0 then null else ((sum(venta) - sum(costo)) / sum(venta)) * 100 end as margen_pct
  from base;
$$;
