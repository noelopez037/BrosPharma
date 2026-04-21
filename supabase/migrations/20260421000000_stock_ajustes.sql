-- Tabla de auditoría para ajustes manuales de inventario.
-- Solo admins pueden insertar/ver (ver RLS abajo).

CREATE TABLE IF NOT EXISTS "public"."stock_ajustes" (
  "id"          bigserial PRIMARY KEY,
  "empresa_id"  bigint  NOT NULL REFERENCES "public"."empresas"("id"),
  "lote_id"     bigint  NOT NULL REFERENCES "public"."producto_lotes"("id"),
  "producto_id" bigint  NOT NULL REFERENCES "public"."productos"("id"),
  "tipo"        text    NOT NULL,
  "cantidad"    integer NOT NULL,
  "motivo"      text,
  "usuario_id"  uuid    NOT NULL REFERENCES "auth"."users"("id"),
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "stock_ajustes_tipo_chk" CHECK (
    "tipo" IN ('MERMA', 'AJUSTE_ENTRADA', 'AJUSTE_SALIDA', 'CORRECCION')
  ),
  CONSTRAINT "stock_ajustes_cantidad_chk" CHECK ("cantidad" > 0)
);

ALTER TABLE "public"."stock_ajustes" OWNER TO "postgres";

-- RLS
ALTER TABLE "public"."stock_ajustes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_ajustes_select_admin" ON "public"."stock_ajustes"
  FOR SELECT TO "authenticated"
  USING (
    EXISTS (
      SELECT 1 FROM "public"."profiles"
      WHERE "id" = "auth"."uid"() AND "role" = 'ADMIN'
    )
  );

CREATE POLICY "stock_ajustes_insert_admin" ON "public"."stock_ajustes"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "public"."profiles"
      WHERE "id" = "auth"."uid"() AND "role" = 'ADMIN'
    )
  );


-- RPC para aplicar el ajuste de forma atómica.
-- SECURITY DEFINER: la función verifica rol ADMIN internamente.
CREATE OR REPLACE FUNCTION "public"."rpc_ajustar_stock_manual"(
  "p_empresa_id"  bigint,
  "p_lote_id"     bigint,
  "p_tipo"        text,
  "p_cantidad"    integer,
  "p_motivo"      text
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid        uuid := auth.uid();
  v_role       text;
  v_tipo       text := upper(trim(coalesce(p_tipo, '')));
  v_producto_id bigint;
  v_stock_actual integer;
  v_delta      integer;
  v_stock_nuevo integer;
begin
  -- Autenticación
  if v_uid is null then
    raise exception 'NO_AUTH';
  end if;

  -- Solo ADMIN
  select upper(coalesce(role, '')) into v_role
  from public.profiles
  where id = v_uid;

  if v_role <> 'ADMIN' then
    raise exception 'NO_AUTORIZADO';
  end if;

  -- Validar tipo
  if v_tipo not in ('MERMA', 'AJUSTE_ENTRADA', 'AJUSTE_SALIDA', 'CORRECCION') then
    raise exception 'TIPO_INVALIDO';
  end if;

  -- Validar cantidad
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'CANTIDAD_INVALIDA';
  end if;

  -- Verificar que el lote existe y pertenece a la empresa
  select p.id into v_producto_id
  from public.producto_lotes pl
  join public.productos p on p.id = pl.producto_id
  where pl.id = p_lote_id
    and p.empresa_id = p_empresa_id;

  if v_producto_id is null then
    raise exception 'LOTE_NO_ENCONTRADO';
  end if;

  -- Obtener stock actual
  select coalesce(stock_total, 0) into v_stock_actual
  from public.stock_lotes
  where lote_id = p_lote_id;

  if v_stock_actual is null then
    v_stock_actual := 0;
  end if;

  -- Calcular delta
  if v_tipo in ('MERMA', 'AJUSTE_SALIDA') then
    v_delta := -p_cantidad;
  else
    v_delta := p_cantidad;
  end if;

  v_stock_nuevo := v_stock_actual + v_delta;

  -- No permitir stock negativo
  if v_stock_nuevo < 0 then
    raise exception 'STOCK_INSUFICIENTE';
  end if;

  -- Aplicar ajuste
  update public.stock_lotes
  set stock_total = v_stock_nuevo
  where lote_id = p_lote_id;

  if not found then
    -- Insertar registro si no existe (edge case: lote sin fila en stock_lotes)
    insert into public.stock_lotes (lote_id, stock_total, stock_reservado)
    values (p_lote_id, v_stock_nuevo, 0);
  end if;

  -- Registrar en audit trail
  insert into public.stock_ajustes (
    empresa_id, lote_id, producto_id, tipo, cantidad, motivo, usuario_id
  ) values (
    p_empresa_id, p_lote_id, v_producto_id, v_tipo, p_cantidad,
    nullif(trim(coalesce(p_motivo, '')), ''),
    v_uid
  );

  return jsonb_build_object(
    'ok',          true,
    'stock_nuevo', v_stock_nuevo,
    'delta',       v_delta
  );
end;
$$;

ALTER FUNCTION "public"."rpc_ajustar_stock_manual"(bigint, bigint, text, integer, text) OWNER TO "postgres";
