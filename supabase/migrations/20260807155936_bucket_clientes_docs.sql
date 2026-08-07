-- Bucket privado para documentos de cliente (licencia sanitaria, patente de comercio, crédito de apertura)
insert into storage.buckets (id, name, public)
values ('Clientes-Docs', 'Clientes-Docs', false)
on conflict (id) do nothing;

-- Extiende la política existente de storage para incluir el nuevo bucket
drop policy if exists storage_authenticated_all on storage.objects;

create policy storage_authenticated_all
on storage.objects
for all
using (bucket_id = any (array['productos', 'Ventas-Docs', 'comprobantes', 'Clientes-Docs']) and auth.role() = 'authenticated')
with check (bucket_id = any (array['productos', 'Ventas-Docs', 'comprobantes', 'Clientes-Docs']) and auth.role() = 'authenticated');
