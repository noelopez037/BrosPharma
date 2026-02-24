-- Auditoría de pagos: políticas y vista para Reportes.
-- Ejecutar este script en el editor SQL de Supabase.

alter table audit.log
  enable row level security;

drop policy if exists "admin_read_audit_log" on audit.log;

create policy "admin_read_audit_log"
  on audit.log
  for select
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and upper(coalesce(p.role, '')) = 'ADMIN'
    )
  );

create or replace view public.vw_ventas_pagos_log as
select
  l.created_at as registrado,
  l.action,
  l.record_pk,
  coalesce(l.new_data->>'actor_nombre', l.old_data->>'actor_nombre') as actor_nombre,
  coalesce((l.new_data->>'venta_id')::bigint, (l.old_data->>'venta_id')::bigint) as venta_id,
  coalesce((l.new_data->>'monto')::numeric, (l.old_data->>'monto')::numeric) as monto,
  coalesce(l.new_data->>'metodo', l.old_data->>'metodo') as metodo,
  coalesce(l.new_data->>'referencia', l.old_data->>'referencia') as referencia,
  coalesce(l.new_data->>'comentario', l.old_data->>'comentario') as comentario,
  coalesce(l.new_data->>'factura_numero', l.old_data->>'factura_numero') as factura_numero
from audit.log l
where l.table_schema = 'public'
  and l.table_name = 'ventas_pagos';

comment on view public.vw_ventas_pagos_log is 'Vista amigable para exportar cambios en public.ventas_pagos desde audit.log (solo ADMIN).';
