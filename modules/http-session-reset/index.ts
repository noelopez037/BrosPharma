import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

interface HttpSessionResetModule {
  resetAsync(): Promise<void>;
}

// requireOptionalNativeModule devuelve null si el módulo no está compilado
// (ej. primera corrida antes de rebuild) en vez de crashear la app.
const mod: HttpSessionResetModule | null =
  Platform.OS !== "web"
    ? requireOptionalNativeModule<HttpSessionResetModule>("HttpSessionReset")
    : null;

/**
 * Resets the OS-level HTTP connection pool.
 *
 * iOS  → URLSession.shared.reset() — evicts all zombie TCP connections from
 *         NSURLSession's connection pool. Same effect as killing the app.
 * Android → evicts all connections from OkHttp's connection pool.
 * Web  → no-op.
 */
export async function resetHttpSession(): Promise<void> {
  if (!mod) {
    console.warn("[HttpSessionReset] módulo nativo no disponible — necesita rebuild");
    return;
  }
  await mod.resetAsync();
}
