-- 1) rpc_venta_facturar: corregir factura/PDF de una venta ya EN_RUTA/ENTREGADO
--    sin regresar el estado a FACTURADO (y sin tocar stock, que ya se
--    resolvio en el paso de entrega). Solo NUEVO -> FACTURADO y las
--    correcciones mientras sigue FACTURADO avanzan/tocan el estado.
CREATE OR REPLACE FUNCTION public.rpc_venta_facturar(p_venta_id bigint, p_facturas jsonb, p_admin_single_iva boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- p_admin_single_iva solo permitido para ADMIN
  if p_admin_single_iva and v_role <> 'ADMIN' then
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

    v_emision := coalesce(nullif(trim(coalesce(it->>'fecha_emision','')), '')::date, current_date);
    v_venc    := coalesce(nullif(trim(coalesce(it->>'fecha_vencimiento','')), '')::date, current_date + 30);

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

  -- Omitir validación EXENTO cuando el admin autorizó una sola factura IVA
  if v_needs_exento and not v_has_exento and not p_admin_single_iva then
    raise exception 'FALTA_FACTURA_EXENTO';
  end if;

  -- Validar que la suma de montos de facturas coincida con el total real de la venta en BD.
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

  if v_prev_estado in ('EN_RUTA', 'ENTREGADO') then
    -- La venta ya salio a ruta o fue entregada: se permite corregir la
    -- factura (numero/monto/PDF) pero el estado y el stock ya resueltos
    -- en el paso de entrega no se deben tocar de nuevo.
    insert into public.ventas_eventos (empresa_id, venta_id, tipo, de_estado, a_estado, nota, creado_por, creado_en)
    values (v_empresa_id, p_venta_id, 'FACTURA_CORREGIDA', v_prev_estado, v_prev_estado, null, v_uid, now());
  else
    update public.ventas
    set estado = 'FACTURADO'
    where id = p_venta_id;

    insert into public.ventas_eventos (empresa_id, venta_id, tipo, de_estado, a_estado, nota, creado_por, creado_en)
    values (v_empresa_id, p_venta_id, 'FACTURADA', v_prev_estado, 'FACTURADO', null, v_uid, now());
  end if;

  return jsonb_build_object(
    'ok', true,
    'venta_id', p_venta_id,
    'estado', case when v_prev_estado in ('EN_RUTA','ENTREGADO') then v_prev_estado else 'FACTURADO' end,
    'needs_iva', v_needs_iva,
    'needs_exento', v_needs_exento
  );
end;
$function$;

-- 2) Eliminar el overload huerfano de 2 argumentos: quedo vivo desde antes de
--    que se agregara p_admin_single_iva y nadie lo llama desde la app (siempre
--    manda ese parametro), pero seguia con el bug de regresion de estado.
DROP FUNCTION IF EXISTS public.rpc_venta_facturar(bigint, jsonb);

-- 3) Anular una sola factura (IVA o EXENTO) de una venta que tiene las dos,
--    sin afectar la otra factura, sus pagos, ni el estado de la venta.
CREATE OR REPLACE FUNCTION public.rpc_venta_anular_factura(p_venta_id bigint, p_tipo text, p_nota text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_empresa_id bigint;
  v_estado text;
  v_tipo text := upper(trim(coalesce(p_tipo,'')));
  v_total_facturas int;
  v_factura_id bigint;
  v_numero text;
  v_monto numeric;
  v_fue_entregada boolean := false;
  r record;
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

  if v_tipo not in ('IVA','EXENTO') then
    raise exception 'TIPO_INVALIDO';
  end if;

  select v.empresa_id, v.estado into v_empresa_id, v_estado
  from public.ventas v
  where v.id = p_venta_id
  for update;

  if not found then
    raise exception 'VENTA_NO_EXISTE';
  end if;

  if not public.tiene_membresia_activa(v_empresa_id) then
    raise exception 'NO_MEMBRESIA';
  end if;

  if v_estado not in ('FACTURADO','EN_RUTA','ENTREGADO') then
    raise exception 'ESTADO_INVALIDO';
  end if;

  if exists (
    select 1
    from public.ventas_tags t
    where t.venta_id = p_venta_id
      and t.removed_at is null
      and (
        t.tag in ('ANULADO','ANULACION_REQUERIDA','PEND_AUTORIZACION_ADMIN','EDICION_REQUERIDA','REFACTURACION_REQUERIDA')
        or t.tag like 'SOLICITA_%'
      )
  ) then
    raise exception 'VENTA_BLOQUEADA_POR_TAG';
  end if;

  select count(*) into v_total_facturas
  from public.ventas_facturas f
  where f.venta_id = p_venta_id;

  if v_total_facturas < 2 then
    raise exception 'VENTA_NO_TIENE_DOS_FACTURAS: usa rpc_venta_anular para anular la venta completa';
  end if;

  select f.id, f.numero_factura, f.monto_total
    into v_factura_id, v_numero, v_monto
  from public.ventas_facturas f
  where f.venta_id = p_venta_id and upper(f.tipo) = v_tipo;

  if v_factura_id is null then
    raise exception 'FACTURA_NO_EXISTE tipo=%', v_tipo;
  end if;

  if exists (
    select 1 from public.ventas_pagos p
    where p.factura_id = v_factura_id and p.monto > 0
  ) then
    raise exception 'FACTURA_TIENE_PAGOS_APLICADOS';
  end if;

  if exists (
    select 1 from public.ventas_pagos p
    where p.venta_id = p_venta_id and p.factura_id is null and p.monto > 0
  ) then
    raise exception 'VENTA_TIENE_PAGOS_SIN_FACTURA_ASOCIADA';
  end if;

  if exists (
    select 1 from public.ventas_pagos_reportados pr
    where pr.factura_id = v_factura_id and pr.estado = 'PENDIENTE'
  ) then
    raise exception 'FACTURA_TIENE_PAGO_REPORTADO_PENDIENTE';
  end if;

  select exists (
    select 1 from public.ventas_eventos e
    where e.venta_id = p_venta_id and upper(coalesce(e.tipo,'')) = 'ENTREGADO'
  ) into v_fue_entregada;

  for r in
    select vd.lote_id, sum(vd.cantidad)::numeric as qty
    from public.ventas_detalle vd
    join public.productos pr on pr.id = vd.producto_id
    where vd.venta_id = p_venta_id
      and (case when v_tipo = 'IVA' then pr.tiene_iva else not pr.tiene_iva end)
    group by vd.lote_id
  loop
    if r.lote_id is null then
      raise exception 'LINEA_SIN_LOTE';
    end if;

    perform 1
    from public.stock_lotes sl
    where sl.lote_id = r.lote_id
      and sl.empresa_id = v_empresa_id
    for update;

    if v_fue_entregada then
      update public.stock_lotes
      set stock_total = stock_total + r.qty
      where lote_id = r.lote_id and empresa_id = v_empresa_id;
    else
      update public.stock_lotes
      set stock_reservado = greatest(0, stock_reservado - r.qty)
      where lote_id = r.lote_id and empresa_id = v_empresa_id;
    end if;
  end loop;

  delete from public.ventas_facturas where id = v_factura_id;

  insert into public.ventas_eventos (empresa_id, venta_id, tipo, de_estado, a_estado, nota, creado_por, creado_en)
  values (
    v_empresa_id, p_venta_id, 'FACTURA_ANULADA', v_estado, v_estado,
    format('Factura %s #%s (Q%s) anulada.%s', v_tipo, coalesce(v_numero,''), coalesce(v_monto::text,''),
      case when nullif(trim(coalesce(p_nota,'')), '') is not null then ' ' || p_nota else '' end),
    v_uid, now()
  );

  return jsonb_build_object('ok', true, 'venta_id', p_venta_id, 'tipo', v_tipo, 'estado', v_estado);
end;
$function$;
