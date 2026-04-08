/**
 * Envuelve una promesa (o thenable) con un timeout.
 * Si no resuelve en `ms` milisegundos, rechaza con un error amigable.
 *
 * Acepta `PromiseLike<T>` para ser compatible con los builders de Supabase
 * que implementan `.then()` pero no extienden `Promise` directamente.
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms = 8_000): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Tiempo agotado, verifica tu conexión")),
        ms
      )
    ),
  ]);
}
