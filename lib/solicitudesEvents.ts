type Listener = () => void;

const listeners = new Set<Listener>();

export function onSolicitudesChanged(cb: Listener) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function emitSolicitudesChanged() {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // ignore listener errors
    }
  });
}
