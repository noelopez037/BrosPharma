import { router } from "expo-router";

// Navega hacia atras si hay historial; si no, cae a una ruta segura.
export function goBackSafe(fallback: any = "/(drawer)/(tabs)") {
  try {
    const can = typeof (router as any)?.canGoBack === "function" ? (router as any).canGoBack() : false;
    if (can) router.back();
    else router.replace(fallback as any);
  } catch {
    router.replace(fallback as any);
  }
}
