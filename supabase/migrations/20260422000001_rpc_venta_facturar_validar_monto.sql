-- Agrega validación server-side en rpc_venta_facturar:
-- rechaza si la suma de montos de facturas no coincide con el total real
-- de ventas_detalle en BD (previene el race condition de pantalla desactualizada).

CREATE OR REPLACE FUNCTION "public"."rpc_venta_facturar"("p_venta_id" bigint, "p_facturas" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;

  v_prev_estado text;

  v_needs_iva boolean := false;
  v_needs_exento boolean := false;

  it jsonb;
  v_tipo text;
  v_num text;
  v_path text;
  v_orig text;
  v_size bigint;

  v_monto numeric;
  v_emision date := current_date;
  v_venc date := (current_date + 30);

  v_has_iva boolean := false;
  v_has_exento boolean := false;

  v_total_venta numeric;
  v_total_facturas numeric;
  v_empresa_id bigint;
begin
  if v_uid is null then
    raise exception 'NO_AUTH';
  end if;

  select upper(coalesce(role,'')) into v_role
  from public.profiles
  where id = v_uid;

  if v_role not in ('ADMIN','FACTURACION') then
    raise exception 'NO_ROLE';
  end if;

  if p_venta_id is null then
    raise exception 'VENTA_INVALIDA';
  end if;

  select estado, empresa_id into v_prev_estado, v_empresa_id
  from public.ventas
  where id = p_venta_id;

  if not found then
    raise exception 'VENTA_NO_EXISTE';
  end if;

  if p_facturas is null or jsonb_typeof(p_facturas) <> 'array' or jsonb_array_length(p_facturas) = 0 then
    raise exception 'FACTURAS_INVALIDAS';
  end if;

  -- Bloqueos por tags
  if exists (
    select 1
    from public.ventas_tags t
    where t.venta_id = p_venta_id
      and t.removed_at is null
      and t.tag = 'ANULADO'
  ) then
    raise exception 'VENTA_BLOQUEADA_POR_TAG';
  end if;

  if exists (
    select 1
    from public.ventas_tags t
    where t.venta_id = p_venta_id
      and t.removed_at is null
      and (t.tag = 'PEND_AUTORIZACION_ADMIN' or t.tag like 'SOLICITA_%')
  ) then
    raise exception 'VENTA_BLOQUEADA_POR_TAG';
  end if;

  if exists (
    select 1
    from public.ventas_tags t
    where t.venta_id = p_venta_id
      and t.removed_at is null
      and t.tag = 'EDICION_REQUERIDA'
  ) then
    raise exception 'VENTA_BLOQUEADA_POR_TAG';
  end if;

  -- Determinar tipos requeridos segun productos de la venta
  select
    exists (
      select 1
      from public.ventas_detalle vd
      join public.productos p on p.id = vd.producto_id
      where vd.venta_id = p_venta_id
        and p.tiene_iva = true
    ),
    exists (
      select 1
      from public.ventas_detalle vd
      join public.productos p on p.id = vd.producto_id
      where vd.venta_id = p_venta_id
        and p.tiene_iva = false
    )
  into v_needs_iva, v_needs_exento;

  -- Upsert de facturas
  for it in
    select value from jsonb_array_elements(p_facturas) as t(value)
  loop
    v_tipo := upper(trim(coalesce(it->>'tipo','')));
    v_num := trim(coalesce(it->>'numero_factura',''));
    v_path := trim(coalesce(it->>'path',''));
    v_orig := nullif(trim(coalesce(it->>'original_name','')), '');
    v_size := nullif(trim(coalesce(it->>'size_bytes','')), '')::bigint;

    -- monto_total obligatorio (>0)
    v_monto := nullif(trim(coalesce(it->>'monto_total','')), '')::numeric;
    if v_monto is null or v_monto <= 0 then
      raise exception 'MONTO_INVALIDO tipo=%', v_tipo;
    end if;

    if v_tipo not in ('IVA','EXENTO') then
      raise exception 'TIPO_INVALIDO';
    end if;

    if v_num = '' then
      raise exception 'NUMERO_FACTURA_REQUERIDO tipo=%', v_tipo;
    end if;

    if v_path = '' then
      raise exception 'PDF_REQUERIDO tipo=%', v_tipo;
    end if;

    -- Validar que el path pertenece a esta venta y empresa
    if v_path not like v_empresa_id::text || '/ventas/' || p_venta_id::text || '/facturas/' || v_tipo || '/%'
       and v_path not like 'ventas/' || p_venta_id::text || '/facturas/' || v_tipo || '/%' then
      raise exception 'PATH_INVALIDO tipo=%', v_tipo;
    end if;

    insert into public.ventas_facturas (
      empresa_id, venta_id, tipo, path, numero_factura, original_name, size_bytes, uploaded_by,
      monto_total, fecha_emision, fecha_vencimiento
    )
    values (
      v_empresa_id, p_venta_id, v_tipo, v_path, v_num, v_orig, v_size, v_uid,
      v_monto, v_emision, v_venc
    )
    on conflict (venta_id, tipo) do update
      set path = excluded.path,
          numero_factura = excluded.numero_factura,
          original_name = excluded.original_name,
          size_bytes = excluded.size_bytes,
          uploaded_by = excluded.uploaded_by,
          monto_total = excluded.monto_total,
          fecha_emision = excluded.fecha_emision,
          fecha_vencimiento = excluded.fecha_vencimiento,
          created_at = now();
  end loop;

  -- Validar que ya existan las requeridas con numero+path
  select
    exists (
      select 1 from public.ventas_facturas f
      where f.venta_id = p_venta_id and f.tipo = 'IVA'
        and nullif(trim(coalesce(f.numero_factura,'')),'') is not null
        and nullif(trim(coalesce(f.path,'')),'') is not null
    ),
    exists (
      select 1 from public.ventas_facturas f
      where f.venta_id = p_venta_id and f.tipo = 'EXENTO'
        and nullif(trim(coalesce(f.numero_factura,'')),'') is not null
        and nullif(trim(coalesce(f.path,'')),'') is not null
    )
  into v_has_iva, v_has_exento;

  if v_needs_iva and not v_has_iva then
    raise exception 'FALTA_FACTURA_IVA';
  end if;

  if v_needs_exento and not v_has_exento then
    raise exception 'FALTA_FACTURA_EXENTO';
  end if;

  -- Validar que la suma de montos de facturas coincida con el total real de la venta en BD.
  -- Esto evita el race condition donde el facturador tenía la pantalla desactualizada.
  select coalesce(sum(vd.subtotal), 0)
  into v_total_venta
  from public.ventas_detalle vd
  where vd.venta_id = p_venta_id;

  select coalesce(sum(f.monto_total), 0)
  into v_total_facturas
  from public.ventas_facturas f
  where f.venta_id = p_venta_id;

  if abs(v_total_facturas - v_total_venta) > 0.02 then
    raise exception 'MONTO_FACTURA_NO_COINCIDE total_venta=% total_facturas=%', v_total_venta, v_total_facturas;
  end if;

  update public.ventas
  set estado = 'FACTURADO'
  where id = p_venta_id;

  insert into public.ventas_eventos (empresa_id, venta_id, tipo, de_estado, a_estado, nota, creado_por, creado_en)
  values (v_empresa_id, p_venta_id, 'FACTURADA', v_prev_estado, 'FACTURADO', null, v_uid, now());

  return jsonb_build_object(
    'ok', true,
    'venta_id', p_venta_id,
    'estado', 'FACTURADO',
    'needs_iva', v_needs_iva,
    'needs_exento', v_needs_exento
  );
end;
$$;
