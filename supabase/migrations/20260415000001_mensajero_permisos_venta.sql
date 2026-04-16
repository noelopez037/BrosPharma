-- Permite al rol MENSAJERO:
--   - registrar/borrar recetas en ventas
--   - reportar pagos (CxC)
--   - solicitar anulación/edición de ventas
-- MENSAJERO ya tenía acceso a set_en_ruta y marcar_entregada;
-- estas cuatro funciones faltaban.

-- 1. rpc_venta_borrar_receta
CREATE OR REPLACE FUNCTION "public"."rpc_venta_borrar_receta"("p_receta_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_venta_id bigint;
begin
  if v_uid is null then
    raise exception 'NO_AUTH';
  end if;

  select upper(coalesce(role,'')) into v_role
  from public.profiles
  where id = v_uid;

  if v_role not in ('VENTAS','ADMIN','MENSAJERO') then
    raise exception 'NO_ROLE';
  end if;

  select venta_id into v_venta_id
  from public.ventas_recetas
  where id = p_receta_id;

  if v_venta_id is null then
    raise exception 'RECETA_NO_EXISTE';
  end if;

  if v_role = 'VENTAS' then
    if not exists (
      select 1 from public.ventas v
      where v.id = v_venta_id
        and v.vendedor_id = v_uid
    ) then
      raise exception 'NO_PERMISO_VENTA';
    end if;
  end if;

  delete from public.ventas_recetas
  where id = p_receta_id;

  update public.ventas v
  set receta_cargada = exists (
    select 1 from public.ventas_recetas r where r.venta_id = v.id
  )
  where v.id = v_venta_id;

  insert into public.ventas_eventos (venta_id, tipo, de_estado, a_estado, nota, creado_por, creado_en)
  values (v_venta_id, 'RECETA_ELIMINADA', null, null, null, v_uid, now());

  return jsonb_build_object('ok', true);
end;
$$;


-- 2. rpc_venta_registrar_receta
CREATE OR REPLACE FUNCTION "public"."rpc_venta_registrar_receta"("p_venta_id" bigint, "p_path" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_path text := trim(coalesce(p_path,''));
  v_prefix text := 'ventas/' || p_venta_id::text || '/recetas/';
begin
  if v_uid is null then
    raise exception 'NO_AUTH';
  end if;

  select upper(coalesce(role,'')) into v_role
  from public.profiles
  where id = v_uid;

  if v_role not in ('VENTAS','ADMIN','MENSAJERO') then
    raise exception 'NO_ROLE';
  end if;

  if p_venta_id is null then
    raise exception 'VENTA_INVALIDA';
  end if;

  if v_path = '' or position(v_prefix in v_path) <> 1 then
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

  insert into public.ventas_recetas (venta_id, path, uploaded_by)
  values (p_venta_id, v_path, v_uid);

  update public.ventas
  set receta_cargada = true
  where id = p_venta_id;

  insert into public.ventas_eventos (venta_id, tipo, de_estado, a_estado, nota, creado_por, creado_en)
  values (p_venta_id, 'RECETA_ADJUNTA', null, null, null, v_uid, now());

  return jsonb_build_object('ok', true);
end;
$$;


-- 3. rpc_venta_reportar_pago
CREATE OR REPLACE FUNCTION "public"."rpc_venta_reportar_pago"("p_venta_id" bigint, "p_factura_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comprobante_path" "text", "p_comentario" "text") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_factura_venta_id bigint;
  v_factura_total numeric;
  v_factura_pagado numeric;
  v_pendiente numeric;
  v_id bigint;
begin
  if v_uid is null then
    raise exception 'NO_AUTH';
  end if;

  select role into v_role
  from public.profiles
  where id = v_uid;

  -- ADMIN, VENTAS y MENSAJERO pueden reportar pagos
  if upper(coalesce(v_role,'')) not in ('ADMIN','VENTAS','MENSAJERO') then
    raise exception 'NO_AUTORIZADO';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'MONTO_INVALIDO';
  end if;

  -- Validar factura pertenece a la venta (igual que aplicar)
  select vf.venta_id, vf.monto_total
    into v_factura_venta_id, v_factura_total
  from public.ventas_facturas vf
  where vf.id = p_factura_id;

  if v_factura_venta_id is null then
    raise exception 'FACTURA_NO_EXISTE';
  end if;

  if v_factura_venta_id <> p_venta_id then
    raise exception 'FACTURA_NO_PERTENECE_A_VENTA';
  end if;

  -- Validación por factura SOLO si hay monto_total
  if v_factura_total is not null and v_factura_total > 0 then
    select coalesce(sum(vp.monto), 0)
      into v_factura_pagado
    from public.ventas_pagos vp
    where vp.factura_id = p_factura_id;

    v_pendiente := v_factura_total - coalesce(v_factura_pagado, 0);

    if v_pendiente <= 0 then
      raise exception 'FACTURA_YA_PAGADA';
    end if;

    -- OJO: esto valida contra pagos ya aplicados (no contra otros reportados)
    if p_monto > v_pendiente then
      raise exception 'MONTO_EXCEDE_SALDO_FACTURA';
    end if;
  end if;

  insert into public.ventas_pagos_reportados(
    venta_id,
    factura_id,
    fecha_reportado,
    monto,
    metodo,
    referencia,
    comprobante_path,
    comentario,
    estado,
    created_by
  ) values (
    p_venta_id,
    p_factura_id,
    now(),
    p_monto,
    upper(trim(coalesce(p_metodo,''))),
    nullif(trim(coalesce(p_referencia,'')), ''),
    nullif(trim(coalesce(p_comprobante_path,'')), ''),
    nullif(trim(coalesce(p_comentario,'')), ''),
    'PENDIENTE',
    v_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;


-- 4. rpc_ventas_solicitar_accion
CREATE OR REPLACE FUNCTION "public"."rpc_ventas_solicitar_accion"("p_venta_id" bigint, "p_accion" "text", "p_nota" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_estado text;
  v_accion text := upper(trim(coalesce(p_accion,'')));
  v_nota text := trim(coalesce(p_nota,''));
  v_tag_solicitud text;

  v_cliente_nombre text;
  v_vendedor_codigo text;
begin
  if v_uid is null then raise exception 'NO_AUTH'; end if;

  select upper(coalesce(role,'')) into v_role
  from public.profiles
  where id = v_uid;

  if v_role not in ('VENTAS','ADMIN','MENSAJERO') then raise exception 'NO_ROLE'; end if;
  if v_nota = '' then raise exception 'NOTA_REQUERIDA'; end if;

  select estado, coalesce(cliente_nombre,'') into v_estado, v_cliente_nombre
  from public.ventas
  where id = p_venta_id;

  if not found then raise exception 'VENTA_NO_EXISTE'; end if;

  select coalesce(vendedor_codigo,'') into v_vendedor_codigo
  from public.ventas
  where id = p_venta_id;

  if exists (
    select 1
    from public.ventas_tags
    where venta_id = p_venta_id
      and removed_at is null
      and tag in ('ANULADO','REFACTURADO')
  ) then
    raise exception 'VENTA_FINALIZADA_POR_TAG';
  end if;

  if exists (
    select 1
    from public.ventas_tags
    where venta_id = p_venta_id
      and removed_at is null
      and tag like 'SOLICITA_%'
  ) then
    raise exception 'YA_HAY_SOLICITUD_ACTIVA';
  end if;

  if v_estado = 'NUEVO' then
    if v_accion <> 'EDICION' then raise exception 'ACCION_INVALIDA_PARA_ESTADO'; end if;
    v_tag_solicitud := 'SOLICITA_EDICION';
  else
    if v_accion = 'ANULACION' then
      v_tag_solicitud := 'SOLICITA_ANULACION';
    elsif v_accion = 'REFACTURACION' then
      v_tag_solicitud := 'SOLICITA_REFACTURACION';
    else
      raise exception 'ACCION_INVALIDA_PARA_ESTADO';
    end if;
  end if;

  insert into public.ventas_tags (venta_id, tag, nota, created_by)
  values (p_venta_id, 'PEND_AUTORIZACION_ADMIN', v_nota, v_uid)
  on conflict (venta_id, tag) where removed_at is null do nothing;

  insert into public.ventas_tags (venta_id, tag, nota, created_by)
  values (p_venta_id, v_tag_solicitud, v_nota, v_uid)
  on conflict (venta_id, tag) where removed_at is null do nothing;

  -- Notificación al ADMIN
  insert into public.notif_outbox (type, venta_id, payload)
  values (
    'VENTA_SOLICITUD_ADMIN',
    p_venta_id,
    jsonb_build_object(
      'venta_id', p_venta_id,
      'accion', v_accion,
      'tag', v_tag_solicitud,
      'nota', v_nota,
      'estado', v_estado,
      'cliente_nombre', nullif(v_cliente_nombre,''),
      'vendedor_codigo', nullif(v_vendedor_codigo,'')
    )
  )
  on conflict (type, venta_id) where (type like 'VENTA_%') do update
  set payload = excluded.payload,
      processed_at = null,
      attempts = 0,
      last_error = null;

  return jsonb_build_object(
    'ok', true,
    'venta_id', p_venta_id,
    'estado', v_estado,
    'accion', v_accion,
    'tag', v_tag_solicitud
  );
end;
$$;
