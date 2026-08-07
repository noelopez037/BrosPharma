-- Estado de aprobación admin para la licencia sanitaria subida por usuarios
alter table public.clientes
  add column if not exists licencia_sanitaria_estado text,
  add column if not exists licencia_sanitaria_revisado_por uuid references auth.users(id),
  add column if not exists licencia_sanitaria_revisado_at timestamptz,
  add column if not exists licencia_sanitaria_rechazo_motivo text;

alter table public.clientes
  add constraint clientes_licencia_sanitaria_estado_check
  check (licencia_sanitaria_estado is null or licencia_sanitaria_estado in ('PENDIENTE','APROBADA','RECHAZADA'));

-- Dedupe de notificaciones de licencia sanitaria pendiente (mismo patrón que notif_outbox_unique_stock_bajo_20,
-- reusando la columna venta_id como id de entidad generico: aqui guarda cliente_id)
create unique index if not exists notif_outbox_unique_licencia_sanitaria
  on public.notif_outbox (empresa_id, type, venta_id)
  where (type = 'LICENCIA_SANITARIA_PENDIENTE');
