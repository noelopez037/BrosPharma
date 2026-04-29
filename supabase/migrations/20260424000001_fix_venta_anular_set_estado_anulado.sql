-- Fix: rpc_venta_anular y rpc_venta_anular_nuevo no actualizaban ventas.estado = 'ANULADO'
-- También elimina el constraint ventas_estado_chk que bloqueaba el valor 'ANULADO'
-- y hace backfill de ventas que tienen tag ANULADO pero estado incorrecto.

-- 1. Eliminar constraint que excluye 'ANULADO' (ventas_estado_valido_chk lo cubre correctamente)
ALTER TABLE public.ventas DROP CONSTRAINT IF EXISTS ventas_estado_chk;

-- 2. Backfill: corregir ventas con anulado_at y tag ANULADO pero estado != 'ANULADO'
UPDATE public.ventas
SET estado = 'ANULADO'
WHERE anulado_at IS NOT NULL
  AND estado <> 'ANULADO'
  AND EXISTS (
    SELECT 1 FROM public.ventas_tags vt
    WHERE vt.venta_id = ventas.id
      AND vt.tag = 'ANULADO'
      AND vt.removed_at IS NULL
  );

-- 3. rpc_venta_anular: agrega estado = 'ANULADO' en el UPDATE de ventas
CREATE OR REPLACE FUNCTION public.rpc_venta_anular(
  p_venta_id bigint,
  p_nota     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid           uuid := auth.uid();
  v_empresa_id    bigint;
  v_rol_empresa   text;
  v_estado        text;

  v_has_iva       boolean := false;
  v_has_exento    boolean := false;
  v_req_iva       boolean := false;
  v_req_exento    boolean := false;
  v_ok_iva        boolean := false;
  v_ok_exento     boolean := false;
  v_fue_entregada boolean := false;

  r record;
begin
  if v_uid is null then
    raise exception 'NO_AUTH';
  end if;

  select v.empresa_id, upper(coalesce(v.estado, ''))
    into v_empresa_id, v_estado
  from public.ventas v
  where v.id = p_venta_id
  for update;

  if not found then
    raise exception 'VENTA_NO_EXISTE';
  end if;

  if not public.tiene_membresia_activa(v_empresa_id) then
    raise exception 'NO_MEMBRESIA';
  end if;

  select upper(coalesce(eu.rol_empresa, ''))
    into v_rol_empresa
  from public.empresa_usuarios eu
  where eu.user_id    = v_uid
    and eu.empresa_id = v_empresa_id
    and eu.estado     = 'ACTIVO'
  limit 1;

  if v_rol_empresa not in ('ADMIN', 'FACTURACION') then
    raise exception 'NO_ROLE';
  end if;

  if not exists (
    select 1
    from public.ventas_tags vt
    where vt.empresa_id = v_empresa_id
      and vt.venta_id   = p_venta_id
      and vt.tag        = 'ANULACION_REQUERIDA'
      and vt.removed_at is null
  ) then
    raise exception 'NO_ANULACION_REQUERIDA';
  end if;

  if exists (
    select 1
    from public.ventas_tags vt
    where vt.empresa_id = v_empresa_id
      and vt.venta_id   = p_venta_id
      and vt.tag        = 'ANULADO'
      and vt.removed_at is null
  ) then
    raise exception 'YA_ANULADO';
  end if;

  select exists (
    select 1
    from public.ventas_eventos e
    where e.empresa_id = v_empresa_id
      and e.venta_id   = p_venta_id
      and upper(coalesce(e.tipo, '')) = 'ENTREGADO'
  ) into v_fue_entregada;

  select
    bool_or(coalesce(pr.tiene_iva, false)),
    bool_or(not coalesce(pr.tiene_iva, false))
  into v_has_iva, v_has_exento
  from public.ventas_detalle vd
  join public.productos pr
    on pr.id         = vd.producto_id
   and pr.empresa_id = v_empresa_id
  where vd.empresa_id = v_empresa_id
    and vd.venta_id   = p_venta_id;

  if not coalesce(v_has_iva, false) and not coalesce(v_has_exento, false) then
    raise exception 'VENTA_SIN_LINEAS';
  end if;

  v_req_iva    := coalesce(v_has_iva, false);
  v_req_exento := coalesce(v_has_exento, false);

  if v_req_iva then
    select exists (
      select 1
      from public.ventas_facturas vf
      where vf.empresa_id = v_empresa_id
        and vf.venta_id   = p_venta_id
        and upper(vf.tipo) = 'IVA'
        and nullif(trim(coalesce(vf.numero_factura, '')), '') is not null
        and nullif(trim(coalesce(vf.path, '')), '') is not null
      limit 1
    ) into v_ok_iva;
    if not v_ok_iva then
      raise exception 'FALTA_FACTURA_IVA';
    end if;
  end if;

  if v_req_exento then
    select exists (
      select 1
      from public.ventas_facturas vf
      where vf.empresa_id = v_empresa_id
        and vf.venta_id   = p_venta_id
        and upper(vf.tipo) = 'EXENTO'
        and nullif(trim(coalesce(vf.numero_factura, '')), '') is not null
        and nullif(trim(coalesce(vf.path, '')), '') is not null
      limit 1
    ) into v_ok_exento;
    if not v_ok_exento then
      raise exception 'FALTA_FACTURA_EXENTO';
    end if;
  end if;

  -- Ajuste de stock por lote
  for r in
    select vd.lote_id, sum(vd.cantidad)::numeric as qty
    from public.ventas_detalle vd
    where vd.empresa_id = v_empresa_id
      and vd.venta_id   = p_venta_id
    group by vd.lote_id
  loop
    if r.lote_id is null then
      raise exception 'LINEA_SIN_LOTE';
    end if;

    perform 1
    from public.stock_lotes sl
    where sl.empresa_id = v_empresa_id
      and sl.lote_id    = r.lote_id
    for update;

    if v_fue_entregada then
      update public.stock_lotes sl
      set stock_total = sl.stock_total + r.qty
      where sl.empresa_id = v_empresa_id
        and sl.lote_id    = r.lote_id;
    else
      update public.stock_lotes sl
      set stock_reservado = greatest(0, sl.stock_reservado - r.qty)
      where sl.empresa_id = v_empresa_id
        and sl.lote_id    = r.lote_id;
    end if;
  end loop;

  -- Consumir tag ANULACION_REQUERIDA
  update public.ventas_tags
  set removed_at = now(),
      removed_by = v_uid
  where empresa_id = v_empresa_id
    and venta_id   = p_venta_id
    and tag        = 'ANULACION_REQUERIDA'
    and removed_at is null;

  -- Actualizar estado y fecha de anulación
  update public.ventas
  set estado    = 'ANULADO',
      anulado_at = now()
  where id = p_venta_id;

  -- Tag ANULADO
  insert into public.ventas_tags (empresa_id, venta_id, tag, nota, created_by)
  values (
    v_empresa_id, p_venta_id, 'ANULADO',
    nullif(trim(coalesce(p_nota, '')), ''),
    v_uid
  );

  -- Evento de auditoría
  insert into public.ventas_eventos (
    empresa_id, venta_id, tipo, de_estado, a_estado, nota, creado_por, creado_en
  ) values (
    v_empresa_id, p_venta_id, 'ANULADA',
    v_estado, 'ANULADO',
    nullif(trim(coalesce(p_nota, '')), ''),
    v_uid, now()
  );
end;
$$;

-- 4. rpc_venta_anular_nuevo: agrega estado = 'ANULADO' en el UPDATE de ventas
CREATE OR REPLACE FUNCTION public.rpc_venta_anular_nuevo(
  p_venta_id bigint,
  p_nota     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid         uuid := auth.uid();
  v_empresa_id  bigint;
  v_rol_empresa text;
  v_estado      text;
  r             record;
begin
  if v_uid is null then
    raise exception 'NO_AUTH';
  end if;

  select v.empresa_id, upper(coalesce(v.estado, ''))
    into v_empresa_id, v_estado
  from public.ventas v
  where v.id = p_venta_id
  for update;

  if not found then
    raise exception 'VENTA_NO_EXISTE';
  end if;

  if not public.tiene_membresia_activa(v_empresa_id) then
    raise exception 'NO_MEMBRESIA';
  end if;

  select upper(coalesce(eu.rol_empresa, ''))
    into v_rol_empresa
  from public.empresa_usuarios eu
  where eu.user_id    = v_uid
    and eu.empresa_id = v_empresa_id
    and eu.estado     = 'ACTIVO'
  limit 1;

  if v_rol_empresa <> 'ADMIN' then
    raise exception 'NO_ROLE';
  end if;

  if v_estado <> 'NUEVO' then
    raise exception 'ESTADO_INVALIDO: solo se pueden anular ventas en estado NUEVO con esta función';
  end if;

  if exists (
    select 1
    from public.ventas_tags vt
    where vt.empresa_id = v_empresa_id
      and vt.venta_id   = p_venta_id
      and vt.tag        = 'ANULADO'
      and vt.removed_at is null
  ) then
    raise exception 'YA_ANULADO';
  end if;

  -- Liberar stock reservado por lote
  for r in
    select vd.lote_id, sum(vd.cantidad)::numeric as qty
    from public.ventas_detalle vd
    where vd.empresa_id = v_empresa_id
      and vd.venta_id   = p_venta_id
    group by vd.lote_id
  loop
    if r.lote_id is null then
      continue;
    end if;

    perform 1
    from public.stock_lotes sl
    where sl.empresa_id = v_empresa_id
      and sl.lote_id    = r.lote_id
    for update;

    update public.stock_lotes sl
    set stock_reservado = greatest(0, sl.stock_reservado - r.qty)
    where sl.empresa_id = v_empresa_id
      and sl.lote_id    = r.lote_id;
  end loop;

  -- Actualizar estado y fecha de anulación
  update public.ventas
  set estado    = 'ANULADO',
      anulado_at = now()
  where id = p_venta_id;

  -- Tag ANULADO
  insert into public.ventas_tags (empresa_id, venta_id, tag, nota, created_by)
  values (
    v_empresa_id, p_venta_id, 'ANULADO',
    nullif(trim(coalesce(p_nota, '')), ''),
    v_uid
  );

  -- Evento de auditoría
  insert into public.ventas_eventos (
    empresa_id, venta_id, tipo, de_estado, a_estado, nota, creado_por, creado_en
  ) values (
    v_empresa_id, p_venta_id, 'ANULADA',
    v_estado, 'ANULADO',
    nullif(trim(coalesce(p_nota, '')), ''),
    v_uid, now()
  );
end;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_venta_anular(bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_venta_anular_nuevo(bigint, text) TO authenticated;
