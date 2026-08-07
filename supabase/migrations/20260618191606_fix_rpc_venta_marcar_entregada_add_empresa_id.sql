-- Fix: rpc_venta_marcar_entregada dejaba de funcionar si stock_reservado
-- se desincronizaba (ej. refacturas creadas manualmente sin reservar stock).
-- El check AND sl.stock_reservado >= r.qty bloqueaba entregas legítimas aunque
-- hubiera stock físico suficiente.
-- Nuevo comportamiento: solo valida stock_total >= qty; stock_reservado se
-- ajusta con greatest(0, ...) para no generar negativos.

CREATE OR REPLACE FUNCTION "public"."rpc_venta_marcar_entregada"("p_venta_id" bigint, "p_nota" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_prev_estado text;
  v_empresa_id bigint;
  r record;
begin
  if v_uid is null then
    raise exception 'NO_AUTH';
  end if;

  select upper(coalesce(role,'')) into v_role
  from public.profiles
  where id = v_uid;

  if v_role not in ('ADMIN','BODEGA','VENTAS','MENSAJERO') then
    raise exception 'NO_ROLE';
  end if;

  select estado, empresa_id into v_prev_estado, v_empresa_id
  from public.ventas
  where id = p_venta_id
  for update;

  if not found then
    raise exception 'VENTA_NO_EXISTE';
  end if;

  if v_prev_estado <> 'EN_RUTA' then
    raise exception 'ESTADO_INVALIDO';
  end if;

  if exists (
    select 1
    from public.ventas_tags t
    where t.venta_id = p_venta_id
      and t.removed_at is null
      and t.tag in ('ANULADO','ANULACION_REQUERIDA','REFACTURACION_REQUERIDA','EDICION_REQUERIDA','PEND_AUTORIZACION_ADMIN')
  ) then
    raise exception 'VENTA_BLOQUEADA_POR_TAG';
  end if;

  -- consumir por lote: valida stock físico (stock_total), ajusta reservado sin negativos
  for r in
    select vd.lote_id, sum(vd.cantidad)::numeric as qty
    from public.ventas_detalle vd
    where vd.venta_id = p_venta_id
    group by vd.lote_id
  loop
    if r.lote_id is null then
      raise exception 'LINEA_SIN_LOTE';
    end if;

    perform 1
    from public.stock_lotes sl
    where sl.lote_id    = r.lote_id
      and sl.empresa_id = v_empresa_id
    for update;

    update public.stock_lotes sl
    set stock_total     = sl.stock_total - r.qty,
        stock_reservado = greatest(0, sl.stock_reservado - r.qty)
    where sl.lote_id    = r.lote_id
      and sl.empresa_id = v_empresa_id
      and sl.stock_total >= r.qty;

    if not found then
      raise exception 'STOCK_INSUFICIENTE lote_id=%', r.lote_id;
    end if;
  end loop;

  update public.ventas
  set estado = 'ENTREGADO'
  where id = p_venta_id;

  insert into public.ventas_eventos (empresa_id, venta_id, tipo, de_estado, a_estado, nota, creado_por, creado_en)
  values (
    v_empresa_id,
    p_venta_id,
    'ENTREGADO',
    v_prev_estado,
    'ENTREGADO',
    nullif(trim(coalesce(p_nota,'')), ''),
    v_uid,
    now()
  );

  return jsonb_build_object('ok', true, 'venta_id', p_venta_id, 'estado', 'ENTREGADO');
end;
$$;
