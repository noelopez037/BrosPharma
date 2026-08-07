create or replace function public.rpc_cliente_licencia_sanitaria_revisar(
  p_empresa_id bigint,
  p_cliente_id bigint,
  p_decision   text,
  p_nota       text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid         uuid := auth.uid();
  v_rol_empresa text;
  v_decision    text := upper(trim(coalesce(p_decision, '')));
  v_nota        text := nullif(trim(coalesce(p_nota, '')), '');
  v_estado      text;
begin
  if v_uid is null then raise exception 'NO_AUTH'; end if;
  if v_decision not in ('APROBAR', 'RECHAZAR') then raise exception 'DECISION_INVALIDA'; end if;
  if v_decision = 'RECHAZAR' and v_nota is null then raise exception 'MOTIVO_REQUERIDO'; end if;

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

  if v_rol_empresa <> 'ADMIN' then raise exception 'NO_ROLE'; end if;

  select licencia_sanitaria_estado
    into v_estado
  from public.clientes
  where id = p_cliente_id
    and empresa_id = p_empresa_id;

  if not found then raise exception 'CLIENTE_NO_EXISTE'; end if;
  if v_estado is distinct from 'PENDIENTE' then raise exception 'NO_PENDIENTE'; end if;

  update public.clientes
  set licencia_sanitaria_estado         = case when v_decision = 'APROBAR' then 'APROBADA' else 'RECHAZADA' end,
      licencia_sanitaria_revisado_por   = v_uid,
      licencia_sanitaria_revisado_at    = now(),
      licencia_sanitaria_rechazo_motivo = case when v_decision = 'RECHAZAR' then v_nota else null end
  where id = p_cliente_id
    and empresa_id = p_empresa_id;

  return jsonb_build_object(
    'ok',         true,
    'cliente_id', p_cliente_id,
    'empresa_id', p_empresa_id,
    'decision',   v_decision
  );
end;
$function$;

grant execute on function public.rpc_cliente_licencia_sanitaria_revisar(bigint, bigint, text, text) to authenticated, anon, service_role;

create or replace view public.vw_clientes_licencia_sanitaria_pendientes_admin as
select
  c.id as cliente_id,
  c.empresa_id,
  c.nombre,
  c.nit,
  c.telefono,
  c.licencia_sanitaria_pdf_path,
  c.licencia_sanitaria_updated_at
from public.clientes c
where c.licencia_sanitaria_estado = 'PENDIENTE'
  and public.has_role('ADMIN')
order by c.licencia_sanitaria_updated_at desc;

grant select on public.vw_clientes_licencia_sanitaria_pendientes_admin to authenticated, anon, service_role;
