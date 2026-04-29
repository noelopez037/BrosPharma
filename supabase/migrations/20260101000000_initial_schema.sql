


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "audit";


ALTER SCHEMA "audit" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "hypopg" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "index_advisor" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "audit"."tg_row_change_simple"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'audit'
    AS $$
declare
  v_actor uuid;
  v_pk text;
begin
  begin
    v_actor := auth.uid();
  exception when others then
    v_actor := null;
  end;

  if (tg_op = 'DELETE') then
    v_pk := old.id::text;

    insert into audit.log(actor_uid, action, table_schema, table_name, record_pk, old_data)
    values (v_actor, tg_op, tg_table_schema, tg_table_name, v_pk, to_jsonb(old));

    return old;
  else
    v_pk := new.id::text;

    insert into audit.log(actor_uid, action, table_schema, table_name, record_pk, new_data)
    values (v_actor, tg_op, tg_table_schema, tg_table_name, v_pk, to_jsonb(new));

    return new;
  end if;
end;
$$;


ALTER FUNCTION "audit"."tg_row_change_simple"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_test_get_stock_total"("p_lote_id" bigint) RETURNS integer
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select stock_total from public.stock_lotes where lote_id = p_lote_id;
$$;


ALTER FUNCTION "public"."_test_get_stock_total"("p_lote_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."anular_venta"("p_venta_id" bigint, "p_motivo" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_estado text;
  r record;
begin
  select estado into v_estado
  from public.ventas
  where id = p_venta_id;

  if not found then
    raise exception 'Venta no existe';
  end if;

  if v_estado = 'ANULADO' then
    raise exception 'La venta ya está ANULADA';
  end if;

  -- Si ya está ENTREGADO, NO es anulación: se usa devolución parcial/total.
  if v_estado = 'ENTREGADO' then
    raise exception 'Venta ENTREGADA: use registrar_devolucion_venta_por_detalle()';
  end if;

  if v_estado = 'NUEVO' then
    -- Liberar reservas
    for r in
      select lote_id, cantidad
      from public.ventas_detalle
      where venta_id = p_venta_id
    loop
      update public.stock_lotes
      set stock_reservado = stock_reservado - r.cantidad
      where lote_id = r.lote_id
        and stock_reservado >= r.cantidad;

      if not found then
        raise exception 'Inconsistencia liberando reserva (lote %)', r.lote_id;
      end if;
    end loop;

  elsif v_estado in ('FACTURADO','EN_RUTA') then
    -- Revertir stock físico
    for r in
      select lote_id, cantidad
      from public.ventas_detalle
      where venta_id = p_venta_id
    loop
      update public.stock_lotes
      set stock_total = stock_total + r.cantidad
      where lote_id = r.lote_id;
    end loop;

  else
    raise exception 'Estado no soportado para anular: %', v_estado;
  end if;

  update public.ventas
  set
    estado = 'ANULADO',
    cancel_reason = p_motivo,
    anulado_at = now(),
    canceled_at = coalesce(canceled_at, now())
  where id = p_venta_id;

  insert into public.ventas_eventos(venta_id, tipo, de_estado, a_estado, nota, creado_por)
  values (p_venta_id, 'ANULADA', v_estado, 'ANULADO', p_motivo, auth.uid());
end;
$$;


ALTER FUNCTION "public"."anular_venta"("p_venta_id" bigint, "p_motivo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."crear_devolucion"("p_venta_id" bigint, "p_motivo" "text", "p_created_by" "uuid", "p_items" "jsonb") RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_dev_id bigint;
  v_item jsonb;
  v_producto_id bigint;
  v_lote_id bigint;
  v_cantidad integer;
begin
  if not exists (
    select 1 from public.ventas
    where id = p_venta_id and estado = 'ENTREGADO'
  ) then
    raise exception 'Solo se puede devolver una venta ENTREGADA';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La devolución no tiene items';
  end if;

  insert into public.devoluciones (venta_id, motivo, created_by)
  values (p_venta_id, p_motivo, p_created_by)
  returning id into v_dev_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_producto_id := (v_item->>'producto_id')::bigint;
    v_lote_id := (v_item->>'lote_id')::bigint;
    v_cantidad := (v_item->>'cantidad')::int;

    if v_cantidad <= 0 then
      raise exception 'Cantidad inválida en devolución';
    end if;

    insert into public.devoluciones_detalle (devolucion_id, producto_id, lote_id, cantidad)
    values (v_dev_id, v_producto_id, v_lote_id, v_cantidad);
    -- El trigger inc_stock_por_devolucion suma stock_total automáticamente
  end loop;

  return v_dev_id;
end;
$$;


ALTER FUNCTION "public"."crear_devolucion"("p_venta_id" bigint, "p_motivo" "text", "p_created_by" "uuid", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_venta_nueva"("p_cliente_nombre" "text", "p_comentarios" "text", "p_items" "jsonb") RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_venta_id bigint;
  v_item jsonb;

  v_producto_id bigint;
  v_cantidad integer;
  v_precio_venta numeric(12,2);

  v_lote_id bigint;
  v_requiere_receta boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Usuario no autenticado';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos';
  end if;

  select exists (
    select 1
    from public.productos pr
    where pr.requiere_receta = true
      and pr.id in (
        select (x->>'producto_id')::bigint
        from jsonb_array_elements(p_items) x
      )
  ) into v_requiere_receta;

  insert into public.ventas (
    cliente_nombre,
    vendedor_id,
    estado,
    comentarios,
    requiere_receta,
    receta_cargada
  ) values (
    p_cliente_nombre,
    auth.uid(),
    'NUEVO',
    p_comentarios,
    v_requiere_receta,
    false
  )
  returning id into v_venta_id;

  insert into public.ventas_eventos(venta_id, tipo, de_estado, a_estado, nota, creado_por)
  values (v_venta_id, 'CREADA', null, 'NUEVO', p_comentarios, auth.uid());

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_producto_id := (v_item->>'producto_id')::bigint;
    v_cantidad := (v_item->>'cantidad')::int;
    v_precio_venta := (v_item->>'precio_venta_unit')::numeric;

    v_lote_id := public.reserve_stock_fefo(v_producto_id, v_cantidad);

    insert into public.ventas_detalle (
      venta_id, producto_id, lote_id, cantidad, precio_venta_unit
    ) values (
      v_venta_id, v_producto_id, v_lote_id, v_cantidad, v_precio_venta
    );
  end loop;

  return v_venta_id;
end;
$$;


ALTER FUNCTION "public"."create_venta_nueva"("p_cliente_nombre" "text", "p_comentarios" "text", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_venta_nueva"("p_cliente_nombre" "text", "p_comentarios" "text", "p_vendedor_id" "uuid", "p_items" "jsonb") RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_venta_id bigint;
  v_item jsonb;

  v_producto_id bigint;
  v_cantidad integer;
  v_precio_venta numeric(12,2);

  v_lote_id bigint;
  v_requiere_receta boolean := false;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos';
  end if;

  select exists (
    select 1
    from public.productos pr
    where pr.requiere_receta = true
      and pr.id in (
        select (x->>'producto_id')::bigint
        from jsonb_array_elements(p_items) x
      )
  ) into v_requiere_receta;

  insert into public.ventas (
    cliente_nombre,
    vendedor_id,
    estado,
    comentarios,
    requiere_receta,
    receta_cargada
  ) values (
    p_cliente_nombre,
    p_vendedor_id,
    'NUEVO',
    p_comentarios,
    v_requiere_receta,
    false
  )
  returning id into v_venta_id;

  insert into public.ventas_eventos(venta_id, tipo, de_estado, a_estado, nota, creado_por)
  values (v_venta_id, 'CREADA', null, 'NUEVO', p_comentarios, auth.uid());

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_producto_id := (v_item->>'producto_id')::bigint;
    v_cantidad := (v_item->>'cantidad')::int;
    v_precio_venta := (v_item->>'precio_venta_unit')::numeric;

    if v_cantidad <= 0 then
      raise exception 'Cantidad inválida para producto %', v_producto_id;
    end if;

    if v_precio_venta < 0 then
      raise exception 'Precio inválido para producto %', v_producto_id;
    end if;

    v_lote_id := public.reserve_stock_fefo(v_producto_id, v_cantidad);

    insert into public.ventas_detalle (
      venta_id, producto_id, lote_id, cantidad, precio_venta_unit
    ) values (
      v_venta_id, v_producto_id, v_lote_id, v_cantidad, v_precio_venta
    );
  end loop;

  return v_venta_id;
end;
$$;


ALTER FUNCTION "public"."create_venta_nueva"("p_cliente_nombre" "text", "p_comentarios" "text", "p_vendedor_id" "uuid", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select role from public.profiles where id = auth.uid()), '');
$$;


ALTER FUNCTION "public"."current_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_cliente_vendedor_admin_only"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF public.current_role() <> 'ADMIN' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.vendedor_id IS NOT NULL AND NEW.vendedor_id <> auth.uid() THEN
        RAISE EXCEPTION 'No autorizado para asignar vendedor_id';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.vendedor_id IS DISTINCT FROM OLD.vendedor_id THEN
        RAISE EXCEPTION 'No autorizado para cambiar vendedor_id';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_cliente_vendedor_admin_only"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_numero_factura"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if new.numero_factura is null or btrim(new.numero_factura) = '' then
    raise exception 'numero_factura requerido';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_numero_factura"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enviar_a_ruta"("p_venta_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if not exists (
    select 1 from public.ventas
    where id = p_venta_id and estado = 'FACTURADO'
  ) then
    raise exception 'Solo se puede enviar a ruta una venta FACTURADA';
  end if;

  update public.ventas
  set estado = 'RUTA'
  where id = p_venta_id;
end;
$$;


ALTER FUNCTION "public"."enviar_a_ruta"("p_venta_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."facturar_venta"("p_venta_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  r record;
begin
  if not exists (
    select 1 from public.ventas
    where id = p_venta_id and estado = 'NUEVO'
  ) then
    raise exception 'Solo se puede facturar una venta en estado NUEVO';
  end if;

  if exists (
    select 1 from public.ventas
    where id = p_venta_id and requiere_receta = true and receta_cargada = false
  ) then
    raise exception 'Esta venta requiere receta y aún no está cargada';
  end if;

  for r in
    select lote_id, cantidad
    from public.ventas_detalle
    where venta_id = p_venta_id
  loop
    update public.stock_lotes
    set
      stock_total = stock_total - r.cantidad,
      stock_reservado = stock_reservado - r.cantidad
    where lote_id = r.lote_id
      and stock_reservado >= r.cantidad
      and stock_total >= r.cantidad;

    if not found then
      raise exception 'Inconsistencia de stock al facturar (lote %)', r.lote_id;
    end if;
  end loop;

  update public.ventas
  set estado = 'FACTURADO'
  where id = p_venta_id;

  insert into public.ventas_eventos(venta_id, tipo, de_estado, a_estado, nota, creado_por)
  values (p_venta_id, 'FACTURADA', 'NUEVO', 'FACTURADO', null, auth.uid());
end;
$$;


ALTER FUNCTION "public"."facturar_venta"("p_venta_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."facturar_venta"("p_venta_id" bigint, "p_ignorar_receta" boolean DEFAULT false, "p_ignorar_facturas" boolean DEFAULT false) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  r record;

  v_req boolean;
  v_receta boolean;
  v_f1 boolean;
  v_f2 boolean;

  v_nota text := null;
begin
  -- Solo si está en NUEVO
  if not exists (
    select 1 from public.ventas
    where id = p_venta_id and estado = 'NUEVO'
  ) then
    raise exception 'Solo se puede facturar una venta en estado NUEVO';
  end if;

  select requiere_receta, receta_cargada, factura_1_cargada, factura_2_cargada
  into v_req, v_receta, v_f1, v_f2
  from public.ventas
  where id = p_venta_id;

  -- Reglas de facturas: debe existir al menos 1
  if (coalesce(v_f1,false) = false and coalesce(v_f2,false) = false)
     and p_ignorar_facturas = false then
    raise exception 'No se puede facturar: debe subir al menos 1 factura (factura_1 o factura_2)';
  end if;

  -- Regla de receta: opcionalmente ignorar
  if v_req = true and v_receta = false and p_ignorar_receta = false then
    raise exception 'Esta venta requiere receta y aún no está cargada';
  end if;

  if v_req = true and v_receta = false and p_ignorar_receta = true then
    v_nota := 'FACTURADA SIN RECETA (AUTORIZADO)';
  end if;

  if (coalesce(v_f1,false) = false and coalesce(v_f2,false) = false)
     and p_ignorar_facturas = true then
    v_nota := trim(both ' ' from coalesce(v_nota || ' | ', '') || 'FACTURADA SIN FACTURAS (AUTORIZADO)');
  end if;

  -- Convertir reserva a descuento real
  for r in
    select lote_id, cantidad
    from public.ventas_detalle
    where venta_id = p_venta_id
  loop
    update public.stock_lotes
    set
      stock_total = stock_total - r.cantidad,
      stock_reservado = stock_reservado - r.cantidad
    where lote_id = r.lote_id
      and stock_total >= r.cantidad
      and stock_reservado >= r.cantidad;

    if not found then
      raise exception 'Inconsistencia de stock al facturar (lote %)', r.lote_id;
    end if;
  end loop;

  update public.ventas
  set estado = 'FACTURADO'
  where id = p_venta_id;

  insert into public.ventas_eventos(venta_id, tipo, de_estado, a_estado, nota, creado_por)
  values (p_venta_id, 'FACTURADA', 'NUEVO', 'FACTURADO', v_nota, auth.uid());
end;
$$;


ALTER FUNCTION "public"."facturar_venta"("p_venta_id" bigint, "p_ignorar_receta" boolean, "p_ignorar_facturas" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_role"("p_role" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with me as (
    select role as r
    from public.profiles
    where id = auth.uid()
  )
  select case
    when (select r from me) = 'ADMIN' then
      true
    when p_role = 'VENTAS' then
      (select r from me) in ('VENTAS','ADMIN')
    else
      (select r from me) = p_role
  end;
$$;


ALTER FUNCTION "public"."has_role"("p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."inc_stock_por_compra"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  insert into public.stock_lotes (lote_id, stock_total, stock_reservado)
  values (new.lote_id, new.cantidad, 0)
  on conflict (lote_id)
  do update
    set stock_total = stock_lotes.stock_total + excluded.stock_total;

  return new;
end;
$$;


ALTER FUNCTION "public"."inc_stock_por_compra"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."inc_stock_por_devolucion"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  -- Sumar al stock físico. (No tocar reservado)
  insert into public.stock_lotes (lote_id, stock_total, stock_reservado)
  values (new.lote_id, new.cantidad, 0)
  on conflict (lote_id)
  do update
    set stock_total = stock_lotes.stock_total + excluded.stock_total;

  return new;
end;
$$;


ALTER FUNCTION "public"."inc_stock_por_devolucion"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."marcar_entregado"("p_venta_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if not exists (
    select 1 from public.ventas
    where id = p_venta_id and estado = 'RUTA'
  ) then
    raise exception 'Solo se puede marcar entregado una venta en RUTA';
  end if;

  update public.ventas
  set estado = 'ENTREGADO'
  where id = p_venta_id;
end;
$$;


ALTER FUNCTION "public"."marcar_entregado"("p_venta_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_created_at_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  new.created_at := old.created_at;
  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_created_at_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalc_saldo_compra"("p_compra_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_total numeric(12,2);
  v_pagado numeric(12,2);
begin
  select c.monto_total into v_total
  from public.compras c
  where c.id = p_compra_id;

  select coalesce(sum(p.monto), 0) into v_pagado
  from public.compras_pagos p
  where p.compra_id = p_compra_id;

  update public.compras
  set saldo_pendiente = greatest(coalesce(v_total, 0) - v_pagado, 0)
  where id = p_compra_id;
end;
$$;


ALTER FUNCTION "public"."recalc_saldo_compra"("p_compra_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalc_total_compra"("p_compra_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_total numeric(12,2);
  v_pagado numeric(12,2);
begin
  select coalesce(sum(d.subtotal), 0)
  into v_total
  from public.compras_detalle d
  where d.compra_id = p_compra_id;

  select coalesce(sum(p.monto), 0)
  into v_pagado
  from public.compras_pagos p
  where p.compra_id = p_compra_id;

  update public.compras
  set
    monto_total = v_total,
    saldo_pendiente = greatest(v_total - v_pagado, 0)
  where id = p_compra_id;
end;
$$;


ALTER FUNCTION "public"."recalc_total_compra"("p_compra_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_devolucion_venta_por_detalle"("p_venta_id" bigint, "p_motivo" "text", "p_items" "jsonb") RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_estado text;
  v_dev_id bigint;
  v_item jsonb;

  v_detalle_id bigint;
  v_lote_id bigint;
  v_cant int;

  v_vendido int;
  v_ya_devuelto int;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La devolución no tiene items';
  end if;

  select estado into v_estado
  from public.ventas
  where id = p_venta_id;

  if not found then
    raise exception 'Venta no existe';
  end if;

  if v_estado not in ('FACTURADO','EN_RUTA','ENTREGADO') then
    raise exception 'Solo se permite devolución si la venta está FACTURADO, EN_RUTA o ENTREGADO';
  end if;

  insert into public.ventas_devoluciones(venta_id, creado_por, motivo)
  values (p_venta_id, auth.uid(), p_motivo)
  returning id into v_dev_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_detalle_id := (v_item->>'detalle_id')::bigint;
    v_cant := (v_item->>'cantidad')::int;

    if v_cant <= 0 then
      raise exception 'Cantidad inválida en devolución (detalle %)', v_detalle_id;
    end if;

    select vd.lote_id, vd.cantidad
      into v_lote_id, v_vendido
    from public.ventas_detalle vd
    where vd.id = v_detalle_id
      and vd.venta_id = p_venta_id;

    if not found then
      raise exception 'Detalle % no pertenece a la venta', v_detalle_id;
    end if;

    select coalesce(sum(dd.cantidad),0) into v_ya_devuelto
    from public.ventas_devoluciones d
    join public.ventas_devoluciones_detalle dd on dd.devolucion_id = d.id
    where d.venta_id = p_venta_id
      and dd.lote_id = v_lote_id;

    if (v_ya_devuelto + v_cant) > v_vendido then
      raise exception 'Devolución excede lo vendido. Detalle % vendido=% devuelto=% intentando=%',
        v_detalle_id, v_vendido, v_ya_devuelto, v_cant;
    end if;

    insert into public.ventas_devoluciones_detalle(devolucion_id, lote_id, cantidad)
    values (v_dev_id, v_lote_id, v_cant);

    insert into public.stock_lotes(lote_id, stock_total, stock_reservado)
    values (v_lote_id, v_cant, 0)
    on conflict (lote_id) do update
      set stock_total = public.stock_lotes.stock_total + excluded.stock_total;
  end loop;

  insert into public.ventas_eventos(venta_id, tipo, de_estado, a_estado, nota, creado_por)
  values (p_venta_id, 'DEVOLUCION', v_estado, v_estado, p_motivo, auth.uid());

  return v_dev_id;
end;
$$;


ALTER FUNCTION "public"."registrar_devolucion_venta_por_detalle"("p_venta_id" bigint, "p_motivo" "text", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reserve_stock_fefo"("p_producto_id" bigint, "p_cantidad" integer) RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  r record;
  v_lote_id bigint;
begin
  if p_cantidad <= 0 then
    raise exception 'Cantidad inválida';
  end if;

  for r in
    select
      pl.id as lote_id
    from public.producto_lotes pl
    join public.stock_lotes sl on sl.lote_id = pl.id
    where pl.producto_id = p_producto_id
      and pl.activo = true
      and (sl.stock_total - sl.stock_reservado) >= p_cantidad
    order by
      pl.fecha_exp asc nulls last,
      pl.id asc
  loop
    update public.stock_lotes
    set stock_reservado = stock_reservado + p_cantidad
    where lote_id = r.lote_id
      and (stock_total - stock_reservado) >= p_cantidad
    returning lote_id into v_lote_id;

    if v_lote_id is not null then
      return v_lote_id; -- reserva exitosa
    end if;
  end loop;

  raise exception 'Stock insuficiente para producto %', p_producto_id;
end;
$$;


ALTER FUNCTION "public"."reserve_stock_fefo"("p_producto_id" bigint, "p_cantidad" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_admin_otorgar_edicion_pago"("p_venta_id" bigint, "p_otorgado_a" "uuid", "p_horas" integer DEFAULT 48) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_role text;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid();

  if v_role <> 'ADMIN' then
    raise exception 'No autorizado';
  end if;

  insert into public.ventas_permisos_edicion (
    venta_id, tipo, otorgado_a, otorgado_por, expira_at, used_at
  ) values (
    p_venta_id, 'PAGO', p_otorgado_a, auth.uid(), now() + make_interval(hours => p_horas), null
  );
end;
$$;


ALTER FUNCTION "public"."rpc_admin_otorgar_edicion_pago"("p_venta_id" bigint, "p_otorgado_a" "uuid", "p_horas" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_admin_resolver_solicitud"("p_venta_id" bigint, "p_decision" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_decision text := upper(trim(coalesce(p_decision,'')));
  v_estado text;
  v_solicitud_tag text;
  v_nota text;
  v_final_tag text;
  v_now timestamptz := now();
  v_count int;
begin
  if v_uid is null then raise exception 'NO_AUTH'; end if;

  select upper(coalesce(role,'')) into v_role
  from public.profiles
  where id = v_uid;

  if v_role <> 'ADMIN' then raise exception 'NO_ROLE'; end if;
  if v_decision not in ('APROBAR','RECHAZAR') then raise exception 'DECISION_INVALIDA'; end if;

  select estado into v_estado
  from public.ventas
  where id = p_venta_id;

  if not found then raise exception 'VENTA_NO_EXISTE'; end if;

  select count(*) into v_count
  from public.ventas_tags
  where venta_id = p_venta_id
    and removed_at is null
    and tag in ('SOLICITA_ANULACION','SOLICITA_REFACTURACION','SOLICITA_EDICION');

  if v_count = 0 then raise exception 'NO_SOLICITUD_ACTIVA'; end if;
  if v_count > 1 then raise exception 'MULTIPLES_SOLICITUDES_ACTIVAS'; end if;

  select tag, coalesce(nota,'') into v_solicitud_tag, v_nota
  from public.ventas_tags
  where venta_id = p_venta_id
    and removed_at is null
    and tag in ('SOLICITA_ANULACION','SOLICITA_REFACTURACION','SOLICITA_EDICION')
  order by created_at desc
  limit 1;

  update public.ventas_tags
  set removed_at = v_now,
      removed_by = v_uid
  where venta_id = p_venta_id
    and removed_at is null
    and tag in ('PEND_AUTORIZACION_ADMIN', v_solicitud_tag);

  if v_decision = 'RECHAZAR' then
    return jsonb_build_object('ok', true, 'venta_id', p_venta_id, 'decision', v_decision, 'solicitud', v_solicitud_tag);
  end if;

  if v_solicitud_tag = 'SOLICITA_ANULACION' then
    v_final_tag := 'ANULACION_REQUERIDA';
    update public.ventas set estado = 'FACTURADO' where id = p_venta_id and estado <> 'FACTURADO';
  elsif v_solicitud_tag = 'SOLICITA_REFACTURACION' then
    v_final_tag := 'REFACTURACION_REQUERIDA';
    update public.ventas set estado = 'FACTURADO' where id = p_venta_id and estado <> 'FACTURADO';
  elsif v_solicitud_tag = 'SOLICITA_EDICION' then
    if v_estado <> 'NUEVO' then raise exception 'EDICION_SOLO_NUEVO'; end if;
    v_final_tag := 'EDICION_REQUERIDA';
  else
    raise exception 'SOLICITUD_DESCONOCIDA';
  end if;

  insert into public.ventas_tags (venta_id, tag, nota, created_by)
  values (p_venta_id, v_final_tag, nullif(trim(v_nota),''), v_uid)
  on conflict (venta_id, tag) where removed_at is null do nothing;

  return jsonb_build_object(
    'ok', true,
    'venta_id', p_venta_id,
    'decision', v_decision,
    'solicitud', v_solicitud_tag,
    'final', v_final_tag
  );
end;
$$;


ALTER FUNCTION "public"."rpc_admin_resolver_solicitud"("p_venta_id" bigint, "p_decision" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_calc_stock_disponible_producto"("p_producto_id" bigint) RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(v.stock_disponible, 0)::int
  from public.vw_inventario_productos_v2 v
  where v.id = p_producto_id;
$$;


ALTER FUNCTION "public"."rpc_calc_stock_disponible_producto"("p_producto_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_claim_push_token"("p_user_id" "uuid", "p_device_id" "text", "p_expo_token" "text", "p_platform" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- 1) Deshabilita este expo_token para cualquier otro usuario
  update public.user_push_tokens
  set enabled = false,
      updated_at = now()
  where expo_token = p_expo_token
    and enabled = true
    and user_id <> p_user_id;

  -- 2) Upsert por device_id (tu constraint actual), habilitando para el usuario actual
  insert into public.user_push_tokens (user_id, device_id, expo_token, platform, enabled, updated_at)
  values (p_user_id, p_device_id, p_expo_token, p_platform, true, now())
  on conflict (device_id)
  do update set
    user_id = excluded.user_id,
    expo_token = excluded.expo_token,
    platform = excluded.platform,
    enabled = true,
    updated_at = now();
end;
$$;


ALTER FUNCTION "public"."rpc_claim_push_token"("p_user_id" "uuid", "p_device_id" "text", "p_expo_token" "text", "p_platform" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_comisiones_resumen_mes"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_vendedor_id" "uuid" DEFAULT NULL::"uuid", "p_iva_pct" numeric DEFAULT 12, "p_comision_pct" numeric DEFAULT 5) RETURNS TABLE("vendedor_id" "uuid", "vendedor_codigo" "text", "total_con_iva" numeric, "total_sin_iva" numeric, "comision_mes" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_divisor numeric;
  v_comision_factor numeric;
begin
  select upper(coalesce(p.role, '')) into v_role
  from public.profiles p
  where p.id = v_uid;

  if v_role not in ('ADMIN','VENTAS') then
    return;
  end if;

  v_divisor := 1 + (coalesce(p_iva_pct,0) / 100.0);
  if v_divisor = 0 then v_divisor := 1; end if;
  v_comision_factor := coalesce(p_comision_pct,0) / 100.0;

  return query
  with base as (
    select
      v.venta_id,
      v.vendedor_id,
      v.vendedor_codigo,
      v.total
    from public.vw_cxc_ventas v
    join public.ventas ve on ve.id = v.venta_id
    where
      ve.canceled_at is null
      and ve.anulado_at is null
      and upper(coalesce(ve.estado,'')) not in ('ANULADA','CANCELADA')
      and (
        (v_role = 'ADMIN' and (p_vendedor_id is null or v.vendedor_id = p_vendedor_id))
        or
        (v_role = 'VENTAS' and v.vendedor_id = v_uid)
      )
  ),
  pagos_acum as (
    select
      p.venta_id,
      p.fecha,
      sum(p.monto) over (
        partition by p.venta_id
        order by p.fecha, p.id
        rows between unbounded preceding and current row
      ) as pagado_acum
    from public.ventas_pagos p
    join base b on b.venta_id = p.venta_id
  ),
  liquidacion as (
    select distinct on (pa.venta_id)
      pa.venta_id,
      pa.fecha as fecha_liquidacion
    from pagos_acum pa
    join base b on b.venta_id = pa.venta_id
    where pa.pagado_acum >= coalesce(b.total,0)
    order by pa.venta_id, pa.fecha asc
  )
  select
    b.vendedor_id,
    max(b.vendedor_codigo) as vendedor_codigo,
    sum(b.total) as total_con_iva,
    sum(b.total) / v_divisor as total_sin_iva,
    (sum(b.total) / v_divisor) * v_comision_factor as comision_mes
  from base b
  join liquidacion l on l.venta_id = b.venta_id
  where
    l.fecha_liquidacion >= p_desde
    and l.fecha_liquidacion <= p_hasta
  group by b.vendedor_id
  order by comision_mes desc;
end;
$$;


ALTER FUNCTION "public"."rpc_comisiones_resumen_mes"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_vendedor_id" "uuid", "p_iva_pct" numeric, "p_comision_pct" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_comisiones_ventas_liquidadas"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_vendedor_id" "uuid" DEFAULT NULL::"uuid", "p_cliente_id" bigint DEFAULT NULL::bigint) RETURNS TABLE("venta_id" bigint, "fecha_venta" timestamp with time zone, "fecha_liquidacion" timestamp with time zone, "cliente_id" bigint, "cliente_nombre" "text", "vendedor_id" "uuid", "vendedor_codigo" "text", "total" numeric, "pagado" numeric, "saldo" numeric, "facturas" "text"[])
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  select upper(coalesce(p.role, '')) into v_role
  from public.profiles p
  where p.id = v_uid;

  if v_role not in ('ADMIN','VENTAS') then
    return;
  end if;

  return query
  with base as (
    select
      v.venta_id,
      v.fecha as fecha_venta,
      v.cliente_id,
      v.cliente_nombre,
      v.vendedor_id,
      v.vendedor_codigo,
      v.total,
      v.pagado,
      v.saldo,
      v.facturas
    from public.vw_cxc_ventas v
    join public.ventas ve on ve.id = v.venta_id
    where
      -- excluye anuladas/canceladas si aplica
      ve.canceled_at is null
      and ve.anulado_at is null
      -- si tienes estado "ANULADA"/"CANCELADA", también lo evitamos
      and upper(coalesce(ve.estado,'')) not in ('ANULADA','CANCELADA')
      -- filtros opcionales
      and (p_cliente_id is null or v.cliente_id = p_cliente_id)
      -- gating por rol
      and (
        (v_role = 'ADMIN' and (p_vendedor_id is null or v.vendedor_id = p_vendedor_id))
        or
        (v_role = 'VENTAS' and v.vendedor_id = v_uid)
      )
  ),
  pagos_acum as (
    select
      p.venta_id,
      p.fecha,
      p.monto,
      sum(p.monto) over (
        partition by p.venta_id
        order by p.fecha, p.id
        rows between unbounded preceding and current row
      ) as pagado_acum
    from public.ventas_pagos p
    join base b on b.venta_id = p.venta_id
  ),
  liquidacion as (
    -- primera fila donde acumulado cruza total (umbral)
    select distinct on (pa.venta_id)
      pa.venta_id,
      pa.fecha as fecha_liquidacion
    from pagos_acum pa
    join base b on b.venta_id = pa.venta_id
    where pa.pagado_acum >= coalesce(b.total, 0)
    order by pa.venta_id, pa.fecha asc
  )
  select
    b.venta_id,
    b.fecha_venta,
    l.fecha_liquidacion,
    b.cliente_id,
    b.cliente_nombre,
    b.vendedor_id,
    b.vendedor_codigo,
    b.total,
    b.pagado,
    b.saldo,
    b.facturas
  from base b
  join liquidacion l on l.venta_id = b.venta_id
  where
    l.fecha_liquidacion >= p_desde
    and l.fecha_liquidacion <= p_hasta
  order by l.fecha_liquidacion desc, b.venta_id desc;
end;
$$;


ALTER FUNCTION "public"."rpc_comisiones_ventas_liquidadas"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_vendedor_id" "uuid", "p_cliente_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_comisiones_ventas_liquidadas"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_vendedor_id" "uuid" DEFAULT NULL::"uuid", "p_cliente_id" bigint DEFAULT NULL::bigint, "p_iva_pct" numeric DEFAULT 12, "p_comision_pct" numeric DEFAULT 5) RETURNS TABLE("venta_id" bigint, "fecha_venta" timestamp with time zone, "fecha_liquidacion" timestamp with time zone, "cliente_id" bigint, "cliente_nombre" "text", "vendedor_id" "uuid", "vendedor_codigo" "text", "total_con_iva" numeric, "total_sin_iva" numeric, "comision_monto" numeric, "pagado" numeric, "saldo" numeric, "facturas" "text"[])
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_divisor numeric;
  v_comision_factor numeric;
begin
  select upper(coalesce(p.role, '')) into v_role
  from public.profiles p
  where p.id = v_uid;

  if v_role not in ('ADMIN','VENTAS') then
    return;
  end if;

  -- Evita división por cero si alguien pasa 0 o null
  v_divisor := 1 + (coalesce(p_iva_pct, 0) / 100.0);
  if v_divisor = 0 then
    v_divisor := 1;
  end if;

  v_comision_factor := coalesce(p_comision_pct, 0) / 100.0;

  return query
  with base as (
    select
      v.venta_id,
      v.fecha as fecha_venta,
      v.cliente_id,
      v.cliente_nombre,
      v.vendedor_id,
      v.vendedor_codigo,
      v.total,
      v.pagado,
      v.saldo,
      v.facturas
    from public.vw_cxc_ventas v
    join public.ventas ve on ve.id = v.venta_id
    where
      ve.canceled_at is null
      and ve.anulado_at is null
      and upper(coalesce(ve.estado,'')) not in ('ANULADA','CANCELADA')
      and (p_cliente_id is null or v.cliente_id = p_cliente_id)
      and (
        (v_role = 'ADMIN' and (p_vendedor_id is null or v.vendedor_id = p_vendedor_id))
        or
        (v_role = 'VENTAS' and v.vendedor_id = v_uid)
      )
  ),
  pagos_acum as (
    select
      p.venta_id,
      p.fecha,
      p.monto,
      sum(p.monto) over (
        partition by p.venta_id
        order by p.fecha, p.id
        rows between unbounded preceding and current row
      ) as pagado_acum
    from public.ventas_pagos p
    join base b on b.venta_id = p.venta_id
  ),
  liquidacion as (
    -- primera fecha donde acumulado cruza el total
    select distinct on (pa.venta_id)
      pa.venta_id,
      pa.fecha as fecha_liquidacion
    from pagos_acum pa
    join base b on b.venta_id = pa.venta_id
    where pa.pagado_acum >= coalesce(b.total, 0)
    order by pa.venta_id, pa.fecha asc
  )
  select
    b.venta_id,
    b.fecha_venta,
    l.fecha_liquidacion,
    b.cliente_id,
    b.cliente_nombre,
    b.vendedor_id,
    b.vendedor_codigo,
    coalesce(b.total, 0) as total_con_iva,
    (coalesce(b.total, 0) / v_divisor) as total_sin_iva,
    (coalesce(b.total, 0) / v_divisor) * v_comision_factor as comision_monto,
    b.pagado,
    b.saldo,
    b.facturas
  from base b
  join liquidacion l on l.venta_id = b.venta_id
  where
    l.fecha_liquidacion >= p_desde
    and l.fecha_liquidacion <= p_hasta
  order by l.fecha_liquidacion desc, b.venta_id desc;
end;
$$;


ALTER FUNCTION "public"."rpc_comisiones_ventas_liquidadas"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_vendedor_id" "uuid", "p_cliente_id" bigint, "p_iva_pct" numeric, "p_comision_pct" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_compra_actualizar_linea"("p_detalle_id" bigint, "p_nueva_cantidad" integer, "p_nuevo_lote" "text", "p_nueva_fecha_exp" "date", "p_nuevo_precio" numeric) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_old record;
  v_new_lote_id bigint;
  v_delta integer;
begin
  select *
  into v_old
  from public.compras_detalle
  where id = p_detalle_id;

  if not found then
    raise exception 'Detalle no existe';
  end if;

  -- Resolver lote nuevo
  select id into v_new_lote_id
  from public.producto_lotes
  where producto_id = v_old.producto_id
    and lote = p_nuevo_lote
    and fecha_exp = p_nueva_fecha_exp
  limit 1;

  if v_new_lote_id is null then
    insert into public.producto_lotes (producto_id, lote, fecha_exp, activo)
    values (v_old.producto_id, p_nuevo_lote, p_nueva_fecha_exp, true)
    returning id into v_new_lote_id;

    insert into public.stock_lotes (lote_id, stock_total, stock_reservado)
    values (v_new_lote_id, 0, 0)
    on conflict (lote_id) do nothing;
  end if;

  -- Ajuste de stock
  if v_old.lote_id <> v_new_lote_id then
    update public.stock_lotes
      set stock_total = stock_total - v_old.cantidad
    where lote_id = v_old.lote_id;

    update public.stock_lotes
      set stock_total = stock_total + p_nueva_cantidad
    where lote_id = v_new_lote_id;
  else
    v_delta := p_nueva_cantidad - v_old.cantidad;
    update public.stock_lotes
      set stock_total = stock_total + v_delta
    where lote_id = v_old.lote_id;
  end if;

  -- Actualizar detalle (NO tocar subtotal)
  update public.compras_detalle
  set
    lote_id = v_new_lote_id,
    cantidad = p_nueva_cantidad,
    precio_compra_unit = p_nuevo_precio
  where id = p_detalle_id;

  -- Validación final
  if exists (select 1 from public.stock_lotes where stock_total < 0) then
    raise exception 'Stock negativo detectado';
  end if;
end;
$$;


ALTER FUNCTION "public"."rpc_compra_actualizar_linea"("p_detalle_id" bigint, "p_nueva_cantidad" integer, "p_nuevo_lote" "text", "p_nueva_fecha_exp" "date", "p_nuevo_precio" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_compra_agregar_linea"("p_compra_id" bigint, "p_producto_id" bigint, "p_lote" "text", "p_fecha_exp" "date", "p_cantidad" integer, "p_precio_compra_unit" numeric) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_lote_id bigint;
begin
  -- Crear o reutilizar lote
  select id
  into v_lote_id
  from producto_lotes
  where producto_id = p_producto_id
    and lote = p_lote
    and fecha_exp = p_fecha_exp;

  if v_lote_id is null then
    insert into producto_lotes (producto_id, lote, fecha_exp, activo)
    values (p_producto_id, p_lote, p_fecha_exp, true)
    returning id into v_lote_id;

    insert into stock_lotes (lote_id, stock_total, stock_reservado)
    values (v_lote_id, 0, 0);
  end if;

  -- Insertar detalle
  insert into compras_detalle (
    compra_id,
    producto_id,
    lote_id,
    cantidad,
    precio_compra_unit,
    subtotal
  )
  values (
    p_compra_id,
    p_producto_id,
    v_lote_id,
    p_cantidad,
    p_precio_compra_unit,
    p_cantidad * p_precio_compra_unit
  );

  -- Ajustar stock
  update stock_lotes
  set stock_total = stock_total + p_cantidad
  where lote_id = v_lote_id;
end;
$$;


ALTER FUNCTION "public"."rpc_compra_agregar_linea"("p_compra_id" bigint, "p_producto_id" bigint, "p_lote" "text", "p_fecha_exp" "date", "p_cantidad" integer, "p_precio_compra_unit" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_compra_aplicar_pago"("p_compra_id" bigint, "p_monto" numeric, "p_metodo" "text" DEFAULT NULL::"text", "p_referencia" "text" DEFAULT NULL::"text", "p_comentario" "text" DEFAULT NULL::"text", "p_fecha" timestamp with time zone DEFAULT "now"()) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  insert into public.compras_pagos (compra_id, fecha, monto, metodo, referencia, comentario, created_by)
  values (p_compra_id, p_fecha, p_monto, p_metodo, p_referencia, p_comentario, auth.uid());
  -- triggers existentes hacen validate_pago_no_exceda_saldo + recalc_saldo_compra
end;
$$;


ALTER FUNCTION "public"."rpc_compra_aplicar_pago"("p_compra_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comentario" "text", "p_fecha" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_compra_aplicar_pago"("p_compra_id" bigint, "p_monto" numeric, "p_metodo" "text" DEFAULT NULL::"text", "p_referencia" "text" DEFAULT NULL::"text", "p_comprobante_path" "text" DEFAULT NULL::"text", "p_comentario" "text" DEFAULT NULL::"text", "p_fecha" timestamp with time zone DEFAULT "now"()) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  insert into public.compras_pagos (
    compra_id, fecha, monto, metodo, referencia, comprobante_path, comentario, created_by
  )
  values (
    p_compra_id, p_fecha, p_monto, p_metodo, p_referencia, p_comprobante_path, p_comentario, auth.uid()
  );
  -- triggers existentes:
  -- validate_pago_no_exceda_saldo() y trg_recalc_saldo_compra() hacen el resto
end;
$$;


ALTER FUNCTION "public"."rpc_compra_aplicar_pago"("p_compra_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comprobante_path" "text", "p_comentario" "text", "p_fecha" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_compra_eliminar_compra"("p_compra_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_detalle_id bigint;
begin
  if p_compra_id is null or p_compra_id <= 0 then
    raise exception 'compra inválida';
  end if;

  -- eliminar líneas con ajuste stock
  for v_detalle_id in
    select id from public.compras_detalle where compra_id = p_compra_id order by id
  loop
    perform public.rpc_compra_eliminar_linea(v_detalle_id);
  end loop;

  -- borrar cabecera (ya sin líneas)
  delete from public.compras where id = p_compra_id;
end;
$$;


ALTER FUNCTION "public"."rpc_compra_eliminar_compra"("p_compra_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_compra_eliminar_linea"("p_detalle_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_lote_id bigint;
  v_cantidad integer;
begin
  -- Obtener datos de la línea
  select lote_id, cantidad
  into v_lote_id, v_cantidad
  from compras_detalle
  where id = p_detalle_id;

  if not found then
    raise exception 'Detalle no existe';
  end if;

  -- Ajustar stock
  update stock_lotes
  set stock_total = stock_total - v_cantidad
  where lote_id = v_lote_id;

  -- Validación de seguridad
  if (select stock_total from stock_lotes where lote_id = v_lote_id) < 0 then
    raise exception 'Stock negativo no permitido';
  end if;

  -- Eliminar detalle
  delete from compras_detalle
  where id = p_detalle_id;
end;
$$;


ALTER FUNCTION "public"."rpc_compra_eliminar_linea"("p_detalle_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_compra_reemplazar"("p_compra_id" bigint, "p_compra" "jsonb", "p_detalles" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  d jsonb;

  v_numero_factura text;
  v_tipo_pago text;
  v_fecha_venc date;
  v_comentarios text;
  v_proveedor_id bigint;
  v_estado text;

  v_producto_id bigint;
  v_lote text;
  v_fecha_exp date;
  v_cantidad int;
  v_precio numeric;
  v_image_path text;

  v_lote_id bigint;
  v_detalle_id bigint;
begin
  if p_compra_id is null or p_compra_id <= 0 then
    raise exception 'compra inválida';
  end if;

  if jsonb_typeof(p_detalles) <> 'array' then
    raise exception 'p_detalles debe ser un array json';
  end if;

  -- ====== parse cabecera
  v_proveedor_id   := nullif((p_compra->>'proveedor_id')::bigint, 0);
  v_numero_factura := nullif(trim(p_compra->>'numero_factura'), '');
  v_tipo_pago      := upper(coalesce(nullif(trim(p_compra->>'tipo_pago'), ''), 'CONTADO'));
  v_fecha_venc     := nullif(p_compra->>'fecha_vencimiento','')::date;
  v_comentarios    := nullif(p_compra->>'comentarios','');
  v_estado         := coalesce(nullif(p_compra->>'estado',''), 'ACTIVA');

  if v_numero_factura is null then
    raise exception 'numero_factura es requerido';
  end if;

  if v_tipo_pago not in ('CONTADO','CREDITO') then
    raise exception 'tipo_pago inválido';
  end if;

  if v_tipo_pago = 'CREDITO' and v_fecha_venc is null then
    v_fecha_venc := (now()::date + 30);
  end if;

  -- ====== update cabecera
  update public.compras
  set
    proveedor_id = v_proveedor_id,
    numero_factura = v_numero_factura,
    tipo_pago = v_tipo_pago,
    fecha_vencimiento = case when v_tipo_pago='CREDITO' then v_fecha_venc else null end,
    comentarios = v_comentarios,
    estado = v_estado
  where id = p_compra_id;

  if not found then
    raise exception 'Compra no existe';
  end if;

  -- ====== eliminar líneas existentes (USAR RPC para ajustar stock)
  for v_detalle_id in
    select id from public.compras_detalle where compra_id = p_compra_id order by id
  loop
    perform public.rpc_compra_eliminar_linea(v_detalle_id);
  end loop;

  -- ====== insertar líneas nuevas
  for d in select value from jsonb_array_elements(p_detalles) loop
    v_producto_id := nullif((d->>'producto_id')::bigint, 0);
    v_lote        := nullif(trim(d->>'lote'), '');
    v_fecha_exp   := nullif(d->>'fecha_exp','')::date;
    v_cantidad    := coalesce(nullif((d->>'cantidad')::int, 0), 0);
    v_precio      := coalesce(nullif((d->>'precio_compra_unit')::numeric, 0), 0);
    v_image_path  := nullif(trim(d->>'image_path'), '');

    if v_producto_id is null then
      raise exception 'producto_id requerido en detalles';
    end if;
    if v_lote is null then
      raise exception 'lote requerido en detalles';
    end if;
    if v_fecha_exp is null then
      raise exception 'fecha_exp requerida en detalles';
    end if;
    if v_cantidad <= 0 then
      raise exception 'cantidad inválida en detalles';
    end if;
    if v_precio < 0 then
      raise exception 'precio inválido en detalles';
    end if;

    -- lote
    select pl.id into v_lote_id
    from public.producto_lotes pl
    where pl.producto_id = v_producto_id and pl.lote = v_lote
    limit 1;

    if v_lote_id is null then
      insert into public.producto_lotes (producto_id, lote, fecha_exp, activo)
      values (v_producto_id, v_lote, v_fecha_exp, true)
      returning id into v_lote_id;
    end if;

    insert into public.stock_lotes (lote_id, stock_total, stock_reservado)
    values (v_lote_id, 0, 0)
    on conflict (lote_id) do nothing;

    insert into public.compras_detalle (
      compra_id, producto_id, lote_id, cantidad, precio_compra_unit, image_path
    )
    values (
      p_compra_id, v_producto_id, v_lote_id, v_cantidad, v_precio, v_image_path
    );
  end loop;

  perform public.recalc_saldo_compra(p_compra_id);
end;
$$;


ALTER FUNCTION "public"."rpc_compra_reemplazar"("p_compra_id" bigint, "p_compra" "jsonb", "p_detalles" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_crear_compra"("p_compra" "jsonb", "p_detalles" "jsonb") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_compra_id        bigint;
  v_total            numeric := 0;

  d                  jsonb;

  v_proveedor_id     bigint;
  v_proveedor_txt    text;
  v_numero_factura   text;
  v_tipo_pago        text;
  v_fecha            timestamptz;
  v_fecha_venc       date;
  v_comentarios      text;

  v_producto_id      bigint;
  v_producto_nombre  text;
  v_lote             text;
  v_fecha_exp        date;
  v_cantidad         int;
  v_precio           numeric;

  v_lote_id          bigint;
  v_image_path       text;
begin
  if jsonb_typeof(p_detalles) <> 'array' then
    raise exception 'p_detalles debe ser un array json';
  end if;

  v_proveedor_id   := nullif((p_compra->>'proveedor_id')::bigint, 0);
  v_proveedor_txt  := nullif(trim(p_compra->>'proveedor'), '');
  v_numero_factura := nullif(trim(p_compra->>'numero_factura'), '');
  v_tipo_pago      := upper(coalesce(nullif(trim(p_compra->>'tipo_pago'), ''), 'CONTADO'));
  v_fecha          := coalesce(nullif(p_compra->>'fecha','')::timestamptz, now());
  v_fecha_venc     := nullif(p_compra->>'fecha_vencimiento','')::date;
  v_comentarios    := nullif(p_compra->>'comentarios','');

  if v_numero_factura is null then
    raise exception 'numero_factura es requerido';
  end if;

  if v_tipo_pago not in ('CONTADO','CREDITO') then
    raise exception 'tipo_pago inválido';
  end if;

  if v_tipo_pago = 'CREDITO' and v_fecha_venc is null then
    v_fecha_venc := (v_fecha::date + 30);
  end if;

  if v_proveedor_id is not null then
    select p.nombre
      into v_proveedor_txt
    from public.proveedores p
    where p.id = v_proveedor_id;
  else
    select p.id
      into v_proveedor_id
    from public.proveedores p
    where lower(p.nombre) = lower(v_proveedor_txt)
    limit 1;

    if v_proveedor_id is null then
      insert into public.proveedores (nombre, activo, created_at)
      values (v_proveedor_txt, true, now())
      returning id into v_proveedor_id;
    end if;
  end if;

  insert into public.compras (
    fecha,
    proveedor,
    numero_factura,
    tipo_pago,
    fecha_vencimiento,
    comentarios,
    monto_total,
    saldo_pendiente,
    estado,
    proveedor_id
  )
  values (
    v_fecha,
    v_proveedor_txt,
    v_numero_factura,
    v_tipo_pago,
    v_fecha_venc,
    v_comentarios,
    0,
    0,
    coalesce(nullif(p_compra->>'estado',''), 'ACTIVA'),
    v_proveedor_id
  )
  returning id into v_compra_id;

  for d in
    select value from jsonb_array_elements(p_detalles)
  loop
    v_producto_id     := nullif((d->>'producto_id')::bigint, 0);
    v_producto_nombre := nullif(trim(d->>'producto'), '');
    v_lote            := nullif(trim(d->>'lote'), '');
    v_fecha_exp       := nullif(d->>'fecha_exp','')::date;
    v_cantidad        := coalesce(nullif((d->>'cantidad')::int, 0), 0);
    v_precio          := coalesce(nullif((d->>'precio_compra_unit')::numeric, 0), 0);
    v_image_path      := nullif(trim(d->>'image_path'), '');

    if v_producto_id is null then
      select pr.id
        into v_producto_id
      from public.productos pr
      where lower(pr.nombre) = lower(v_producto_nombre)
      limit 1;

      if v_producto_id is null then
        insert into public.productos (nombre, activo)
        values (v_producto_nombre, true)
        returning id into v_producto_id;
      end if;
    end if;

    select pl.id
      into v_lote_id
    from public.producto_lotes pl
    where pl.producto_id = v_producto_id
      and pl.lote = v_lote
    limit 1;

    if v_lote_id is null then
      insert into public.producto_lotes (producto_id, lote, fecha_exp, activo)
      values (v_producto_id, v_lote, v_fecha_exp, true)
      returning id into v_lote_id;
    end if;

    insert into public.stock_lotes (lote_id, stock_total, stock_reservado)
    values (v_lote_id, 0, 0)
    on conflict (lote_id) do nothing;

    insert into public.compras_detalle (
      compra_id,
      producto_id,
      lote_id,
      cantidad,
      precio_compra_unit,
      image_path
    )
    values (
      v_compra_id,
      v_producto_id,
      v_lote_id,
      v_cantidad,
      v_precio,
      v_image_path
    );

    insert into public.producto_precio_override (
      producto_id,
      precio_compra_override,
      motivo,
      updated_at,
      updated_by
    )
    values (
      v_producto_id,
      v_precio,
      'Auto actualizado por compra',
      now(),
      auth.uid()
    )
    on conflict (producto_id) do update
    set
      precio_compra_override = case
        when excluded.precio_compra_override > public.producto_precio_override.precio_compra_override
          then excluded.precio_compra_override
        else public.producto_precio_override.precio_compra_override
      end,
      motivo = case
        when excluded.precio_compra_override > public.producto_precio_override.precio_compra_override
          then 'Auto actualizado por compra mayor'
        else public.producto_precio_override.motivo
      end,
      updated_at = case
        when excluded.precio_compra_override > public.producto_precio_override.precio_compra_override
          then now()
        else public.producto_precio_override.updated_at
      end,
      updated_by = case
        when excluded.precio_compra_override > public.producto_precio_override.precio_compra_override
          then auth.uid()
        else public.producto_precio_override.updated_by
      end;

    v_total := v_total + (v_cantidad::numeric * v_precio);
  end loop;

  update public.compras
  set
    monto_total = v_total,
    saldo_pendiente = case
      when v_tipo_pago = 'CREDITO' then v_total
      else 0
    end
  where id = v_compra_id;

  return v_compra_id;
end;
$$;


ALTER FUNCTION "public"."rpc_crear_compra"("p_compra" "jsonb", "p_detalles" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_crear_venta"("p_venta" "jsonb", "p_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;

  v_cliente_id bigint;
  v_cliente_nombre text;
  v_comentarios text;

  v_vendedor_codigo text;

  v_venta_id bigint;
  v_requiere_receta boolean := false;

  it jsonb;
  v_producto_id bigint;
  v_qty int;
  v_precio numeric;

  v_min numeric;
  v_req_receta boolean;

  v_needed int;
  r record;
  st record;
  v_avail int;
  v_take int;
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

  select nullif(trim(coalesce(codigo,'')), '') into v_vendedor_codigo
  from public.profiles
  where id = v_uid;

  v_cliente_id := nullif(trim(coalesce(p_venta->>'cliente_id','')), '')::bigint;
  v_comentarios := nullif(trim(coalesce(p_venta->>'comentarios','')), '');

  if v_cliente_id is null then
    raise exception 'CLIENTE_INVALIDO';
  end if;

  select c.nombre into v_cliente_nombre
  from public.clientes c
  where c.id = v_cliente_id
    and c.activo = true;

  if v_cliente_nombre is null then
    raise exception 'CLIENTE_INVALIDO';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS_INVALIDOS';
  end if;

  insert into public.ventas (
    cliente_id,
    cliente_nombre,
    vendedor_id,
    vendedor_codigo,
    comentarios,
    requiere_receta
  )
  values (
    v_cliente_id,
    v_cliente_nombre,
    v_uid,
    v_vendedor_codigo,
    v_comentarios,
    false
  )
  returning id into v_venta_id;

  for it in
    select value from jsonb_array_elements(p_items) as t(value)
  loop
    v_producto_id := nullif(trim(coalesce(it->>'producto_id','')), '')::bigint;
    v_qty := (coalesce(it->>'cantidad','0'))::int;
    v_precio := (coalesce(it->>'precio_unit','0'))::numeric;

    if v_producto_id is null or v_qty <= 0 then
      raise exception 'ITEM_INVALIDO producto_id=%', coalesce(v_producto_id::text,'null');
    end if;

    select
      bool_or(v.requiere_receta),
      max(v.precio_min_venta)::numeric
    into v_req_receta, v_min
    from public.vw_producto_lotes_detalle v
    where v.producto_id = v_producto_id;

    if v_min is null then
      raise exception 'NO_STOCK producto_id=%', v_producto_id;
    end if;

    if v_precio < v_min then
      raise exception 'PRECIO_MINIMO producto_id=% min=%', v_producto_id, v_min;
    end if;

    if coalesce(v_req_receta,false) then
      v_requiere_receta := true;
    end if;

    v_needed := v_qty;

    for r in
      select v.lote_id, v.fecha_exp
      from public.vw_producto_lotes_detalle v
      where v.producto_id = v_producto_id
        and coalesce(v.stock_disponible_lote, 0) > 0
      order by v.fecha_exp asc nulls last, v.lote_id asc
    loop
      exit when v_needed <= 0;

      select sl.stock_total, sl.stock_reservado
      into st
      from public.stock_lotes sl
      where sl.lote_id = r.lote_id
      for update;

      v_avail := coalesce(st.stock_total,0) - coalesce(st.stock_reservado,0);
      if v_avail <= 0 then
        continue;
      end if;

      v_take := least(v_avail, v_needed);

      update public.stock_lotes
      set stock_reservado = stock_reservado + v_take
      where lote_id = r.lote_id;

      insert into public.ventas_detalle (
        venta_id,
        producto_id,
        lote_id,
        cantidad,
        precio_venta_unit
      )
      values (
        v_venta_id,
        v_producto_id,
        r.lote_id,
        v_take,
        v_precio
      );

      v_needed := v_needed - v_take;
    end loop;

    if v_needed > 0 then
      raise exception 'NO_STOCK producto_id=% faltante=%', v_producto_id, v_needed;
    end if;
  end loop;

  update public.ventas
  set requiere_receta = v_requiere_receta
  where id = v_venta_id;

  insert into public.ventas_eventos (
    venta_id,
    tipo,
    de_estado,
    a_estado,
    nota,
    creado_por,
    creado_en
  )
  values (
    v_venta_id,
    'CREADA',
    null,
    'NUEVO',
    null,
    v_uid,
    now()
  );

  return jsonb_build_object('ok', true, 'venta_id', v_venta_id);
end;
$$;


ALTER FUNCTION "public"."rpc_crear_venta"("p_venta" "jsonb", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_cxc_vendedores"() RETURNS TABLE("id" "uuid", "full_name" "text", "role" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  is_admin boolean;
begin
  select exists(
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and upper(coalesce(p.role,'')) = 'ADMIN'
  ) into is_admin;

  if is_admin then
    return query
      select p.id, p.full_name, p.role
      from public.profiles p
      where upper(coalesce(p.role,'')) in ('ADMIN','VENTAS')
      order by p.full_name nulls last;

  else
    return query
      select p.id, p.full_name, p.role
      from public.profiles p
      where p.id = auth.uid();
  end if;
end;
$$;


ALTER FUNCTION "public"."rpc_cxc_vendedores"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."clientes" (
    "id" bigint NOT NULL,
    "nombre" "text" NOT NULL,
    "nit" "text",
    "telefono" "text" NOT NULL,
    "direccion" "text" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "vendedor_id" "uuid",
    "credito_apertura_pdf_path" "text",
    "credito_apertura_updated_at" timestamp with time zone,
    "patente_comercio_pdf_path" "text",
    "patente_comercio_updated_at" timestamp with time zone,
    "licencia_sanitaria_pdf_path" "text",
    "licencia_sanitaria_updated_at" timestamp with time zone,
    CONSTRAINT "clientes_direccion_nonempty" CHECK (("length"(TRIM(BOTH FROM "direccion")) > 0)),
    CONSTRAINT "clientes_telefono_nonempty" CHECK (("length"(TRIM(BOTH FROM "telefono")) > 0))
);


ALTER TABLE "public"."clientes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ventas" (
    "id" bigint NOT NULL,
    "fecha" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cliente_nombre" "text",
    "vendedor_id" "uuid",
    "estado" "text" DEFAULT 'NUEVO'::"text" NOT NULL,
    "comentarios" "text",
    "requiere_receta" boolean DEFAULT false NOT NULL,
    "receta_cargada" boolean DEFAULT false NOT NULL,
    "factura_1_cargada" boolean DEFAULT false NOT NULL,
    "factura_2_cargada" boolean DEFAULT false NOT NULL,
    "cancel_reason" "text",
    "canceled_at" timestamp with time zone,
    "anulado_at" timestamp with time zone,
    "refactura_de_id" bigint,
    "refacturada_por_id" bigint,
    "cliente_id" bigint NOT NULL,
    "vendedor_codigo" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ventas_estado_chk" CHECK (("estado" = ANY (ARRAY['NUEVO'::"text", 'FACTURADO'::"text", 'EN_RUTA'::"text", 'ENTREGADO'::"text"]))),
    CONSTRAINT "ventas_estado_valido_chk" CHECK (("estado" = ANY (ARRAY['NUEVO'::"text", 'FACTURADO'::"text", 'EN_RUTA'::"text", 'ENTREGADO'::"text", 'ANULADO'::"text"])))
);


ALTER TABLE "public"."ventas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ventas_detalle" (
    "id" bigint NOT NULL,
    "venta_id" bigint NOT NULL,
    "producto_id" bigint NOT NULL,
    "lote_id" bigint NOT NULL,
    "cantidad" integer NOT NULL,
    "precio_venta_unit" numeric(12,2) NOT NULL,
    "subtotal" numeric(12,2) GENERATED ALWAYS AS ((("cantidad")::numeric * "precio_venta_unit")) STORED,
    CONSTRAINT "ventas_detalle_cantidad_check" CHECK (("cantidad" > 0)),
    CONSTRAINT "ventas_detalle_precio_venta_unit_check" CHECK (("precio_venta_unit" >= (0)::numeric))
);


ALTER TABLE "public"."ventas_detalle" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ventas_facturas" (
    "id" bigint NOT NULL,
    "venta_id" bigint NOT NULL,
    "tipo" "text" NOT NULL,
    "path" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "uploaded_by" "uuid",
    "numero_factura" "text",
    "original_name" "text",
    "size_bytes" bigint,
    "monto_total" numeric NOT NULL,
    "fecha_emision" "date",
    "fecha_vencimiento" "date" NOT NULL,
    CONSTRAINT "ventas_facturas_tipo_chk" CHECK (("tipo" = ANY (ARRAY['IVA'::"text", 'EXENTO'::"text"])))
);


ALTER TABLE "public"."ventas_facturas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ventas_pagos" (
    "id" bigint NOT NULL,
    "venta_id" bigint NOT NULL,
    "fecha" timestamp with time zone DEFAULT "now"() NOT NULL,
    "monto" numeric NOT NULL,
    "metodo" "text",
    "referencia" "text",
    "comprobante_path" "text",
    "comentario" "text",
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "factura_id" bigint,
    CONSTRAINT "ventas_pagos_monto_check" CHECK (("monto" > (0)::numeric))
);


ALTER TABLE "public"."ventas_pagos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ventas_tags" (
    "venta_id" bigint NOT NULL,
    "tag" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "id" bigint NOT NULL,
    "nota" "text",
    "removed_at" timestamp with time zone,
    "removed_by" "uuid",
    CONSTRAINT "ventas_tags_tag_chk" CHECK (("tag" = ANY (ARRAY['PEND_AUTORIZACION_ADMIN'::"text", 'SOLICITA_ANULACION'::"text", 'SOLICITA_REFACTURACION'::"text", 'SOLICITA_EDICION'::"text", 'ANULACION_REQUERIDA'::"text", 'REFACTURACION_REQUERIDA'::"text", 'EDICION_REQUERIDA'::"text", 'ANULADO'::"text", 'REFACTURADO'::"text"])))
);


ALTER TABLE "public"."ventas_tags" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_cxc_ventas" AS
 WITH "totales" AS (
         SELECT "v1"."id" AS "venta_id",
            COALESCE("sum"("vd"."subtotal"), (0)::numeric) AS "total"
           FROM ("public"."ventas" "v1"
             JOIN "public"."ventas_detalle" "vd" ON (("vd"."venta_id" = "v1"."id")))
          WHERE (("v1"."estado" = 'ENTREGADO'::"text") AND (NOT (EXISTS ( SELECT 1
                   FROM "public"."ventas_tags" "vt"
                  WHERE (("vt"."venta_id" = "v1"."id") AND ("vt"."tag" = 'ANULADO'::"text") AND ("vt"."removed_at" IS NULL))))))
          GROUP BY "v1"."id"
        ), "pagos" AS (
         SELECT "vp"."venta_id",
            COALESCE("sum"("vp"."monto"), (0)::numeric) AS "pagado",
            "min"("vp"."fecha") AS "fecha_primer_pago",
            "max"("vp"."fecha") AS "fecha_ultimo_pago"
           FROM "public"."ventas_pagos" "vp"
          GROUP BY "vp"."venta_id"
        ), "facturas" AS (
         SELECT "vf"."venta_id",
            "array_agg"("vf"."numero_factura" ORDER BY "vf"."numero_factura") AS "facturas"
           FROM "public"."ventas_facturas" "vf"
          WHERE ("vf"."numero_factura" IS NOT NULL)
          GROUP BY "vf"."venta_id"
        )
 SELECT "v"."id" AS "venta_id",
    "v"."fecha",
    ("v"."fecha" + '30 days'::interval) AS "fecha_vencimiento",
    "c"."id" AS "cliente_id",
    "c"."nombre" AS "cliente_nombre",
    "v"."vendedor_id",
    "v"."vendedor_codigo",
    "t"."total",
    COALESCE("p"."pagado", (0)::numeric) AS "pagado",
    ("t"."total" - COALESCE("p"."pagado", (0)::numeric)) AS "saldo",
    "f"."facturas",
    "p"."fecha_primer_pago",
    "p"."fecha_ultimo_pago"
   FROM (((("public"."ventas" "v"
     JOIN "public"."clientes" "c" ON (("c"."id" = "v"."cliente_id")))
     JOIN "totales" "t" ON (("t"."venta_id" = "v"."id")))
     LEFT JOIN "pagos" "p" ON (("p"."venta_id" = "v"."id")))
     LEFT JOIN "facturas" "f" ON (("f"."venta_id" = "v"."id")))
  WHERE (("v"."estado" = 'ENTREGADO'::"text") AND (NOT (EXISTS ( SELECT 1
           FROM "public"."ventas_tags" "vt"
          WHERE (("vt"."venta_id" = "v"."id") AND ("vt"."tag" = 'ANULADO'::"text") AND ("vt"."removed_at" IS NULL))))));


ALTER VIEW "public"."vw_cxc_ventas" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_cxc_ventas"("p_vendedor_id" "uuid" DEFAULT NULL::"uuid") RETURNS SETOF "public"."vw_cxc_ventas"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  is_admin boolean;
begin
  select exists(
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and upper(coalesce(p.role,'')) = 'ADMIN'
  ) into is_admin;

  if is_admin then
    return query
      select *
      from public.vw_cxc_ventas v
      where (p_vendedor_id is null or v.vendedor_id = p_vendedor_id);

  else
    -- ventas / otros: solo lo propio, sin importar lo que manden
    return query
      select *
      from public.vw_cxc_ventas v
      where v.vendedor_id = auth.uid();
  end if;
end;
$$;


ALTER FUNCTION "public"."rpc_cxc_ventas"("p_vendedor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_dashboard_admin"() RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_year  int := date_part('year',  now() at time zone 'America/Guatemala')::int;
  v_month int := date_part('month', now() at time zone 'America/Guatemala')::int;
  v_today date := (now() at time zone 'America/Guatemala')::date;
  v_hoy_start timestamptz := v_today::timestamptz at time zone 'America/Guatemala';
  v_hoy_end   timestamptz := v_hoy_start + interval '1 day';
  v_mes_start timestamptz := make_timestamptz(v_year, v_month, 1, 0, 0, 0, 'America/Guatemala');
  v_mes_end   timestamptz := v_mes_start + interval '1 month';
begin
  return (
    select json_build_object(
      'solicitudes', 0,
      'recetas_pendientes_mes', 0,
      'ventas_hoy', (
        select count(*)
        from ventas v
        where v.fecha >= v_hoy_start and v.fecha < v_hoy_end
          and v.anulado_at is null
      ),
      'cxc_total', 0,
      'cxc_vencido', 0,

      -- ✅ total global del mes (todos los vendedores)
      'ventas_mes_total', (
        select coalesce(sum(vd.subtotal), 0)
        from ventas v
        join ventas_detalle vd on vd.venta_id = v.id
        where v.fecha >= v_mes_start and v.fecha < v_mes_end
          and v.anulado_at is null
      ),

      -- mantener compatibilidad con tu UI actual (si no lo usas, queda vacío)
      'ventas_mes_por_vendedor', '[]'::json
    )
  );
end;
$$;


ALTER FUNCTION "public"."rpc_dashboard_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_dashboard_ventas"("p_vendedor_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_year int := date_part('year', now() AT TIME ZONE 'America/Guatemala')::int;
  v_today date := (now() AT TIME ZONE 'America/Guatemala')::date;
  v_hoy_start timestamptz := v_today::timestamptz AT TIME ZONE 'America/Guatemala';
  v_hoy_end   timestamptz := v_hoy_start + interval '1 day';
  v_year_start timestamptz := make_timestamptz(v_year, 1, 1, 0, 0, 0, 'America/Guatemala');
  v_year_end   timestamptz := make_timestamptz(v_year + 1, 1, 1, 0, 0, 0, 'America/Guatemala');
BEGIN
  RETURN (
    SELECT json_build_object(

      'ventas_hoy', (
        SELECT COUNT(*) FROM ventas v
        WHERE v.vendedor_id = p_vendedor_id
          AND v.fecha >= v_hoy_start AND v.fecha < v_hoy_end
          AND v.anulado_at IS NULL
      ),

      'clientes_activos', (
        SELECT COUNT(*) FROM clientes
        WHERE vendedor_id = p_vendedor_id AND activo = true
      ),

      'ventas_por_mes', (
        SELECT COALESCE(json_agg(COALESCE(a.monto, 0) ORDER BY m.mes), '[]'::json)
        FROM generate_series(1, 12) AS m(mes)
        LEFT JOIN (
          SELECT
            date_part('month', v.fecha AT TIME ZONE 'America/Guatemala')::int AS mes,
            SUM(vd.subtotal) AS monto
          FROM ventas v
          JOIN ventas_detalle vd ON vd.venta_id = v.id
          WHERE v.vendedor_id = p_vendedor_id
            AND v.fecha >= v_year_start AND v.fecha < v_year_end
            AND v.anulado_at IS NULL
          GROUP BY 1
        ) a ON a.mes = m.mes
      )

    )
  );
END;
$$;


ALTER FUNCTION "public"."rpc_dashboard_ventas"("p_vendedor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_enqueue_stock_bajo_20"("p_producto_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_stock int;
  v_prev_low boolean;
  v_next_low boolean;
  v_nombre text;
  v_marca text;
begin
  if p_producto_id is null then
    return;
  end if;

  -- calcula stock disponible actual (ahora sí existe)
  v_stock := public.rpc_calc_stock_disponible_producto(p_producto_id);
  v_next_low := (v_stock < 20);

  select is_low into v_prev_low
  from public.notif_stock_state
  where producto_id = p_producto_id;

  if v_prev_low is null then
    insert into public.notif_stock_state(producto_id, is_low, last_stock, updated_at)
    values (p_producto_id, v_next_low, v_stock, now())
    on conflict (producto_id) do update
      set is_low = excluded.is_low,
          last_stock = excluded.last_stock,
          updated_at = now();
    return;
  end if;

  insert into public.notif_stock_state(producto_id, is_low, last_stock, updated_at)
  values (p_producto_id, v_next_low, v_stock, now())
  on conflict (producto_id) do update
    set is_low = excluded.is_low,
        last_stock = excluded.last_stock,
        updated_at = now();

  if (v_prev_low = false and v_next_low = true) then
    select pr.nombre, coalesce(m.nombre, null)
      into v_nombre, v_marca
    from public.productos pr
    left join public.marcas m on m.id = pr.marca_id
    where pr.id = p_producto_id;

    insert into public.notif_outbox(type, venta_id, payload)
    values (
      'STOCK_BAJO_20',
      p_producto_id, -- ✅ clave por producto
      jsonb_build_object(
        'producto_id', p_producto_id,
        'stock', v_stock,
        'threshold', 20,
        'producto_nombre', coalesce(v_nombre, ''),
        'marca_nombre', coalesce(v_marca, '')
      )
    )
    on conflict (type, venta_id) do update
      set payload = excluded.payload,
          processed_at = null,
          attempts = 0,
          last_error = null;
  end if;
end;
$$;


ALTER FUNCTION "public"."rpc_enqueue_stock_bajo_20"("p_producto_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_estado_cuenta_cliente_pdf"("p_cliente_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_result jsonb;
begin
  -- Validar cliente
  if not exists (select 1 from public.clientes where id = p_cliente_id) then
    raise exception 'CLIENTE_NO_EXISTE';
  end if;

  with pagos as (
    select factura_id, coalesce(sum(monto), 0) as pagado
    from public.ventas_pagos
    where factura_id is not null
    group by factura_id
  ),
  totales_venta as (
    select venta_id, coalesce(sum(subtotal), 0) as total_venta
    from public.ventas_detalle
    group by venta_id
  ),
  anuladas as (
    select distinct venta_id
    from public.ventas_tags
    where tag = 'ANULADO'
      and removed_at is null
  ),
  base as (
    select
      vf.id                                                                      as factura_id,
      v.id                                                                       as venta_id,
      vf.numero_factura,
      vf.fecha_emision,
      coalesce(vf.fecha_vencimiento, (v.fecha::date + 30))                      as fecha_vencimiento,
      coalesce(vf.monto_total, tv.total_venta, 0)                               as monto_total,
      coalesce(p.pagado, 0)                                                      as pagado,
      coalesce(vf.monto_total, tv.total_venta, 0) - coalesce(p.pagado, 0)       as saldo
    from public.ventas_facturas vf
    join public.ventas v        on v.id = vf.venta_id
    left join totales_venta tv  on tv.venta_id = v.id
    left join pagos p           on p.factura_id = vf.id
    left join anuladas a        on a.venta_id = v.id
    where v.cliente_id = p_cliente_id
      and a.venta_id is null
  ),
  filas as (
    select
      factura_id,
      venta_id,
      numero_factura,
      fecha_emision,
      fecha_vencimiento,
      monto_total,
      pagado,
      saldo,
      case when fecha_vencimiento < current_date then 'VENCIDA' else 'PENDIENTE' end as estado,
      case when fecha_vencimiento < current_date
           then (current_date - fecha_vencimiento)::int
           else 0
      end as dias_atraso
    from base
    where saldo > 0
  ),
  agg_totals as (
    select
      coalesce(sum(saldo), 0)                                              as saldo_total,
      coalesce(sum(case when estado = 'VENCIDA' then saldo else 0 end), 0) as saldo_vencido,
      coalesce(sum(case when estado = 'PENDIENTE' then saldo else 0 end), 0) as saldo_pendiente,
      coalesce(count(*) filter (where estado = 'VENCIDA'), 0)              as facturas_vencidas,
      coalesce(count(*) filter (where estado = 'PENDIENTE'), 0)            as facturas_pendientes
    from filas
  ),
  agg_rows as (
    select coalesce(
      jsonb_agg(
        to_jsonb(filas)
        order by
          (case when filas.estado = 'VENCIDA' then 0 else 1 end),
          filas.fecha_vencimiento asc,
          filas.fecha_emision asc
      ),
      '[]'::jsonb
    ) as rows_json
    from filas
  )
  select jsonb_build_object(
    'header', jsonb_build_object(
      'cliente_id',    c.id,
      'nombre',        c.nombre,
      'nit',           c.nit,
      'telefono',      c.telefono,
      'direccion',     c.direccion,
      'fecha_emision', current_date
    ),
    'totals', jsonb_build_object(
      'saldo_total',          t.saldo_total,
      'saldo_vencido',        t.saldo_vencido,
      'saldo_pendiente',      t.saldo_pendiente,
      'facturas_vencidas',    t.facturas_vencidas,
      'facturas_pendientes',  t.facturas_pendientes
    ),
    'rows', r.rows_json
  )
  into v_result
  from public.clientes c
  cross join agg_totals t
  cross join agg_rows r
  where c.id = p_cliente_id;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."rpc_estado_cuenta_cliente_pdf"("p_cliente_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_inventario_buscar"("p_q" "text", "p_limit" integer DEFAULT 30, "p_offset" integer DEFAULT 0) RETURNS TABLE("id" integer, "nombre" "text", "marca" "text", "activo" boolean, "precio_compra_actual" numeric, "precio_min_venta" numeric, "stock_disponible" integer, "lote_proximo" "text", "fecha_exp_proxima" "date")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
with filtered as (
  select
    p.id,
    p.nombre,
    coalesce(m.nombre, p.marca) as marca,
    p.activo
  from public.productos p
  left join public.marcas m on m.id = p.marca_id
  where
    coalesce(nullif(trim(p_q), ''), '') = ''
    or (
      p.nombre ilike ('%' || p_q || '%')
      or coalesce(m.nombre, p.marca) ilike ('%' || p_q || '%')
    )
  order by p.nombre asc
  limit p_limit offset p_offset
),
ultimo_precio_compra as (
  select distinct on (cd.producto_id)
    cd.producto_id,
    cd.precio_compra_unit as precio_compra_ultima_compra
  from public.compras_detalle cd
  join public.compras c on c.id = cd.compra_id
  where cd.producto_id in (select id from filtered)
  order by cd.producto_id, c.id desc
),
stock_producto as (
  select
    pl.producto_id,
    coalesce(sum(sl.stock_total - sl.stock_reservado), 0::bigint)::int as stock_disponible
  from public.producto_lotes pl
  left join public.stock_lotes sl on sl.lote_id = pl.id
  where pl.producto_id in (select id from filtered)
  group by pl.producto_id
),
fefo_lote as (
  select distinct on (pl.producto_id)
    pl.producto_id,
    pl.lote,
    pl.fecha_exp
  from public.producto_lotes pl
  join public.stock_lotes sl on sl.lote_id = pl.id
  where pl.producto_id in (select id from filtered)
    and (sl.stock_total - sl.stock_reservado) > 0
  order by pl.producto_id, pl.fecha_exp, pl.id
)
select
  f.id,
  f.nombre,
  f.marca,
  f.activo,
  coalesce(ppo.precio_compra_override, upc.precio_compra_ultima_compra) as precio_compra_actual,
  case
    when coalesce(ppo.precio_compra_override, upc.precio_compra_ultima_compra) is null then null::numeric
    else round(coalesce(ppo.precio_compra_override, upc.precio_compra_ultima_compra) / 0.7, 2)
  end as precio_min_venta,
  coalesce(sp.stock_disponible, 0) as stock_disponible,
  fl.lote as lote_proximo,
  fl.fecha_exp as fecha_exp_proxima
from filtered f
left join public.producto_precio_override ppo on ppo.producto_id = f.id
left join ultimo_precio_compra upc on upc.producto_id = f.id
left join stock_producto sp on sp.producto_id = f.id
left join fefo_lote fl on fl.producto_id = f.id
order by f.nombre asc;
$$;


ALTER FUNCTION "public"."rpc_inventario_buscar"("p_q" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_inventario_totales_simple"("p_producto_id" bigint) RETURNS TABLE("entradas" integer, "salidas" integer, "saldo" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with
compras as (
  select coalesce(sum(cd.cantidad), 0)::int as entradas
  from public.compras_detalle cd
  join public.compras c on c.id = cd.compra_id
  where cd.producto_id = p_producto_id
),

tag_anulado as (
  select distinct vt.venta_id
  from public.ventas_tags vt
  where upper(btrim(vt.tag)) = 'ANULADO'
),

entregas as (
  select coalesce(sum(vd.cantidad), 0)::int as salidas
  from public.ventas_detalle vd
  join public.ventas v on v.id = vd.venta_id
  join (
    select ve.venta_id
    from public.ventas_eventos ve
    where upper(btrim(ve.tipo)) = 'ENTREGADO'
       or upper(btrim(ve.a_estado)) = 'ENTREGADO'
    group by ve.venta_id
  ) e on e.venta_id = v.id
  left join tag_anulado ta on ta.venta_id = v.id
  where vd.producto_id = p_producto_id
    and ta.venta_id is null
)

select
  c.entradas,
  e.salidas,
  (c.entradas - e.salidas)::int as saldo
from compras c
cross join entregas e;
$$;


ALTER FUNCTION "public"."rpc_inventario_totales_simple"("p_producto_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_inventario_totales_simple_v2"("p_producto_id" bigint) RETURNS TABLE("entradas" integer, "salidas" integer, "reservado" integer, "saldo" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with
compras as (
  select coalesce(sum(cd.cantidad), 0)::int as entradas
  from public.compras_detalle cd
  join public.compras c on c.id = cd.compra_id
  where cd.producto_id = p_producto_id
),

tag_anulado as (
  select distinct vt.venta_id
  from public.ventas_tags vt
  where upper(btrim(vt.tag)) = 'ANULADO'
),

venta_entrega as (
  select
    ve.venta_id,
    max(ve.creado_en) as entregado_at
  from public.ventas_eventos ve
  where upper(btrim(ve.tipo)) = 'ENTREGADO'
     or upper(btrim(ve.a_estado)) = 'ENTREGADO'
  group by ve.venta_id
),

entregas as (
  select coalesce(sum(vd.cantidad), 0)::int as salidas
  from public.ventas_detalle vd
  join public.ventas v on v.id = vd.venta_id
  join venta_entrega e on e.venta_id = v.id
  left join tag_anulado ta on ta.venta_id = v.id
  where vd.producto_id = p_producto_id
    and ta.venta_id is null
),

reservas as (
  select coalesce(sum(vd.cantidad), 0)::int as reservado
  from public.ventas_detalle vd
  join public.ventas v on v.id = vd.venta_id
  left join venta_entrega e on e.venta_id = v.id
  left join tag_anulado ta on ta.venta_id = v.id
  where vd.producto_id = p_producto_id
    and e.venta_id is null
    and ta.venta_id is null
    and upper(btrim(v.estado)) in ('NUEVO','FACTURADO','EN RUTA','EN_RUTA','RUTA')
),

calc as (
  select
    c.entradas,
    s.salidas,
    r.reservado,
    (c.entradas - s.salidas)::int as existencia
  from compras c
  cross join entregas s
  cross join reservas r
)

select
  entradas,
  salidas,
  reservado,
  (existencia - reservado)::int as saldo
from calc;
$$;


ALTER FUNCTION "public"."rpc_inventario_totales_simple_v2"("p_producto_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_kardex_producto_detallado"("p_producto_id" bigint, "p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) RETURNS TABLE("fecha" timestamp with time zone, "tipo" "text", "compra_id" bigint, "venta_id" bigint, "estado" "text", "proveedor" "text", "cliente" "text", "lote_id" bigint, "lote" "text", "entrada" integer, "salida" integer, "saldo" integer, "factura_numero" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with _auth as (select public.rpc_require_admin()),
params as (select p_desde as desde, p_hasta as hasta),

prod as (
  select coalesce(p.tiene_iva, true) as producto_tiene_iva
  from public.productos p
  where p.id = p_producto_id
),

tag_anulado as (
  select t.venta_id, max(t.created_at) as tag_anulado_at
  from public.ventas_tags t
  where t.removed_at is null
    and upper(btrim(t.tag)) = 'ANULADO'
  group by t.venta_id
),

ventas_flags as (
  select
    v.id,
    v.created_at,
    v.estado,
    v.cliente_id,
    v.cliente_nombre,
    (ta.venta_id is not null) as es_anulada,
    coalesce(v.anulado_at, v.canceled_at, ta.tag_anulado_at) as fecha_anulacion
  from public.ventas v
  left join tag_anulado ta on ta.venta_id = v.id
),

venta_entrega as (
  select
    ve.venta_id,
    max(ve.creado_en) as entregado_at
  from public.ventas_eventos ve
  where upper(btrim(ve.tipo)) = 'ENTREGADO'
     or upper(btrim(ve.a_estado)) = 'ENTREGADO'
  group by ve.venta_id
),

fact_by_venta as (
  select
    vf.venta_id,
    max(case when upper(btrim(vf.tipo)) = 'IVA' then nullif(btrim(vf.numero_factura),'') end) as factura_iva,
    max(case when upper(btrim(vf.tipo)) = 'EXENTO' then nullif(btrim(vf.numero_factura),'') end) as factura_exento
  from public.ventas_facturas vf
  group by vf.venta_id
),

mov_all as (
  -- COMPRA: total += entrada
  select
    c.created_at as fecha,
    'COMPRA'::text as tipo,
    cd.compra_id,
    null::bigint as venta_id,
    null::text as estado,
    pvd.nombre as proveedor,
    null::text as cliente,
    cd.lote_id,
    pl.lote,
    cd.cantidad::int as entrada,
    0::int as salida,
    1 as sort_grp,
    cd.id::bigint as sort_id,
    nullif(btrim(c.numero_factura),'')::text as factura_numero
  from public.compras_detalle cd
  join public.compras c on c.id = cd.compra_id
  join public.proveedores pvd on pvd.id = c.proveedor_id
  left join public.producto_lotes pl on pl.id = cd.lote_id
  where cd.producto_id = p_producto_id

  union all

  -- DEVOLUCION real: total += entrada
  select
    d.creado_en as fecha,
    'DEVOLUCION'::text as tipo,
    null::bigint as compra_id,
    d.venta_id,
    vf.estado as estado,
    null::text as proveedor,
    coalesce(c.nombre, vf.cliente_nombre) as cliente,
    dd.lote_id,
    pl.lote,
    dd.cantidad::int as entrada,
    0::int as salida,
    2 as sort_grp,
    dd.id::bigint as sort_id,
    case
      when (select producto_tiene_iva from prod) then fb.factura_iva
      else fb.factura_exento
    end as factura_numero
  from public.ventas_devoluciones d
  join public.ventas_devoluciones_detalle dd on dd.devolucion_id = d.id
  join ventas_flags vf on vf.id = d.venta_id
  left join public.clientes c on c.id = vf.cliente_id
  left join public.producto_lotes pl on pl.id = dd.lote_id
  join public.ventas_detalle vd on vd.venta_id = d.venta_id and vd.lote_id = dd.lote_id
  left join fact_by_venta fb on fb.venta_id = d.venta_id
  where vd.producto_id = p_producto_id

  union all

  -- RESERVA: SIEMPRE se registra en created_at de la venta
  select
    vf.created_at as fecha,
    'RESERVA'::text as tipo,
    null::bigint as compra_id,
    vd.venta_id,
    vf.estado as estado,
    null::text as proveedor,
    coalesce(c.nombre, vf.cliente_nombre) as cliente,
    vd.lote_id,
    pl.lote,
    0::int as entrada,
    vd.cantidad::int as salida,
    3 as sort_grp,
    vd.id::bigint as sort_id,
    case
      when (select producto_tiene_iva from prod) then fb.factura_iva
      else fb.factura_exento
    end as factura_numero
  from public.ventas_detalle vd
  join ventas_flags vf on vf.id = vd.venta_id
  left join public.clientes c on c.id = vf.cliente_id
  left join public.producto_lotes pl on pl.id = vd.lote_id
  left join fact_by_venta fb on fb.venta_id = vd.venta_id
  where vd.producto_id = p_producto_id

  union all

  -- LIBERACION (anulación sin entrega): reserved -= entrada
  select
    vf.fecha_anulacion as fecha,
    'LIBERACION'::text as tipo,
    null::bigint as compra_id,
    vd.venta_id,
    'ANULADA'::text as estado,
    null::text as proveedor,
    coalesce(c.nombre, vf.cliente_nombre) as cliente,
    vd.lote_id,
    pl.lote,
    vd.cantidad::int as entrada,
    0::int as salida,
    4 as sort_grp,
    vd.id::bigint as sort_id,
    case
      when (select producto_tiene_iva from prod) then fb.factura_iva
      else fb.factura_exento
    end as factura_numero
  from public.ventas_detalle vd
  join ventas_flags vf on vf.id = vd.venta_id
  left join venta_entrega ve on ve.venta_id = vd.venta_id
  left join public.clientes c on c.id = vf.cliente_id
  left join public.producto_lotes pl on pl.id = vd.lote_id
  left join fact_by_venta fb on fb.venta_id = vd.venta_id
  where vd.producto_id = p_producto_id
    and vf.es_anulada = true
    and vf.fecha_anulacion is not null
    and ve.entregado_at is null
    and not exists (select 1 from public.ventas_devoluciones d where d.venta_id = vf.id)

  union all

  -- DEVOLUCION por anulación con entrega: total += entrada
  select
    vf.fecha_anulacion as fecha,
    'DEVOLUCION'::text as tipo,
    null::bigint as compra_id,
    vd.venta_id,
    'ANULADA'::text as estado,
    null::text as proveedor,
    coalesce(c.nombre, vf.cliente_nombre) as cliente,
    vd.lote_id,
    pl.lote,
    vd.cantidad::int as entrada,
    0::int as salida,
    5 as sort_grp,
    vd.id::bigint as sort_id,
    case
      when (select producto_tiene_iva from prod) then fb.factura_iva
      else fb.factura_exento
    end as factura_numero
  from public.ventas_detalle vd
  join ventas_flags vf on vf.id = vd.venta_id
  join venta_entrega ve on ve.venta_id = vd.venta_id and ve.entregado_at is not null
  left join public.clientes c on c.id = vf.cliente_id
  left join public.producto_lotes pl on pl.id = vd.lote_id
  left join fact_by_venta fb on fb.venta_id = vd.venta_id
  where vd.producto_id = p_producto_id
    and vf.es_anulada = true
    and vf.fecha_anulacion is not null
    and not exists (select 1 from public.ventas_devoluciones d where d.venta_id = vf.id)

  union all

  -- VENTA ENTREGADO: total -= salida AND reserved -= salida
  select
    ve.entregado_at as fecha,
    'VENTA'::text as tipo,
    null::bigint as compra_id,
    vd.venta_id,
    case when vf.es_anulada then 'ANULADA' else 'ENTREGADO' end as estado,
    null::text as proveedor,
    coalesce(c.nombre, vf.cliente_nombre) as cliente,
    vd.lote_id,
    pl.lote,
    0::int as entrada,
    vd.cantidad::int as salida,
    6 as sort_grp,
    vd.id::bigint as sort_id,
    case
      when (select producto_tiene_iva from prod) then fb.factura_iva
      else fb.factura_exento
    end as factura_numero
  from public.ventas_detalle vd
  join ventas_flags vf on vf.id = vd.venta_id
  join venta_entrega ve on ve.venta_id = vd.venta_id and ve.entregado_at is not null
  left join public.clientes c on c.id = vf.cliente_id
  left join public.producto_lotes pl on pl.id = vd.lote_id
  left join fact_by_venta fb on fb.venta_id = vd.venta_id
  where vd.producto_id = p_producto_id
),

mov_all_deltas as (
  select
    m.*,
    case
      when m.tipo in ('COMPRA','DEVOLUCION') then m.entrada
      when m.tipo = 'VENTA' then -m.salida
      else 0
    end::int as delta_total,
    case
      when m.tipo = 'RESERVA' then m.salida
      when m.tipo = 'LIBERACION' then -m.entrada
      when m.tipo = 'VENTA' then -m.salida
      else 0
    end::int as delta_res
  from mov_all m
),

ini as (
  select
    coalesce(sum(delta_total),0)::int as total_ini,
    coalesce(sum(delta_res),0)::int as res_ini
  from mov_all_deltas, params
  where fecha < params.desde
),

mov_rango as (
  select *
  from mov_all_deltas, params
  where fecha >= params.desde
    and fecha <= params.hasta
),

ordered as (
  select
    m.*,
    (select total_ini from ini) as total_ini,
    (select res_ini from ini) as res_ini,
    sum(m.delta_total) over (
      order by m.fecha, m.sort_grp, m.sort_id
      rows between unbounded preceding and current row
    ) as total_delta,
    sum(m.delta_res) over (
      order by m.fecha, m.sort_grp, m.sort_id
      rows between unbounded preceding and current row
    ) as res_delta
  from mov_rango m
)

select
  fecha, tipo, compra_id, venta_id, estado,
  proveedor, cliente, lote_id, lote,
  entrada, salida,
  greatest(((total_ini + total_delta) - (res_ini + res_delta))::int, 0) as saldo,
  factura_numero
from ordered
order by fecha, sort_grp, sort_id;
$$;


ALTER FUNCTION "public"."rpc_kardex_producto_detallado"("p_producto_id" bigint, "p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_kardex_producto_detallado_audit"("p_producto_id" bigint, "p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) RETURNS TABLE("fecha" timestamp with time zone, "tipo" "text", "compra_id" bigint, "venta_id" bigint, "estado" "text", "proveedor" "text", "cliente" "text", "lote_id" bigint, "lote" "text", "entrada" integer, "salida" integer, "saldo_raw" integer, "factura_numero" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with k as (
  select *
  from public.rpc_kardex_producto_detallado(p_producto_id, p_desde, p_hasta)
),
ordered as (
  select
    k.*,
    sum(
      case
        when tipo in ('COMPRA','DEVOLUCION','LIBERACION') then entrada
        when tipo = 'VENTA' then -salida
        else 0
      end
    ) over (order by fecha, tipo, coalesce(compra_id,0), coalesce(venta_id,0), coalesce(lote_id,0)) as total_delta,
    sum(
      case
        when tipo = 'RESERVA' then salida
        when tipo = 'VENTA' then -salida
        when tipo = 'LIBERACION' then -entrada
        else 0
      end
    ) over (order by fecha, tipo, coalesce(compra_id,0), coalesce(venta_id,0), coalesce(lote_id,0)) as res_delta
  from k
)
select
  fecha, tipo, compra_id, venta_id, estado, proveedor, cliente, lote_id, lote,
  entrada, salida,
  (total_delta - res_delta)::int as saldo_raw,
  factura_numero
from ordered
order by fecha;
$$;


ALTER FUNCTION "public"."rpc_kardex_producto_detallado_audit"("p_producto_id" bigint, "p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_notif_destinatarios_compra_linea_ingresada"() RETURNS TABLE("user_id" "uuid", "role" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
select p.id as user_id, upper(btrim(p.role)) as role
from public.profiles p
where upper(btrim(p.role)) in ('ADMIN','BODEGA','VENTAS');
$$;


ALTER FUNCTION "public"."rpc_notif_destinatarios_compra_linea_ingresada"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_notif_destinatarios_venta_facturada"("p_venta_id" bigint) RETURNS TABLE("user_id" "uuid", "role" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with v as (
  select id, vendedor_id
  from public.ventas
  where id = p_venta_id
),
staff as (
  select p.id as user_id, upper(btrim(p.role)) as role
  from public.profiles p
  where upper(btrim(p.role)) in ('ADMIN', 'BODEGA')
),
owner_row as (
  select v.vendedor_id as user_id, 'OWNER'::text as role
  from v
  where v.vendedor_id is not null
)
select distinct user_id, role from staff
union
select distinct user_id, role from owner_row;
$$;


ALTER FUNCTION "public"."rpc_notif_destinatarios_venta_facturada"("p_venta_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_notif_destinatarios_venta_nuevos"() RETURNS TABLE("user_id" "uuid", "role" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.id as user_id, upper(coalesce(p.role,'')) as role
  from public.profiles p
  where upper(coalesce(p.role,'')) in ('ADMIN','FACTURACION','BODEGA');
$$;


ALTER FUNCTION "public"."rpc_notif_destinatarios_venta_nuevos"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notif_outbox" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "type" "text" NOT NULL,
    "venta_id" bigint NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "processed_at" timestamp with time zone,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text"
);

ALTER TABLE ONLY "public"."notif_outbox" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."notif_outbox" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_notif_outbox_claim"("p_limit" integer DEFAULT 20) RETURNS SETOF "public"."notif_outbox"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return query
  with c as (
    select id
    from public.notif_outbox
    where processed_at is null
      and attempts < 10
    order by id
    limit greatest(p_limit, 1)
    for update skip locked
  )
  update public.notif_outbox o
  set attempts = o.attempts + 1
  from c
  where o.id = c.id
  returning o.*;
end;
$$;


ALTER FUNCTION "public"."rpc_notif_outbox_claim"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_notif_outbox_mark_error"("p_id" bigint, "p_error" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.notif_outbox
  set last_error = left(coalesce(p_error,'ERROR'), 5000)
  where id = p_id;
$$;


ALTER FUNCTION "public"."rpc_notif_outbox_mark_error"("p_id" bigint, "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_notif_outbox_mark_processed"("p_id" bigint) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.notif_outbox
  set processed_at = now(),
      last_error = null
  where id = p_id;
$$;


ALTER FUNCTION "public"."rpc_notif_outbox_mark_processed"("p_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_producto_detalle"("p_producto_id" integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  WITH precio_base AS (
    SELECT
      COALESCE(ov.precio_compra_override, uc.precio_compra) AS precio_compra_actual
    FROM productos p
    LEFT JOIN producto_precio_override ov ON ov.producto_id = p.id
    LEFT JOIN (
      SELECT DISTINCT ON (cd.producto_id)
        cd.producto_id,
        cd.precio_compra_unit AS precio_compra
      FROM compras_detalle cd
      JOIN compras c ON c.id = cd.compra_id
      WHERE cd.producto_id = p_producto_id
      ORDER BY cd.producto_id, c.fecha DESC NULLS LAST, cd.id DESC
    ) uc ON uc.producto_id = p.id
    WHERE p.id = p_producto_id
  )
  SELECT jsonb_build_object(
    'head', jsonb_build_object(
      'id',               p.id,
      'nombre',           p.nombre,
      'marca',            m.nombre,
      'image_path',       p.image_path,
      'activo',           p.activo,
      'tiene_iva',        p.tiene_iva,
      'requiere_receta',  p.requiere_receta,
      'precio_min_venta', CASE
                            WHEN pb.precio_compra_actual IS NULL THEN NULL
                            ELSE ((pb.precio_compra_actual / 0.70))::numeric(12,2)
                          END
    ),
    'lotes', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'lote_id',          pl.id,
            'lote',             pl.lote,
            'fecha_exp',        pl.fecha_exp,
            'stock_total',      COALESCE(sl.stock_total, 0),
            'stock_reservado',  COALESCE(sl.stock_reservado, 0),
            'stock_disponible', GREATEST(0, COALESCE(sl.stock_total, 0) - COALESCE(sl.stock_reservado, 0))
          )
          ORDER BY pl.fecha_exp ASC NULLS LAST
        )
        FROM producto_lotes pl
        LEFT JOIN stock_lotes sl ON sl.lote_id = pl.id
        WHERE pl.producto_id = p_producto_id
          AND pl.activo IS DISTINCT FROM false
          AND GREATEST(0, COALESCE(sl.stock_total, 0) - COALESCE(sl.stock_reservado, 0)) > 0
      ),
      '[]'::jsonb
    )
  )
  FROM productos p
  LEFT JOIN marcas m ON m.id = p.marca_id
  LEFT JOIN precio_base pb ON true
  WHERE p.id = p_producto_id;
$$;


ALTER FUNCTION "public"."rpc_producto_detalle"("p_producto_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_report_compras_mensual_12m"("p_end_date" "date" DEFAULT CURRENT_DATE, "p_months" integer DEFAULT 12, "p_proveedor_id" bigint DEFAULT NULL::bigint) RETURNS TABLE("mes" "date", "compras_count" bigint, "total_comprado" numeric, "saldo_pendiente" numeric, "vencidas_count" bigint, "saldo_vencido" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with _auth as (select public.rpc_require_admin()),
params as (
  select date_trunc('month', p_end_date)::date as end_month,
         greatest(p_months, 1) as months_n
),
rango as (
  select (end_month - ((months_n - 1) * interval '1 month'))::date as start_month,
         end_month
  from params
),
meses as (
  select date_trunc('month', dd)::date as mes
  from rango, generate_series(start_month, end_month, interval '1 month') dd
),
tot_por_compra as (
  select
    c.id as compra_id,
    c.fecha,
    c.fecha_vencimiento,
    c.proveedor_id,
    coalesce(
      c.monto_total,
      sum(coalesce(cd.subtotal, cd.cantidad * cd.precio_compra_unit))::numeric
    ) as total_calc,
    coalesce(c.saldo_pendiente, 0)::numeric as saldo
  from public.compras c
  left join public.compras_detalle cd on cd.compra_id = c.id
  where c.fecha >= (select start_month from rango)
    and c.fecha <  ((select end_month from rango) + interval '1 month')
    and (p_proveedor_id is null or c.proveedor_id = p_proveedor_id)
  group by c.id, c.fecha, c.fecha_vencimiento, c.proveedor_id, c.monto_total, c.saldo_pendiente
),
agg as (
  select
    date_trunc('month', fecha)::date as mes,
    count(*)::bigint as compras_count,
    sum(total_calc)::numeric as total_comprado,
    sum(saldo)::numeric as saldo_pendiente,
    sum(case when fecha_vencimiento is not null and fecha_vencimiento < current_date and saldo > 0 then 1 else 0 end)::bigint as vencidas_count,
    sum(case when fecha_vencimiento is not null and fecha_vencimiento < current_date and saldo > 0 then saldo else 0 end)::numeric as saldo_vencido
  from tot_por_compra
  group by 1
)
select
  m.mes,
  coalesce(a.compras_count, 0),
  coalesce(a.total_comprado, 0),
  coalesce(a.saldo_pendiente, 0),
  coalesce(a.vencidas_count, 0),
  coalesce(a.saldo_vencido, 0)
from meses m
left join agg a on a.mes = m.mes
order by m.mes;
$$;


ALTER FUNCTION "public"."rpc_report_compras_mensual_12m"("p_end_date" "date", "p_months" integer, "p_proveedor_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_report_inventario_alertas"("p_stock_bajo" integer DEFAULT 5, "p_exp_dias" integer DEFAULT 30, "p_incluir_inactivos" boolean DEFAULT false) RETURNS TABLE("tipo" "text", "producto_id" bigint, "producto" "text", "marca" "text", "stock_disponible" integer, "lote_id" bigint, "lote" "text", "fecha_exp" "date", "stock_disponible_lote" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with _auth as (select public.rpc_require_admin()),
stock_bajo as (
  select
    'STOCK_BAJO'::text as tipo,
    v.id as producto_id,
    v.nombre as producto,
    v.marca as marca,
    v.stock_disponible::int as stock_disponible,
    null::bigint as lote_id,
    null::text as lote,
    null::date as fecha_exp,
    null::int as stock_disponible_lote
  from public.vw_inventario_productos_v2 v
  where (p_incluir_inactivos or v.activo = true)
    and coalesce(v.stock_disponible, 0) <= p_stock_bajo
),
prox_vencer as (
  select
    'PROX_VENCER'::text as tipo,
    d.producto_id,
    d.nombre as producto,
    d.marca,
    null::int as stock_disponible,
    d.lote_id,
    d.lote,
    d.fecha_exp,
    d.stock_disponible_lote::int as stock_disponible_lote
  from public.vw_producto_lotes_detalle d
  where (p_incluir_inactivos or d.activo = true)
    and d.fecha_exp is not null
    and d.stock_disponible_lote > 0
    and d.fecha_exp <= (current_date + (p_exp_dias || ' days')::interval)
)
select * from stock_bajo
union all
select * from prox_vencer
order by tipo, marca, producto, fecha_exp nulls last;
$$;


ALTER FUNCTION "public"."rpc_report_inventario_alertas"("p_stock_bajo" integer, "p_exp_dias" integer, "p_incluir_inactivos" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_report_kardex_producto_consolidado"("p_producto_id" bigint, "p_desde" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_hasta" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_incluir_anuladas" boolean DEFAULT false) RETURNS TABLE("fecha" timestamp with time zone, "tipo" "text", "ref_id" bigint, "compra_id" bigint, "venta_id" bigint, "devolucion_id" bigint, "entrada" integer, "salida" integer, "saldo_producto" integer, "precio_unit" numeric, "subtotal" numeric, "lote_id" bigint, "lote" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with _auth as (select public.rpc_require_admin()),
params as (
  select
    coalesce(p_desde, (now() - interval '12 months')) as desde,
    coalesce(p_hasta, now()) as hasta
),

ventas_validas as (
  select v.id
  from public.ventas v
  where
    p_incluir_anuladas
    or (
      v.anulado_at is null
      and not exists (
        select 1
        from public.ventas_tags t
        where t.venta_id = v.id
          and t.tag = 'ANULADO'
          and t.removed_at is null
      )
    )
),

mov_compra as (
  select
    c.fecha as fecha,
    'COMPRA'::text as tipo,
    cd.id::bigint as ref_id,
    cd.compra_id,
    null::bigint as venta_id,
    null::bigint as devolucion_id,
    cd.cantidad::int as entrada,
    0::int as salida,
    cd.precio_compra_unit::numeric as precio_unit,
    coalesce(cd.subtotal, cd.cantidad * cd.precio_compra_unit)::numeric as subtotal,
    cd.lote_id,
    pl.lote
  from public.compras_detalle cd
  join public.compras c on c.id = cd.compra_id
  join public.producto_lotes pl on pl.id = cd.lote_id
  where cd.producto_id = p_producto_id
),

mov_venta as (
  select
    v.fecha as fecha,
    'VENTA'::text as tipo,
    vd.id::bigint as ref_id,
    null::bigint as compra_id,
    vd.venta_id,
    null::bigint as devolucion_id,
    0::int as entrada,
    vd.cantidad::int as salida,
    vd.precio_venta_unit::numeric as precio_unit,
    coalesce(vd.subtotal, vd.cantidad * vd.precio_venta_unit)::numeric as subtotal,
    vd.lote_id,
    pl.lote
  from public.ventas_detalle vd
  join public.ventas v on v.id = vd.venta_id
  join ventas_validas vv on vv.id = v.id
  join public.producto_lotes pl on pl.id = vd.lote_id
  where vd.producto_id = p_producto_id
),

mov_dev_new as (
  -- devolucion de venta (regresa stock)
  select
    d.creado_en as fecha,
    'DEVOLUCION'::text as tipo,
    dd.id::bigint as ref_id,
    null::bigint as compra_id,
    d.venta_id,
    d.id as devolucion_id,
    dd.cantidad::int as entrada,
    0::int as salida,
    null::numeric as precio_unit,
    null::numeric as subtotal,
    dd.lote_id,
    pl.lote
  from public.ventas_devoluciones d
  join public.ventas_devoluciones_detalle dd on dd.devolucion_id = d.id
  join public.producto_lotes pl on pl.id = dd.lote_id
  join public.ventas v on v.id = d.venta_id
  join ventas_validas vv on vv.id = v.id
  join public.ventas_detalle vd on vd.venta_id = d.venta_id and vd.lote_id = dd.lote_id
  where vd.producto_id = p_producto_id
),

mov_dev_old as (
  -- flujo alterno (si lo usas)
  select
    d.fecha as fecha,
    'DEV_OLD'::text as tipo,
    dd.id::bigint as ref_id,
    null::bigint as compra_id,
    d.venta_id,
    d.id as devolucion_id,
    dd.cantidad::int as entrada,
    0::int as salida,
    null::numeric as precio_unit,
    null::numeric as subtotal,
    dd.lote_id,
    pl.lote
  from public.devoluciones d
  join public.devoluciones_detalle dd on dd.devolucion_id = d.id
  join public.producto_lotes pl on pl.id = dd.lote_id
  join public.ventas v on v.id = d.venta_id
  join ventas_validas vv on vv.id = v.id
  where dd.producto_id = p_producto_id
),

mov_all as (
  select * from mov_compra
  union all select * from mov_venta
  union all select * from mov_dev_new
  union all select * from mov_dev_old
),

saldo_ini as (
  select sum(entrada - salida)::int as saldo_ini
  from mov_all, params
  where fecha < params.desde
),

mov_rango as (
  select m.*, (select coalesce(saldo_ini,0) from saldo_ini) as saldo_ini
  from mov_all m
  cross join params
  where m.fecha >= params.desde
    and m.fecha <  params.hasta
)

select
  fecha, tipo, ref_id,
  compra_id, venta_id, devolucion_id,
  entrada, salida,
  (saldo_ini + sum(entrada - salida) over (order by fecha, tipo, ref_id))::int as saldo_producto,
  precio_unit, subtotal,
  lote_id, lote
from mov_rango
order by fecha, tipo, ref_id;
$$;


ALTER FUNCTION "public"."rpc_report_kardex_producto_consolidado"("p_producto_id" bigint, "p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_incluir_anuladas" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_report_pagos_proveedores_mensual_12m"("p_end_date" "date" DEFAULT CURRENT_DATE, "p_months" integer DEFAULT 12, "p_proveedor_id" bigint DEFAULT NULL::bigint) RETURNS TABLE("mes" "date", "metodo" "text", "pagos_count" bigint, "monto" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with _auth as (select public.rpc_require_admin()),
params as (
  select date_trunc('month', p_end_date)::date as end_month,
         greatest(p_months, 1) as months_n
),
rango as (
  select (end_month - ((months_n - 1) * interval '1 month'))::date as start_month,
         end_month
  from params
)
select
  date_trunc('month', p.fecha)::date as mes,
  coalesce(p.metodo, '—') as metodo,
  count(*)::bigint as pagos_count,
  sum(p.monto)::numeric as monto
from public.compras_pagos p
join public.compras c on c.id = p.compra_id
where p.fecha >= (select start_month from rango)
  and p.fecha <  ((select end_month from rango) + interval '1 month')
  and (p_proveedor_id is null or c.proveedor_id = p_proveedor_id)
group by 1, 2
order by 1, 2;
$$;


ALTER FUNCTION "public"."rpc_report_pagos_proveedores_mensual_12m"("p_end_date" "date", "p_months" integer, "p_proveedor_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_report_producto_promedio_mensual_12m"("p_producto_id" bigint, "p_end_date" "date" DEFAULT CURRENT_DATE, "p_months" integer DEFAULT 12, "p_vendedor_id" "uuid" DEFAULT NULL::"uuid", "p_estado" "text" DEFAULT NULL::"text") RETURNS TABLE("mes" "date", "unidades_mes" numeric, "monto_mes" numeric, "precio_promedio_mes" numeric, "prom_unidades_mes" numeric, "prom_monto_mes" numeric, "precio_promedio_periodo" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with _auth as (select public.rpc_require_admin()),
params as (
  select date_trunc('month', p_end_date)::date as end_month,
         greatest(p_months, 1) as months_n
),
rango as (
  select (end_month - ((months_n - 1) * interval '1 month'))::date as start_month,
         end_month
  from params
),
meses as (
  select date_trunc('month', dd)::date as mes
  from rango, generate_series(start_month, end_month, interval '1 month') dd
),
ventas_validas as (
  select v.id, v.fecha
  from public.ventas v
  where v.fecha >= (select start_month from rango)
    and v.fecha <  ((select end_month from rango) + interval '1 month')
    and (p_vendedor_id is null or v.vendedor_id = p_vendedor_id)
    and (p_estado is null or v.estado = p_estado)
    and v.anulado_at is null
    and not exists (
      select 1
      from public.ventas_tags t
      where t.venta_id = v.id
        and t.tag = 'ANULADO'
        and t.removed_at is null
    )
),
agg as (
  select date_trunc('month', v.fecha)::date as mes,
         sum(d.cantidad)::numeric as unidades_mes,
         sum(coalesce(d.subtotal, d.cantidad * d.precio_venta_unit))::numeric as monto_mes
  from ventas_validas v
  join public.ventas_detalle d on d.venta_id = v.id
  where d.producto_id = p_producto_id
  group by 1
),
base as (
  select m.mes,
         coalesce(a.unidades_mes, 0) as unidades_mes,
         coalesce(a.monto_mes, 0) as monto_mes
  from meses m
  left join agg a on a.mes = m.mes
),
resumen as (
  select avg(unidades_mes)::numeric as prom_unidades_mes,
         avg(monto_mes)::numeric as prom_monto_mes,
         case when sum(unidades_mes) > 0 then sum(monto_mes)/sum(unidades_mes) else 0 end as precio_promedio_periodo
  from base
)
select
  b.mes,
  b.unidades_mes,
  b.monto_mes,
  case when b.unidades_mes > 0 then b.monto_mes/b.unidades_mes else 0 end as precio_promedio_mes,
  r.prom_unidades_mes,
  r.prom_monto_mes,
  r.precio_promedio_periodo
from base b
cross join resumen r
order by b.mes;
$$;


ALTER FUNCTION "public"."rpc_report_producto_promedio_mensual_12m"("p_producto_id" bigint, "p_end_date" "date", "p_months" integer, "p_vendedor_id" "uuid", "p_estado" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_report_top_productos_12m"("p_end_date" "date" DEFAULT CURRENT_DATE, "p_months" integer DEFAULT 12, "p_limit" integer DEFAULT 50, "p_order_by" "text" DEFAULT 'MONTO'::"text", "p_vendedor_id" "uuid" DEFAULT NULL::"uuid", "p_estado" "text" DEFAULT NULL::"text") RETURNS TABLE("producto_id" bigint, "producto" "text", "marca" "text", "ventas_count" bigint, "unidades" numeric, "monto" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with _auth as (select public.rpc_require_admin()),
params as (
  select date_trunc('month', p_end_date)::date as end_month,
         greatest(p_months, 1) as months_n,
         greatest(p_limit, 1) as lim
),
rango as (
  select (end_month - ((months_n - 1) * interval '1 month'))::timestamptz as desde,
         (end_month + interval '1 month')::timestamptz as hasta
  from params
),
ventas_validas as (
  select v.id
  from public.ventas v
  where v.fecha >= (select desde from rango)
    and v.fecha <  (select hasta from rango)
    and (p_vendedor_id is null or v.vendedor_id = p_vendedor_id)
    and (p_estado is null or v.estado = p_estado)
    and v.anulado_at is null
    and not exists (
      select 1
      from public.ventas_tags t
      where t.venta_id = v.id
        and t.tag = 'ANULADO'
        and t.removed_at is null
    )
),
agg as (
  select d.producto_id,
         count(distinct d.venta_id)::bigint as ventas_count,
         sum(d.cantidad)::numeric as unidades,
         sum(coalesce(d.subtotal, d.cantidad * d.precio_venta_unit))::numeric as monto
  from public.ventas_detalle d
  join ventas_validas vv on vv.id = d.venta_id
  group by d.producto_id
)
select
  a.producto_id,
  p.nombre as producto,
  m.nombre as marca,
  a.ventas_count,
  a.unidades,
  a.monto
from agg a
join public.productos p on p.id = a.producto_id
left join public.marcas m on m.id = p.marca_id
order by
  case when upper(p_order_by) = 'UNIDADES' then a.unidades end desc nulls last,
  case when upper(p_order_by) = 'MONTO' then a.monto end desc nulls last,
  a.monto desc
limit (select lim from params);
$$;


ALTER FUNCTION "public"."rpc_report_top_productos_12m"("p_end_date" "date", "p_months" integer, "p_limit" integer, "p_order_by" "text", "p_vendedor_id" "uuid", "p_estado" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_report_ventas_mensual_12m"("p_end_date" "date" DEFAULT CURRENT_DATE, "p_months" integer DEFAULT 12, "p_vendedor_id" "uuid" DEFAULT NULL::"uuid", "p_estado" "text" DEFAULT NULL::"text") RETURNS TABLE("mes" "date", "ventas_count" bigint, "unidades" numeric, "monto" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with _auth as (select public.rpc_require_admin()),
params as (
  select date_trunc('month', p_end_date)::date as end_month,
         greatest(p_months, 1) as months_n
),
rango as (
  select (end_month - ((months_n - 1) * interval '1 month'))::date as start_month,
         end_month
  from params
),
meses as (
  select date_trunc('month', dd)::date as mes
  from rango, generate_series(start_month, end_month, interval '1 month') dd
),
ventas_validas as (
  select v.id, v.fecha
  from public.ventas v
  where (p_vendedor_id is null or v.vendedor_id = p_vendedor_id)
    and (p_estado is null or v.estado = p_estado)
    and v.fecha >= (select start_month from rango)
    and v.fecha <  ((select end_month from rango) + interval '1 month')
    and v.anulado_at is null
    and not exists (
      select 1
      from public.ventas_tags t
      where t.venta_id = v.id
        and t.tag = 'ANULADO'
        and t.removed_at is null
    )
),
agg as (
  select date_trunc('month', v.fecha)::date as mes,
         count(distinct v.id)::bigint as ventas_count,
         sum(d.cantidad)::numeric as unidades,
         sum(coalesce(d.subtotal, d.cantidad * d.precio_venta_unit))::numeric as monto
  from ventas_validas v
  join public.ventas_detalle d on d.venta_id = v.id
  group by 1
)
select m.mes,
       coalesce(a.ventas_count, 0),
       coalesce(a.unidades, 0),
       coalesce(a.monto, 0)
from meses m
left join agg a on a.mes = m.mes
order by m.mes;
$$;


ALTER FUNCTION "public"."rpc_report_ventas_mensual_12m"("p_end_date" "date", "p_months" integer, "p_vendedor_id" "uuid", "p_estado" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_reporte_bajo_movimiento"("p_hasta" timestamp with time zone, "p_min_dias" integer DEFAULT 30) RETURNS TABLE("producto_id" bigint, "producto_nombre" "text", "marca_nombre" "text", "stock_disponible" integer, "ultima_venta" timestamp with time zone, "dias_sin_movimiento" integer, "ultimo_costo_unit" numeric, "valor_inventario" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with inv as (
    select
      p.id as producto_id,
      p.nombre as producto_nombre,
      p.marca_nombre,
      p.stock_disponible
    from public.vw_inventario_productos p
    where p.activo is true
      and coalesce(p.stock_disponible, 0) > 0
  ),
  ult_venta as (
    select
      d.producto_id,
      max(v.created_at) as ultima_venta
    from public.ventas_detalle d
    join public.ventas v on v.id = d.venta_id
    where not exists (
      select 1
      from public.ventas_tags vt
      where vt.venta_id = v.id
        and vt.tag = 'ANULADO'
        and vt.removed_at is null
    )
    group by d.producto_id
  ),
  costo as (
    select
      cd.producto_id,
      (
        select cd2.precio_compra_unit
        from public.compras_detalle cd2
        where cd2.producto_id = cd.producto_id
        order by cd2.compra_id desc, cd2.id desc
        limit 1
      ) as ultimo_costo_unit
    from public.compras_detalle cd
    group by cd.producto_id
  )
  select
    i.producto_id,
    i.producto_nombre,
    i.marca_nombre,
    i.stock_disponible,
    uv.ultima_venta,
    case
      when uv.ultima_venta is null then null
      else greatest(0, floor(extract(epoch from (p_hasta - uv.ultima_venta)) / 86400))::int
    end as dias_sin_movimiento,
    c.ultimo_costo_unit,
    case
      when c.ultimo_costo_unit is null then null
      else (i.stock_disponible::numeric * c.ultimo_costo_unit)
    end as valor_inventario
  from inv i
  left join ult_venta uv on uv.producto_id = i.producto_id
  left join costo c on c.producto_id = i.producto_id
  where
    -- si nunca se vendió, también suele interesar: lo dejamos pasar como NULL días
    (uv.ultima_venta is null)
    or (floor(extract(epoch from (p_hasta - uv.ultima_venta)) / 86400))::int >= p_min_dias
  order by
    -- primero los que nunca se han vendido
    (uv.ultima_venta is not null) asc,
    dias_sin_movimiento desc nulls last,
    valor_inventario desc nulls last;
$$;


ALTER FUNCTION "public"."rpc_reporte_bajo_movimiento"("p_hasta" timestamp with time zone, "p_min_dias" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_reporte_utilidad_global_v1"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) RETURNS TABLE("total_ventas" numeric, "costo_total" numeric, "utilidad_bruta" numeric, "margen_pct" numeric)
    LANGUAGE "sql"
    AS $$
  select
    sum(coalesce(total_ventas, 0)) as total_ventas,
    sum(coalesce(costo_total, 0)) as costo_total,
    sum(coalesce(utilidad_bruta, 0)) as utilidad_bruta,
    case
      when sum(coalesce(total_ventas, 0)) = 0 then 0
      else (sum(coalesce(utilidad_bruta, 0)) / sum(coalesce(total_ventas, 0))) * 100
    end as margen_pct
  from rpc_reporte_utilidad_productos_v3(p_desde, p_hasta);
$$;


ALTER FUNCTION "public"."rpc_reporte_utilidad_global_v1"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_reporte_utilidad_productos"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) RETURNS TABLE("producto_id" bigint, "producto_nombre" "text", "marca_id" bigint, "marca_nombre" "text", "unidades_vendidas" bigint, "total_ventas" numeric, "costo_total" numeric, "utilidad_bruta" numeric, "margen" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    d.producto_id,
    p.nombre as producto_nombre,
    p.marca_id,
    m.nombre as marca_nombre,

    sum(d.cantidad)::bigint as unidades_vendidas,

    sum(d.cantidad * d.precio_venta_unit) as total_ventas,
    sum(d.cantidad * cd.precio_compra_unit) as costo_total,

    sum(d.cantidad * d.precio_venta_unit) - sum(d.cantidad * cd.precio_compra_unit) as utilidad_bruta,

    case
      when sum(d.cantidad * d.precio_venta_unit) = 0 then null
      else
        (sum(d.cantidad * d.precio_venta_unit) - sum(d.cantidad * cd.precio_compra_unit))
        / sum(d.cantidad * d.precio_venta_unit)
    end as margen

  from public.ventas_detalle d
  join public.ventas v
    on v.id = d.venta_id
  join (
    select distinct on (lote_id, producto_id)
      lote_id, producto_id, precio_compra_unit
    from public.compras_detalle
    order by lote_id, producto_id, id
  ) cd on cd.lote_id    = d.lote_id
      and cd.producto_id = d.producto_id
  join public.productos p
    on p.id = d.producto_id
  left join public.marcas m
    on m.id = p.marca_id

  where v.created_at >= p_desde
    and v.created_at <  p_hasta

    and not exists (
      select 1
      from public.ventas_tags vt
      where vt.venta_id = v.id
        and vt.tag = 'ANULADO'
        and vt.removed_at is null
    )

  group by
    d.producto_id, p.nombre, p.marca_id, m.nombre

  order by utilidad_bruta desc;
$$;


ALTER FUNCTION "public"."rpc_reporte_utilidad_productos"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_reporte_utilidad_productos_v2"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) RETURNS TABLE("producto_id" bigint, "producto_nombre" "text", "marca_id" bigint, "marca_nombre" "text", "unidades_vendidas" bigint, "total_ventas" numeric, "costo_total" numeric, "utilidad_bruta" numeric, "margen" numeric, "margen_pct" numeric, "precio_venta_prom" numeric, "costo_prom" numeric, "utilidad_unit_prom" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with base as (
    select
      d.producto_id,
      p.nombre as producto_nombre,
      p.marca_id,
      m.nombre as marca_nombre,

      sum(d.cantidad)::bigint as unidades_vendidas,
      sum(d.cantidad * d.precio_venta_unit) as total_ventas,
      sum(d.cantidad * cd.precio_compra_unit) as costo_total
    from public.ventas_detalle d
    join public.ventas v on v.id = d.venta_id
    join (
      select distinct on (lote_id, producto_id)
        lote_id, producto_id, precio_compra_unit
      from public.compras_detalle
      order by lote_id, producto_id, id
    ) cd on cd.lote_id    = d.lote_id
        and cd.producto_id = d.producto_id
    join public.productos p on p.id = d.producto_id
    left join public.marcas m on m.id = p.marca_id
    where v.created_at >= p_desde
      and v.created_at <  p_hasta
      and not exists (
        select 1
        from public.ventas_tags vt
        where vt.venta_id = v.id
          and vt.tag = 'ANULADO'
          and vt.removed_at is null
      )
    group by d.producto_id, p.nombre, p.marca_id, m.nombre
  )
  select
    producto_id,
    producto_nombre,
    marca_id,
    marca_nombre,
    unidades_vendidas,
    total_ventas,
    costo_total,
    (total_ventas - costo_total) as utilidad_bruta,
    case when total_ventas = 0 then null else (total_ventas - costo_total) / total_ventas end as margen,
    case when total_ventas = 0 then null else ((total_ventas - costo_total) / total_ventas) * 100 end as margen_pct,
    case when unidades_vendidas = 0 then null else total_ventas / unidades_vendidas end as precio_venta_prom,
    case when unidades_vendidas = 0 then null else costo_total / unidades_vendidas end as costo_prom,
    case when unidades_vendidas = 0 then null else (total_ventas - costo_total) / unidades_vendidas end as utilidad_unit_prom
  from base
  order by utilidad_bruta desc;
$$;


ALTER FUNCTION "public"."rpc_reporte_utilidad_productos_v2"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_reporte_utilidad_productos_v3"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) RETURNS TABLE("producto_id" bigint, "producto_nombre" "text", "marca_id" bigint, "marca_nombre" "text", "unidades_vendidas" bigint, "total_ventas" numeric, "costo_total" numeric, "utilidad_bruta" numeric, "margen_pct" numeric, "participacion_utilidad_pct" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with base as (
    select
      d.producto_id,
      p.nombre as producto_nombre,
      p.marca_id,
      m.nombre as marca_nombre,
      sum(d.cantidad)::bigint as unidades_vendidas,
      sum(d.cantidad * d.precio_venta_unit) as total_ventas,
      sum(d.cantidad * cd.precio_compra_unit) as costo_total
    from public.ventas_detalle d
    join public.ventas v on v.id = d.venta_id
    join (
      select distinct on (lote_id, producto_id)
        lote_id, producto_id, precio_compra_unit
      from public.compras_detalle
      order by lote_id, producto_id, id
    ) cd on cd.lote_id    = d.lote_id
        and cd.producto_id = d.producto_id
    join public.productos p on p.id = d.producto_id
    left join public.marcas m on m.id = p.marca_id
    where v.created_at >= p_desde
      and v.created_at <  p_hasta
      and not exists (
        select 1
        from public.ventas_tags vt
        where vt.venta_id = v.id
          and vt.tag = 'ANULADO'
          and vt.removed_at is null
      )
    group by d.producto_id, p.nombre, p.marca_id, m.nombre
  ),
  totales as (
    select sum(total_ventas - costo_total) as utilidad_total
    from base
  )
  select
    b.producto_id,
    b.producto_nombre,
    b.marca_id,
    b.marca_nombre,
    b.unidades_vendidas,
    b.total_ventas,
    b.costo_total,
    (b.total_ventas - b.costo_total) as utilidad_bruta,
    case when b.total_ventas = 0 then null
      else ((b.total_ventas - b.costo_total) / b.total_ventas) * 100
    end as margen_pct,
    case when t.utilidad_total = 0 then null
      else ((b.total_ventas - b.costo_total) / t.utilidad_total) * 100
    end as participacion_utilidad_pct
  from base b
  cross join totales t
  order by utilidad_bruta desc;
$$;


ALTER FUNCTION "public"."rpc_reporte_utilidad_productos_v3"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_reporte_utilidad_resumen"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) RETURNS TABLE("unidades_vendidas" bigint, "total_ventas" numeric, "costo_total" numeric, "utilidad_bruta" numeric, "margen" numeric, "margen_pct" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with base as (
    select
      d.cantidad::bigint as unidades,
      (d.cantidad * d.precio_venta_unit) as venta,
      (d.cantidad * cd.precio_compra_unit) as costo
    from public.ventas_detalle d
    join public.ventas v on v.id = d.venta_id
    join (
      select distinct on (lote_id, producto_id)
        lote_id, producto_id, precio_compra_unit
      from public.compras_detalle
      order by lote_id, producto_id, id
    ) cd on cd.lote_id    = d.lote_id
        and cd.producto_id = d.producto_id
    where v.created_at >= p_desde
      and v.created_at <  p_hasta
      and not exists (
        select 1
        from public.ventas_tags vt
        where vt.venta_id = v.id
          and vt.tag = 'ANULADO'
          and vt.removed_at is null
      )
  )
  select
    sum(unidades) as unidades_vendidas,
    sum(venta) as total_ventas,
    sum(costo) as costo_total,
    sum(venta) - sum(costo) as utilidad_bruta,
    case when sum(venta) = 0 then null else (sum(venta) - sum(costo)) / sum(venta) end as margen,
    case when sum(venta) = 0 then null else ((sum(venta) - sum(costo)) / sum(venta)) * 100 end as margen_pct
  from base;
$$;


ALTER FUNCTION "public"."rpc_reporte_utilidad_resumen"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_require_admin"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not has_role('ADMIN') then
    raise exception 'forbidden: admin only';
  end if;
end;
$$;


ALTER FUNCTION "public"."rpc_require_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_reservado_pendiente_producto"("p_producto_id" bigint) RETURNS integer
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
with anulado as (
  select distinct venta_id
  from public.ventas_tags
  where removed_at is null
    and upper(btrim(tag)) = 'ANULADO'
),
entregadas as (
  select distinct venta_id
  from public.ventas_eventos
  where upper(btrim(tipo)) = 'ENTREGADO'
     or upper(btrim(a_estado)) = 'ENTREGADO'
)
select coalesce(sum(vd.cantidad),0)::int
from public.ventas_detalle vd
join public.ventas v on v.id = vd.venta_id
where vd.producto_id = p_producto_id
  and v.id not in (select venta_id from anulado)
  and v.id not in (select venta_id from entregadas);
$$;


ALTER FUNCTION "public"."rpc_reservado_pendiente_producto"("p_producto_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_venta_anular"("p_venta_id" bigint, "p_nota" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_estado text;

  v_has_iva boolean := false;
  v_has_exento boolean := false;

  v_req_iva boolean := false;
  v_req_exento boolean := false;

  v_ok_iva boolean := false;
  v_ok_exento boolean := false;

  v_fue_entregada boolean := false;

  r record;
begin
  if v_uid is null then
    raise exception 'NO_AUTH';
  end if;

  select upper(coalesce(p.role,'')) into v_role
  from public.profiles p
  where p.id = v_uid;

  if v_role not in ('ADMIN','FACTURACION') then
    raise exception 'NO_ROLE';
  end if;

  -- lock venta
  select upper(coalesce(v.estado,'')) into v_estado
  from public.ventas v
  where v.id = p_venta_id
  for update;

  if v_estado is null or v_estado = '' then
    raise exception 'VENTA_NO_EXISTE';
  end if;

  -- requiere autorizacion
  if not exists (
    select 1
    from public.ventas_tags vt
    where vt.venta_id = p_venta_id
      and vt.tag = 'ANULACION_REQUERIDA'
      and vt.removed_at is null
  ) then
    raise exception 'NO_ANULACION_REQUERIDA';
  end if;

  if exists (
    select 1
    from public.ventas_tags vt
    where vt.venta_id = p_venta_id
      and vt.tag = 'ANULADO'
      and vt.removed_at is null
  ) then
    raise exception 'YA_ANULADO';
  end if;

  -- detectar si alguna vez se entrego (aunque ahora el estado haya sido forzado a FACTURADO por aprobacion)
  select exists (
    select 1
    from public.ventas_eventos e
    where e.venta_id = p_venta_id
      and upper(coalesce(e.tipo,'')) = 'ENTREGADO'
  ) into v_fue_entregada;

  -- Determinar si requiere IVA/EXENTO segun productos de la venta
  select
    bool_or(coalesce(pr.tiene_iva,false)) as has_iva,
    bool_or(not coalesce(pr.tiene_iva,false)) as has_exento
  into v_has_iva, v_has_exento
  from public.ventas_detalle vd
  join public.productos pr on pr.id = vd.producto_id
  where vd.venta_id = p_venta_id;

  if not coalesce(v_has_iva,false) and not coalesce(v_has_exento,false) then
    raise exception 'VENTA_SIN_LINEAS';
  end if;

  v_req_iva := coalesce(v_has_iva,false);
  v_req_exento := coalesce(v_has_exento,false);

  -- Validar facturas completas (numero + path) para tipos requeridos
  if v_req_iva then
    select exists (
      select 1
      from public.ventas_facturas vf
      where vf.venta_id = p_venta_id
        and upper(vf.tipo) = 'IVA'
        and nullif(trim(coalesce(vf.numero_factura,'')),'') is not null
        and nullif(trim(coalesce(vf.path,'')),'') is not null
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
      where vf.venta_id = p_venta_id
        and upper(vf.tipo) = 'EXENTO'
        and nullif(trim(coalesce(vf.numero_factura,'')),'') is not null
        and nullif(trim(coalesce(vf.path,'')),'') is not null
      limit 1
    ) into v_ok_exento;

    if not v_ok_exento then
      raise exception 'FALTA_FACTURA_EXENTO';
    end if;
  end if;

  -- Ajuste de inventario segun si ya se entrego o no
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
    for update;

    if v_fue_entregada then
      -- devolucion fisica: regresa a stock_total (no toca reservado)
      update public.stock_lotes sl
      set stock_total = sl.stock_total + r.qty
      where sl.lote_id = r.lote_id;
    else
      -- no entregada: solo libera reserva
      update public.stock_lotes sl
      set stock_reservado = sl.stock_reservado - r.qty
      where sl.lote_id = r.lote_id
        and sl.stock_reservado >= r.qty;

      if not found then
        raise exception 'RESERVA_INSUFICIENTE lote_id=%', r.lote_id;
      end if;
    end if;
  end loop;

  -- Consumir ANULACION_REQUERIDA
  update public.ventas_tags
  set removed_at = now(),
      removed_by = v_uid
  where venta_id = p_venta_id
    and tag = 'ANULACION_REQUERIDA'
    and removed_at is null;

  -- Tag final ANULADO
  insert into public.ventas_tags (venta_id, tag, nota, created_by)
  values (p_venta_id, 'ANULADO', nullif(trim(coalesce(p_nota,'')),'') , v_uid);

  -- Evento
  insert into public.ventas_eventos (venta_id, tipo, de_estado, a_estado, nota, creado_por, creado_en)
  values (p_venta_id, 'ANULADA', v_estado, v_estado, nullif(trim(coalesce(p_nota,'')),'') , v_uid, now());
end;
$$;


ALTER FUNCTION "public"."rpc_venta_anular"("p_venta_id" bigint, "p_nota" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_venta_aplicar_pago"("p_venta_id" bigint, "p_factura_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comprobante_path" "text", "p_comentario" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_factura_venta_id bigint;

  -- nuevos
  v_factura_total numeric;
  v_factura_pagado numeric;
  v_pendiente numeric;
begin
  if v_uid is null then
    raise exception 'NO_AUTH';
  end if;

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

  if p_monto is null or p_monto <= 0 then
    raise exception 'MONTO_INVALIDO';
  end if;

  -- Validación por factura SOLO si hay monto_total (para no romper ventas viejas sin monto_total)
  if v_factura_total is not null and v_factura_total > 0 then
    select coalesce(sum(vp.monto), 0)
      into v_factura_pagado
    from public.ventas_pagos vp
    where vp.factura_id = p_factura_id;

    v_pendiente := v_factura_total - coalesce(v_factura_pagado, 0);

    if v_pendiente <= 0 then
      raise exception 'FACTURA_YA_PAGADA';
    end if;

    if p_monto > v_pendiente then
      raise exception 'MONTO_EXCEDE_SALDO_FACTURA';
    end if;
  end if;

  insert into public.ventas_pagos(
    venta_id,
    factura_id,
    fecha,
    monto,
    metodo,
    referencia,
    comprobante_path,
    comentario,
    created_by
  )
  values (
    p_venta_id,
    p_factura_id,
    now(),
    p_monto,
    upper(trim(coalesce(p_metodo,''))),
    nullif(trim(coalesce(p_referencia,'')), ''),
    nullif(trim(coalesce(p_comprobante_path,'')), ''),
    nullif(trim(coalesce(p_comentario,'')), ''),
    v_uid
  );
end;
$$;


ALTER FUNCTION "public"."rpc_venta_aplicar_pago"("p_venta_id" bigint, "p_factura_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comprobante_path" "text", "p_comentario" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_venta_aplicar_pago"("p_venta_id" bigint, "p_monto" numeric, "p_metodo" "text" DEFAULT NULL::"text", "p_referencia" "text" DEFAULT NULL::"text", "p_comprobante_path" "text" DEFAULT NULL::"text", "p_comentario" "text" DEFAULT NULL::"text", "p_fecha" timestamp with time zone DEFAULT "now"()) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_total numeric;
  v_pagado numeric;
  v_role text;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid();

  -- Solo ADMIN y VENTAS pueden aplicar pagos
  if v_role not in ('ADMIN','VENTAS') then
    raise exception 'No autorizado';
  end if;

  if p_monto <= 0 then
    raise exception 'El monto debe ser mayor a 0';
  end if;

  -- Total de la venta
  select coalesce(sum(vd.subtotal), 0)
  into v_total
  from public.ventas_detalle vd
  where vd.venta_id = p_venta_id;

  -- Pagado acumulado
  select coalesce(sum(vp.monto), 0)
  into v_pagado
  from public.ventas_pagos vp
  where vp.venta_id = p_venta_id;

  if (v_pagado + p_monto) > v_total then
    raise exception 'El pago excede el saldo de la venta';
  end if;

  insert into public.ventas_pagos (
    venta_id, fecha, monto, metodo, referencia, comprobante_path, comentario, created_by
  ) values (
    p_venta_id, p_fecha, p_monto, p_metodo, p_referencia, p_comprobante_path, p_comentario, auth.uid()
  );
end;
$$;


ALTER FUNCTION "public"."rpc_venta_aplicar_pago"("p_venta_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comprobante_path" "text", "p_comentario" "text", "p_fecha" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_venta_aprobar_pago_reportado"("p_pago_reportado_id" bigint, "p_nota_admin" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;

  r record;
begin
  if v_uid is null then
    raise exception 'NO_AUTH';
  end if;

  select role into v_role
  from public.profiles
  where id = v_uid;

  if upper(coalesce(v_role,'')) <> 'ADMIN' then
    raise exception 'NO_AUTORIZADO';
  end if;

  select *
    into r
  from public.ventas_pagos_reportados
  where id = p_pago_reportado_id
  for update;

  if r.id is null then
    raise exception 'PAGO_REPORTADO_NO_EXISTE';
  end if;

  if r.estado <> 'PENDIENTE' then
    raise exception 'PAGO_REPORTADO_NO_PENDIENTE';
  end if;

  -- aplicar de verdad (esto sí afecta vw_cxc_ventas / saldo / comisiones)
  perform public.rpc_venta_aplicar_pago(
    p_venta_id := r.venta_id,
    p_factura_id := r.factura_id,
    p_monto := r.monto,
    p_metodo := r.metodo,
    p_referencia := r.referencia,
    p_comprobante_path := r.comprobante_path,
    p_comentario := r.comentario
  );

  update public.ventas_pagos_reportados
  set
    estado = 'APROBADO',
    revisado_por = v_uid,
    revisado_at = now(),
    nota_admin = nullif(trim(coalesce(p_nota_admin,'')), '')
  where id = p_pago_reportado_id;
end;
$$;


ALTER FUNCTION "public"."rpc_venta_aprobar_pago_reportado"("p_pago_reportado_id" bigint, "p_nota_admin" "text") OWNER TO "postgres";


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

  if v_role not in ('VENTAS','ADMIN') then
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


ALTER FUNCTION "public"."rpc_venta_borrar_receta"("p_receta_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_venta_delete_factura"("p_venta_id" bigint, "p_numero" smallint, "p_motivo" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_estado text;
  v_tipo text;
  v_existe boolean;
begin
  if p_numero not in (1,2) then
    raise exception 'p_numero debe ser 1 o 2';
  end if;

  select estado into v_estado
  from public.ventas
  where id = p_venta_id;

  if not found then
    raise exception 'Venta no existe';
  end if;

  v_tipo := case when p_numero = 1 then 'FACTURA_1' else 'FACTURA_2' end;

  select exists (
    select 1 from public.ventas_facturas
    where venta_id = p_venta_id and tipo = v_tipo
  ) into v_existe;

  if v_existe = false then
    raise exception 'No existe % para esta venta', v_tipo;
  end if;

  delete from public.ventas_facturas
  where venta_id = p_venta_id and tipo = v_tipo;

  update public.ventas
  set
    factura_1_cargada = case when p_numero = 1 then false else factura_1_cargada end,
    factura_2_cargada = case when p_numero = 2 then false else factura_2_cargada end
  where id = p_venta_id;

  insert into public.ventas_eventos(venta_id, tipo, de_estado, a_estado, nota, creado_por)
  values (
    p_venta_id,
    'FACTURA_ELIMINADA',
    v_estado,
    v_estado,
    coalesce('Factura ' || p_numero::text || ' eliminada', '') ||
    case when p_motivo is not null and length(trim(p_motivo)) > 0
         then ' | ' || trim(p_motivo) else '' end,
    auth.uid()
  );
end;
$$;


ALTER FUNCTION "public"."rpc_venta_delete_factura"("p_venta_id" bigint, "p_numero" smallint, "p_motivo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_venta_delete_receta"("p_venta_id" bigint, "p_motivo" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_estado text;
  v_existe boolean;
begin
  select estado into v_estado
  from public.ventas
  where id = p_venta_id;

  if not found then
    raise exception 'Venta no existe';
  end if;

  select exists (
    select 1 from public.ventas_recetas
    where venta_id = p_venta_id
  ) into v_existe;

  if v_existe = false then
    raise exception 'No existe receta para esta venta';
  end if;

  delete from public.ventas_recetas
  where venta_id = p_venta_id;

  update public.ventas
  set receta_cargada = false
  where id = p_venta_id;

  insert into public.ventas_eventos(venta_id, tipo, de_estado, a_estado, nota, creado_por)
  values (
    p_venta_id,
    'RECETA_ELIMINADA',
    v_estado,
    v_estado,
    coalesce('Receta eliminada', '') ||
    case when p_motivo is not null and length(trim(p_motivo)) > 0
         then ' | ' || trim(p_motivo) else '' end,
    auth.uid()
  );
end;
$$;


ALTER FUNCTION "public"."rpc_venta_delete_receta"("p_venta_id" bigint, "p_motivo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_venta_editar"("p_venta_id" bigint, "p_venta" "jsonb", "p_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;

  v_prev_estado text;
  v_old_vendedor uuid;

  v_cliente_id bigint;
  v_cliente_nombre text;
  v_comentarios text;

  v_requiere_receta boolean := false;

  it jsonb;
  v_producto_id bigint;
  v_qty int;
  v_precio numeric;

  v_min numeric;
  v_req_receta boolean;

  r record;
  st record;
  v_needed int;
  v_avail int;
  v_take int;
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

  -- lock venta
  select estado, vendedor_id into v_prev_estado, v_old_vendedor
  from public.ventas
  where id = p_venta_id
  for update;

  if not found then
    raise exception 'VENTA_NO_EXISTE';
  end if;

  if v_prev_estado <> 'NUEVO' then
    raise exception 'ESTADO_INVALIDO';
  end if;

  if v_role = 'VENTAS' and v_old_vendedor <> v_uid then
    raise exception 'NO_PERMISO_VENTA';
  end if;

  -- debe existir autorizacion activa
  if not exists (
    select 1
    from public.ventas_tags t
    where t.venta_id = p_venta_id
      and t.removed_at is null
      and t.tag = 'EDICION_REQUERIDA'
  ) then
    raise exception 'NO_AUTORIZADO_EDICION';
  end if;

  -- input venta
  v_cliente_id := nullif(trim(coalesce(p_venta->>'cliente_id','')), '')::bigint;
  v_comentarios := nullif(trim(coalesce(p_venta->>'comentarios','')), '');

  if v_cliente_id is null then
    raise exception 'CLIENTE_INVALIDO';
  end if;

  select c.nombre into v_cliente_nombre
  from public.clientes c
  where c.id = v_cliente_id
    and c.activo = true;

  if v_cliente_nombre is null then
    raise exception 'CLIENTE_INVALIDO';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS_INVALIDOS';
  end if;

  -- liberar reservas viejas (sumadas por lote)
  for r in
    select lote_id, sum(cantidad)::int as qty
    from public.ventas_detalle
    where venta_id = p_venta_id
    group by lote_id
  loop
    select sl.stock_total, sl.stock_reservado
    into st
    from public.stock_lotes sl
    where sl.lote_id = r.lote_id
    for update;

    update public.stock_lotes
    set stock_reservado = greatest(coalesce(stock_reservado,0) - coalesce(r.qty,0), 0)
    where lote_id = r.lote_id;
  end loop;

  -- borrar detalle viejo
  delete from public.ventas_detalle
  where venta_id = p_venta_id;

  -- reservar e insertar detalle nuevo
  for it in
    select value from jsonb_array_elements(p_items) as t(value)
  loop
    v_producto_id := nullif(trim(coalesce(it->>'producto_id','')), '')::bigint;
    v_qty := (coalesce(it->>'cantidad','0'))::int;
    v_precio := (coalesce(it->>'precio_unit','0'))::numeric;

    if v_producto_id is null or v_qty <= 0 then
      raise exception 'ITEM_INVALIDO producto_id=%', coalesce(v_producto_id::text,'null');
    end if;

    select
      bool_or(v.requiere_receta),
      max(v.precio_min_venta)::numeric
    into v_req_receta, v_min
    from public.vw_producto_lotes_detalle v
    where v.producto_id = v_producto_id;

    if v_min is null then
      raise exception 'NO_STOCK producto_id=%', v_producto_id;
    end if;

    if v_precio < v_min then
      raise exception 'PRECIO_MINIMO producto_id=% min=%', v_producto_id, v_min;
    end if;

    if coalesce(v_req_receta,false) then
      v_requiere_receta := true;
    end if;

    v_needed := v_qty;

    for r in
      select v.lote_id, v.fecha_exp
      from public.vw_producto_lotes_detalle v
      where v.producto_id = v_producto_id
        and coalesce(v.stock_disponible_lote, 0) > 0
      order by v.fecha_exp asc nulls last, v.lote_id asc
    loop
      exit when v_needed <= 0;

      select sl.stock_total, sl.stock_reservado
      into st
      from public.stock_lotes sl
      where sl.lote_id = r.lote_id
      for update;

      v_avail := coalesce(st.stock_total,0) - coalesce(st.stock_reservado,0);
      if v_avail <= 0 then
        continue;
      end if;

      v_take := least(v_avail, v_needed);

      update public.stock_lotes
      set stock_reservado = stock_reservado + v_take
      where lote_id = r.lote_id;

      insert into public.ventas_detalle (
        venta_id,
        producto_id,
        lote_id,
        cantidad,
        precio_venta_unit
      )
      values (
        p_venta_id,
        v_producto_id,
        r.lote_id,
        v_take,
        v_precio
      );

      v_needed := v_needed - v_take;
    end loop;

    if v_needed > 0 then
      raise exception 'NO_STOCK producto_id=% faltante=%', v_producto_id, v_needed;
    end if;
  end loop;

  -- actualizar cabecera
  update public.ventas
  set cliente_id = v_cliente_id,
      cliente_nombre = v_cliente_nombre,
      comentarios = v_comentarios,
      requiere_receta = v_requiere_receta
  where id = p_venta_id;

  insert into public.ventas_eventos (venta_id, tipo, de_estado, a_estado, nota, creado_por, creado_en)
  values (p_venta_id, 'EDITADA', 'NUEVO', 'NUEVO', null, v_uid, now());

  -- consumir autorizacion (uso unico)
  update public.ventas_tags
  set removed_at = now(), removed_by = v_uid
  where venta_id = p_venta_id
    and tag = 'EDICION_REQUERIDA'
    and removed_at is null;

  return jsonb_build_object('ok', true, 'venta_id', p_venta_id);
end;
$$;


ALTER FUNCTION "public"."rpc_venta_editar"("p_venta_id" bigint, "p_venta" "jsonb", "p_items" "jsonb") OWNER TO "postgres";


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

  select estado into v_prev_estado
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

    -- Validar prefijo del path para evitar cosas raras
    if position('ventas/' || p_venta_id::text || '/facturas/' || v_tipo || '/' in v_path) <> 1 then
      raise exception 'PATH_INVALIDO tipo=%', v_tipo;
    end if;

    insert into public.ventas_facturas (
      venta_id, tipo, path, numero_factura, original_name, size_bytes, uploaded_by,
      monto_total, fecha_emision, fecha_vencimiento
    )
    values (
      p_venta_id, v_tipo, v_path, v_num, v_orig, v_size, v_uid,
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

  update public.ventas
  set estado = 'FACTURADO'
  where id = p_venta_id;

  insert into public.ventas_eventos (venta_id, tipo, de_estado, a_estado, nota, creado_por, creado_en)
  values (p_venta_id, 'FACTURADA', v_prev_estado, 'FACTURADO', null, v_uid, now());

  return jsonb_build_object(
    'ok', true,
    'venta_id', p_venta_id,
    'estado', 'FACTURADO',
    'needs_iva', v_needs_iva,
    'needs_exento', v_needs_exento
  );
end;
$$;


ALTER FUNCTION "public"."rpc_venta_facturar"("p_venta_id" bigint, "p_facturas" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_venta_marcar_entregada"("p_venta_id" bigint, "p_nota" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_prev_estado text;
  r record;
begin
  if v_uid is null then
    raise exception 'NO_AUTH';
  end if;

  select upper(coalesce(role,'')) into v_role
  from public.profiles
  where id = v_uid;

  if v_role not in ('ADMIN','BODEGA','VENTAS') then
    raise exception 'NO_ROLE';
  end if;

  -- lock venta
  select estado into v_prev_estado
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

  -- consumir por lote: baja total y reservado
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
    for update;

    update public.stock_lotes sl
    set stock_total = sl.stock_total - r.qty,
        stock_reservado = sl.stock_reservado - r.qty
    where sl.lote_id = r.lote_id
      and sl.stock_total >= r.qty
      and sl.stock_reservado >= r.qty;

    if not found then
      raise exception 'STOCK_INSUFICIENTE lote_id=%', r.lote_id;
    end if;
  end loop;

  update public.ventas
  set estado = 'ENTREGADO'
  where id = p_venta_id;

  insert into public.ventas_eventos (venta_id, tipo, de_estado, a_estado, nota, creado_por, creado_en)
  values (
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
$$;


ALTER FUNCTION "public"."rpc_venta_marcar_entregada"("p_venta_id" bigint, "p_nota" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_venta_pago_editar_meta"("p_pago_id" bigint, "p_metodo" "text" DEFAULT NULL::"text", "p_referencia" "text" DEFAULT NULL::"text", "p_comentario" "text" DEFAULT NULL::"text", "p_comprobante_path" "text" DEFAULT NULL::"text", "p_fecha" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_role text;
  v_uid uuid := auth.uid();
  v_venta_id bigint;
  v_vendedor_id uuid;
  v_perm_id bigint;
begin
  select role into v_role
  from public.profiles
  where id = v_uid;

  select venta_id into v_venta_id
  from public.ventas_pagos
  where id = p_pago_id;

  if v_venta_id is null then
    raise exception 'Pago no encontrado';
  end if;

  select vendedor_id into v_vendedor_id
  from public.ventas
  where id = v_venta_id;

  if v_role = 'ADMIN' then
    -- ok
  elsif v_role = 'VENTAS' then
    if v_vendedor_id <> v_uid then
      raise exception 'No autorizado';
    end if;

    -- tomar 1 permiso vigente no usado y bloquearlo (single-use)
    select id into v_perm_id
    from public.ventas_permisos_edicion
    where venta_id = v_venta_id
      and tipo = 'PAGO'
      and otorgado_a = v_uid
      and expira_at > now()
      and used_at is null
    order by otorgado_at desc
    limit 1
    for update;

    if v_perm_id is null then
      raise exception 'Edicion de pago no autorizada o expirada';
    end if;
  else
    raise exception 'No autorizado';
  end if;

  update public.ventas_pagos
  set
    metodo = coalesce(p_metodo, metodo),
    referencia = coalesce(p_referencia, referencia),
    comentario = coalesce(p_comentario, comentario),
    comprobante_path = coalesce(p_comprobante_path, comprobante_path),
    fecha = coalesce(p_fecha, fecha)
  where id = p_pago_id;

  -- consumir permiso si fue VENTAS
  if v_role = 'VENTAS' then
    update public.ventas_permisos_edicion
    set used_at = now()
    where id = v_perm_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."rpc_venta_pago_editar_meta"("p_pago_id" bigint, "p_metodo" "text", "p_referencia" "text", "p_comentario" "text", "p_comprobante_path" "text", "p_fecha" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_venta_pago_editar_monto"("p_pago_id" bigint, "p_monto" numeric) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_role text;
  v_uid uuid := auth.uid();
  v_venta_id bigint;
  v_vendedor_id uuid;
  v_perm_id bigint;
  v_total numeric;
  v_pagado_sin_este numeric;
begin
  select role into v_role
  from public.profiles
  where id = v_uid;

  if p_monto <= 0 then
    raise exception 'El monto debe ser mayor a 0';
  end if;

  select venta_id into v_venta_id
  from public.ventas_pagos
  where id = p_pago_id;

  if v_venta_id is null then
    raise exception 'Pago no encontrado';
  end if;

  select vendedor_id into v_vendedor_id
  from public.ventas
  where id = v_venta_id;

  if v_role = 'ADMIN' then
    -- ok
  elsif v_role = 'VENTAS' then
    if v_vendedor_id <> v_uid then
      raise exception 'No autorizado';
    end if;

    -- tomar 1 permiso vigente no usado y bloquearlo (single-use)
    select id into v_perm_id
    from public.ventas_permisos_edicion
    where venta_id = v_venta_id
      and tipo = 'PAGO'
      and otorgado_a = v_uid
      and expira_at > now()
      and used_at is null
    order by otorgado_at desc
    limit 1
    for update;

    if v_perm_id is null then
      raise exception 'Edicion de pago no autorizada o expirada';
    end if;
  else
    raise exception 'No autorizado';
  end if;

  -- total de la venta
  select coalesce(sum(subtotal),0)
  into v_total
  from public.ventas_detalle
  where venta_id = v_venta_id;

  -- pagado sin este pago
  select coalesce(sum(monto),0)
  into v_pagado_sin_este
  from public.ventas_pagos
  where venta_id = v_venta_id
    and id <> p_pago_id;

  if (v_pagado_sin_este + p_monto) > v_total then
    raise exception 'El pago excede el saldo de la venta';
  end if;

  update public.ventas_pagos
  set monto = p_monto
  where id = p_pago_id;

  -- consumir permiso si fue VENTAS
  if v_role = 'VENTAS' then
    update public.ventas_permisos_edicion
    set used_at = now()
    where id = v_perm_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."rpc_venta_pago_editar_monto"("p_pago_id" bigint, "p_monto" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_venta_pago_eliminar"("p_pago_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_role text;
  v_uid uuid := auth.uid();
  v_venta_id bigint;
  v_vendedor_id uuid;
begin
  select role into v_role
  from public.profiles
  where id = v_uid;

  if v_role not in ('ADMIN', 'VENTAS') then
    raise exception 'No autorizado';
  end if;

  select venta_id into v_venta_id
  from public.ventas_pagos
  where id = p_pago_id;

  if v_venta_id is null then
    raise exception 'Pago no encontrado';
  end if;

  if v_role = 'VENTAS' then
    select vendedor_id into v_vendedor_id
    from public.ventas
    where id = v_venta_id;

    if v_vendedor_id <> v_uid then
      raise exception 'No autorizado';
    end if;
  end if;

  delete from public.ventas_pagos
  where id = p_pago_id;

  if not found then
    raise exception 'Pago no encontrado';
  end if;
end;
$$;


ALTER FUNCTION "public"."rpc_venta_pago_eliminar"("p_pago_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_venta_pasar_en_ruta"("p_venta_id" bigint, "p_nota" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_prev_estado text;
begin
  if v_uid is null then
    raise exception 'NO_AUTH';
  end if;

  select upper(coalesce(role,'')) into v_role
  from public.profiles
  where id = v_uid;

  if v_role not in ('BODEGA','ADMIN') then
    raise exception 'NO_ROLE';
  end if;

  select estado into v_prev_estado
  from public.ventas
  where id = p_venta_id;

  if not found then
    raise exception 'VENTA_NO_EXISTE';
  end if;

  if v_prev_estado <> 'FACTURADO' then
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

  update public.ventas
  set estado = 'EN_RUTA'
  where id = p_venta_id;

  insert into public.ventas_eventos (venta_id, tipo, de_estado, a_estado, nota, creado_por, creado_en)
  values (p_venta_id, 'EN_RUTA', v_prev_estado, 'EN_RUTA', nullif(trim(coalesce(p_nota,'')), ''), v_uid, now());

  return jsonb_build_object('ok', true, 'venta_id', p_venta_id, 'estado', 'EN_RUTA');
end;
$$;


ALTER FUNCTION "public"."rpc_venta_pasar_en_ruta"("p_venta_id" bigint, "p_nota" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_venta_rechazar_pago_reportado"("p_pago_reportado_id" bigint, "p_nota_admin" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  r record;
begin
  if v_uid is null then
    raise exception 'NO_AUTH';
  end if;

  select role into v_role
  from public.profiles
  where id = v_uid;

  if upper(coalesce(v_role,'')) <> 'ADMIN' then
    raise exception 'NO_AUTORIZADO';
  end if;

  select *
    into r
  from public.ventas_pagos_reportados
  where id = p_pago_reportado_id
  for update;

  if r.id is null then
    raise exception 'PAGO_REPORTADO_NO_EXISTE';
  end if;

  if r.estado <> 'PENDIENTE' then
    raise exception 'PAGO_REPORTADO_NO_PENDIENTE';
  end if;

  update public.ventas_pagos_reportados
  set
    estado = 'RECHAZADO',
    revisado_por = v_uid,
    revisado_at = now(),
    nota_admin = nullif(trim(coalesce(p_nota_admin,'')), '')
  where id = p_pago_reportado_id;
end;
$$;


ALTER FUNCTION "public"."rpc_venta_rechazar_pago_reportado"("p_pago_reportado_id" bigint, "p_nota_admin" "text") OWNER TO "postgres";


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

  if v_role not in ('VENTAS','ADMIN') then
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


ALTER FUNCTION "public"."rpc_venta_registrar_receta"("p_venta_id" bigint, "p_path" "text") OWNER TO "postgres";


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

  -- Solo ADMIN o VENTAS pueden reportar (ajustable)
  if upper(coalesce(v_role,'')) not in ('ADMIN','VENTAS') then
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


ALTER FUNCTION "public"."rpc_venta_reportar_pago"("p_venta_id" bigint, "p_factura_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comprobante_path" "text", "p_comentario" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_venta_set_en_ruta"("p_venta_id" bigint, "p_nota" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_estado text;
begin
  select estado into v_estado
  from public.ventas
  where id = p_venta_id;

  if not found then
    raise exception 'Venta no existe';
  end if;

  if v_estado <> 'FACTURADO' then
    raise exception 'Solo se puede pasar a EN_RUTA desde FACTURADO';
  end if;

  update public.ventas
  set estado = 'EN_RUTA'
  where id = p_venta_id;

  insert into public.ventas_eventos(venta_id, tipo, de_estado, a_estado, nota, creado_por)
  values (p_venta_id, 'ESTADO', 'FACTURADO', 'EN_RUTA', p_nota, auth.uid());
end;
$$;


ALTER FUNCTION "public"."rpc_venta_set_en_ruta"("p_venta_id" bigint, "p_nota" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_venta_set_entregado"("p_venta_id" bigint, "p_nota" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_estado text;
begin
  select estado into v_estado
  from public.ventas
  where id = p_venta_id;

  if not found then
    raise exception 'Venta no existe';
  end if;

  if v_estado <> 'EN_RUTA' then
    raise exception 'Solo se puede pasar a ENTREGADO desde EN_RUTA';
  end if;

  update public.ventas
  set estado = 'ENTREGADO'
  where id = p_venta_id;

  insert into public.ventas_eventos(venta_id, tipo, de_estado, a_estado, nota, creado_por)
  values (p_venta_id, 'ESTADO', 'EN_RUTA', 'ENTREGADO', p_nota, auth.uid());
end;
$$;


ALTER FUNCTION "public"."rpc_venta_set_entregado"("p_venta_id" bigint, "p_nota" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_venta_set_factura"("p_venta_id" bigint, "p_numero" smallint, "p_path" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_estado text;
  v_tipo text;
begin
  if p_numero not in (1,2) then
    raise exception 'p_numero debe ser 1 o 2';
  end if;

  if p_path is null or length(trim(p_path)) = 0 then
    raise exception 'p_path requerido';
  end if;

  select estado into v_estado
  from public.ventas
  where id = p_venta_id;

  if not found then
    raise exception 'Venta no existe';
  end if;

  v_tipo := case when p_numero = 1 then 'FACTURA_1' else 'FACTURA_2' end;

  insert into public.ventas_facturas (venta_id, tipo, path, created_at, uploaded_by)
  values (p_venta_id, v_tipo, p_path, now(), auth.uid())
  on conflict (venta_id, tipo)
  do update set
    path = excluded.path,
    created_at = now(),
    uploaded_by = auth.uid();

  update public.ventas
  set
    factura_1_cargada = case when p_numero = 1 then true else factura_1_cargada end,
    factura_2_cargada = case when p_numero = 2 then true else factura_2_cargada end
  where id = p_venta_id;

  insert into public.ventas_eventos(venta_id, tipo, de_estado, a_estado, nota, creado_por)
  values (
    p_venta_id,
    'FACTURA_SUBIDA',
    v_estado,
    v_estado,
    'Factura ' || p_numero::text || ' subida',
    auth.uid()
  );
end;
$$;


ALTER FUNCTION "public"."rpc_venta_set_factura"("p_venta_id" bigint, "p_numero" smallint, "p_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_venta_set_receta"("p_venta_id" bigint, "p_path" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_estado text;
begin
  if p_path is null or length(trim(p_path)) = 0 then
    raise exception 'p_path requerido';
  end if;

  select estado into v_estado
  from public.ventas
  where id = p_venta_id;

  if not found then
    raise exception 'Venta no existe';
  end if;

  insert into public.ventas_recetas (venta_id, path, created_at, uploaded_by)
  values (p_venta_id, p_path, now(), auth.uid())
  on conflict (venta_id)
  do update set
    path = excluded.path,
    created_at = now(),
    uploaded_by = auth.uid();

  update public.ventas
  set receta_cargada = true
  where id = p_venta_id;

  insert into public.ventas_eventos(venta_id, tipo, de_estado, a_estado, nota, creado_por)
  values (
    p_venta_id,
    'RECETA_SUBIDA',
    v_estado,
    v_estado,
    'Receta subida',
    auth.uid()
  );
end;
$$;


ALTER FUNCTION "public"."rpc_venta_set_receta"("p_venta_id" bigint, "p_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_ventas_dots"("p_limit" integer DEFAULT 200) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
with per_estado as (
  select id, estado from (
    select v.id, v.estado,
           row_number() over (partition by v.estado order by v.fecha desc) as rn
    from public.ventas v
    where v.estado in ('NUEVO','FACTURADO','EN_RUTA')
  ) x
  where rn <= greatest(coalesce(p_limit,200), 1)
),
visibles as (
  select p.id, p.estado
  from per_estado p
  where not exists (
    select 1
    from public.ventas_tags t
    where t.venta_id = p.id
      and t.removed_at is null
      and t.tag = 'ANULADO'
  )
),
fact_attention as (
  select exists (
    select 1
    from visibles v
    join public.ventas_tags t
      on t.venta_id = v.id
     and t.removed_at is null
     and t.tag in ('ANULACION_REQUERIDA','EDICION_REQUERIDA','PEND_AUTORIZACION_ADMIN')
    where v.estado = 'FACTURADO'
  ) as has_attention
)
select jsonb_build_object(
  'nuevosAlert', (select count(*) from visibles where estado='NUEVO') > 0,
  'facturadoAny', (select count(*) from visibles where estado='FACTURADO') > 0,
  'enRutaAny', (select count(*) from visibles where estado='EN_RUTA') > 0,
  'facturadosAlert', (select has_attention from fact_attention)
);
$$;


ALTER FUNCTION "public"."rpc_ventas_dots"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_ventas_pagadas_en_rango"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_vendedor_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("venta_id" bigint, "fecha_venta" timestamp with time zone, "fecha_pagada" timestamp with time zone, "cliente_id" bigint, "cliente_nombre" "text", "vendedor_id" "uuid", "vendedor_codigo" "text", "total" numeric, "pagado" numeric, "saldo" numeric, "facturas" "text"[])
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_role text;
  v_uid uuid := auth.uid();
begin
  select upper(coalesce(role,'')) into v_role
  from public.profiles
  where id = v_uid;

  return query
  with totales as (
    select vd.venta_id, coalesce(sum(vd.subtotal),0) as total
    from public.ventas_detalle vd
    group by vd.venta_id
  ),
  pagos_ordenados as (
    select
      vp.venta_id,
      vp.fecha,
      vp.id,
      vp.monto,
      sum(vp.monto) over (
        partition by vp.venta_id
        order by vp.fecha, vp.id
        rows between unbounded preceding and current row
      ) as pagado_acum
    from public.ventas_pagos vp
  ),
  completadas as (
    select
      p.venta_id,
      min(p.fecha) as fecha_pagada
    from pagos_ordenados p
    join totales t on t.venta_id = p.venta_id
    where p.pagado_acum >= t.total
    group by p.venta_id
  ),
  sum_pagos as (
    select venta_id, coalesce(sum(monto),0) as pagado
    from public.ventas_pagos
    group by venta_id
  ),
  facturas as (
    select
      vf.venta_id,
      array_agg(vf.numero_factura order by vf.numero_factura) as facturas
    from public.ventas_facturas vf
    where vf.numero_factura is not null
    group by vf.venta_id
  )
  select
    v.id as venta_id,
    v.fecha as fecha_venta,
    comp.fecha_pagada,
    c.id as cliente_id,
    c.nombre as cliente_nombre,
    v.vendedor_id,
    v.vendedor_codigo,
    t.total,
    coalesce(sp.pagado,0) as pagado,
    (t.total - coalesce(sp.pagado,0)) as saldo,
    f.facturas
  from completadas comp
  join public.ventas v on v.id = comp.venta_id
  join public.clientes c on c.id = v.cliente_id
  join totales t on t.venta_id = v.id
  left join sum_pagos sp on sp.venta_id = v.id
  left join facturas f on f.venta_id = v.id
  where v.estado = 'ENTREGADO'
    and comp.fecha_pagada >= p_from
    and comp.fecha_pagada <  p_to
    and (
      case
        when v_role = 'ADMIN' then
          (p_vendedor_id is null or v.vendedor_id = p_vendedor_id)
        when v_role = 'VENTAS' then
          v.vendedor_id = v_uid
        else
          false  -- FACTURACION, BODEGA u otros: bloqueados
      end
    )
  order by comp.fecha_pagada desc;
end;
$$;


ALTER FUNCTION "public"."rpc_ventas_pagadas_en_rango"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_vendedor_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ventas_devoluciones" (
    "id" bigint NOT NULL,
    "venta_id" bigint NOT NULL,
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "motivo" "text"
);


ALTER TABLE "public"."ventas_devoluciones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ventas_devoluciones_detalle" (
    "id" bigint NOT NULL,
    "devolucion_id" bigint NOT NULL,
    "lote_id" bigint NOT NULL,
    "cantidad" integer NOT NULL,
    CONSTRAINT "ventas_devoluciones_detalle_cantidad_check" CHECK (("cantidad" > 0))
);


ALTER TABLE "public"."ventas_devoluciones_detalle" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_ventas_lista" WITH ("security_invoker"='true') AS
 SELECT "v"."id",
    "v"."fecha",
    "v"."estado",
    "v"."cliente_nombre",
    "v"."cliente_id",
    "v"."vendedor_id",
    "v"."requiere_receta",
    "v"."receta_cargada",
    "v"."factura_1_cargada",
    "v"."factura_2_cargada",
    "sum"("vd"."cantidad") AS "total_items",
    COALESCE("dr"."total_devuelto", (0)::bigint) AS "total_devuelto",
        CASE
            WHEN (COALESCE("dr"."total_devuelto", (0)::bigint) = 0) THEN NULL::"text"
            WHEN (COALESCE("dr"."total_devuelto", (0)::bigint) < "sum"("vd"."cantidad")) THEN 'PARCIAL'::"text"
            WHEN (COALESCE("dr"."total_devuelto", (0)::bigint) = "sum"("vd"."cantidad")) THEN 'TOTAL'::"text"
            ELSE NULL::"text"
        END AS "estado_devolucion"
   FROM (("public"."ventas" "v"
     JOIN "public"."ventas_detalle" "vd" ON (("vd"."venta_id" = "v"."id")))
     LEFT JOIN ( SELECT "d"."venta_id",
            "sum"("dd"."cantidad") AS "total_devuelto"
           FROM ("public"."ventas_devoluciones" "d"
             JOIN "public"."ventas_devoluciones_detalle" "dd" ON (("dd"."devolucion_id" = "d"."id")))
          GROUP BY "d"."venta_id") "dr" ON (("dr"."venta_id" = "v"."id")))
  GROUP BY "v"."id", "v"."fecha", "v"."estado", "v"."cliente_nombre", "v"."cliente_id", "v"."vendedor_id", "v"."requiere_receta", "v"."receta_cargada", "v"."factura_1_cargada", "v"."factura_2_cargada", "dr"."total_devuelto";


ALTER VIEW "public"."vw_ventas_lista" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_ventas_receta_pendiente_por_mes"("p_year" integer, "p_month" integer) RETURNS SETOF "public"."vw_ventas_lista"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  with bounds as (
    select
      make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'America/Guatemala') as start_ts,
      (make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'America/Guatemala') + interval '1 month') as end_ts
  )
  select vl.*
  from public.vw_ventas_lista vl
  cross join bounds b
  where
    vl.fecha >= b.start_ts
    and vl.fecha < b.end_ts
    and vl.estado <> 'ANULADO'
    and vl.requiere_receta is true
    and coalesce(vl.receta_cargada, false) is false
    and not exists (
      select 1
      from public.ventas_recetas vr
      where vr.venta_id = vl.id
    )
  order by vl.fecha desc, vl.id desc;
$$;


ALTER FUNCTION "public"."rpc_ventas_receta_pendiente_por_mes"("p_year" integer, "p_month" integer) OWNER TO "postgres";


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

  if v_role not in ('VENTAS','ADMIN') then raise exception 'NO_ROLE'; end if;
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

  -- ✅ NOTIF: solo ADMIN. Dedupe: (type, venta_id) pero solo para VENTA_%
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


ALTER FUNCTION "public"."rpc_ventas_solicitar_accion"("p_venta_id" bigint, "p_accion" "text", "p_nota" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_cliente_vendedor_id_default"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.vendedor_id IS NULL THEN
    NEW.vendedor_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_cliente_vendedor_id_default"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_ventas_factura_flags"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  update public.ventas v
  set
    factura_1_cargada = exists (
      select 1 from public.ventas_facturas f
      where f.venta_id = v.id and f.tipo = 'IVA'
    ),
    factura_2_cargada = exists (
      select 1 from public.ventas_facturas f
      where f.venta_id = v.id and f.tipo = 'EXENTO'
    )
  where v.id = coalesce(new.venta_id, old.venta_id);

  return null;
end;
$$;


ALTER FUNCTION "public"."sync_ventas_factura_flags"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_block_cancel_sale_if_paid"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- Solo cuando el estado cambie a ANULADO
  if (old.estado is distinct from new.estado) and new.estado = 'ANULADO' then
    if exists (
      select 1
      from public.ventas_pagos p
      where p.venta_id = old.id
        and p.monto > 0
      limit 1
    ) then
      raise exception 'No se puede anular la venta %: tiene pagos aplicados.', old.id
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."tg_block_cancel_sale_if_paid"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_ventas_facturas_sanitize"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_total numeric;
  v_fecha timestamptz;
begin
  select coalesce(sum(vd.subtotal), 0)
    into v_total
  from public.ventas_detalle vd
  where vd.venta_id = new.venta_id;

  select v.fecha into v_fecha
  from public.ventas v
  where v.id = new.venta_id;

  if new.monto_total is null then
    new.monto_total := v_total;
  end if;

  if new.fecha_vencimiento is null then
    new.fecha_vencimiento := (v_fecha::date + 30);
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."tg_ventas_facturas_sanitize"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_enqueue_compra_linea_ingresada"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_nombre text;
  v_marca text;
begin
  select
    p.nombre,
    coalesce(m.nombre,'')
  into
    v_nombre,
    v_marca
  from public.productos p
  left join public.marcas m on m.id = p.marca_id
  where p.id = new.producto_id;

  insert into public.notif_outbox (type, venta_id, payload)
  values (
    'COMPRA_LINEA_INGRESADA',
    new.compra_id, -- reutilizamos venta_id como ref (compra_id)
    jsonb_build_object(
      'compra_id', new.compra_id,
      'compra_detalle_id', new.id,
      'producto_id', new.producto_id,
      'cantidad', new.cantidad,
      'lote_id', new.lote_id,
      'producto_nombre', coalesce(v_nombre, ''),
      'producto_marca',  coalesce(v_marca, '')
    )
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."trg_enqueue_compra_linea_ingresada"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_enqueue_venta_facturada"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'UPDATE' then
    if upper(btrim(coalesce(old.estado, ''))) <> 'FACTURADO'
       and upper(btrim(coalesce(new.estado, ''))) = 'FACTURADO'
    then
      -- guard anti-duplicado (por venta)
      if not exists (
        select 1
        from public.notif_outbox o
        where o.type = 'VENTA_FACTURADA'
          and o.venta_id = new.id
      ) then
        insert into public.notif_outbox (type, venta_id, payload)
        values (
          'VENTA_FACTURADA',
          new.id,
          jsonb_build_object(
            'venta_id', new.id,
            'vendedor_id', new.vendedor_id
          )
        );
      end if;
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trg_enqueue_venta_facturada"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_enqueue_venta_nuevos"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- INSERT: si ya entra como NUEVO y no está ANULADO
  if (tg_op = 'INSERT') then
    if public.venta_visible_en_nuevos(new.id) then
      insert into public.notif_outbox (type, venta_id, payload)
      values (
        'VENTA_VISIBLE_NUEVOS',
        new.id,
        jsonb_build_object(
          'venta_id', new.id,
          'estado', new.estado,
          'fecha', new.fecha,
          'cliente_nombre', new.cliente_nombre,
          'vendedor_codigo', new.vendedor_codigo,
          'vendedor_id', new.vendedor_id
        )
      )
      on conflict (type, venta_id) where (type like 'VENTA_%') do nothing;
    end if;
    return new;
  end if;

  -- UPDATE: solo cuando entra a NUEVO (antes no era NUEVO)
  if (tg_op = 'UPDATE') then
    if (old.estado is distinct from 'NUEVO' and new.estado = 'NUEVO') then
      if public.venta_visible_en_nuevos(new.id) then
        insert into public.notif_outbox (type, venta_id, payload)
        values (
          'VENTA_VISIBLE_NUEVOS',
          new.id,
          jsonb_build_object(
            'venta_id', new.id,
            'estado', new.estado,
            'fecha', new.fecha,
            'cliente_nombre', new.cliente_nombre,
            'vendedor_codigo', new.vendedor_codigo,
            'vendedor_id', new.vendedor_id
          )
        )
        on conflict (type, venta_id) where (type like 'VENTA_%') do nothing;
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trg_enqueue_venta_nuevos"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_recalc_saldo_compra"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'INSERT' then
    perform public.recalc_saldo_compra(new.compra_id);
    return new;
  elsif tg_op = 'UPDATE' then
    -- por si cambiaron compra_id
    perform public.recalc_saldo_compra(old.compra_id);
    perform public.recalc_saldo_compra(new.compra_id);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.recalc_saldo_compra(old.compra_id);
    return old;
  end if;

  return null;
end;
$$;


ALTER FUNCTION "public"."trg_recalc_saldo_compra"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_recalc_total_compra"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'INSERT' then
    perform public.recalc_total_compra(new.compra_id);
    return new;
  elsif tg_op = 'UPDATE' then
    perform public.recalc_total_compra(old.compra_id);
    perform public.recalc_total_compra(new.compra_id);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.recalc_total_compra(old.compra_id);
    return old;
  end if;

  return null;
end;
$$;


ALTER FUNCTION "public"."trg_recalc_total_compra"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_set_producto_image_from_latest_compra"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  latest_compra_id bigint;
begin
  if new.image_path is null or new.image_path = '' then
    return new;
  end if;

  select cd.compra_id
    into latest_compra_id
  from public.compras_detalle cd
  join public.compras c on c.id = cd.compra_id
  where cd.producto_id = new.producto_id
  order by c.fecha desc, cd.compra_id desc
  limit 1;

  if latest_compra_id = new.compra_id then
    update public.productos
    set image_path = new.image_path
    where id = new.producto_id;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trg_set_producto_image_from_latest_compra"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_stock_lotes_check_low_20"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_producto_id bigint;
begin
  select pl.producto_id into v_producto_id
  from public.producto_lotes pl
  where pl.id = new.lote_id;

  if v_producto_id is null then
    return new;
  end if;

  perform public.rpc_enqueue_stock_bajo_20(v_producto_id);
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_stock_lotes_check_low_20"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_compra_credito"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if new.tipo_pago = 'CREDITO' and new.fecha_vencimiento is null then
    raise exception 'Si tipo_pago es CREDITO, fecha_vencimiento es obligatoria';
  end if;

  if new.tipo_pago = 'CONTADO' then
    new.fecha_vencimiento := null;
    new.saldo_pendiente := 0;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."validate_compra_credito"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_compra_lote_producto"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if not exists (
    select 1
    from public.producto_lotes pl
    where pl.id = new.lote_id
      and pl.producto_id = new.producto_id
  ) then
    raise exception
      'El lote % no pertenece al producto %',
      new.lote_id, new.producto_id;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."validate_compra_lote_producto"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_devolucion_lote_producto"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if not exists (
    select 1
    from public.producto_lotes pl
    where pl.id = new.lote_id
      and pl.producto_id = new.producto_id
  ) then
    raise exception 'El lote % no pertenece al producto %', new.lote_id, new.producto_id;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."validate_devolucion_lote_producto"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_pago_no_exceda_saldo"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_total numeric(12,2);
  v_pagado numeric(12,2);
begin
  select c.monto_total into v_total
  from public.compras c
  where c.id = new.compra_id;

  if v_total is null then
    return new; -- si aún no hay monto_total, no bloqueamos
  end if;

  select coalesce(sum(p.monto),0) into v_pagado
  from public.compras_pagos p
  where p.compra_id = new.compra_id
    and (tg_op <> 'UPDATE' or p.id <> new.id);

  if (v_pagado + new.monto) > v_total then
    raise exception 'El pago excede el monto total de la compra';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."validate_pago_no_exceda_saldo"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_venta_lote_producto"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if not exists (
    select 1
    from public.producto_lotes pl
    where pl.id = new.lote_id
      and pl.producto_id = new.producto_id
  ) then
    raise exception 'El lote % no pertenece al producto %', new.lote_id, new.producto_id;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."validate_venta_lote_producto"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."venta_visible_en_nuevos"("p_venta_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select
    exists (
      select 1
      from public.ventas v
      where v.id = p_venta_id
        and v.estado = 'NUEVO'
    )
    and not exists (
      select 1
      from public.ventas_tags vt
      where vt.venta_id = p_venta_id
        and upper(coalesce(vt.tag,'')) = 'ANULADO'
        and vt.removed_at is null
    );
$$;


ALTER FUNCTION "public"."venta_visible_en_nuevos"("p_venta_id" bigint) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "audit"."log" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor_uid" "uuid",
    "action" "text" NOT NULL,
    "table_schema" "text" NOT NULL,
    "table_name" "text" NOT NULL,
    "record_pk" "text",
    "old_data" "jsonb",
    "new_data" "jsonb"
);


ALTER TABLE "audit"."log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "audit"."log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "audit"."log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "audit"."log_id_seq" OWNED BY "audit"."log"."id";



CREATE OR REPLACE VIEW "audit"."vw_ventas_pagos_log" AS
 SELECT "created_at" AS "registrado",
    "action" AS "accion",
    "record_pk" AS "pk",
    "actor_uid",
    COALESCE((("new_data" ->> 'venta_id'::"text"))::bigint, (("old_data" ->> 'venta_id'::"text"))::bigint) AS "venta_id",
    COALESCE((("new_data" ->> 'factura_id'::"text"))::bigint, (("old_data" ->> 'factura_id'::"text"))::bigint) AS "factura_id",
    COALESCE((("new_data" ->> 'monto'::"text"))::numeric, (("old_data" ->> 'monto'::"text"))::numeric) AS "monto",
    COALESCE(("new_data" ->> 'metodo'::"text"), ("old_data" ->> 'metodo'::"text")) AS "metodo",
    COALESCE(("new_data" ->> 'referencia'::"text"), ("old_data" ->> 'referencia'::"text")) AS "referencia",
    COALESCE(("new_data" ->> 'comentario'::"text"), ("old_data" ->> 'comentario'::"text")) AS "comentario"
   FROM "audit"."log" "l"
  WHERE (("table_schema" = 'public'::"text") AND ("table_name" = 'ventas_pagos'::"text"));


ALTER VIEW "audit"."vw_ventas_pagos_log" OWNER TO "postgres";


ALTER TABLE "public"."clientes" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."clientes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."compras" (
    "id" bigint NOT NULL,
    "fecha" timestamp with time zone DEFAULT "now"() NOT NULL,
    "proveedor" "text",
    "numero_factura" "text",
    "tipo_pago" "text" DEFAULT 'CONTADO'::"text" NOT NULL,
    "fecha_vencimiento" "date",
    "comentarios" "text",
    "monto_total" numeric(12,2),
    "saldo_pendiente" numeric(12,2),
    "estado" "text" DEFAULT 'CONFIRMADA'::"text" NOT NULL,
    "proveedor_id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "compras_monto_total_check" CHECK (("monto_total" >= (0)::numeric)),
    CONSTRAINT "compras_saldo_pendiente_check" CHECK (("saldo_pendiente" >= (0)::numeric))
);

ALTER TABLE ONLY "public"."compras" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."compras" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."compras_detalle" (
    "id" bigint NOT NULL,
    "compra_id" bigint NOT NULL,
    "producto_id" bigint NOT NULL,
    "lote_id" bigint NOT NULL,
    "cantidad" integer NOT NULL,
    "precio_compra_unit" numeric(12,2) NOT NULL,
    "subtotal" numeric(12,2) GENERATED ALWAYS AS ((("cantidad")::numeric * "precio_compra_unit")) STORED,
    "image_path" "text",
    CONSTRAINT "compras_detalle_cantidad_check" CHECK (("cantidad" > 0)),
    CONSTRAINT "compras_detalle_precio_compra_unit_check" CHECK (("precio_compra_unit" >= (0)::numeric))
);

ALTER TABLE ONLY "public"."compras_detalle" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."compras_detalle" OWNER TO "postgres";


ALTER TABLE "public"."compras_detalle" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."compras_detalle_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."compras" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."compras_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."compras_pagos" (
    "id" bigint NOT NULL,
    "compra_id" bigint NOT NULL,
    "fecha" timestamp with time zone DEFAULT "now"() NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "metodo" "text",
    "referencia" "text",
    "comprobante_path" "text",
    "comentario" "text",
    "created_by" "uuid",
    CONSTRAINT "compras_pagos_monto_check" CHECK (("monto" > (0)::numeric))
);

ALTER TABLE ONLY "public"."compras_pagos" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."compras_pagos" OWNER TO "postgres";


ALTER TABLE "public"."compras_pagos" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."compras_pagos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."devoluciones" (
    "id" bigint NOT NULL,
    "venta_id" bigint NOT NULL,
    "fecha" timestamp with time zone DEFAULT "now"() NOT NULL,
    "motivo" "text",
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL
);


ALTER TABLE "public"."devoluciones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."devoluciones_detalle" (
    "id" bigint NOT NULL,
    "devolucion_id" bigint NOT NULL,
    "producto_id" bigint NOT NULL,
    "lote_id" bigint NOT NULL,
    "cantidad" integer NOT NULL,
    CONSTRAINT "devoluciones_detalle_cantidad_check" CHECK (("cantidad" > 0))
);


ALTER TABLE "public"."devoluciones_detalle" OWNER TO "postgres";


ALTER TABLE "public"."devoluciones_detalle" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."devoluciones_detalle_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."devoluciones" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."devoluciones_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."marcas" (
    "id" bigint NOT NULL,
    "nombre" "text" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."marcas" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."marcas" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."marcas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."marcas_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."marcas_id_seq" OWNED BY "public"."marcas"."id";



ALTER TABLE "public"."notif_outbox" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."notif_outbox_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."notif_stock_state" (
    "producto_id" bigint NOT NULL,
    "is_low" boolean DEFAULT false NOT NULL,
    "last_stock" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."notif_stock_state" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."notif_stock_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."producto_lotes" (
    "id" bigint NOT NULL,
    "producto_id" bigint NOT NULL,
    "lote" "text" NOT NULL,
    "fecha_exp" "date",
    "activo" boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY "public"."producto_lotes" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."producto_lotes" OWNER TO "postgres";


ALTER TABLE "public"."producto_lotes" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."producto_lotes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."producto_precio_override" (
    "producto_id" bigint NOT NULL,
    "precio_compra_override" numeric(12,2) NOT NULL,
    "motivo" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "producto_precio_override_precio_compra_override_check" CHECK (("precio_compra_override" >= (0)::numeric))
);


ALTER TABLE "public"."producto_precio_override" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."productos" (
    "id" bigint NOT NULL,
    "nombre" "text" NOT NULL,
    "requiere_receta" boolean DEFAULT false NOT NULL,
    "image_path" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "tiene_iva" boolean DEFAULT true NOT NULL,
    "marca_id" bigint
);

ALTER TABLE ONLY "public"."productos" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."productos" OWNER TO "postgres";


ALTER TABLE "public"."productos" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."productos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "role" "text" DEFAULT 'VENTAS'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "codigo" "text",
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['ADMIN'::"text", 'BODEGA'::"text", 'VENTAS'::"text", 'FACTURACION'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."proveedores" (
    "id" bigint NOT NULL,
    "nombre" "text" NOT NULL,
    "nit" "text",
    "telefono" "text",
    "direccion" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."proveedores" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."proveedores" OWNER TO "postgres";


ALTER TABLE "public"."proveedores" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."proveedores_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."stock_lotes" (
    "lote_id" bigint NOT NULL,
    "stock_total" integer DEFAULT 0 NOT NULL,
    "stock_reservado" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "stock_lotes_stock_reservado_check" CHECK (("stock_reservado" >= 0)),
    CONSTRAINT "stock_lotes_stock_total_check" CHECK (("stock_total" >= 0))
);

ALTER TABLE ONLY "public"."stock_lotes" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_lotes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timezone_names_cache" (
    "name" "text" NOT NULL
);


ALTER TABLE "public"."timezone_names_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_push_tokens" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "expo_token" "text" NOT NULL,
    "platform" "text",
    "device_id" "text",
    "enabled" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."user_push_tokens" OWNER TO "postgres";


ALTER TABLE "public"."user_push_tokens" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."user_push_tokens_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."ventas_detalle" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ventas_detalle_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE SEQUENCE IF NOT EXISTS "public"."ventas_devoluciones_detalle_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ventas_devoluciones_detalle_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ventas_devoluciones_detalle_id_seq" OWNED BY "public"."ventas_devoluciones_detalle"."id";



CREATE SEQUENCE IF NOT EXISTS "public"."ventas_devoluciones_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ventas_devoluciones_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ventas_devoluciones_id_seq" OWNED BY "public"."ventas_devoluciones"."id";



CREATE TABLE IF NOT EXISTS "public"."ventas_eventos" (
    "id" bigint NOT NULL,
    "venta_id" bigint NOT NULL,
    "tipo" "text" NOT NULL,
    "de_estado" "text",
    "a_estado" "text",
    "nota" "text",
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ventas_eventos" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."ventas_eventos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ventas_eventos_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ventas_eventos_id_seq" OWNED BY "public"."ventas_eventos"."id";



ALTER TABLE "public"."ventas_facturas" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ventas_facturas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."ventas" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ventas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE SEQUENCE IF NOT EXISTS "public"."ventas_pagos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ventas_pagos_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ventas_pagos_id_seq" OWNED BY "public"."ventas_pagos"."id";



CREATE TABLE IF NOT EXISTS "public"."ventas_pagos_reportados" (
    "id" bigint NOT NULL,
    "venta_id" bigint NOT NULL,
    "factura_id" bigint,
    "fecha_reportado" timestamp with time zone DEFAULT "now"() NOT NULL,
    "monto" numeric NOT NULL,
    "metodo" "text",
    "referencia" "text",
    "comprobante_path" "text",
    "comentario" "text",
    "estado" "text" DEFAULT 'PENDIENTE'::"text" NOT NULL,
    "revisado_por" "uuid",
    "revisado_at" timestamp with time zone,
    "nota_admin" "text",
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ventas_pagos_reportados_estado_check" CHECK (("estado" = ANY (ARRAY['PENDIENTE'::"text", 'APROBADO'::"text", 'RECHAZADO'::"text"]))),
    CONSTRAINT "ventas_pagos_reportados_monto_check" CHECK (("monto" > (0)::numeric))
);


ALTER TABLE "public"."ventas_pagos_reportados" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."ventas_pagos_reportados_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ventas_pagos_reportados_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ventas_pagos_reportados_id_seq" OWNED BY "public"."ventas_pagos_reportados"."id";



CREATE TABLE IF NOT EXISTS "public"."ventas_permisos_edicion" (
    "id" bigint NOT NULL,
    "venta_id" bigint NOT NULL,
    "tipo" "text" NOT NULL,
    "otorgado_a" "uuid" NOT NULL,
    "otorgado_por" "uuid" DEFAULT "auth"."uid"(),
    "otorgado_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expira_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    CONSTRAINT "ventas_permisos_edicion_tipo_check" CHECK (("tipo" = ANY (ARRAY['VENTA'::"text", 'PAGO'::"text"])))
);


ALTER TABLE "public"."ventas_permisos_edicion" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."ventas_permisos_edicion_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ventas_permisos_edicion_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ventas_permisos_edicion_id_seq" OWNED BY "public"."ventas_permisos_edicion"."id";



CREATE TABLE IF NOT EXISTS "public"."ventas_recetas" (
    "id" bigint NOT NULL,
    "venta_id" bigint NOT NULL,
    "path" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "uploaded_by" "uuid"
);


ALTER TABLE "public"."ventas_recetas" OWNER TO "postgres";


ALTER TABLE "public"."ventas_recetas" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ventas_recetas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE SEQUENCE IF NOT EXISTS "public"."ventas_tags_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ventas_tags_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ventas_tags_id_seq" OWNED BY "public"."ventas_tags"."id";



CREATE OR REPLACE VIEW "public"."vw_inventario_productos_base" WITH ("security_invoker"='true') AS
 WITH "ult_compra" AS (
         SELECT DISTINCT ON ("cd"."producto_id") "cd"."producto_id",
            "cd"."precio_compra_unit" AS "precio_compra"
           FROM ("public"."compras_detalle" "cd"
             JOIN "public"."compras" "c" ON (("c"."id" = "cd"."compra_id")))
          ORDER BY "cd"."producto_id", "c"."fecha" DESC NULLS LAST, "cd"."id" DESC
        ), "precio_base" AS (
         SELECT "p_1"."id" AS "producto_id",
            COALESCE("ov"."precio_compra_override", "uc"."precio_compra") AS "precio_compra_actual"
           FROM (("public"."productos" "p_1"
             LEFT JOIN "public"."producto_precio_override" "ov" ON (("ov"."producto_id" = "p_1"."id")))
             LEFT JOIN "ult_compra" "uc" ON (("uc"."producto_id" = "p_1"."id")))
        ), "agg" AS (
         SELECT "pl"."producto_id",
            ("sum"((COALESCE("sl"."stock_total", 0) - COALESCE("sl"."stock_reservado", 0))))::integer AS "stock_disponible",
            "min"("pl"."fecha_exp") FILTER (WHERE ((COALESCE("sl"."stock_total", 0) - COALESCE("sl"."stock_reservado", 0)) > 0)) AS "fecha_exp_proxima",
            ("array_agg"("pl"."lote" ORDER BY "pl"."fecha_exp"))[1] AS "lote_proximo"
           FROM ("public"."producto_lotes" "pl"
             LEFT JOIN "public"."stock_lotes" "sl" ON (("sl"."lote_id" = "pl"."id")))
          WHERE ("pl"."activo" IS DISTINCT FROM false)
          GROUP BY "pl"."producto_id"
        )
 SELECT "p"."id",
    "p"."nombre",
    "p"."marca_id",
    "m"."nombre" AS "marca_nombre",
    "p"."image_path",
    "p"."activo",
        CASE
            WHEN ("pb"."precio_compra_actual" IS NULL) THEN NULL::numeric
            ELSE (("pb"."precio_compra_actual" / 0.70))::numeric(12,2)
        END AS "precio_min_venta",
    COALESCE("a"."stock_disponible", 0) AS "stock_disponible",
    "a"."lote_proximo",
    "a"."fecha_exp_proxima"
   FROM ((("public"."productos" "p"
     LEFT JOIN "public"."marcas" "m" ON (("m"."id" = "p"."marca_id")))
     LEFT JOIN "precio_base" "pb" ON (("pb"."producto_id" = "p"."id")))
     LEFT JOIN "agg" "a" ON (("a"."producto_id" = "p"."id")));


ALTER VIEW "public"."vw_inventario_productos_base" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_inventario_productos" WITH ("security_invoker"='true') AS
 SELECT "id",
    "nombre",
    "marca_id",
    "marca_nombre",
    "image_path",
    "activo",
    "precio_min_venta",
    "stock_disponible",
    "lote_proximo",
    "fecha_exp_proxima",
    "marca_nombre" AS "marca"
   FROM "public"."vw_inventario_productos_base" "b";


ALTER VIEW "public"."vw_inventario_productos" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_inventario_productos_v2" WITH ("security_invoker"='true') AS
 SELECT "v"."id",
    "v"."nombre",
    "v"."marca_id",
    "v"."marca_nombre",
    "v"."image_path",
    "v"."activo",
    "v"."precio_min_venta",
    "v"."stock_disponible",
    "v"."lote_proximo",
    "v"."fecha_exp_proxima",
    "v"."marca",
    "p"."tiene_iva",
    "p"."requiere_receta"
   FROM ("public"."vw_inventario_productos" "v"
     JOIN "public"."productos" "p" ON (("p"."id" = "v"."id")));


ALTER VIEW "public"."vw_inventario_productos_v2" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_producto_lotes_detalle_base" WITH ("security_invoker"='true') AS
 WITH "ult_compra" AS (
         SELECT DISTINCT ON ("cd"."producto_id") "cd"."producto_id",
            "cd"."precio_compra_unit" AS "precio_compra"
           FROM ("public"."compras_detalle" "cd"
             JOIN "public"."compras" "c" ON (("c"."id" = "cd"."compra_id")))
          ORDER BY "cd"."producto_id", "c"."fecha" DESC NULLS LAST, "cd"."id" DESC
        ), "precio_base" AS (
         SELECT "p_1"."id" AS "producto_id",
            COALESCE("ov"."precio_compra_override", "uc"."precio_compra") AS "precio_compra_actual"
           FROM (("public"."productos" "p_1"
             LEFT JOIN "public"."producto_precio_override" "ov" ON (("ov"."producto_id" = "p_1"."id")))
             LEFT JOIN "ult_compra" "uc" ON (("uc"."producto_id" = "p_1"."id")))
        )
 SELECT "p"."id" AS "producto_id",
    "p"."nombre",
    "m"."nombre" AS "marca",
    "p"."image_path",
    "p"."activo",
    "p"."tiene_iva",
    "p"."requiere_receta",
    "pb"."precio_compra_actual",
        CASE
            WHEN ("pb"."precio_compra_actual" IS NULL) THEN NULL::numeric
            ELSE (("pb"."precio_compra_actual" / 0.70))::numeric(12,2)
        END AS "precio_min_venta",
    "pl"."id" AS "lote_id",
    "pl"."lote",
    "pl"."fecha_exp",
    COALESCE("sl"."stock_total", 0) AS "stock_total_lote",
    COALESCE("sl"."stock_reservado", 0) AS "stock_reservado_lote",
    (COALESCE("sl"."stock_total", 0) - COALESCE("sl"."stock_reservado", 0)) AS "stock_disponible_lote"
   FROM (((("public"."productos" "p"
     LEFT JOIN "public"."marcas" "m" ON (("m"."id" = "p"."marca_id")))
     LEFT JOIN "public"."producto_lotes" "pl" ON (("pl"."producto_id" = "p"."id")))
     LEFT JOIN "public"."stock_lotes" "sl" ON (("sl"."lote_id" = "pl"."id")))
     LEFT JOIN "precio_base" "pb" ON (("pb"."producto_id" = "p"."id")));


ALTER VIEW "public"."vw_producto_lotes_detalle_base" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_producto_lotes_detalle" WITH ("security_invoker"='true') AS
 SELECT "b"."producto_id",
    "b"."nombre",
    "b"."image_path",
    "b"."activo",
    "b"."tiene_iva",
    "b"."requiere_receta",
    "b"."precio_compra_actual",
    "b"."precio_min_venta",
    "b"."lote_id",
    "b"."lote",
    "b"."fecha_exp",
    "b"."stock_total_lote",
    "b"."stock_reservado_lote",
    "b"."stock_disponible_lote",
    "m"."nombre" AS "marca"
   FROM (("public"."vw_producto_lotes_detalle_base" "b"
     LEFT JOIN "public"."productos" "p" ON (("p"."id" = "b"."producto_id")))
     LEFT JOIN "public"."marcas" "m" ON (("m"."id" = "p"."marca_id")));


ALTER VIEW "public"."vw_producto_lotes_detalle" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_reporte_utilidad_productos" AS
 SELECT "d"."producto_id",
    "p"."nombre" AS "producto_nombre",
    "p"."marca_id",
    "m"."nombre" AS "marca_nombre",
    "sum"("d"."cantidad") AS "unidades_vendidas",
    "sum"((("d"."cantidad")::numeric * "d"."precio_venta_unit")) AS "total_ventas",
    "sum"((("d"."cantidad")::numeric * "cd"."precio_compra_unit")) AS "costo_total",
    ("sum"((("d"."cantidad")::numeric * "d"."precio_venta_unit")) - "sum"((("d"."cantidad")::numeric * "cd"."precio_compra_unit"))) AS "utilidad_bruta",
        CASE
            WHEN ("sum"((("d"."cantidad")::numeric * "d"."precio_venta_unit")) = (0)::numeric) THEN NULL::numeric
            ELSE (("sum"((("d"."cantidad")::numeric * "d"."precio_venta_unit")) - "sum"((("d"."cantidad")::numeric * "cd"."precio_compra_unit"))) / "sum"((("d"."cantidad")::numeric * "d"."precio_venta_unit")))
        END AS "margen"
   FROM (((("public"."ventas_detalle" "d"
     JOIN "public"."ventas" "v" ON (("v"."id" = "d"."venta_id")))
     JOIN "public"."compras_detalle" "cd" ON ((("cd"."lote_id" = "d"."lote_id") AND ("cd"."producto_id" = "d"."producto_id"))))
     JOIN "public"."productos" "p" ON (("p"."id" = "d"."producto_id")))
     LEFT JOIN "public"."marcas" "m" ON (("m"."id" = "p"."marca_id")))
  GROUP BY "d"."producto_id", "p"."nombre", "p"."marca_id", "m"."nombre";


ALTER VIEW "public"."vw_reporte_utilidad_productos" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_reporte_utilidad_ventas" AS
 SELECT "v"."id" AS "venta_id",
    "v"."created_at" AS "fecha_venta",
    "v"."cliente_nombre",
    "v"."vendedor_id",
    "sum"((("d"."cantidad")::numeric * "d"."precio_venta_unit")) AS "total_venta",
    "sum"((("d"."cantidad")::numeric * "cd"."precio_compra_unit")) AS "costo_total",
    ("sum"((("d"."cantidad")::numeric * "d"."precio_venta_unit")) - "sum"((("d"."cantidad")::numeric * "cd"."precio_compra_unit"))) AS "utilidad_bruta",
        CASE
            WHEN ("sum"((("d"."cantidad")::numeric * "d"."precio_venta_unit")) = (0)::numeric) THEN NULL::numeric
            ELSE (("sum"((("d"."cantidad")::numeric * "d"."precio_venta_unit")) - "sum"((("d"."cantidad")::numeric * "cd"."precio_compra_unit"))) / "sum"((("d"."cantidad")::numeric * "d"."precio_venta_unit")))
        END AS "margen"
   FROM (("public"."ventas" "v"
     JOIN "public"."ventas_detalle" "d" ON (("d"."venta_id" = "v"."id")))
     JOIN "public"."compras_detalle" "cd" ON ((("cd"."lote_id" = "d"."lote_id") AND ("cd"."producto_id" = "d"."producto_id"))))
  GROUP BY "v"."id", "v"."created_at", "v"."cliente_nombre", "v"."vendedor_id";


ALTER VIEW "public"."vw_reporte_utilidad_ventas" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_vendedores_lista" WITH ("security_invoker"='true') AS
 SELECT DISTINCT "vendedor_id",
    COALESCE("vendedor_codigo", '—'::"text") AS "vendedor_codigo"
   FROM "public"."vw_cxc_ventas"
  WHERE ("vendedor_id" IS NOT NULL)
  ORDER BY COALESCE("vendedor_codigo", '—'::"text");


ALTER VIEW "public"."vw_vendedores_lista" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_venta_devolucion_resumen" WITH ("security_invoker"='true') AS
 SELECT "v"."id" AS "venta_id",
    "v"."estado",
    COALESCE("sum"("vd"."cantidad"), (0)::bigint) AS "total_vendido",
    COALESCE(( SELECT "sum"("dd"."cantidad") AS "sum"
           FROM ("public"."ventas_devoluciones" "d"
             JOIN "public"."ventas_devoluciones_detalle" "dd" ON (("dd"."devolucion_id" = "d"."id")))
          WHERE ("d"."venta_id" = "v"."id")), (0)::bigint) AS "total_devuelto"
   FROM ("public"."ventas" "v"
     LEFT JOIN "public"."ventas_detalle" "vd" ON (("vd"."venta_id" = "v"."id")))
  GROUP BY "v"."id", "v"."estado";


ALTER VIEW "public"."vw_venta_devolucion_resumen" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_venta_razon_anulacion" WITH ("security_invoker"='true') AS
 SELECT DISTINCT ON ("venta_id") "venta_id",
    "nota" AS "solicitud_nota",
    "created_at" AS "solicitud_fecha",
    "created_by" AS "solicitud_user_id"
   FROM "public"."ventas_tags" "vt"
  WHERE ("tag" = 'SOLICITA_ANULACION'::"text")
  ORDER BY "venta_id", "created_at" DESC;


ALTER VIEW "public"."vw_venta_razon_anulacion" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_ventas_estado_efectivo" AS
 WITH "an" AS (
         SELECT DISTINCT "ventas_tags"."venta_id"
           FROM "public"."ventas_tags"
          WHERE (("ventas_tags"."removed_at" IS NULL) AND ("upper"("btrim"("ventas_tags"."tag")) = 'ANULADO'::"text"))
        ), "en" AS (
         SELECT DISTINCT "ventas_eventos"."venta_id"
           FROM "public"."ventas_eventos"
          WHERE (("upper"("btrim"("ventas_eventos"."tipo")) = 'ENTREGADO'::"text") OR ("upper"("btrim"("ventas_eventos"."a_estado")) = 'ENTREGADO'::"text"))
        )
 SELECT "v"."id",
    "v"."fecha",
    "v"."cliente_nombre",
    "v"."vendedor_id",
    "v"."estado",
    "v"."comentarios",
    "v"."requiere_receta",
    "v"."receta_cargada",
    "v"."factura_1_cargada",
    "v"."factura_2_cargada",
    "v"."cancel_reason",
    "v"."canceled_at",
    "v"."anulado_at",
    "v"."refactura_de_id",
    "v"."refacturada_por_id",
    "v"."cliente_id",
    "v"."vendedor_codigo",
    "v"."created_at",
        CASE
            WHEN ("an"."venta_id" IS NOT NULL) THEN 'ANULADA'::"text"
            WHEN ("en"."venta_id" IS NOT NULL) THEN 'ENTREGADO'::"text"
            ELSE COALESCE(NULLIF("upper"("btrim"("v"."estado")), ''::"text"), 'NUEVO'::"text")
        END AS "estado_efectivo",
    ("an"."venta_id" IS NOT NULL) AS "tiene_tag_anulado",
    ("en"."venta_id" IS NOT NULL) AS "tiene_evento_entregado"
   FROM (("public"."ventas" "v"
     LEFT JOIN "an" ON (("an"."venta_id" = "v"."id")))
     LEFT JOIN "en" ON (("en"."venta_id" = "v"."id")));


ALTER VIEW "public"."vw_ventas_estado_efectivo" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_ventas_facturacion_pendientes" WITH ("security_invoker"='true') AS
 SELECT DISTINCT ON ("v"."id") "v"."id" AS "venta_id",
    "v"."fecha",
    "v"."estado",
    "v"."cliente_id",
    "v"."cliente_nombre",
    "v"."vendedor_id",
    "v"."comentarios",
    "t"."tag" AS "accion_tag",
    "t"."nota" AS "accion_nota",
    "t"."created_at" AS "accion_at"
   FROM ("public"."ventas" "v"
     JOIN "public"."ventas_tags" "t" ON ((("t"."venta_id" = "v"."id") AND ("t"."removed_at" IS NULL) AND ("t"."tag" = ANY (ARRAY['ANULACION_REQUERIDA'::"text", 'REFACTURACION_REQUERIDA'::"text", 'EDICION_REQUERIDA'::"text"])))))
  WHERE ((NOT (EXISTS ( SELECT 1
           FROM "public"."ventas_tags" "x"
          WHERE (("x"."venta_id" = "v"."id") AND ("x"."removed_at" IS NULL) AND ("x"."tag" = ANY (ARRAY['ANULADO'::"text", 'REFACTURADO'::"text"])))))) AND (("t"."tag" <> 'EDICION_REQUERIDA'::"text") OR ("v"."estado" = 'NUEVO'::"text")))
  ORDER BY "v"."id", "t"."created_at" DESC;


ALTER VIEW "public"."vw_ventas_facturacion_pendientes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_ventas_pagos_log" AS
 SELECT "l"."registrado",
    "l"."accion" AS "action",
    "p"."full_name" AS "actor_nombre",
    "v"."cliente_nombre",
    "l"."monto",
    "l"."metodo",
    "l"."referencia",
    "l"."comentario",
    "f"."numero_factura" AS "factura_numero"
   FROM ((("audit"."vw_ventas_pagos_log" "l"
     LEFT JOIN "public"."profiles" "p" ON (("p"."id" = "l"."actor_uid")))
     LEFT JOIN "public"."ventas_facturas" "f" ON (("f"."id" = "l"."factura_id")))
     LEFT JOIN "public"."ventas" "v" ON (("v"."id" = "l"."venta_id")));


ALTER VIEW "public"."vw_ventas_pagos_log" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_ventas_solicitudes_pendientes_admin" WITH ("security_invoker"='true') AS
 SELECT DISTINCT ON ("v"."id") "v"."id" AS "venta_id",
    "v"."fecha",
    "v"."estado",
    "v"."cliente_id",
    "v"."cliente_nombre",
    "v"."vendedor_id",
    "s"."tag" AS "solicitud_tag",
        CASE
            WHEN ("s"."tag" = 'SOLICITA_ANULACION'::"text") THEN 'ANULACION'::"text"
            WHEN ("s"."tag" = 'SOLICITA_REFACTURACION'::"text") THEN 'REFACTURACION'::"text"
            WHEN ("s"."tag" = 'SOLICITA_EDICION'::"text") THEN 'EDICION'::"text"
            ELSE NULL::"text"
        END AS "solicitud_accion",
    "s"."nota" AS "solicitud_nota",
    "s"."created_at" AS "solicitud_at",
    "s"."created_by" AS "solicitud_by"
   FROM (("public"."ventas" "v"
     JOIN "public"."ventas_tags" "p" ON ((("p"."venta_id" = "v"."id") AND ("p"."removed_at" IS NULL) AND ("p"."tag" = 'PEND_AUTORIZACION_ADMIN'::"text"))))
     JOIN "public"."ventas_tags" "s" ON ((("s"."venta_id" = "v"."id") AND ("s"."removed_at" IS NULL) AND ("s"."tag" = ANY (ARRAY['SOLICITA_ANULACION'::"text", 'SOLICITA_REFACTURACION'::"text", 'SOLICITA_EDICION'::"text"])))))
  WHERE (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('VENTAS'::"text")) AND (NOT (EXISTS ( SELECT 1
           FROM "public"."ventas_tags" "x"
          WHERE (("x"."venta_id" = "v"."id") AND ("x"."removed_at" IS NULL) AND ("x"."tag" = ANY (ARRAY['ANULADO'::"text", 'REFACTURADO'::"text"])))))))
  ORDER BY "v"."id", "s"."created_at" DESC;


ALTER VIEW "public"."vw_ventas_solicitudes_pendientes_admin" OWNER TO "postgres";


ALTER TABLE ONLY "audit"."log" ALTER COLUMN "id" SET DEFAULT "nextval"('"audit"."log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."marcas" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."marcas_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ventas_devoluciones" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ventas_devoluciones_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ventas_devoluciones_detalle" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ventas_devoluciones_detalle_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ventas_eventos" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ventas_eventos_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ventas_pagos" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ventas_pagos_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ventas_pagos_reportados" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ventas_pagos_reportados_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ventas_permisos_edicion" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ventas_permisos_edicion_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ventas_tags" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ventas_tags_id_seq"'::"regclass");



ALTER TABLE ONLY "audit"."log"
    ADD CONSTRAINT "log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compras_detalle"
    ADD CONSTRAINT "compras_detalle_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compras_pagos"
    ADD CONSTRAINT "compras_pagos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compras"
    ADD CONSTRAINT "compras_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."devoluciones_detalle"
    ADD CONSTRAINT "devoluciones_detalle_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."devoluciones"
    ADD CONSTRAINT "devoluciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."marcas"
    ADD CONSTRAINT "marcas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notif_outbox"
    ADD CONSTRAINT "notif_outbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notif_stock_state"
    ADD CONSTRAINT "notif_stock_state_pkey" PRIMARY KEY ("producto_id");



ALTER TABLE ONLY "public"."producto_lotes"
    ADD CONSTRAINT "producto_lotes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."producto_lotes"
    ADD CONSTRAINT "producto_lotes_producto_id_lote_key" UNIQUE ("producto_id", "lote");



ALTER TABLE ONLY "public"."producto_lotes"
    ADD CONSTRAINT "producto_lotes_unique_producto_lote_fecha" UNIQUE ("producto_id", "lote", "fecha_exp");



ALTER TABLE ONLY "public"."producto_precio_override"
    ADD CONSTRAINT "producto_precio_override_pkey" PRIMARY KEY ("producto_id");



ALTER TABLE ONLY "public"."productos"
    ADD CONSTRAINT "productos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proveedores"
    ADD CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_lotes"
    ADD CONSTRAINT "stock_lotes_lote_id_key" UNIQUE ("lote_id");



ALTER TABLE ONLY "public"."stock_lotes"
    ADD CONSTRAINT "stock_lotes_pkey" PRIMARY KEY ("lote_id");



ALTER TABLE ONLY "public"."timezone_names_cache"
    ADD CONSTRAINT "timezone_names_cache_pkey" PRIMARY KEY ("name");



ALTER TABLE ONLY "public"."user_push_tokens"
    ADD CONSTRAINT "user_push_tokens_device_id_key" UNIQUE ("device_id");



ALTER TABLE ONLY "public"."user_push_tokens"
    ADD CONSTRAINT "user_push_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ventas_detalle"
    ADD CONSTRAINT "ventas_detalle_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ventas_devoluciones_detalle"
    ADD CONSTRAINT "ventas_devoluciones_detalle_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ventas_devoluciones"
    ADD CONSTRAINT "ventas_devoluciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ventas_eventos"
    ADD CONSTRAINT "ventas_eventos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ventas_facturas"
    ADD CONSTRAINT "ventas_facturas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ventas_facturas"
    ADD CONSTRAINT "ventas_facturas_venta_id_tipo_key" UNIQUE ("venta_id", "tipo");



ALTER TABLE ONLY "public"."ventas_pagos"
    ADD CONSTRAINT "ventas_pagos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ventas_pagos_reportados"
    ADD CONSTRAINT "ventas_pagos_reportados_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ventas_permisos_edicion"
    ADD CONSTRAINT "ventas_permisos_edicion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ventas_recetas"
    ADD CONSTRAINT "ventas_recetas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ventas_tags"
    ADD CONSTRAINT "ventas_tags_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_clientes_nombre" ON "public"."clientes" USING "btree" ("nombre");



CREATE INDEX "idx_clientes_vendedor_id" ON "public"."clientes" USING "btree" ("vendedor_id");



CREATE INDEX "idx_compras_detalle_compra" ON "public"."compras_detalle" USING "btree" ("compra_id");



CREATE INDEX "idx_compras_detalle_lote" ON "public"."compras_detalle" USING "btree" ("lote_id");



CREATE INDEX "idx_compras_detalle_lote_producto" ON "public"."compras_detalle" USING "btree" ("lote_id", "producto_id");



CREATE INDEX "idx_compras_detalle_producto" ON "public"."compras_detalle" USING "btree" ("producto_id");



CREATE INDEX "idx_compras_fecha" ON "public"."compras" USING "btree" ("fecha");



CREATE INDEX "idx_compras_pagos_compra" ON "public"."compras_pagos" USING "btree" ("compra_id");



CREATE INDEX "idx_compras_pagos_fecha" ON "public"."compras_pagos" USING "btree" ("fecha");



CREATE INDEX "idx_compras_proveedor_id" ON "public"."compras" USING "btree" ("proveedor_id");



CREATE INDEX "idx_compras_tipo_pago" ON "public"."compras" USING "btree" ("tipo_pago");



CREATE INDEX "idx_dev_det_devolucion" ON "public"."devoluciones_detalle" USING "btree" ("devolucion_id");



CREATE INDEX "idx_dev_det_lote" ON "public"."devoluciones_detalle" USING "btree" ("lote_id");



CREATE INDEX "idx_devoluciones_det_producto" ON "public"."devoluciones_detalle" USING "btree" ("producto_id");



CREATE INDEX "idx_devoluciones_fecha" ON "public"."devoluciones" USING "btree" ("fecha");



CREATE INDEX "idx_devoluciones_venta" ON "public"."devoluciones" USING "btree" ("venta_id");



CREATE INDEX "idx_lotes_fecha_exp" ON "public"."producto_lotes" USING "btree" ("fecha_exp");



CREATE INDEX "idx_lotes_producto" ON "public"."producto_lotes" USING "btree" ("producto_id");



CREATE INDEX "idx_marcas_nombre" ON "public"."marcas" USING "btree" ("nombre");



CREATE INDEX "idx_marcas_nombre_trgm" ON "public"."marcas" USING "gin" ("nombre" "extensions"."gin_trgm_ops");



CREATE INDEX "idx_marcas_nombre_trgm_inv" ON "public"."marcas" USING "gin" ("nombre" "extensions"."gin_trgm_ops");



CREATE INDEX "idx_producto_precio_override_updated_at" ON "public"."producto_precio_override" USING "btree" ("updated_at");



CREATE INDEX "idx_productos_marca_id" ON "public"."productos" USING "btree" ("marca_id");



CREATE INDEX "idx_productos_nombre" ON "public"."productos" USING "btree" ("nombre");



CREATE INDEX "idx_productos_nombre_trgm" ON "public"."productos" USING "gin" ("nombre" "extensions"."gin_trgm_ops");



CREATE INDEX "idx_proveedores_nombre" ON "public"."proveedores" USING "btree" ("nombre");



CREATE INDEX "idx_ventas_cliente_id" ON "public"."ventas" USING "btree" ("cliente_id");



CREATE INDEX "idx_ventas_created_at" ON "public"."ventas" USING "btree" ("created_at");



CREATE INDEX "idx_ventas_detalle_lote" ON "public"."ventas_detalle" USING "btree" ("lote_id");



CREATE INDEX "idx_ventas_detalle_lote_producto" ON "public"."ventas_detalle" USING "btree" ("lote_id", "producto_id");



CREATE INDEX "idx_ventas_detalle_producto" ON "public"."ventas_detalle" USING "btree" ("producto_id");



CREATE INDEX "idx_ventas_detalle_venta" ON "public"."ventas_detalle" USING "btree" ("venta_id");



CREATE INDEX "idx_ventas_detalle_venta_id" ON "public"."ventas_detalle" USING "btree" ("venta_id");



CREATE INDEX "idx_ventas_devol_det_devolucion_id" ON "public"."ventas_devoluciones_detalle" USING "btree" ("devolucion_id");



CREATE INDEX "idx_ventas_devol_det_lox" ON "public"."ventas_devoluciones_detalle" USING "btree" ("lote_id");



CREATE INDEX "idx_ventas_estado" ON "public"."ventas" USING "btree" ("estado");



CREATE INDEX "idx_ventas_estado_fecha" ON "public"."ventas" USING "btree" ("estado", "fecha");



CREATE INDEX "idx_ventas_fecha" ON "public"."ventas" USING "btree" ("fecha");



CREATE INDEX "idx_ventas_pagos_venta_fecha_id" ON "public"."ventas_pagos" USING "btree" ("venta_id", "fecha", "id");



CREATE INDEX "idx_ventas_pagos_venta_id" ON "public"."ventas_pagos" USING "btree" ("venta_id");



CREATE INDEX "idx_ventas_perm_edicion_lookup" ON "public"."ventas_permisos_edicion" USING "btree" ("venta_id", "tipo", "otorgado_a", "expira_at", "used_at");



CREATE INDEX "idx_ventas_refactura_de_id" ON "public"."ventas" USING "btree" ("refactura_de_id");



CREATE INDEX "idx_ventas_refacturada_por_id" ON "public"."ventas" USING "btree" ("refacturada_por_id");



CREATE INDEX "idx_ventas_tags_tag" ON "public"."ventas_tags" USING "btree" ("tag");



CREATE INDEX "idx_ventas_vendedor" ON "public"."ventas" USING "btree" ("vendedor_id");



CREATE INDEX "idx_ventas_vendedor_id" ON "public"."ventas" USING "btree" ("vendedor_id");



CREATE UNIQUE INDEX "marcas_nombre_ci_ux" ON "public"."marcas" USING "btree" ("lower"(TRIM(BOTH FROM "nombre")));



CREATE UNIQUE INDEX "notif_outbox_unique_compra_linea" ON "public"."notif_outbox" USING "btree" ("type", "venta_id", ((("payload" ->> 'compra_detalle_id'::"text"))::bigint)) WHERE ("type" = 'COMPRA_LINEA_INGRESADA'::"text");



CREATE UNIQUE INDEX "notif_outbox_unique_ventas" ON "public"."notif_outbox" USING "btree" ("type", "venta_id") WHERE ("type" ~~ 'VENTA_%'::"text");



CREATE INDEX "notif_stock_state_updated_at_idx" ON "public"."notif_stock_state" USING "btree" ("updated_at");



CREATE UNIQUE INDEX "profiles_codigo_uniq" ON "public"."profiles" USING "btree" ("codigo") WHERE (("codigo" IS NOT NULL) AND ("codigo" <> ''::"text"));



CREATE UNIQUE INDEX "proveedores_nit_unique" ON "public"."proveedores" USING "btree" ("nit") WHERE ("nit" IS NOT NULL);



CREATE UNIQUE INDEX "user_push_tokens_one_active_per_device" ON "public"."user_push_tokens" USING "btree" ("user_id", "device_id") WHERE (("enabled" IS TRUE) AND ("device_id" IS NOT NULL));



CREATE UNIQUE INDEX "user_push_tokens_one_enabled_per_token" ON "public"."user_push_tokens" USING "btree" ("expo_token") WHERE ("enabled" = true);



CREATE UNIQUE INDEX "user_push_tokens_user_device_uniq" ON "public"."user_push_tokens" USING "btree" ("user_id", "device_id");



CREATE INDEX "user_push_tokens_user_id_idx" ON "public"."user_push_tokens" USING "btree" ("user_id");



CREATE UNIQUE INDEX "ux_clientes_nit" ON "public"."clientes" USING "btree" ("regexp_replace"("upper"(TRIM(BOTH FROM "nit")), '[^0-9A-Z]'::"text", ''::"text", 'g'::"text")) WHERE (("nit" IS NOT NULL) AND ("regexp_replace"("upper"(TRIM(BOTH FROM "nit")), '[^0-9A-Z]'::"text", ''::"text", 'g'::"text") <> ALL (ARRAY['CF'::"text", 'CONSUMIDORFINAL'::"text"])));



CREATE UNIQUE INDEX "ux_compra_lote_unico" ON "public"."compras_detalle" USING "btree" ("compra_id", "lote_id");



CREATE UNIQUE INDEX "ux_compras_proveedor_factura" ON "public"."compras" USING "btree" ("proveedor", "numero_factura");



CREATE UNIQUE INDEX "ux_outbox_compra_linea_dedupe" ON "public"."notif_outbox" USING "btree" ("type", (("payload" ->> 'compra_detalle_id'::"text"))) WHERE ("type" = 'COMPRA_LINEA_INGRESADA'::"text");



CREATE UNIQUE INDEX "ux_proveedores_nit" ON "public"."proveedores" USING "btree" ("nit") WHERE ("nit" IS NOT NULL);



CREATE UNIQUE INDEX "ux_venta_lote_unico" ON "public"."ventas_detalle" USING "btree" ("venta_id", "lote_id");



CREATE INDEX "ventas_devoluciones_venta_id_idx" ON "public"."ventas_devoluciones" USING "btree" ("venta_id", "creado_en" DESC);



CREATE INDEX "ventas_eventos_venta_id_idx" ON "public"."ventas_eventos" USING "btree" ("venta_id", "creado_en" DESC);



CREATE INDEX "ventas_fecha_idx" ON "public"."ventas" USING "btree" ("fecha" DESC);



CREATE INDEX "ventas_pagos_factura_id_idx" ON "public"."ventas_pagos" USING "btree" ("factura_id");



CREATE INDEX "ventas_pagos_reportados_created_by_idx" ON "public"."ventas_pagos_reportados" USING "btree" ("created_by");



CREATE INDEX "ventas_pagos_reportados_estado_idx" ON "public"."ventas_pagos_reportados" USING "btree" ("estado");



CREATE INDEX "ventas_pagos_reportados_factura_idx" ON "public"."ventas_pagos_reportados" USING "btree" ("factura_id");



CREATE INDEX "ventas_pagos_reportados_venta_idx" ON "public"."ventas_pagos_reportados" USING "btree" ("venta_id");



CREATE INDEX "ventas_recetas_venta_id_idx" ON "public"."ventas_recetas" USING "btree" ("venta_id");



CREATE INDEX "ventas_tags_anulado_created_partial_idx" ON "public"."ventas_tags" USING "btree" ("created_at" DESC) INCLUDE ("venta_id") WHERE (("tag" = 'ANULADO'::"text") AND ("removed_at" IS NULL));



CREATE INDEX "ventas_tags_removed_at_idx" ON "public"."ventas_tags" USING "btree" ("removed_at");



CREATE INDEX "ventas_tags_tag_activa_idx" ON "public"."ventas_tags" USING "btree" ("tag") WHERE ("removed_at" IS NULL);



CREATE UNIQUE INDEX "ventas_tags_uniq_activa" ON "public"."ventas_tags" USING "btree" ("venta_id", "tag") WHERE ("removed_at" IS NULL);



CREATE INDEX "ventas_tags_venta_id_idx" ON "public"."ventas_tags" USING "btree" ("venta_id");



CREATE OR REPLACE TRIGGER "compras_detalle_enqueue_linea_ingresada" AFTER INSERT ON "public"."compras_detalle" FOR EACH ROW EXECUTE FUNCTION "public"."trg_enqueue_compra_linea_ingresada"();



CREATE OR REPLACE TRIGGER "compras_detalle_set_producto_image" AFTER INSERT OR UPDATE OF "image_path" ON "public"."compras_detalle" FOR EACH ROW EXECUTE FUNCTION "public"."trg_set_producto_image_from_latest_compra"();



CREATE OR REPLACE TRIGGER "stock_lotes_check_low_20_ins" AFTER INSERT ON "public"."stock_lotes" FOR EACH ROW EXECUTE FUNCTION "public"."trg_stock_lotes_check_low_20"();



CREATE OR REPLACE TRIGGER "stock_lotes_check_low_20_upd" AFTER UPDATE OF "stock_total", "stock_reservado" ON "public"."stock_lotes" FOR EACH ROW EXECUTE FUNCTION "public"."trg_stock_lotes_check_low_20"();



CREATE OR REPLACE TRIGGER "tr_audit_ventas_pagos" AFTER INSERT OR DELETE ON "public"."ventas_pagos" FOR EACH ROW EXECUTE FUNCTION "audit"."tg_row_change_simple"();



CREATE OR REPLACE TRIGGER "tr_ventas_facturas_sanitize" BEFORE INSERT OR UPDATE OF "venta_id", "monto_total", "fecha_vencimiento" ON "public"."ventas_facturas" FOR EACH ROW EXECUTE FUNCTION "public"."tg_ventas_facturas_sanitize"();



CREATE OR REPLACE TRIGGER "trg_block_cancel_sale_if_paid" BEFORE UPDATE ON "public"."ventas" FOR EACH ROW EXECUTE FUNCTION "public"."tg_block_cancel_sale_if_paid"();



CREATE OR REPLACE TRIGGER "trg_compras_detalle_recalc_total" AFTER INSERT OR DELETE OR UPDATE ON "public"."compras_detalle" FOR EACH ROW EXECUTE FUNCTION "public"."trg_recalc_total_compra"();



CREATE OR REPLACE TRIGGER "trg_compras_pagos_recalc" AFTER INSERT OR DELETE OR UPDATE ON "public"."compras_pagos" FOR EACH ROW EXECUTE FUNCTION "public"."trg_recalc_saldo_compra"();



CREATE OR REPLACE TRIGGER "trg_enforce_cliente_vendedor_admin_only" BEFORE INSERT OR UPDATE ON "public"."clientes" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_cliente_vendedor_admin_only"();



CREATE OR REPLACE TRIGGER "trg_enforce_numero_factura" BEFORE INSERT OR UPDATE ON "public"."ventas_facturas" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_numero_factura"();



CREATE OR REPLACE TRIGGER "trg_inc_stock_por_compra" AFTER INSERT ON "public"."compras_detalle" FOR EACH ROW EXECUTE FUNCTION "public"."inc_stock_por_compra"();



CREATE OR REPLACE TRIGGER "trg_inc_stock_por_devolucion" AFTER INSERT ON "public"."devoluciones_detalle" FOR EACH ROW EXECUTE FUNCTION "public"."inc_stock_por_devolucion"();



CREATE OR REPLACE TRIGGER "trg_no_update_created_at_compras" BEFORE UPDATE ON "public"."compras" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_created_at_update"();



CREATE OR REPLACE TRIGGER "trg_no_update_created_at_ventas" BEFORE UPDATE ON "public"."ventas" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_created_at_update"();



CREATE OR REPLACE TRIGGER "trg_set_cliente_vendedor_id_default" BEFORE INSERT ON "public"."clientes" FOR EACH ROW EXECUTE FUNCTION "public"."set_cliente_vendedor_id_default"();



CREATE OR REPLACE TRIGGER "trg_sync_ventas_factura_flags" AFTER INSERT OR DELETE OR UPDATE ON "public"."ventas_facturas" FOR EACH ROW EXECUTE FUNCTION "public"."sync_ventas_factura_flags"();



CREATE OR REPLACE TRIGGER "trg_user_push_tokens_updated_at" BEFORE UPDATE ON "public"."user_push_tokens" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_validate_compra_credito" BEFORE INSERT OR UPDATE ON "public"."compras" FOR EACH ROW EXECUTE FUNCTION "public"."validate_compra_credito"();



CREATE OR REPLACE TRIGGER "trg_validate_compra_lote_producto" BEFORE INSERT OR UPDATE ON "public"."compras_detalle" FOR EACH ROW EXECUTE FUNCTION "public"."validate_compra_lote_producto"();



CREATE OR REPLACE TRIGGER "trg_validate_devolucion_lote_producto" BEFORE INSERT OR UPDATE ON "public"."devoluciones_detalle" FOR EACH ROW EXECUTE FUNCTION "public"."validate_devolucion_lote_producto"();



CREATE OR REPLACE TRIGGER "trg_validate_pago_no_exceda_saldo" BEFORE INSERT OR UPDATE ON "public"."compras_pagos" FOR EACH ROW EXECUTE FUNCTION "public"."validate_pago_no_exceda_saldo"();



CREATE OR REPLACE TRIGGER "trg_validate_venta_lote_producto" BEFORE INSERT OR UPDATE ON "public"."ventas_detalle" FOR EACH ROW EXECUTE FUNCTION "public"."validate_venta_lote_producto"();



CREATE OR REPLACE TRIGGER "ventas_enqueue_facturada_upd" AFTER UPDATE OF "estado" ON "public"."ventas" FOR EACH ROW EXECUTE FUNCTION "public"."trg_enqueue_venta_facturada"();



CREATE OR REPLACE TRIGGER "ventas_enqueue_nuevos_ins" AFTER INSERT ON "public"."ventas" FOR EACH ROW EXECUTE FUNCTION "public"."trg_enqueue_venta_nuevos"();



CREATE OR REPLACE TRIGGER "ventas_enqueue_nuevos_upd" AFTER UPDATE OF "estado" ON "public"."ventas" FOR EACH ROW EXECUTE FUNCTION "public"."trg_enqueue_venta_nuevos"();



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "public"."profiles"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."compras_detalle"
    ADD CONSTRAINT "compras_detalle_compra_id_fkey" FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."compras_detalle"
    ADD CONSTRAINT "compras_detalle_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "public"."producto_lotes"("id");



ALTER TABLE ONLY "public"."compras_detalle"
    ADD CONSTRAINT "compras_detalle_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id");



ALTER TABLE ONLY "public"."compras_pagos"
    ADD CONSTRAINT "compras_pagos_compra_id_fkey" FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."compras"
    ADD CONSTRAINT "compras_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id");



ALTER TABLE ONLY "public"."devoluciones_detalle"
    ADD CONSTRAINT "devoluciones_detalle_devolucion_id_fkey" FOREIGN KEY ("devolucion_id") REFERENCES "public"."devoluciones"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."devoluciones_detalle"
    ADD CONSTRAINT "devoluciones_detalle_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "public"."producto_lotes"("id");



ALTER TABLE ONLY "public"."devoluciones_detalle"
    ADD CONSTRAINT "devoluciones_detalle_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id");



ALTER TABLE ONLY "public"."devoluciones"
    ADD CONSTRAINT "devoluciones_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."notif_stock_state"
    ADD CONSTRAINT "notif_stock_state_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_lotes"
    ADD CONSTRAINT "producto_lotes_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_precio_override"
    ADD CONSTRAINT "producto_precio_override_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."productos"
    ADD CONSTRAINT "productos_marca_id_fkey" FOREIGN KEY ("marca_id") REFERENCES "public"."marcas"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_lotes"
    ADD CONSTRAINT "stock_lotes_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "public"."producto_lotes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id");



ALTER TABLE ONLY "public"."ventas_detalle"
    ADD CONSTRAINT "ventas_detalle_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "public"."producto_lotes"("id");



ALTER TABLE ONLY "public"."ventas_detalle"
    ADD CONSTRAINT "ventas_detalle_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id");



ALTER TABLE ONLY "public"."ventas_detalle"
    ADD CONSTRAINT "ventas_detalle_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ventas_devoluciones_detalle"
    ADD CONSTRAINT "ventas_devoluciones_detalle_devolucion_id_fkey" FOREIGN KEY ("devolucion_id") REFERENCES "public"."ventas_devoluciones"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ventas_devoluciones_detalle"
    ADD CONSTRAINT "ventas_devoluciones_detalle_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "public"."producto_lotes"("id");



ALTER TABLE ONLY "public"."ventas_devoluciones"
    ADD CONSTRAINT "ventas_devoluciones_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ventas_eventos"
    ADD CONSTRAINT "ventas_eventos_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ventas_facturas"
    ADD CONSTRAINT "ventas_facturas_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ventas_pagos"
    ADD CONSTRAINT "ventas_pagos_factura_fk" FOREIGN KEY ("factura_id") REFERENCES "public"."ventas_facturas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ventas_pagos_reportados"
    ADD CONSTRAINT "ventas_pagos_reportados_factura_id_fkey" FOREIGN KEY ("factura_id") REFERENCES "public"."ventas_facturas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ventas_pagos_reportados"
    ADD CONSTRAINT "ventas_pagos_reportados_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ventas_pagos"
    ADD CONSTRAINT "ventas_pagos_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ventas_permisos_edicion"
    ADD CONSTRAINT "ventas_permisos_edicion_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ventas_recetas"
    ADD CONSTRAINT "ventas_recetas_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_refactura_de_id_fkey" FOREIGN KEY ("refactura_de_id") REFERENCES "public"."ventas"("id");



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_refacturada_por_id_fkey" FOREIGN KEY ("refacturada_por_id") REFERENCES "public"."ventas"("id");



ALTER TABLE ONLY "public"."ventas_tags"
    ADD CONSTRAINT "ventas_tags_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE CASCADE;



CREATE POLICY "audit_log_select_admin" ON "audit"."log" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



ALTER TABLE "audit"."log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clientes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clientes_delete_admin" ON "public"."clientes" FOR DELETE TO "authenticated" USING (("public"."current_role"() = 'ADMIN'::"text"));



CREATE POLICY "clientes_insert_admin_or_vendedor" ON "public"."clientes" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_role"('ADMIN'::"text") OR ("public"."has_role"('VENTAS'::"text") AND ("vendedor_id" = "auth"."uid"()))));



CREATE POLICY "clientes_select_admin_bodega" ON "public"."clientes" FOR SELECT TO "authenticated" USING (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text")));



CREATE POLICY "clientes_select_vendedor_own" ON "public"."clientes" FOR SELECT TO "authenticated" USING (("public"."has_role"('VENTAS'::"text") AND ("vendedor_id" = "auth"."uid"())));



CREATE POLICY "clientes_update_admin" ON "public"."clientes" FOR UPDATE TO "authenticated" USING ("public"."has_role"('ADMIN'::"text")) WITH CHECK ("public"."has_role"('ADMIN'::"text"));



CREATE POLICY "clientes_update_vendedor_own" ON "public"."clientes" FOR UPDATE TO "authenticated" USING (("public"."has_role"('VENTAS'::"text") AND ("vendedor_id" = "auth"."uid"()))) WITH CHECK (("public"."has_role"('VENTAS'::"text") AND ("vendedor_id" = "auth"."uid"())));



ALTER TABLE "public"."compras" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "compras_delete_admin" ON "public"."compras" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



ALTER TABLE "public"."compras_detalle" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "compras_detalle_delete_admin" ON "public"."compras_detalle" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



CREATE POLICY "compras_detalle_insert_admin" ON "public"."compras_detalle" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



CREATE POLICY "compras_detalle_select_auth" ON "public"."compras_detalle" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "compras_detalle_update_admin" ON "public"."compras_detalle" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



CREATE POLICY "compras_insert_admin" ON "public"."compras" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



ALTER TABLE "public"."compras_pagos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "compras_pagos_delete_admin" ON "public"."compras_pagos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



CREATE POLICY "compras_pagos_insert_admin" ON "public"."compras_pagos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



CREATE POLICY "compras_pagos_select_admin" ON "public"."compras_pagos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



CREATE POLICY "compras_pagos_update_admin" ON "public"."compras_pagos" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



CREATE POLICY "compras_select_auth" ON "public"."compras" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "compras_update_admin" ON "public"."compras" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



ALTER TABLE "public"."devoluciones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "devoluciones_delete_admin_fact" ON "public"."devoluciones" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['ADMIN'::"text", 'FACTURACION'::"text"]))))));



ALTER TABLE "public"."devoluciones_detalle" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "devoluciones_detalle_delete_admin_fact" ON "public"."devoluciones_detalle" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['ADMIN'::"text", 'FACTURACION'::"text"]))))));



CREATE POLICY "devoluciones_detalle_insert_admin_fact" ON "public"."devoluciones_detalle" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['ADMIN'::"text", 'FACTURACION'::"text"]))))));



CREATE POLICY "devoluciones_detalle_select_admin_fact" ON "public"."devoluciones_detalle" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['ADMIN'::"text", 'FACTURACION'::"text"]))))));



CREATE POLICY "devoluciones_detalle_update_admin_fact" ON "public"."devoluciones_detalle" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['ADMIN'::"text", 'FACTURACION'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['ADMIN'::"text", 'FACTURACION'::"text"]))))));



CREATE POLICY "devoluciones_insert_admin_fact" ON "public"."devoluciones" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['ADMIN'::"text", 'FACTURACION'::"text"]))))));



CREATE POLICY "devoluciones_select_admin_fact" ON "public"."devoluciones" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['ADMIN'::"text", 'FACTURACION'::"text"]))))));



CREATE POLICY "devoluciones_update_admin_fact" ON "public"."devoluciones" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['ADMIN'::"text", 'FACTURACION'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['ADMIN'::"text", 'FACTURACION'::"text"]))))));



ALTER TABLE "public"."marcas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "marcas_delete_admin" ON "public"."marcas" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



CREATE POLICY "marcas_insert_admin" ON "public"."marcas" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



CREATE POLICY "marcas_select_auth" ON "public"."marcas" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "marcas_update_admin" ON "public"."marcas" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



ALTER TABLE "public"."notif_outbox" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notif_stock_state" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ppo_delete_admin" ON "public"."producto_precio_override" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("upper"("p"."role") = 'ADMIN'::"text")))));



CREATE POLICY "ppo_insert_admin" ON "public"."producto_precio_override" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("upper"("p"."role") = 'ADMIN'::"text")))));



CREATE POLICY "ppo_select_admin" ON "public"."producto_precio_override" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("upper"("p"."role") = 'ADMIN'::"text")))));



CREATE POLICY "ppo_update_admin" ON "public"."producto_precio_override" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("upper"("p"."role") = 'ADMIN'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("upper"("p"."role") = 'ADMIN'::"text")))));



ALTER TABLE "public"."producto_lotes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "producto_lotes_delete_admin" ON "public"."producto_lotes" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



CREATE POLICY "producto_lotes_insert_admin" ON "public"."producto_lotes" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



CREATE POLICY "producto_lotes_select_auth" ON "public"."producto_lotes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "producto_lotes_update_admin" ON "public"."producto_lotes" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



ALTER TABLE "public"."producto_precio_override" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."productos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "productos_delete_admin" ON "public"."productos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



CREATE POLICY "productos_insert_admin" ON "public"."productos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



CREATE POLICY "productos_select_auth" ON "public"."productos" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "productos_update_admin" ON "public"."productos" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_insert_auth_admin" ON "public"."profiles" FOR INSERT TO "supabase_auth_admin" WITH CHECK (true);



CREATE POLICY "profiles_insert_own" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "profiles_insert_service_role" ON "public"."profiles" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "profiles_select_admin_all" ON "public"."profiles" FOR SELECT TO "authenticated" USING ("public"."has_role"('ADMIN'::"text"));



CREATE POLICY "profiles_select_bodega_all" ON "public"."profiles" FOR SELECT TO "authenticated" USING ("public"."has_role"('BODEGA'::"text"));



CREATE POLICY "profiles_select_facturacion_sellers" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("public"."has_role"('FACTURACION'::"text") AND ("role" = ANY (ARRAY['ADMIN'::"text", 'VENTAS'::"text"]))));



CREATE POLICY "profiles_select_own" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



ALTER TABLE "public"."proveedores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "proveedores_delete_admin" ON "public"."proveedores" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



CREATE POLICY "proveedores_insert_admin" ON "public"."proveedores" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



CREATE POLICY "proveedores_select_auth" ON "public"."proveedores" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "proveedores_update_admin" ON "public"."proveedores" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



ALTER TABLE "public"."stock_lotes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stock_lotes_delete_admin" ON "public"."stock_lotes" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



CREATE POLICY "stock_lotes_insert_admin" ON "public"."stock_lotes" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



CREATE POLICY "stock_lotes_select_auth" ON "public"."stock_lotes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "stock_lotes_update_admin" ON "public"."stock_lotes" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'ADMIN'::"text")))));



ALTER TABLE "public"."timezone_names_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tz_cache_select" ON "public"."timezone_names_cache" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."user_push_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_push_tokens_insert_own" ON "public"."user_push_tokens" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "user_push_tokens_select_own" ON "public"."user_push_tokens" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "user_push_tokens_update_own" ON "public"."user_push_tokens" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."ventas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ventas_delete_admin" ON "public"."ventas" FOR DELETE TO "authenticated" USING ("public"."has_role"('ADMIN'::"text"));



ALTER TABLE "public"."ventas_detalle" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ventas_detalle_select_admin_bodega_facturador" ON "public"."ventas_detalle" FOR SELECT TO "authenticated" USING (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text")));



CREATE POLICY "ventas_detalle_select_vendedor_own" ON "public"."ventas_detalle" FOR SELECT TO "authenticated" USING (("public"."has_role"('VENTAS'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE (("v"."id" = "ventas_detalle"."venta_id") AND ("v"."vendedor_id" = "auth"."uid"()))))));



CREATE POLICY "ventas_detalle_write_admin_bodega_facturador" ON "public"."ventas_detalle" TO "authenticated" USING (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text"))) WITH CHECK (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text")));



CREATE POLICY "ventas_detalle_write_vendedor_own_nuevo" ON "public"."ventas_detalle" TO "authenticated" USING (("public"."has_role"('VENTAS'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE (("v"."id" = "ventas_detalle"."venta_id") AND ("v"."vendedor_id" = "auth"."uid"()) AND ("v"."estado" = 'NUEVO'::"text")))))) WITH CHECK (("public"."has_role"('VENTAS'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE (("v"."id" = "ventas_detalle"."venta_id") AND ("v"."vendedor_id" = "auth"."uid"()) AND ("v"."estado" = 'NUEVO'::"text"))))));



ALTER TABLE "public"."ventas_devoluciones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ventas_devoluciones_detalle" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ventas_devoluciones_detalle_select_admin_bodega_facturador" ON "public"."ventas_devoluciones_detalle" FOR SELECT TO "authenticated" USING (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text")));



CREATE POLICY "ventas_devoluciones_detalle_select_vendedor_own" ON "public"."ventas_devoluciones_detalle" FOR SELECT TO "authenticated" USING (("public"."has_role"('VENTAS'::"text") AND (EXISTS ( SELECT 1
   FROM ("public"."ventas_devoluciones" "d"
     JOIN "public"."ventas" "v" ON (("v"."id" = "d"."venta_id")))
  WHERE (("d"."id" = "ventas_devoluciones_detalle"."devolucion_id") AND ("v"."vendedor_id" = "auth"."uid"()))))));



CREATE POLICY "ventas_devoluciones_detalle_write_admin_bodega_facturador" ON "public"."ventas_devoluciones_detalle" TO "authenticated" USING (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text"))) WITH CHECK (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text")));



CREATE POLICY "ventas_devoluciones_detalle_write_vendedor_own" ON "public"."ventas_devoluciones_detalle" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_role"('VENTAS'::"text") AND (EXISTS ( SELECT 1
   FROM ("public"."ventas_devoluciones" "d"
     JOIN "public"."ventas" "v" ON (("v"."id" = "d"."venta_id")))
  WHERE (("d"."id" = "ventas_devoluciones_detalle"."devolucion_id") AND ("v"."vendedor_id" = "auth"."uid"()))))));



CREATE POLICY "ventas_devoluciones_select_admin_bodega_facturador" ON "public"."ventas_devoluciones" FOR SELECT TO "authenticated" USING (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text")));



CREATE POLICY "ventas_devoluciones_select_vendedor_own" ON "public"."ventas_devoluciones" FOR SELECT TO "authenticated" USING (("public"."has_role"('VENTAS'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE (("v"."id" = "ventas_devoluciones"."venta_id") AND ("v"."vendedor_id" = "auth"."uid"()))))));



CREATE POLICY "ventas_devoluciones_write_admin_bodega_facturador" ON "public"."ventas_devoluciones" TO "authenticated" USING (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text"))) WITH CHECK (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text")));



CREATE POLICY "ventas_devoluciones_write_vendedor_own" ON "public"."ventas_devoluciones" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_role"('VENTAS'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE (("v"."id" = "ventas_devoluciones"."venta_id") AND ("v"."vendedor_id" = "auth"."uid"()))))));



ALTER TABLE "public"."ventas_eventos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ventas_eventos_insert_admin_bodega_facturador" ON "public"."ventas_eventos" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text")));



CREATE POLICY "ventas_eventos_select_admin_bodega_facturador" ON "public"."ventas_eventos" FOR SELECT TO "authenticated" USING (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text")));



CREATE POLICY "ventas_eventos_select_vendedor_own" ON "public"."ventas_eventos" FOR SELECT TO "authenticated" USING (("public"."has_role"('VENTAS'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE (("v"."id" = "ventas_eventos"."venta_id") AND ("v"."vendedor_id" = "auth"."uid"()))))));



ALTER TABLE "public"."ventas_facturas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ventas_facturas_select_admin" ON "public"."ventas_facturas" FOR SELECT TO "authenticated" USING ("public"."has_role"('ADMIN'::"text"));



CREATE POLICY "ventas_facturas_select_admin_bodega_facturador" ON "public"."ventas_facturas" FOR SELECT TO "authenticated" USING (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text")));



CREATE POLICY "ventas_facturas_select_vendedor_own" ON "public"."ventas_facturas" FOR SELECT TO "authenticated" USING (("public"."has_role"('VENTAS'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE (("v"."id" = "ventas_facturas"."venta_id") AND ("v"."vendedor_id" = "auth"."uid"()))))));



CREATE POLICY "ventas_facturas_select_ventas_own" ON "public"."ventas_facturas" FOR SELECT TO "authenticated" USING (("public"."has_role"('VENTAS'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE (("v"."id" = "ventas_facturas"."venta_id") AND ("v"."vendedor_id" = "auth"."uid"()))))));



CREATE POLICY "ventas_facturas_write_admin_bodega_facturador" ON "public"."ventas_facturas" TO "authenticated" USING (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text"))) WITH CHECK (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text")));



CREATE POLICY "ventas_insert_admin_bodega_facturador" ON "public"."ventas" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text")));



CREATE POLICY "ventas_insert_vendedor_own" ON "public"."ventas" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_role"('VENTAS'::"text") AND ("vendedor_id" = "auth"."uid"())));



ALTER TABLE "public"."ventas_pagos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ventas_pagos_admin_delete" ON "public"."ventas_pagos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'ADMIN'::"text")))));



CREATE POLICY "ventas_pagos_admin_insert" ON "public"."ventas_pagos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'ADMIN'::"text")))));



CREATE POLICY "ventas_pagos_admin_select" ON "public"."ventas_pagos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'ADMIN'::"text")))));



CREATE POLICY "ventas_pagos_admin_update" ON "public"."ventas_pagos" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'ADMIN'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'ADMIN'::"text")))));



ALTER TABLE "public"."ventas_pagos_reportados" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ventas_pagos_select_admin" ON "public"."ventas_pagos" FOR SELECT TO "authenticated" USING ("public"."has_role"('ADMIN'::"text"));



CREATE POLICY "ventas_pagos_select_ventas_own" ON "public"."ventas_pagos" FOR SELECT TO "authenticated" USING (("public"."has_role"('VENTAS'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE (("v"."id" = "ventas_pagos"."venta_id") AND ("v"."vendedor_id" = "auth"."uid"()))))));



CREATE POLICY "ventas_pagos_ventas_delete" ON "public"."ventas_pagos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."ventas" "v"
     JOIN "public"."profiles" "p" ON (("p"."id" = "auth"."uid"())))
  WHERE (("v"."id" = "ventas_pagos"."venta_id") AND ("p"."role" = 'VENTAS'::"text") AND ("v"."vendedor_id" = "auth"."uid"())))));



CREATE POLICY "ventas_pagos_ventas_insert" ON "public"."ventas_pagos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."ventas" "v"
     JOIN "public"."profiles" "p" ON (("p"."id" = "auth"."uid"())))
  WHERE (("v"."id" = "ventas_pagos"."venta_id") AND ("p"."role" = 'VENTAS'::"text") AND ("v"."vendedor_id" = "auth"."uid"())))));



CREATE POLICY "ventas_pagos_ventas_select" ON "public"."ventas_pagos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."ventas" "v"
     JOIN "public"."profiles" "p" ON (("p"."id" = "auth"."uid"())))
  WHERE (("v"."id" = "ventas_pagos"."venta_id") AND ("p"."role" = 'VENTAS'::"text") AND ("v"."vendedor_id" = "auth"."uid"())))));



ALTER TABLE "public"."ventas_permisos_edicion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ventas_recetas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ventas_recetas_select_admin_bodega_facturador" ON "public"."ventas_recetas" FOR SELECT TO "authenticated" USING (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text")));



CREATE POLICY "ventas_recetas_select_vendedor_own" ON "public"."ventas_recetas" FOR SELECT TO "authenticated" USING (("public"."has_role"('VENTAS'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE (("v"."id" = "ventas_recetas"."venta_id") AND ("v"."vendedor_id" = "auth"."uid"()))))));



CREATE POLICY "ventas_recetas_write_admin_bodega_facturador" ON "public"."ventas_recetas" TO "authenticated" USING (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text"))) WITH CHECK (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text")));



CREATE POLICY "ventas_select_admin_bodega_facturador" ON "public"."ventas" FOR SELECT TO "authenticated" USING (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text")));



CREATE POLICY "ventas_select_vendedor_own" ON "public"."ventas" FOR SELECT TO "authenticated" USING (("public"."has_role"('VENTAS'::"text") AND ("vendedor_id" = "auth"."uid"())));



ALTER TABLE "public"."ventas_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ventas_tags_select_admin_bodega" ON "public"."ventas_tags" FOR SELECT TO "authenticated" USING (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text")));



CREATE POLICY "ventas_tags_select_facturador_sin_solicitudes" ON "public"."ventas_tags" FOR SELECT TO "authenticated" USING (("public"."has_role"('FACTURACION'::"text") AND ("tag" <> 'PEND_AUTORIZACION_ADMIN'::"text") AND ("tag" !~~ 'SOLICITA_%'::"text")));



CREATE POLICY "ventas_tags_select_ventas_own" ON "public"."ventas_tags" FOR SELECT TO "authenticated" USING (("public"."has_role"('VENTAS'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE (("v"."id" = "ventas_tags"."venta_id") AND ("v"."vendedor_id" = "auth"."uid"()))))));



CREATE POLICY "ventas_update_admin_bodega_facturador" ON "public"."ventas" FOR UPDATE TO "authenticated" USING (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text"))) WITH CHECK (("public"."has_role"('ADMIN'::"text") OR "public"."has_role"('BODEGA'::"text") OR "public"."has_role"('FACTURACION'::"text")));



CREATE POLICY "ventas_update_vendedor_own_nuevo" ON "public"."ventas" FOR UPDATE TO "authenticated" USING (("public"."has_role"('VENTAS'::"text") AND ("vendedor_id" = "auth"."uid"()) AND ("estado" = 'NUEVO'::"text"))) WITH CHECK (("public"."has_role"('VENTAS'::"text") AND ("vendedor_id" = "auth"."uid"()) AND ("estado" = 'NUEVO'::"text")));



CREATE POLICY "vpe_admin_all" ON "public"."ventas_permisos_edicion" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'ADMIN'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'ADMIN'::"text")))));



CREATE POLICY "vpe_ventas_select_own" ON "public"."ventas_permisos_edicion" FOR SELECT TO "authenticated" USING ((("otorgado_a" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'VENTAS'::"text"))))));



CREATE POLICY "vpr_admin_all" ON "public"."ventas_pagos_reportados" TO "authenticated" USING ("public"."has_role"('ADMIN'::"text")) WITH CHECK ("public"."has_role"('ADMIN'::"text"));



CREATE POLICY "vpr_ventas_insert_own" ON "public"."ventas_pagos_reportados" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_role"('VENTAS'::"text") AND ("created_by" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE (("v"."id" = "ventas_pagos_reportados"."venta_id") AND ("v"."vendedor_id" = "auth"."uid"()))))));



CREATE POLICY "vpr_ventas_select_own" ON "public"."ventas_pagos_reportados" FOR SELECT TO "authenticated" USING (("public"."has_role"('VENTAS'::"text") AND ("created_by" = "auth"."uid"())));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "audit" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


























































































































































































































































































REVOKE ALL ON FUNCTION "public"."_test_get_stock_total"("p_lote_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_test_get_stock_total"("p_lote_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_test_get_stock_total"("p_lote_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."anular_venta"("p_venta_id" bigint, "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."anular_venta"("p_venta_id" bigint, "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."anular_venta"("p_venta_id" bigint, "p_motivo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."crear_devolucion"("p_venta_id" bigint, "p_motivo" "text", "p_created_by" "uuid", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."crear_devolucion"("p_venta_id" bigint, "p_motivo" "text", "p_created_by" "uuid", "p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."crear_devolucion"("p_venta_id" bigint, "p_motivo" "text", "p_created_by" "uuid", "p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_venta_nueva"("p_cliente_nombre" "text", "p_comentarios" "text", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_venta_nueva"("p_cliente_nombre" "text", "p_comentarios" "text", "p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_venta_nueva"("p_cliente_nombre" "text", "p_comentarios" "text", "p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_venta_nueva"("p_cliente_nombre" "text", "p_comentarios" "text", "p_vendedor_id" "uuid", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_venta_nueva"("p_cliente_nombre" "text", "p_comentarios" "text", "p_vendedor_id" "uuid", "p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_venta_nueva"("p_cliente_nombre" "text", "p_comentarios" "text", "p_vendedor_id" "uuid", "p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_cliente_vendedor_admin_only"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_cliente_vendedor_admin_only"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_cliente_vendedor_admin_only"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_numero_factura"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_numero_factura"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_numero_factura"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enviar_a_ruta"("p_venta_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enviar_a_ruta"("p_venta_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."enviar_a_ruta"("p_venta_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."facturar_venta"("p_venta_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."facturar_venta"("p_venta_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."facturar_venta"("p_venta_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."facturar_venta"("p_venta_id" bigint, "p_ignorar_receta" boolean, "p_ignorar_facturas" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."facturar_venta"("p_venta_id" bigint, "p_ignorar_receta" boolean, "p_ignorar_facturas" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."facturar_venta"("p_venta_id" bigint, "p_ignorar_receta" boolean, "p_ignorar_facturas" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_role"("p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_role"("p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("p_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."inc_stock_por_compra"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."inc_stock_por_compra"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."inc_stock_por_compra"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."inc_stock_por_devolucion"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."inc_stock_por_devolucion"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."inc_stock_por_devolucion"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."marcar_entregado"("p_venta_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."marcar_entregado"("p_venta_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."marcar_entregado"("p_venta_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_created_at_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_created_at_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_created_at_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."recalc_saldo_compra"("p_compra_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recalc_saldo_compra"("p_compra_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalc_saldo_compra"("p_compra_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."recalc_total_compra"("p_compra_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recalc_total_compra"("p_compra_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalc_total_compra"("p_compra_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_devolucion_venta_por_detalle"("p_venta_id" bigint, "p_motivo" "text", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_devolucion_venta_por_detalle"("p_venta_id" bigint, "p_motivo" "text", "p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_devolucion_venta_por_detalle"("p_venta_id" bigint, "p_motivo" "text", "p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reserve_stock_fefo"("p_producto_id" bigint, "p_cantidad" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reserve_stock_fefo"("p_producto_id" bigint, "p_cantidad" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reserve_stock_fefo"("p_producto_id" bigint, "p_cantidad" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_admin_otorgar_edicion_pago"("p_venta_id" bigint, "p_otorgado_a" "uuid", "p_horas" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_admin_otorgar_edicion_pago"("p_venta_id" bigint, "p_otorgado_a" "uuid", "p_horas" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_admin_otorgar_edicion_pago"("p_venta_id" bigint, "p_otorgado_a" "uuid", "p_horas" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_admin_resolver_solicitud"("p_venta_id" bigint, "p_decision" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_admin_resolver_solicitud"("p_venta_id" bigint, "p_decision" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_admin_resolver_solicitud"("p_venta_id" bigint, "p_decision" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_calc_stock_disponible_producto"("p_producto_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_calc_stock_disponible_producto"("p_producto_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_calc_stock_disponible_producto"("p_producto_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_claim_push_token"("p_user_id" "uuid", "p_device_id" "text", "p_expo_token" "text", "p_platform" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_claim_push_token"("p_user_id" "uuid", "p_device_id" "text", "p_expo_token" "text", "p_platform" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_claim_push_token"("p_user_id" "uuid", "p_device_id" "text", "p_expo_token" "text", "p_platform" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_comisiones_resumen_mes"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_vendedor_id" "uuid", "p_iva_pct" numeric, "p_comision_pct" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_comisiones_resumen_mes"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_vendedor_id" "uuid", "p_iva_pct" numeric, "p_comision_pct" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_comisiones_resumen_mes"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_vendedor_id" "uuid", "p_iva_pct" numeric, "p_comision_pct" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_comisiones_ventas_liquidadas"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_vendedor_id" "uuid", "p_cliente_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_comisiones_ventas_liquidadas"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_vendedor_id" "uuid", "p_cliente_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_comisiones_ventas_liquidadas"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_vendedor_id" "uuid", "p_cliente_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_comisiones_ventas_liquidadas"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_vendedor_id" "uuid", "p_cliente_id" bigint, "p_iva_pct" numeric, "p_comision_pct" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_comisiones_ventas_liquidadas"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_vendedor_id" "uuid", "p_cliente_id" bigint, "p_iva_pct" numeric, "p_comision_pct" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_comisiones_ventas_liquidadas"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_vendedor_id" "uuid", "p_cliente_id" bigint, "p_iva_pct" numeric, "p_comision_pct" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_compra_actualizar_linea"("p_detalle_id" bigint, "p_nueva_cantidad" integer, "p_nuevo_lote" "text", "p_nueva_fecha_exp" "date", "p_nuevo_precio" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_compra_actualizar_linea"("p_detalle_id" bigint, "p_nueva_cantidad" integer, "p_nuevo_lote" "text", "p_nueva_fecha_exp" "date", "p_nuevo_precio" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_compra_actualizar_linea"("p_detalle_id" bigint, "p_nueva_cantidad" integer, "p_nuevo_lote" "text", "p_nueva_fecha_exp" "date", "p_nuevo_precio" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_compra_agregar_linea"("p_compra_id" bigint, "p_producto_id" bigint, "p_lote" "text", "p_fecha_exp" "date", "p_cantidad" integer, "p_precio_compra_unit" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_compra_agregar_linea"("p_compra_id" bigint, "p_producto_id" bigint, "p_lote" "text", "p_fecha_exp" "date", "p_cantidad" integer, "p_precio_compra_unit" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_compra_agregar_linea"("p_compra_id" bigint, "p_producto_id" bigint, "p_lote" "text", "p_fecha_exp" "date", "p_cantidad" integer, "p_precio_compra_unit" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_compra_aplicar_pago"("p_compra_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comentario" "text", "p_fecha" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_compra_aplicar_pago"("p_compra_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comentario" "text", "p_fecha" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_compra_aplicar_pago"("p_compra_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comentario" "text", "p_fecha" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_compra_aplicar_pago"("p_compra_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comprobante_path" "text", "p_comentario" "text", "p_fecha" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_compra_aplicar_pago"("p_compra_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comprobante_path" "text", "p_comentario" "text", "p_fecha" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_compra_aplicar_pago"("p_compra_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comprobante_path" "text", "p_comentario" "text", "p_fecha" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_compra_eliminar_compra"("p_compra_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_compra_eliminar_compra"("p_compra_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_compra_eliminar_compra"("p_compra_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_compra_eliminar_linea"("p_detalle_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_compra_eliminar_linea"("p_detalle_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_compra_eliminar_linea"("p_detalle_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_compra_reemplazar"("p_compra_id" bigint, "p_compra" "jsonb", "p_detalles" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_compra_reemplazar"("p_compra_id" bigint, "p_compra" "jsonb", "p_detalles" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_compra_reemplazar"("p_compra_id" bigint, "p_compra" "jsonb", "p_detalles" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_crear_compra"("p_compra" "jsonb", "p_detalles" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_crear_compra"("p_compra" "jsonb", "p_detalles" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_crear_compra"("p_compra" "jsonb", "p_detalles" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_crear_venta"("p_venta" "jsonb", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_crear_venta"("p_venta" "jsonb", "p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_crear_venta"("p_venta" "jsonb", "p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_cxc_vendedores"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_cxc_vendedores"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_cxc_vendedores"() TO "service_role";



GRANT ALL ON TABLE "public"."clientes" TO "authenticated";
GRANT ALL ON TABLE "public"."clientes" TO "service_role";



GRANT ALL ON TABLE "public"."ventas" TO "authenticated";
GRANT ALL ON TABLE "public"."ventas" TO "service_role";



GRANT ALL ON TABLE "public"."ventas_detalle" TO "authenticated";
GRANT ALL ON TABLE "public"."ventas_detalle" TO "service_role";



GRANT ALL ON TABLE "public"."ventas_facturas" TO "authenticated";
GRANT ALL ON TABLE "public"."ventas_facturas" TO "service_role";



GRANT ALL ON TABLE "public"."ventas_pagos" TO "authenticated";
GRANT ALL ON TABLE "public"."ventas_pagos" TO "service_role";



GRANT ALL ON TABLE "public"."ventas_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."ventas_tags" TO "service_role";



GRANT ALL ON TABLE "public"."vw_cxc_ventas" TO "service_role";
GRANT SELECT ON TABLE "public"."vw_cxc_ventas" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."rpc_cxc_ventas"("p_vendedor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_cxc_ventas"("p_vendedor_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_cxc_ventas"("p_vendedor_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_dashboard_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_dashboard_ventas"("p_vendedor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_enqueue_stock_bajo_20"("p_producto_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_enqueue_stock_bajo_20"("p_producto_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_enqueue_stock_bajo_20"("p_producto_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_estado_cuenta_cliente_pdf"("p_cliente_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_estado_cuenta_cliente_pdf"("p_cliente_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_estado_cuenta_cliente_pdf"("p_cliente_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_inventario_buscar"("p_q" "text", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_inventario_buscar"("p_q" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_inventario_buscar"("p_q" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_inventario_totales_simple"("p_producto_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_inventario_totales_simple_v2"("p_producto_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_kardex_producto_detallado"("p_producto_id" bigint, "p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_kardex_producto_detallado_audit"("p_producto_id" bigint, "p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_notif_destinatarios_compra_linea_ingresada"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_notif_destinatarios_compra_linea_ingresada"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_notif_destinatarios_compra_linea_ingresada"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_notif_destinatarios_venta_facturada"("p_venta_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_notif_destinatarios_venta_facturada"("p_venta_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_notif_destinatarios_venta_facturada"("p_venta_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_notif_destinatarios_venta_nuevos"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_notif_destinatarios_venta_nuevos"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_notif_destinatarios_venta_nuevos"() TO "service_role";



GRANT ALL ON TABLE "public"."notif_outbox" TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_notif_outbox_claim"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_notif_outbox_claim"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_notif_outbox_claim"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_notif_outbox_mark_error"("p_id" bigint, "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_notif_outbox_mark_error"("p_id" bigint, "p_error" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_notif_outbox_mark_error"("p_id" bigint, "p_error" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_notif_outbox_mark_processed"("p_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_notif_outbox_mark_processed"("p_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_notif_outbox_mark_processed"("p_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_producto_detalle"("p_producto_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_report_compras_mensual_12m"("p_end_date" "date", "p_months" integer, "p_proveedor_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_report_compras_mensual_12m"("p_end_date" "date", "p_months" integer, "p_proveedor_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_report_compras_mensual_12m"("p_end_date" "date", "p_months" integer, "p_proveedor_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_report_inventario_alertas"("p_stock_bajo" integer, "p_exp_dias" integer, "p_incluir_inactivos" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_report_inventario_alertas"("p_stock_bajo" integer, "p_exp_dias" integer, "p_incluir_inactivos" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_report_inventario_alertas"("p_stock_bajo" integer, "p_exp_dias" integer, "p_incluir_inactivos" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_report_kardex_producto_consolidado"("p_producto_id" bigint, "p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_incluir_anuladas" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_report_kardex_producto_consolidado"("p_producto_id" bigint, "p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_incluir_anuladas" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_report_kardex_producto_consolidado"("p_producto_id" bigint, "p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_incluir_anuladas" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_report_pagos_proveedores_mensual_12m"("p_end_date" "date", "p_months" integer, "p_proveedor_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_report_pagos_proveedores_mensual_12m"("p_end_date" "date", "p_months" integer, "p_proveedor_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_report_pagos_proveedores_mensual_12m"("p_end_date" "date", "p_months" integer, "p_proveedor_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_report_producto_promedio_mensual_12m"("p_producto_id" bigint, "p_end_date" "date", "p_months" integer, "p_vendedor_id" "uuid", "p_estado" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_report_producto_promedio_mensual_12m"("p_producto_id" bigint, "p_end_date" "date", "p_months" integer, "p_vendedor_id" "uuid", "p_estado" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_report_producto_promedio_mensual_12m"("p_producto_id" bigint, "p_end_date" "date", "p_months" integer, "p_vendedor_id" "uuid", "p_estado" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_report_top_productos_12m"("p_end_date" "date", "p_months" integer, "p_limit" integer, "p_order_by" "text", "p_vendedor_id" "uuid", "p_estado" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_report_top_productos_12m"("p_end_date" "date", "p_months" integer, "p_limit" integer, "p_order_by" "text", "p_vendedor_id" "uuid", "p_estado" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_report_top_productos_12m"("p_end_date" "date", "p_months" integer, "p_limit" integer, "p_order_by" "text", "p_vendedor_id" "uuid", "p_estado" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_report_ventas_mensual_12m"("p_end_date" "date", "p_months" integer, "p_vendedor_id" "uuid", "p_estado" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_report_ventas_mensual_12m"("p_end_date" "date", "p_months" integer, "p_vendedor_id" "uuid", "p_estado" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_report_ventas_mensual_12m"("p_end_date" "date", "p_months" integer, "p_vendedor_id" "uuid", "p_estado" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_reporte_bajo_movimiento"("p_hasta" timestamp with time zone, "p_min_dias" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."rpc_reporte_bajo_movimiento"("p_hasta" timestamp with time zone, "p_min_dias" integer) TO "authenticated";



GRANT ALL ON FUNCTION "public"."rpc_reporte_utilidad_global_v1"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_reporte_utilidad_productos"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) TO "service_role";
GRANT ALL ON FUNCTION "public"."rpc_reporte_utilidad_productos"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) TO "authenticated";



GRANT ALL ON FUNCTION "public"."rpc_reporte_utilidad_productos_v2"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) TO "service_role";
GRANT ALL ON FUNCTION "public"."rpc_reporte_utilidad_productos_v2"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) TO "authenticated";



GRANT ALL ON FUNCTION "public"."rpc_reporte_utilidad_productos_v3"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) TO "service_role";
GRANT ALL ON FUNCTION "public"."rpc_reporte_utilidad_productos_v3"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) TO "authenticated";



GRANT ALL ON FUNCTION "public"."rpc_reporte_utilidad_resumen"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) TO "service_role";
GRANT ALL ON FUNCTION "public"."rpc_reporte_utilidad_resumen"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."rpc_require_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_require_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_require_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_reservado_pendiente_producto"("p_producto_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_anular"("p_venta_id" bigint, "p_nota" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_anular"("p_venta_id" bigint, "p_nota" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_anular"("p_venta_id" bigint, "p_nota" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_aplicar_pago"("p_venta_id" bigint, "p_factura_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comprobante_path" "text", "p_comentario" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_aplicar_pago"("p_venta_id" bigint, "p_factura_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comprobante_path" "text", "p_comentario" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_aplicar_pago"("p_venta_id" bigint, "p_factura_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comprobante_path" "text", "p_comentario" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_aplicar_pago"("p_venta_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comprobante_path" "text", "p_comentario" "text", "p_fecha" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_aplicar_pago"("p_venta_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comprobante_path" "text", "p_comentario" "text", "p_fecha" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_aplicar_pago"("p_venta_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comprobante_path" "text", "p_comentario" "text", "p_fecha" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_aprobar_pago_reportado"("p_pago_reportado_id" bigint, "p_nota_admin" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_aprobar_pago_reportado"("p_pago_reportado_id" bigint, "p_nota_admin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_aprobar_pago_reportado"("p_pago_reportado_id" bigint, "p_nota_admin" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_borrar_receta"("p_receta_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_borrar_receta"("p_receta_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_borrar_receta"("p_receta_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_delete_factura"("p_venta_id" bigint, "p_numero" smallint, "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_delete_factura"("p_venta_id" bigint, "p_numero" smallint, "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_delete_factura"("p_venta_id" bigint, "p_numero" smallint, "p_motivo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_delete_receta"("p_venta_id" bigint, "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_delete_receta"("p_venta_id" bigint, "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_delete_receta"("p_venta_id" bigint, "p_motivo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_editar"("p_venta_id" bigint, "p_venta" "jsonb", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_editar"("p_venta_id" bigint, "p_venta" "jsonb", "p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_editar"("p_venta_id" bigint, "p_venta" "jsonb", "p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_facturar"("p_venta_id" bigint, "p_facturas" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_facturar"("p_venta_id" bigint, "p_facturas" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_facturar"("p_venta_id" bigint, "p_facturas" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_marcar_entregada"("p_venta_id" bigint, "p_nota" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_marcar_entregada"("p_venta_id" bigint, "p_nota" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_marcar_entregada"("p_venta_id" bigint, "p_nota" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_pago_editar_meta"("p_pago_id" bigint, "p_metodo" "text", "p_referencia" "text", "p_comentario" "text", "p_comprobante_path" "text", "p_fecha" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_pago_editar_meta"("p_pago_id" bigint, "p_metodo" "text", "p_referencia" "text", "p_comentario" "text", "p_comprobante_path" "text", "p_fecha" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_pago_editar_meta"("p_pago_id" bigint, "p_metodo" "text", "p_referencia" "text", "p_comentario" "text", "p_comprobante_path" "text", "p_fecha" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_pago_editar_monto"("p_pago_id" bigint, "p_monto" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_pago_editar_monto"("p_pago_id" bigint, "p_monto" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_pago_editar_monto"("p_pago_id" bigint, "p_monto" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_pago_eliminar"("p_pago_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_pago_eliminar"("p_pago_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_pago_eliminar"("p_pago_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_pasar_en_ruta"("p_venta_id" bigint, "p_nota" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_pasar_en_ruta"("p_venta_id" bigint, "p_nota" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_pasar_en_ruta"("p_venta_id" bigint, "p_nota" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_rechazar_pago_reportado"("p_pago_reportado_id" bigint, "p_nota_admin" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_rechazar_pago_reportado"("p_pago_reportado_id" bigint, "p_nota_admin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_rechazar_pago_reportado"("p_pago_reportado_id" bigint, "p_nota_admin" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_registrar_receta"("p_venta_id" bigint, "p_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_registrar_receta"("p_venta_id" bigint, "p_path" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_registrar_receta"("p_venta_id" bigint, "p_path" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_reportar_pago"("p_venta_id" bigint, "p_factura_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comprobante_path" "text", "p_comentario" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_reportar_pago"("p_venta_id" bigint, "p_factura_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comprobante_path" "text", "p_comentario" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_reportar_pago"("p_venta_id" bigint, "p_factura_id" bigint, "p_monto" numeric, "p_metodo" "text", "p_referencia" "text", "p_comprobante_path" "text", "p_comentario" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_set_en_ruta"("p_venta_id" bigint, "p_nota" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_set_en_ruta"("p_venta_id" bigint, "p_nota" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_set_en_ruta"("p_venta_id" bigint, "p_nota" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_set_entregado"("p_venta_id" bigint, "p_nota" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_set_entregado"("p_venta_id" bigint, "p_nota" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_set_entregado"("p_venta_id" bigint, "p_nota" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_set_factura"("p_venta_id" bigint, "p_numero" smallint, "p_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_set_factura"("p_venta_id" bigint, "p_numero" smallint, "p_path" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_set_factura"("p_venta_id" bigint, "p_numero" smallint, "p_path" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_venta_set_receta"("p_venta_id" bigint, "p_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_venta_set_receta"("p_venta_id" bigint, "p_path" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_venta_set_receta"("p_venta_id" bigint, "p_path" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_ventas_dots"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_ventas_dots"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_ventas_dots"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_ventas_pagadas_en_rango"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_vendedor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_ventas_pagadas_en_rango"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_vendedor_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_ventas_pagadas_en_rango"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_vendedor_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."ventas_devoluciones" TO "authenticated";
GRANT ALL ON TABLE "public"."ventas_devoluciones" TO "service_role";



GRANT ALL ON TABLE "public"."ventas_devoluciones_detalle" TO "authenticated";
GRANT ALL ON TABLE "public"."ventas_devoluciones_detalle" TO "service_role";



GRANT ALL ON TABLE "public"."vw_ventas_lista" TO "service_role";
GRANT SELECT ON TABLE "public"."vw_ventas_lista" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."rpc_ventas_receta_pendiente_por_mes"("p_year" integer, "p_month" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_ventas_receta_pendiente_por_mes"("p_year" integer, "p_month" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_ventas_receta_pendiente_por_mes"("p_year" integer, "p_month" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_ventas_solicitar_accion"("p_venta_id" bigint, "p_accion" "text", "p_nota" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_ventas_solicitar_accion"("p_venta_id" bigint, "p_accion" "text", "p_nota" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_ventas_solicitar_accion"("p_venta_id" bigint, "p_accion" "text", "p_nota" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_cliente_vendedor_id_default"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_cliente_vendedor_id_default"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_cliente_vendedor_id_default"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_ventas_factura_flags"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_ventas_factura_flags"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_ventas_factura_flags"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_block_cancel_sale_if_paid"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_ventas_facturas_sanitize"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_ventas_facturas_sanitize"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_ventas_facturas_sanitize"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_enqueue_compra_linea_ingresada"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_enqueue_compra_linea_ingresada"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_enqueue_compra_linea_ingresada"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_enqueue_venta_facturada"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_enqueue_venta_facturada"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_enqueue_venta_facturada"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_enqueue_venta_nuevos"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_enqueue_venta_nuevos"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_enqueue_venta_nuevos"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_recalc_saldo_compra"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_recalc_saldo_compra"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_recalc_saldo_compra"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_recalc_total_compra"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_recalc_total_compra"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_recalc_total_compra"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_set_producto_image_from_latest_compra"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_set_producto_image_from_latest_compra"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_set_producto_image_from_latest_compra"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_stock_lotes_check_low_20"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_stock_lotes_check_low_20"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_stock_lotes_check_low_20"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_compra_credito"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_compra_credito"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_compra_credito"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_compra_lote_producto"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_compra_lote_producto"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_compra_lote_producto"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_devolucion_lote_producto"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_devolucion_lote_producto"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_devolucion_lote_producto"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_pago_no_exceda_saldo"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_pago_no_exceda_saldo"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_pago_no_exceda_saldo"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_venta_lote_producto"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_venta_lote_producto"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_venta_lote_producto"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."venta_visible_en_nuevos"("p_venta_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."venta_visible_en_nuevos"("p_venta_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."venta_visible_en_nuevos"("p_venta_id" bigint) TO "service_role";












GRANT SELECT ON TABLE "audit"."log" TO "authenticated";



GRANT SELECT ON TABLE "audit"."vw_ventas_pagos_log" TO "authenticated";















GRANT ALL ON SEQUENCE "public"."clientes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."clientes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."compras" TO "service_role";
GRANT SELECT ON TABLE "public"."compras" TO "authenticated";



GRANT ALL ON TABLE "public"."compras_detalle" TO "service_role";
GRANT SELECT ON TABLE "public"."compras_detalle" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."compras_detalle_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."compras_detalle_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."compras_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."compras_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."compras_pagos" TO "service_role";
GRANT SELECT ON TABLE "public"."compras_pagos" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."compras_pagos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."compras_pagos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."devoluciones" TO "authenticated";
GRANT ALL ON TABLE "public"."devoluciones" TO "service_role";



GRANT ALL ON TABLE "public"."devoluciones_detalle" TO "authenticated";
GRANT ALL ON TABLE "public"."devoluciones_detalle" TO "service_role";



GRANT ALL ON SEQUENCE "public"."devoluciones_detalle_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."devoluciones_detalle_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."devoluciones_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."devoluciones_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."marcas" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."marcas" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."marcas_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."marcas_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."notif_outbox_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."notif_outbox_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."notif_stock_state" TO "service_role";



GRANT ALL ON TABLE "public"."producto_lotes" TO "service_role";
GRANT SELECT ON TABLE "public"."producto_lotes" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."producto_lotes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."producto_lotes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."producto_precio_override" TO "authenticated";
GRANT ALL ON TABLE "public"."producto_precio_override" TO "service_role";



GRANT ALL ON TABLE "public"."productos" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."productos" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."productos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."productos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("id") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("full_name") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."proveedores" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."proveedores" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."proveedores_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."proveedores_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."stock_lotes" TO "service_role";
GRANT SELECT ON TABLE "public"."stock_lotes" TO "authenticated";



GRANT ALL ON TABLE "public"."timezone_names_cache" TO "service_role";
GRANT SELECT ON TABLE "public"."timezone_names_cache" TO "authenticated";
GRANT SELECT ON TABLE "public"."timezone_names_cache" TO "anon";



GRANT ALL ON TABLE "public"."user_push_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."user_push_tokens" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_push_tokens_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_push_tokens_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ventas_detalle_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ventas_detalle_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ventas_devoluciones_detalle_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ventas_devoluciones_detalle_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ventas_devoluciones_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ventas_devoluciones_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ventas_eventos" TO "authenticated";
GRANT ALL ON TABLE "public"."ventas_eventos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ventas_eventos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ventas_eventos_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ventas_facturas_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ventas_facturas_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ventas_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ventas_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ventas_pagos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ventas_pagos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ventas_pagos_reportados" TO "authenticated";
GRANT ALL ON TABLE "public"."ventas_pagos_reportados" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ventas_pagos_reportados_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ventas_pagos_reportados_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ventas_permisos_edicion" TO "authenticated";
GRANT ALL ON TABLE "public"."ventas_permisos_edicion" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ventas_permisos_edicion_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ventas_permisos_edicion_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ventas_recetas" TO "authenticated";
GRANT ALL ON TABLE "public"."ventas_recetas" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ventas_recetas_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ventas_recetas_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ventas_tags_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ventas_tags_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."vw_inventario_productos_base" TO "service_role";
GRANT SELECT ON TABLE "public"."vw_inventario_productos_base" TO "authenticated";



GRANT ALL ON TABLE "public"."vw_inventario_productos" TO "service_role";
GRANT SELECT ON TABLE "public"."vw_inventario_productos" TO "authenticated";



GRANT ALL ON TABLE "public"."vw_inventario_productos_v2" TO "service_role";
GRANT SELECT ON TABLE "public"."vw_inventario_productos_v2" TO "authenticated";



GRANT ALL ON TABLE "public"."vw_producto_lotes_detalle_base" TO "service_role";
GRANT SELECT ON TABLE "public"."vw_producto_lotes_detalle_base" TO "authenticated";



GRANT ALL ON TABLE "public"."vw_producto_lotes_detalle" TO "service_role";
GRANT SELECT ON TABLE "public"."vw_producto_lotes_detalle" TO "authenticated";



GRANT ALL ON TABLE "public"."vw_reporte_utilidad_productos" TO "service_role";
GRANT SELECT ON TABLE "public"."vw_reporte_utilidad_productos" TO "authenticated";



GRANT ALL ON TABLE "public"."vw_reporte_utilidad_ventas" TO "service_role";



GRANT ALL ON TABLE "public"."vw_vendedores_lista" TO "service_role";
GRANT SELECT ON TABLE "public"."vw_vendedores_lista" TO "authenticated";



GRANT ALL ON TABLE "public"."vw_venta_devolucion_resumen" TO "service_role";
GRANT SELECT ON TABLE "public"."vw_venta_devolucion_resumen" TO "authenticated";



GRANT ALL ON TABLE "public"."vw_venta_razon_anulacion" TO "service_role";
GRANT SELECT ON TABLE "public"."vw_venta_razon_anulacion" TO "authenticated";



GRANT ALL ON TABLE "public"."vw_ventas_estado_efectivo" TO "service_role";



GRANT ALL ON TABLE "public"."vw_ventas_facturacion_pendientes" TO "service_role";
GRANT SELECT ON TABLE "public"."vw_ventas_facturacion_pendientes" TO "authenticated";



GRANT ALL ON TABLE "public"."vw_ventas_pagos_log" TO "service_role";
GRANT SELECT ON TABLE "public"."vw_ventas_pagos_log" TO "authenticated";



GRANT ALL ON TABLE "public"."vw_ventas_solicitudes_pendientes_admin" TO "service_role";
GRANT SELECT ON TABLE "public"."vw_ventas_solicitudes_pendientes_admin" TO "authenticated";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































