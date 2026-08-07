-- El kardex mostraba la reserva de stock de una venta en su fecha de CREACION,
-- aunque la venta se haya editado despues (cambiando cantidades/productos).
-- Esto hacia parecer sobregiros de stock que en realidad no existieron: la
-- cantidad real solo quedo fijada en la edicion, no en la creacion.
-- Ahora usa la fecha de la ULTIMA edicion (evento 'EDITADA') si existe,
-- igual que ya se hace para la entrega (venta_entrega) y la anulacion.
create or replace function public.rpc_kardex_producto_detallado(p_empresa_id bigint, p_producto_id bigint, p_desde timestamp with time zone, p_hasta timestamp with time zone)
 returns table(fecha timestamp with time zone, tipo text, compra_id bigint, venta_id bigint, estado text, proveedor text, cliente text, lote_id bigint, lote text, entrada integer, salida integer, saldo integer, factura_numero text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
with
params as (select p_desde as desde, p_hasta as hasta),
prod as (
  select coalesce(p.tiene_iva, true) as tiene_iva
  from public.productos p where p.id = p_producto_id and p.empresa_id = p_empresa_id
),
tag_anulado as (
  select t.venta_id, max(t.created_at) as tag_anulado_at
  from public.ventas_tags t
  where t.empresa_id=p_empresa_id and t.removed_at is null and upper(btrim(t.tag))='ANULADO'
  group by t.venta_id
),
ventas_flags as (
  select v.id, v.created_at, v.estado, v.cliente_id, v.cliente_nombre,
         (ta.venta_id is not null) as es_anulada,
         coalesce(v.anulado_at, v.canceled_at, ta.tag_anulado_at) as fecha_anulacion
  from public.ventas v left join tag_anulado ta on ta.venta_id=v.id
  where v.empresa_id=p_empresa_id
),
venta_ultima_edicion as (
  select ve.venta_id, max(ve.creado_en) as editado_at
  from public.ventas_eventos ve
  where ve.empresa_id=p_empresa_id and upper(btrim(ve.tipo))='EDITADA'
  group by ve.venta_id
),
venta_entrega as (
  select ve.venta_id, max(ve.creado_en) as entregado_at
  from public.ventas_eventos ve
  where ve.empresa_id=p_empresa_id and (upper(btrim(ve.tipo))='ENTREGADO' or upper(btrim(ve.a_estado))='ENTREGADO')
  group by ve.venta_id
),
fact_by_venta as (
  select vf.venta_id,
         max(case when upper(btrim(vf.tipo))='IVA'    then nullif(btrim(vf.numero_factura),'') end) as factura_iva,
         max(case when upper(btrim(vf.tipo))='EXENTO' then nullif(btrim(vf.numero_factura),'') end) as factura_exento
  from public.ventas_facturas vf where vf.empresa_id=p_empresa_id group by vf.venta_id
),
mov_all as (
  select c.created_at as fecha,'COMPRA'::text as tipo,
         cd.compra_id,null::bigint as venta_id,null::text as estado,
         pvd.nombre as proveedor,null::text as cliente,
         cd.lote_id,pl.lote,cd.cantidad::int as entrada,0::int as salida,
         1 as sort_grp,cd.id::bigint as sort_id,
         nullif(btrim(c.numero_factura),'')::text as factura_numero
  from public.compras_detalle cd
  join public.compras c on c.id=cd.compra_id and c.empresa_id=p_empresa_id
  join public.proveedores pvd on pvd.id=c.proveedor_id and pvd.empresa_id=p_empresa_id
  left join public.producto_lotes pl on pl.id=cd.lote_id
  where cd.empresa_id=p_empresa_id and cd.producto_id=p_producto_id

  union all

  select d.creado_en,'DEVOLUCION'::text,
         null::bigint,d.venta_id,vf.estado,
         null::text,coalesce(cl.nombre,vf.cliente_nombre),
         dd.lote_id,pl.lote,dd.cantidad::int,0::int,
         2,dd.id::bigint,
         case when(select tiene_iva from prod)then fb.factura_iva else fb.factura_exento end
  from public.ventas_devoluciones d
  join public.ventas_devoluciones_detalle dd on dd.devolucion_id=d.id and dd.empresa_id=p_empresa_id
  join ventas_flags vf on vf.id=d.venta_id
  left join public.clientes cl on cl.id=vf.cliente_id and cl.empresa_id=p_empresa_id
  left join public.producto_lotes pl on pl.id=dd.lote_id
  join public.ventas_detalle vd on vd.venta_id=d.venta_id and vd.lote_id=dd.lote_id and vd.empresa_id=p_empresa_id and vd.producto_id=p_producto_id
  left join fact_by_venta fb on fb.venta_id=d.venta_id
  where d.empresa_id=p_empresa_id

  union all

  select coalesce(vue.editado_at, vf.created_at),'RESERVA'::text,
         null::bigint,vd.venta_id,vf.estado,
         null::text,coalesce(cl.nombre,vf.cliente_nombre),
         vd.lote_id,pl.lote,0::int,vd.cantidad::int,
         3,vd.id::bigint,
         case when(select tiene_iva from prod)then fb.factura_iva else fb.factura_exento end
  from public.ventas_detalle vd
  join ventas_flags vf on vf.id=vd.venta_id
  left join venta_ultima_edicion vue on vue.venta_id=vd.venta_id
  left join public.clientes cl on cl.id=vf.cliente_id and cl.empresa_id=p_empresa_id
  left join public.producto_lotes pl on pl.id=vd.lote_id
  left join fact_by_venta fb on fb.venta_id=vd.venta_id
  where vd.empresa_id=p_empresa_id and vd.producto_id=p_producto_id

  union all

  select vf.fecha_anulacion,'LIBERACION'::text,
         null::bigint,vd.venta_id,'ANULADA'::text,
         null::text,coalesce(cl.nombre,vf.cliente_nombre),
         vd.lote_id,pl.lote,vd.cantidad::int,0::int,
         4,vd.id::bigint,
         case when(select tiene_iva from prod)then fb.factura_iva else fb.factura_exento end
  from public.ventas_detalle vd
  join ventas_flags vf on vf.id=vd.venta_id
  left join venta_entrega ve on ve.venta_id=vd.venta_id
  left join public.clientes cl on cl.id=vf.cliente_id and cl.empresa_id=p_empresa_id
  left join public.producto_lotes pl on pl.id=vd.lote_id
  left join fact_by_venta fb on fb.venta_id=vd.venta_id
  where vd.empresa_id=p_empresa_id and vd.producto_id=p_producto_id
    and vf.es_anulada=true and vf.fecha_anulacion is not null and ve.entregado_at is null
    and not exists(select 1 from public.ventas_devoluciones dv where dv.venta_id=vf.id and dv.empresa_id=p_empresa_id)

  union all

  select ve2.entregado_at,'VENTA'::text,
         null::bigint,vd.venta_id,
         case when vf.es_anulada then 'ANULADA' else 'ENTREGADO' end,
         null::text,coalesce(cl.nombre,vf.cliente_nombre),
         vd.lote_id,pl.lote,0::int,vd.cantidad::int,
         6,vd.id::bigint,
         case when(select tiene_iva from prod)then fb.factura_iva else fb.factura_exento end
  from public.ventas_detalle vd
  join ventas_flags vf on vf.id=vd.venta_id
  join venta_entrega ve2 on ve2.venta_id=vd.venta_id and ve2.entregado_at is not null
  left join public.clientes cl on cl.id=vf.cliente_id and cl.empresa_id=p_empresa_id
  left join public.producto_lotes pl on pl.id=vd.lote_id
  left join fact_by_venta fb on fb.venta_id=vd.venta_id
  where vd.empresa_id=p_empresa_id and vd.producto_id=p_producto_id
),
deltas as (
  select m.*,
         case when m.tipo in('COMPRA','DEVOLUCION') then m.entrada when m.tipo='VENTA' then -m.salida else 0 end::int as dt,
         case when m.tipo='RESERVA' then m.salida when m.tipo='LIBERACION' then -m.entrada when m.tipo='VENTA' then -m.salida else 0 end::int as dr
  from mov_all m
),
ini as (
  select coalesce(sum(dt),0)::int as ti, coalesce(sum(dr),0)::int as ri
  from deltas, params where fecha < params.desde
),
rango as (
  select m.* from deltas m, params where m.fecha>=params.desde and m.fecha<=params.hasta
),
ordered as (
  select r.*,
         (select ti from ini) as ti, (select ri from ini) as ri,
         sum(r.dt) over(order by r.fecha,r.sort_grp,r.sort_id rows between unbounded preceding and current row) as ctd,
         sum(r.dr) over(order by r.fecha,r.sort_grp,r.sort_id rows between unbounded preceding and current row) as crd
  from rango r
)
select fecha,tipo,compra_id,venta_id,estado,proveedor,cliente,lote_id,lote,entrada,salida,
       greatest(((ti+ctd)-(ri+crd))::int,0) as saldo,
       factura_numero
from ordered order by fecha,sort_grp,sort_id;
$function$;
