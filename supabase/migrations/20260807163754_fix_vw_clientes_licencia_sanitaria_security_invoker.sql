-- La vista quedo sin security_invoker, ejecutandose con privilegios del owner y bypaseando
-- RLS de clientes en vez de los del usuario que consulta. La corregimos para que coincida
-- con el patron ya usado por vw_ventas_solicitudes_pendientes_admin.
alter view public.vw_clientes_licencia_sanitaria_pendientes_admin set (security_invoker = true);
