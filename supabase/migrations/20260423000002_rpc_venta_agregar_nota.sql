-- RPC para agregar una nota libre a una venta.
-- Usa ventas_eventos con tipo='NOTA' para reutilizar tabla y RLS existentes.
CREATE OR REPLACE FUNCTION public.rpc_venta_agregar_nota(
  p_venta_id bigint,
  p_contenido text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_empresa_id bigint;
begin
  if v_uid is null then raise exception 'NO_AUTH'; end if;

  select upper(coalesce(role,'')) into v_role
  from public.profiles where id = v_uid;

  if v_role not in ('ADMIN','BODEGA','VENTAS','FACTURACION','MENSAJERO') then
    raise exception 'NO_ROLE';
  end if;

  if nullif(trim(coalesce(p_contenido,'')), '') is null then
    raise exception 'CONTENIDO_REQUERIDO';
  end if;

  -- Validar acceso: ADMIN/BODEGA/FACTURACION ven todo; VENTAS/MENSAJERO solo sus ventas
  select v.empresa_id into v_empresa_id
  from public.ventas v
  where v.id = p_venta_id
    and (
      v_role in ('ADMIN','BODEGA','FACTURACION')
      or v.vendedor_id = v_uid
    );

  if v_empresa_id is null then raise exception 'VENTA_NO_ENCONTRADA'; end if;

  if not public.tiene_membresia_activa(v_empresa_id) then
    raise exception 'NO_MEMBRESIA_EMPRESA';
  end if;

  insert into public.ventas_eventos (empresa_id, venta_id, tipo, nota, creado_por, creado_en)
  values (v_empresa_id, p_venta_id, 'NOTA', trim(p_contenido), v_uid, now());

  return jsonb_build_object('ok', true);
end;
$$;
