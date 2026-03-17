-- Cambia rpc_comisiones_resumen_mes para calcular comisiones basadas en
-- ventas pagadas en el mes (saldo <= 0 y fecha_ultimo_pago en el rango),
-- en lugar de ventas creadas en el mes.
CREATE OR REPLACE FUNCTION public.rpc_comisiones_resumen_mes(
  p_empresa_id   bigint,
  p_desde        timestamp with time zone,
  p_hasta        timestamp with time zone,
  p_vendedor_id  uuid    DEFAULT NULL,
  p_iva_pct      numeric DEFAULT 12,
  p_comision_pct numeric DEFAULT 5
)
RETURNS TABLE(
  vendedor_id     uuid,
  vendedor_codigo text,
  total_con_iva   numeric,
  total_sin_iva   numeric,
  comision_mes    numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select
    cxc.vendedor_id,
    cxc.vendedor_codigo,
    sum(cxc.total)                                                        as total_con_iva,
    sum(cxc.total) / (1 + p_iva_pct / 100.0)                             as total_sin_iva,
    (sum(cxc.total) / (1 + p_iva_pct / 100.0)) * (p_comision_pct / 100.0) as comision_mes
  from public.vw_cxc_ventas cxc
  where cxc.empresa_id        = p_empresa_id
    and cxc.saldo             <= 0
    and cxc.fecha_ultimo_pago >= p_desde
    and cxc.fecha_ultimo_pago <  p_hasta
    and (p_vendedor_id is null or cxc.vendedor_id = p_vendedor_id)
  group by cxc.vendedor_id, cxc.vendedor_codigo;
$function$;
