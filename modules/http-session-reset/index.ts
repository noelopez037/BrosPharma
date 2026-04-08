import { requireNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

interface HttpSessionResetModule {
  resetAsync(): Promise<void>;
}

// On web there's no native module — no-op.
const mod: HttpSessionResetModule | null =
  Platform.OS !== "web"
    ? requireNativeModule("HttpSessionReset")
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
  if (!mod) return;
  await mod.resetAsync();
}
