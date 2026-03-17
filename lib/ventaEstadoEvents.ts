type Listener = () => void;

const listeners = new Set<Listener>();

export function onVentaEstadoChanged(cb: Listener) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function emitVentaEstadoChanged() {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // ignore listener errors
    }
  });
}
