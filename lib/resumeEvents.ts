type Listener = () => void;

const listeners = new Set<Listener>();

let _lastResumeAt: number | null = null;

// Deduplicación: previene múltiples emits en el mismo ciclo de recovery.
// Si emitAppResumed() se llama dentro de EMIT_DEBOUNCE_MS desde el último emit,
// el nuevo emit se ignora (cubre SIGNED_OUT espurio y race conditions).
const EMIT_DEBOUNCE_MS = 500;
let _lastEmitAt: number | null = null;
let _emitCountThisCycle = 0;

export function onAppResumed(cb: Listener) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function emitAppResumed() {
  const now = Date.now();

  if (_lastEmitAt !== null && now - _lastEmitAt < EMIT_DEBOUNCE_MS) {
    console.warn(
      `[resume] emitAppResumed ignorado — debounce (${now - _lastEmitAt}ms desde último emit, ciclo #${_emitCountThisCycle})`,
    );
    return;
  }

  _lastEmitAt = now;
  _emitCountThisCycle += 1;

  if (__DEV__) {
    console.log(
      `[resume] emitAppResumed — emit #${_emitCountThisCycle} en este ciclo, listeners=${listeners.size}`,
    );
  }

  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // ignorar errores de listeners individuales
    }
  });
}

/** Marca el inicio de un nuevo ciclo de foreground y resetea el contador de emits. */
export function markAppResumed() {
  _lastResumeAt = Date.now();
  _emitCountThisCycle = 0;
  _lastEmitAt = null;
  if (__DEV__) console.log("[resume] markAppResumed — nuevo ciclo iniciado");
}

/** Devuelve true si la app volvió del background hace menos de `withinMs` ms. */
export function isRecentResume(withinMs = 15_000) {
  if (_lastResumeAt === null) return false;
  return Date.now() - _lastResumeAt < withinMs;
}
