create or replace function public.rpc_cliente_documento_registrar(
  p_empresa_id bigint,
  p_cliente_id bigint,
  p_tipo text,
  p_path text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid           uuid := auth.uid();
  v_rol_empresa   text;
  v_tipo          text := lower(trim(coalesce(p_tipo, '')));
  v_cliente_nombre text;
begin
  if v_uid is null then raise exception 'NO_AUTH'; end if;
  if v_tipo not in ('licencia_sanitaria', 'patente_comercio', 'credito_apertura') then
    raise exception 'TIPO_INVALIDO';
  end if;
  if p_path is null or trim(p_path) = '' then
    raise exception 'PATH_REQUERIDO';
  end if;

  if not public.tiene_membresia_activa(p_empresa_id) then
    raise exception 'NO_MEMBRESIA';
  end if;

  select upper(coalesce(eu.rol_empresa, ''))
    into v_rol_empresa
  from public.empresa_usuarios eu
  where eu.user_id    = v_uid
    and eu.empresa_id = p_empresa_id
    and eu.estado     = 'ACTIVO'
  limit 1;

  if v_rol_empresa not in ('ADMIN', 'VENTAS', 'MENSAJERO') then
    raise exception 'NO_ROLE';
  end if;

  select nombre
    into v_cliente_nombre
  from public.clientes
  where id = p_cliente_id
    and empresa_id = p_empresa_id;

  if not found then raise exception 'CLIENTE_NO_EXISTE'; end if;

  if v_tipo = 'licencia_sanitaria' then
    update public.clientes
    set licencia_sanitaria_pdf_path       = p_path,
        licencia_sanitaria_updated_at     = now(),
        licencia_sanitaria_estado         = 'PENDIENTE',
        licencia_sanitaria_revisado_por   = null,
        licencia_sanitaria_revisado_at    = null,
        licencia_sanitaria_rechazo_motivo = null
    where id = p_cliente_id
      and empresa_id = p_empresa_id;

    insert into public.notif_outbox (empresa_id, type, venta_id, payload)
    values (
      p_empresa_id,
      'LICENCIA_SANITARIA_PENDIENTE',
      p_cliente_id,
      jsonb_build_object(
        'cliente_id',     p_cliente_id,
        'cliente_nombre', coalesce(v_cliente_nombre, '')
      )
    )
    on conflict (empresa_id, type, venta_id) where (type = 'LICENCIA_SANITARIA_PENDIENTE')
    do update
      set payload      = excluded.payload,
          processed_at = null,
          attempts     = 0,
          last_error   = null;

  elsif v_tipo = 'patente_comercio' then
    update public.clientes
    set patente_comercio_pdf_path   = p_path,
        patente_comercio_updated_at = now()
    where id = p_cliente_id
      and empresa_id = p_empresa_id;

  elsif v_tipo = 'credito_apertura' then
    update public.clientes
    set credito_apertura_pdf_path   = p_path,
        credito_apertura_updated_at = now()
    where id = p_cliente_id
      and empresa_id = p_empresa_id;
  end if;
end;
$function$;

grant execute on function public.rpc_cliente_documento_registrar(bigint, bigint, text, text) to authenticated, anon, service_role;
