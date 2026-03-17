-- Permite deshabilitar un push token sin autenticación, dado que el dispositivo
-- conoce tanto su device_id como su expo_token. Esto resuelve el caso donde
-- la sesión expira en background y no se puede hacer el UPDATE autenticado.
CREATE OR REPLACE FUNCTION public.rpc_disable_push_for_device(
  p_device_id text,
  p_expo_token text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Requiere ambos valores para prevenir que cualquier anon deshabilite tokens ajenos.
  IF p_device_id IS NULL OR p_device_id = '' THEN RETURN; END IF;
  IF p_expo_token IS NULL OR p_expo_token = '' THEN RETURN; END IF;

  UPDATE public.user_push_tokens
  SET enabled = false
  WHERE device_id = p_device_id
    AND expo_token = p_expo_token;
END;
$$;

-- Accesible por anon (sesión expirada) y authenticated (logout normal)
GRANT EXECUTE ON FUNCTION public.rpc_disable_push_for_device(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_disable_push_for_device(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_disable_push_for_device(text, text) TO service_role;
