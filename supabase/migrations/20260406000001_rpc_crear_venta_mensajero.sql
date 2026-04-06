-- Permite que el rol MENSAJERO también pueda crear ventas
CREATE OR REPLACE FUNCTION public.rpc_crear_venta(p_venta jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;

  v_empresa_id bigint;

  v_cliente_id bigint;
  v_cliente_nombre text;
  v_comentarios text;

  v_vendedor_codigo text;

  v_venta_id bigint;
  v_requiere_receta boolean := false;

  it jsonb;
  v_producto_id bigint;
  v_qty int;
  v_precio numeric;

  v_min numeric;
  v_req_receta boolean;

  v_needed int;
  r record;
  st record;
  v_avail int;
  v_take int;
begin
  if v_uid is null then
    raise exception 'NO_AUTH';
  end if;

  select upper(coalesce(role,'')), nullif(trim(coalesce(codigo,'')), '')
  into v_role, v_vendedor_codigo
  from public.profiles
  where id = v_uid;

  if v_role not in ('VENTAS','ADMIN','MENSAJERO') then
    raise exception 'NO_ROLE';
  end if;

  v_empresa_id := nullif(trim(coalesce(p_venta->>'empresa_id','')), '')::bigint;
  v_cliente_id := nullif(trim(coalesce(p_venta->>'cliente_id','')), '')::bigint;
  v_comentarios := nullif(trim(coalesce(p_venta->>'comentarios','')), '');

  if v_empresa_id is null then
    raise exception 'EMPRESA_ID_REQUERIDA';
  end if;

  if not public.tiene_membresia_activa(v_empresa_id) then
    raise exception 'NO_MEMBRESIA_EMPRESA';
  end if;

  if v_cliente_id is null then
    raise exception 'CLIENTE_INVALIDO';
  end if;

  select c.nombre
  into v_cliente_nombre
  from public.clientes c
  where c.id = v_cliente_id
    and c.empresa_id = v_empresa_id
    and c.activo = true;

  if v_cliente_nombre is null then
    raise exception 'CLIENTE_INVALIDO';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS_INVALIDOS';
  end if;

  insert into public.ventas (
    empresa_id,
    cliente_id,
    cliente_nombre,
    vendedor_id,
    vendedor_codigo,
    comentarios,
    requiere_receta
  )
  values (
    v_empresa_id,
    v_cliente_id,
    v_cliente_nombre,
    v_uid,
    v_vendedor_codigo,
    v_comentarios,
    false
  )
  returning id into v_venta_id;

  for it in
    select value
    from jsonb_array_elements(p_items) as t(value)
  loop
    v_producto_id := nullif(trim(coalesce(it->>'producto_id','')), '')::bigint;
    v_qty := coalesce(it->>'cantidad','0')::int;
    v_precio := coalesce(it->>'precio_unit','0')::numeric;

    if v_producto_id is null or v_qty <= 0 then
      raise exception 'ITEM_INVALIDO producto_id=%', coalesce(v_producto_id::text,'null');
    end if;

    select
      bool_or(coalesce(p.requiere_receta,false)),
      max(
        case
          when coalesce(ppo.precio_compra_override, upc.precio_compra) is null then null
          else round(coalesce(ppo.precio_compra_override, upc.precio_compra) / 0.70, 2)
        end
      )::numeric
    into v_req_receta, v_min
    from public.productos p
    left join public.producto_precio_override ppo
      on ppo.producto_id = p.id
     and ppo.empresa_id = v_empresa_id
    left join (
      select distinct on (cd.producto_id)
        cd.producto_id,
        cd.precio_compra_unit as precio_compra
      from public.compras_detalle cd
      join public.compras c
        on c.id = cd.compra_id
      where cd.empresa_id = v_empresa_id
        and c.empresa_id = v_empresa_id
      order by cd.producto_id, c.fecha desc nulls last, cd.id desc
    ) upc
      on upc.producto_id = p.id
    where p.id = v_producto_id
      and p.empresa_id = v_empresa_id
      and p.activo = true;

    if v_min is null then
      raise exception 'PRODUCTO_INVALIDO_O_SIN_PRECIO producto_id=%', v_producto_id;
    end if;

    if v_precio < v_min then
      raise exception 'PRECIO_MINIMO producto_id=% min=%', v_producto_id, v_min;
    end if;

    if coalesce(v_req_receta,false) then
      v_requiere_receta := true;
    end if;

    v_needed := v_qty;

    for r in
      select
        pl.id as lote_id,
        pl.fecha_exp
      from public.producto_lotes pl
      join public.stock_lotes sl
        on sl.lote_id = pl.id
       and sl.empresa_id = v_empresa_id
      where pl.empresa_id = v_empresa_id
        and pl.producto_id = v_producto_id
        and coalesce(sl.stock_total, 0) - coalesce(sl.stock_reservado, 0) > 0
      order by pl.fecha_exp asc nulls last, pl.id asc
    loop
      exit when v_needed <= 0;

      select sl.stock_total, sl.stock_reservado
      into st
      from public.stock_lotes sl
      where sl.lote_id = r.lote_id
        and sl.empresa_id = v_empresa_id
      for update;

      v_avail := coalesce(st.stock_total,0) - coalesce(st.stock_reservado,0);

      if v_avail <= 0 then
        continue;
      end if;

      v_take := least(v_avail, v_needed);

      update public.stock_lotes
      set stock_reservado = stock_reservado + v_take
      where lote_id = r.lote_id
        and empresa_id = v_empresa_id;

      insert into public.ventas_detalle (
        empresa_id,
        venta_id,
        producto_id,
        lote_id,
        cantidad,
        precio_venta_unit
      )
      values (
        v_empresa_id,
        v_venta_id,
        v_producto_id,
        r.lote_id,
        v_take,
        v_precio
      );

      v_needed := v_needed - v_take;
    end loop;

    if v_needed > 0 then
      raise exception 'NO_STOCK producto_id=% faltante=%', v_producto_id, v_needed;
    end if;
  end loop;

  update public.ventas
  set requiere_receta = v_requiere_receta
  where id = v_venta_id
    and empresa_id = v_empresa_id;

  insert into public.ventas_eventos (
    empresa_id,
    venta_id,
    tipo,
    de_estado,
    a_estado,
    nota,
    creado_por,
    creado_en
  )
  values (
    v_empresa_id,
    v_venta_id,
    'CREADA',
    null,
    'NUEVO',
    null,
    v_uid,
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'venta_id', v_venta_id,
    'empresa_id', v_empresa_id
  );
end;
$$;
