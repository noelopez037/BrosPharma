type Listener = () => void;

const listeners = new Set<Listener>();

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
