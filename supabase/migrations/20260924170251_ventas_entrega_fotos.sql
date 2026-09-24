-- Respaldo fotografico de entrega por venta (hoja firmada / foto de guia Guatex).
-- Hasta 2 fotos por venta; se exige al menos 1 antes de poder marcar la venta como ENTREGADO.

create table public.ventas_entrega_fotos (
  id bigint generated always as identity primary key,
  venta_id bigint not null references public.ventas(id),
  path text not null,
  uploaded_by uuid,
  empresa_id bigint not null,
  created_at timestamptz not null default now()
);

alter table public.ventas_entrega_fotos enable row level security;

create policy ventas_entrega_fotos_mt_select
  on public.ventas_entrega_fotos
  for select
  to authenticated
  using (tiene_membresia_activa(empresa_id));

create policy ventas_entrega_fotos_mt_insert
  on public.ventas_entrega_fotos
  for insert
  to authenticated
  with check (tiene_membresia_activa(empresa_id));

create policy ventas_entrega_fotos_mt_update
  on public.ventas_entrega_fotos
  for update
  to authenticated
  using (tiene_membresia_activa(empresa_id))
  with check (tiene_membresia_activa(empresa_id));

create policy ventas_entrega_fotos_mt_delete
  on public.ventas_entrega_fotos
  for delete
  to authenticated
  using (tiene_membresia_activa(empresa_id));

alter table public.ventas
  add column entrega_respaldo_cargado boolean not null default false;

create or replace function public.rpc_venta_registrar_entrega_foto(p_venta_id bigint, p_path text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_path text := trim(coalesce(p_path,''));
  v_prefix text;
  v_empresa_id bigint;
  v_count int;
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

  select empresa_id into v_empresa_id
  from public.ventas
  where id = p_venta_id;

  if v_empresa_id is null then
    raise exception 'VENTA_INVALIDA';
  end if;

  -- Path must be: {empresa_id}/ventas/{venta_id}/entrega/...
  v_prefix := v_empresa_id::text || '/ventas/' || p_venta_id::text || '/entrega/';
  if position(v_prefix in v_path) <> 1 then
    raise exception 'PATH_INVALIDO';
  end if;

  select count(*) into v_count
  from public.ventas_entrega_fotos
  where venta_id = p_venta_id;

  if v_count >= 2 then
    raise exception 'LIMITE_FOTOS_ALCANZADO';
  end if;

  insert into public.ventas_entrega_fotos (venta_id, path, uploaded_by, empresa_id)
  values (p_venta_id, v_path, v_uid, v_empresa_id);

  update public.ventas
  set entrega_respaldo_cargado = true
  where id = p_venta_id;

  insert into public.ventas_eventos (venta_id, tipo, de_estado, a_estado, nota, creado_por, creado_en, empresa_id)
  values (p_venta_id, 'ENTREGA_RESPALDO_ADJUNTO', null, null, null, v_uid, now(), v_empresa_id);

  return jsonb_build_object('ok', true);
end;
$function$;

grant execute on function public.rpc_venta_registrar_entrega_foto(bigint, text) to authenticated, anon, service_role;

create or replace function public.rpc_venta_borrar_entrega_foto(p_foto_id bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_venta_id bigint;
  v_empresa_id bigint;
begin
  if v_uid is null then raise exception 'NO_AUTH'; end if;

  select upper(coalesce(role,'')) into v_role from public.profiles where id = v_uid;

  if v_role not in ('VENTAS','ADMIN','MENSAJERO') then raise exception 'NO_ROLE'; end if;

  select ef.venta_id, v.empresa_id into v_venta_id, v_empresa_id
  from public.ventas_entrega_fotos ef
  join public.ventas v on v.id = ef.venta_id
  where ef.id = p_foto_id;

  if v_venta_id is null then raise exception 'FOTO_NO_EXISTE'; end if;

  if v_role = 'VENTAS' then
    if not exists (select 1 from public.ventas v where v.id = v_venta_id and v.vendedor_id = v_uid) then
      raise exception 'NO_PERMISO_VENTA';
    end if;
  end if;

  delete from public.ventas_entrega_fotos where id = p_foto_id;

  update public.ventas v
  set entrega_respaldo_cargado = exists (select 1 from public.ventas_entrega_fotos f where f.venta_id = v.id)
  where v.id = v_venta_id;

  insert into public.ventas_eventos (venta_id, tipo, de_estado, a_estado, nota, creado_por, creado_en, empresa_id)
  values (v_venta_id, 'ENTREGA_RESPALDO_ELIMINADO', null, null, null, v_uid, now(), v_empresa_id);

  return jsonb_build_object('ok', true);
end;
$function$;

grant execute on function public.rpc_venta_borrar_entrega_foto(bigint) to authenticated, anon, service_role;

create or replace function public.rpc_venta_marcar_entregada(p_venta_id bigint, p_nota text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  if not exists (select 1 from public.ventas_entrega_fotos where venta_id = p_venta_id) then
    raise exception 'FALTA_RESPALDO_ENTREGA';
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
    where sl.lote_id = r.lote_id
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
$function$;
