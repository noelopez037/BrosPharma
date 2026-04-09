// lib/networkRecovery.ts
//
// Recovery automático al reconectar la red.
// Escucha transiciones offline → online y ejecuta el mismo ciclo de recovery
// que el listener de AppState, cubriendo el caso de cambio de red en foreground
// (WiFi ↔ datos, pérdida y retorno) donde AppState.change NO se dispara.
//
// Uso: llamar startNetworkRecovery() desde el useEffect raíz de _layout.tsx
// y stopNetworkRecovery() en el cleanup.

import NetInfo from "@react-native-community/netinfo";
import { AppState } from "react-native";

import { resetHttpSession } from "../modules/http-session-reset";
import { supabase } from "./supabase";
import { invalidateAll } from "./productoCache";
import { refreshEmpresaActiva } from "./useEmpresaActiva";
import { emitAppResumed, markAppResumed } from "./resumeEvents";

const EMPRESA_TIMEOUT_MS = 5_000;

let _unsubscribe: (() => void) | null = null;
let _lastWasConnected: boolean | null = null;
let _recoveryInProgress = false;

async function runNetworkRecovery() {
  if (_recoveryInProgress) {
    console.warn("[network-recovery] recovery ya en progreso — ignorando trigger");
    return;
  }

  _recoveryInProgress = true;
  const t0 = Date.now();
  console.log("[network-recovery] reconexión detectada — iniciando recovery (trigger: reconnect)");

  try {
    // 1. Limpiar pool TCP zombie (mismo que en AppState active)
    console.log("[network-recovery] resetHttpSession — inicio");
    await resetHttpSession();
    console.log(`[network-recovery] resetHttpSession — listo en ${Date.now() - t0}ms`);

    // 2. Reactivar auto-refresh (puede haberse pausado o fallado)
    void supabase.auth.startAutoRefresh();

    // 3. Limpiar cache de productos
    invalidateAll();

    // 4. Marcar inicio de ciclo (resetea contador de emits)
    markAppResumed();

    // 5. Esperar empresa con timeout antes de emitir
    let empresaReady = false;
    try {
      await Promise.race([
        refreshEmpresaActiva(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("empresa timeout")), EMPRESA_TIMEOUT_MS),
        ),
      ]);
      empresaReady = true;
      console.log(`[network-recovery] empresaActiva lista en ${Date.now() - t0}ms`);
    } catch (e: any) {
      console.warn(
        `[network-recovery] recovery degraded: empresa no lista tras ${Date.now() - t0}ms — ${e?.message ?? e}`,
      );
    }

    // 6. Emitir resume a todas las pantallas
    emitAppResumed();

    console.log(
      `[network-recovery] recovery completo en ${Date.now() - t0}ms | empresaReady=${empresaReady}`,
    );
  } catch (e: any) {
    console.warn("[network-recovery] error en recovery:", e?.message ?? e);
  } finally {
    _recoveryInProgress = false;
  }
}

/**
 * Inicia el listener de conectividad.
 * Solo dispara recovery en la transición offline → online mientras la app
 * está en foreground. Llamar desde useEffect en _layout.tsx.
 */
export function startNetworkRecovery() {
  if (_unsubscribe) return; // ya iniciado

  if (__DEV__) console.log("[network-recovery] listener iniciado");

  _unsubscribe = NetInfo.addEventListener((state) => {
    const isConnected = state.isConnected === true;
    const wasConnected = _lastWasConnected;
    _lastWasConnected = isConnected;

    if (__DEV__) {
      console.log(
        `[network-recovery] estado red: ${wasConnected} → ${isConnected} | type=${state.type} | appState=${AppState.currentState}`,
      );
    }

    // Solo disparar en transición offline → online
    if (wasConnected === null) return; // estado inicial, no recovery
    if (wasConnected === true) return; // ya estaba conectado
    if (!isConnected) return; // sigue sin conexión

    // Solo si la app está en foreground
    if (AppState.currentState !== "active") {
      if (__DEV__)
        console.log("[network-recovery] red reconectada pero app en background — recovery omitido");
      return;
    }

    void runNetworkRecovery();
  });
}

/**
 * Detiene el listener. Llamar en el cleanup del useEffect.
 */
export function stopNetworkRecovery() {
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
  _lastWasConnected = null;
  if (__DEV__) console.log("[network-recovery] listener detenido");
}
