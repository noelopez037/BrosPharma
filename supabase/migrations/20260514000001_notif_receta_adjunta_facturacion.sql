-- Notifica al usuario FACTURACION cuando se adjunta una receta a una venta en estado NUEVO
CREATE OR REPLACE FUNCTION "public"."rpc_venta_registrar_receta"("p_venta_id" bigint, "p_path" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_path text := trim(coalesce(p_path,''));
  v_prefix text;
  v_estado text;
  v_cliente_nombre text;
  v_empresa_id bigint;
begin
  if v_uid is null then
    raise exception 'NO_AUTH';
  end if;

  select upper(coalesce(role,'')) into v_role
  from public.profiles
  where id = v_uid;

  if v_role not in ('VENTAS','ADMIN') then
    raise exception 'NO_ROLE';
  end if;

  if p_venta_id is null then
    raise exception 'VENTA_INVALIDA';
  end if;

  if v_path = '' then
    raise exception 'PATH_INVALIDO';
  end if;

  if v_role = 'VENTAS' then
    if not exists (
      select 1 from public.ventas v
      where v.id = p_venta_id
        and v.vendedor_id = v_uid
    ) then
      raise exception 'NO_PERMISO_VENTA';
    end if;
  end if;

  select estado, cliente_nombre, empresa_id
  into v_estado, v_cliente_nombre, v_empresa_id
  from public.ventas
  where id = p_venta_id;

  if v_empresa_id is null then
    raise exception 'VENTA_INVALIDA';
  end if;

  -- Path must be: {empresa_id}/ventas/{venta_id}/recetas/...
  v_prefix := v_empresa_id::text || '/ventas/' || p_venta_id::text || '/recetas/';
  if position(v_prefix in v_path) <> 1 then
    raise exception 'PATH_INVALIDO';
  end if;

  insert into public.ventas_recetas (venta_id, path, uploaded_by, empresa_id)
  values (p_venta_id, v_path, v_uid, v_empresa_id);

  update public.ventas
  set receta_cargada = true
  where id = p_venta_id;

  insert into public.ventas_eventos (venta_id, tipo, de_estado, a_estado, nota, creado_por, creado_en, empresa_id)
  values (p_venta_id, 'RECETA_ADJUNTA', null, null, null, v_uid, now(), v_empresa_id);

  if v_estado = 'NUEVO' then
    insert into public.notif_outbox (type, venta_id, payload, empresa_id)
    values (
      'VENTA_RECETA_ADJUNTA',
      p_venta_id,
      jsonb_build_object(
        'venta_id', p_venta_id,
        'cliente_nombre', nullif(v_cliente_nombre, ''),
        'empresa_id', v_empresa_id
      ),
      v_empresa_id
    )
    on conflict (empresa_id, type, venta_id) where (type like 'VENTA_%')
    do update set
      payload = excluded.payload,
      processed_at = null,
      attempts = 0,
      last_error = null;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;
