type Listener = () => void;

const listeners = new Set<Listener>();

let _lastResumeAt: number | null = null;

// Deduplicación: previene emits duplicados en ráfaga (ej. dos listeners disparando
// el mismo ciclo en <100ms). El valor es bajo (150ms) para no bloquear el segundo
// emit legítimo cuando TOKEN_REFRESHED llega poco después del emit optimista.
// Un segundo emit >150ms después sí debe pasar (trae token y empresa válidos).
const EMIT_DEBOUNCE_MS = 150;
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
