-- Corrige rpc_dashboard_ventas:
-- 1) Excluye ventas con tag ANULADO activo (antes solo miraba anulado_at, inconsistente
--    con el resto del sistema que usa tags como fuente de verdad para anulaciones).
-- 2) Si el que llama no es ADMIN de la empresa, ignora p_vendedor_id y fuerza su propio
--    auth.uid() -- antes cualquier usuario activo podia pedir el dashboard de otro vendedor.
CREATE OR REPLACE FUNCTION public.rpc_dashboard_ventas(p_empresa_id bigint, p_vendedor_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_year       int := date_part('year', now() AT TIME ZONE 'America/Guatemala')::int;
  v_today      date := (now() AT TIME ZONE 'America/Guatemala')::date;
  v_hoy_start  timestamptz := v_today::timestamptz AT TIME ZONE 'America/Guatemala';
  v_hoy_end    timestamptz := v_hoy_start + interval '1 day';
  v_year_start timestamptz := make_timestamptz(v_year, 1, 1, 0, 0, 0, 'America/Guatemala');
  v_year_end   timestamptz := make_timestamptz(v_year + 1, 1, 1, 0, 0, 0, 'America/Guatemala');
  v_uid        uuid := auth.uid();
  v_rol        text;
  v_target     uuid;
BEGIN
  IF NOT public.tiene_membresia_activa(p_empresa_id) THEN
    RAISE EXCEPTION 'NO_MEMBRESIA';
  END IF;

  SELECT upper(coalesce(eu.rol_empresa, ''))
    INTO v_rol
  FROM public.empresa_usuarios eu
  WHERE eu.user_id    = v_uid
    AND eu.empresa_id = p_empresa_id
    AND eu.estado     = 'ACTIVO'
  LIMIT 1;

  v_target := CASE WHEN v_rol = 'ADMIN' THEN p_vendedor_id ELSE v_uid END;

  RETURN (
    SELECT json_build_object(
      'ventas_hoy', (
        SELECT COUNT(*) FROM ventas v
        WHERE v.empresa_id  = p_empresa_id
          AND v.vendedor_id = v_target
          AND v.fecha       >= v_hoy_start AND v.fecha < v_hoy_end
          AND v.anulado_at  IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM ventas_tags vt
            WHERE vt.empresa_id = p_empresa_id
              AND vt.venta_id   = v.id
              AND vt.tag        = 'ANULADO'
              AND vt.removed_at IS NULL
          )
      ),
      'clientes_activos', (
        SELECT COUNT(*) FROM clientes
        WHERE empresa_id  = p_empresa_id
          AND vendedor_id = v_target
          AND activo      = true
      ),
      'ventas_por_mes', (
        SELECT COALESCE(json_agg(COALESCE(a.monto, 0) ORDER BY m.mes), '[]'::json)
        FROM generate_series(1, 12) AS m(mes)
        LEFT JOIN (
          SELECT date_part('month', v.fecha AT TIME ZONE 'America/Guatemala')::int AS mes,
                 SUM(vd.subtotal) AS monto
          FROM ventas v
          JOIN ventas_detalle vd ON vd.venta_id   = v.id
                                 AND vd.empresa_id = p_empresa_id
          WHERE v.empresa_id  = p_empresa_id
            AND v.vendedor_id = v_target
            AND v.fecha       >= v_year_start AND v.fecha < v_year_end
            AND v.anulado_at  IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM ventas_tags vt
              WHERE vt.empresa_id = p_empresa_id
                AND vt.venta_id   = v.id
                AND vt.tag        = 'ANULADO'
                AND vt.removed_at IS NULL
            )
          GROUP BY 1
        ) a ON a.mes = m.mes
      )
    )
  );
END;
$function$;
