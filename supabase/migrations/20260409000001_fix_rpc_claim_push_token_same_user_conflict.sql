-- Migration: fix_rpc_claim_push_token_same_user_conflict
-- Fix: rpc_claim_push_token fallaba con error 23505 (duplicate key) en el
-- constraint user_push_tokens_one_enabled_per_token cuando el mismo usuario
-- registraba el mismo expo_token desde un device_id diferente.
--
-- Escenario de fallo:
--   1. Existe fila: device_id=D_old, expo_token=T1, enabled=true, user_id=U1
--   2. App reinstalada → mismo token T1, device_id cambia a D_new
--   3. Paso 1 original: UPDATE WHERE user_id <> U1 → no encuentra nada (mismo user)
--   4. Paso 2: INSERT → ya hay T1+enabled=true en D_old → viola constraint → 23505
--
-- Solución: el Paso 1 deshabilita el token en CUALQUIER fila que no sea exactamente
-- el par (user_id, device_id) que se va a upsertear. Cubre:
--   - otro usuario con el mismo token (caso original)
--   - mismo usuario, mismo token, diferente device_id (reinstalación / re-login)

CREATE OR REPLACE FUNCTION public.rpc_claim_push_token(
  p_user_id   uuid,
  p_device_id text,
  p_expo_token text,
  p_platform  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- 1) Deshabilitar este expo_token en CUALQUIER fila previa que no sea
  --    exactamente el par (user_id, device_id) que vamos a upsertear.
  --    Antes: AND user_id <> p_user_id  ← no cubría mismo user, distinto device
  --    Ahora: NOT (user_id = p_user_id AND device_id = p_device_id)
  UPDATE public.user_push_tokens
  SET    enabled    = false,
         updated_at = now()
  WHERE  expo_token = p_expo_token
    AND  enabled    = true
    AND  NOT (user_id = p_user_id AND device_id = p_device_id);

  -- 2) Upsert por device_id: si ya existe ese device lo actualiza,
  --    si no existe lo inserta. En ambos casos queda enabled = true.
  INSERT INTO public.user_push_tokens
         (user_id, device_id, expo_token, platform, enabled, updated_at)
  VALUES (p_user_id, p_device_id, p_expo_token, p_platform, true, now())
  ON CONFLICT (device_id)
  DO UPDATE SET
    user_id    = excluded.user_id,
    expo_token = excluded.expo_token,
    platform   = excluded.platform,
    enabled    = true,
    updated_at = now();
END;
$$;
