-- Creates/updates RPC for Kardex detail by product.
-- Run this in Supabase SQL editor.

create or replace function public.rpc_kardex_producto_detallado(
  p_producto_id bigint,
  p_desde timestamptz,
  p_hasta timestamptz
)
returns table (
  fecha timestamptz,
  tipo text,
  compra_id bigint,
  venta_id bigint,
  estado text,
  proveedor text,
  cliente text,
  lote_id bigint,
  lote text,
  entrada numeric,
  salida numeric,
  saldo numeric
)
language sql
security definer
set search_path = public
as $$
with ventas_validas as (
  select v.*
  from ventas v
  where v.anulado_at is null
    and v.canceled_at is null
    and coalesce(upper(v.estado), '') <> 'ANULADA'
    and not exists (
      select 1
      from ventas_tags t
      where t.venta_id = v.id
        and t.tag = 'ANULADO'
        and t.removed_at is null
    )
),

saldo_inicial as (
  select
    coalesce(sum(x.entrada), 0) - coalesce(sum(x.salida), 0) as saldo0
  from (
    select cd.cantidad::numeric as entrada, 0::numeric as salida
    from compras_detalle cd
    join compras c on c.id = cd.compra_id
    where cd.producto_id = p_producto_id
      and c.fecha < p_desde
      and coalesce(upper(c.estado), '') <> 'ANULADA'

    union all

    select 0::numeric as entrada, vd.cantidad::numeric as salida
    from ventas_detalle vd
    join ventas_validas v on v.id = vd.venta_id
    where vd.producto_id = p_producto_id
      and v.fecha < p_desde
  ) x
),

movs as (
  -- COMPRA (entrada)
  select
    c.fecha as fecha,
    'COMPRA'::text as tipo,
    cd.compra_id::bigint as compra_id,
    null::bigint as venta_id,
    null::text as estado,
    p.nombre::text as proveedor,
    null::text as cliente,
    cd.lote_id::bigint as lote_id,
    pl.lote::text as lote,
    cd.cantidad::numeric as entrada,
    null::numeric as salida
  from compras_detalle cd
  join compras c on c.id = cd.compra_id
  left join proveedores p on p.id = c.proveedor_id
  left join producto_lotes pl on pl.id = cd.lote_id
  where cd.producto_id = p_producto_id
    and c.fecha >= p_desde
    and c.fecha <= p_hasta
    and coalesce(upper(c.estado), '') <> 'ANULADA'

  union all

  -- VENTA (salida)
  select
    v.fecha as fecha,
    'VENTA'::text as tipo,
    null::bigint as compra_id,
    vd.venta_id::bigint as venta_id,
    v.estado::text as estado,
    null::text as proveedor,
    coalesce(cli.nombre, v.cliente_nombre)::text as cliente,
    vd.lote_id::bigint as lote_id,
    pl.lote::text as lote,
    null::numeric as entrada,
    vd.cantidad::numeric as salida
  from ventas_detalle vd
  join ventas_validas v on v.id = vd.venta_id
  left join clientes cli on cli.id = v.cliente_id
  left join producto_lotes pl on pl.id = vd.lote_id
  where vd.producto_id = p_producto_id
    and v.fecha >= p_desde
    and v.fecha <= p_hasta
)

select
  m.fecha,
  m.tipo,
  m.compra_id,
  m.venta_id,
  m.estado,
  m.proveedor,
  m.cliente,
  m.lote_id,
  m.lote,
  m.entrada,
  m.salida,
  (select saldo0 from saldo_inicial)
    + sum(coalesce(m.entrada, 0) - coalesce(m.salida, 0))
      over (order by m.fecha, m.tipo, coalesce(m.compra_id, 0), coalesce(m.venta_id, 0))
    as saldo
from movs m
order by m.fecha, m.tipo, coalesce(m.compra_id, 0), coalesce(m.venta_id, 0);
$$;

grant execute on function public.rpc_kardex_producto_detallado(bigint, timestamptz, timestamptz) to authenticated;
