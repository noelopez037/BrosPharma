type Listener = () => void;

const listeners = new Set<Listener>();

let _lastResumeAt: number | null = null;

export function onAppResumed(cb: Listener) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function emitAppResumed() {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // ignore listener errors
    }
  });
}

/** Marca el momento en que la app volvió al foreground. */
export function markAppResumed() {
  _lastResumeAt = Date.now();
}

/** Devuelve true si la app volvió del background hace menos de `withinMs` ms. */
export function isRecentResume(withinMs = 15_000) {
  if (_lastResumeAt === null) return false;
  return Date.now() - _lastResumeAt < withinMs;
}
