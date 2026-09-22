-- rpc_venta_anular_factura dejaba las lineas de ventas_detalle del tipo
-- anulado intactas. Eso causaba dos bugs reales detectados en produccion:
--  1) Si la venta seguia su curso normal a ENTREGADO despues de anular la
--     factura, rpc_venta_marcar_entregada volvia a descontar el stock de
--     esas lineas (ya se habia liberado/restaurado al anular la factura).
--  2) vw_cxc_ventas suma ventas_detalle.subtotal para el total/saldo de la
--     venta, asi que el monto de la factura anulada seguia contando como
--     pendiente de cobro en Cuentas por Cobrar.
-- Fix: despues de devolver el stock, eliminar las lineas de ventas_detalle
-- de ese tipo. El registro de que existieron queda en el evento
-- FACTURA_ANULADA (numero/monto en la nota).
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

  -- Quitar las lineas de este tipo de la venta: ya no deben contarse en el
  -- total (Cuentas por Cobrar suma ventas_detalle.subtotal) ni volver a
  -- descontarse de stock si la venta continua su flujo (EN_RUTA/ENTREGADO).
  delete from public.ventas_detalle vd
  using public.productos pr
  where vd.venta_id = p_venta_id
    and pr.id = vd.producto_id
    and (case when v_tipo = 'IVA' then pr.tiene_iva else not pr.tiene_iva end);

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
