-- Revertir la funcion de "anular una sola factura" (rpc_venta_anular_factura).
-- Se mantiene el fix de rpc_venta_facturar (no regresar estado al corregir
-- una factura de una venta EN_RUTA/ENTREGADO) y la limpieza del overload
-- huerfano de 2 argumentos, aplicados en la misma migracion original.
DROP FUNCTION IF EXISTS public.rpc_venta_anular_factura(bigint, text, text);
