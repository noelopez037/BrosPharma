import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";

type RegisterPushTokenDebugInfo = {
  platform: "ios" | "android" | "web" | "unknown";
  isDevice: boolean | null;
  projectId?: string;
  permissions?: Notifications.PermissionStatus;
  tokenPreview?: string;
  hadStoredToken?: boolean;
  usedThrottle?: "success" | "failure";
};

type RegisterPushTokenResult =
  | { ok: true; expoToken: string; didUpsert: boolean; debug?: RegisterPushTokenDebugInfo }
  | {
      ok: false;
      reason:
        | "unsupported_platform"
        | "throttled"
        | "permission_denied"
        | "token_unavailable"
        | "supabase_error";
      error?: unknown;
      debug?: RegisterPushTokenDebugInfo;
    };

const STORAGE_PREFIX = "pushToken:lastRegistered:";

const SUCCESS_THROTTLE_MS = 10 * 60 * 1000;
const FAILURE_BACKOFF_MS = 60 * 1000;
const lastSuccessAtByUser = new Map<string, number>();
const lastFailureAtByUser = new Map<string, number>();
let inFlight: Promise<RegisterPushTokenResult> | null = null;

function getExpoProjectId(): string | undefined {
  // Recommended by Expo for EAS builds.
  // - In EAS build/runtime: Constants.easConfig?.projectId
  // - In dev/Expo Go: projectId may be absent; getExpoPushTokenAsync can still work.
  // - Optional override: EXPO_PUBLIC_EAS_PROJECT_ID
  const fromEnv = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  const fromEas = (Constants as any)?.easConfig?.projectId as string | undefined;
  const fromExtra = (Constants as any)?.expoConfig?.extra?.eas?.projectId as
    | string
    | undefined;
  return fromEas ?? fromExtra ?? fromEnv;
}

async function getStoredTokenForUser(userId: string): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(`${STORAGE_PREFIX}${userId}`);
    return v ? String(v) : null;
  } catch {
    return null;
  }
}

async function setStoredTokenForUser(userId: string, token: string): Promise<void> {
  try {
    await AsyncStorage.setItem(`${STORAGE_PREFIX}${userId}`, token);
  } catch {
    // ignore
  }
}

export async function registerPushToken(opts: {
  supabase: SupabaseClient;
  userId: string;
  debug?: boolean;
}): Promise<RegisterPushTokenResult> {
  const debugInfo: RegisterPushTokenDebugInfo = {
    platform:
      Platform.OS === "ios" || Platform.OS === "android" || Platform.OS === "web"
        ? Platform.OS
        : "unknown",
    isDevice: Device.isDevice ?? null,
  };

  if (__DEV__) {
    console.info("[push] registerPushToken:called", {
      userId: opts.userId,
      platform: debugInfo.platform,
      isDevice: debugInfo.isDevice,
    });
  }

  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    const res: RegisterPushTokenResult = {
      ok: false,
      reason: "unsupported_platform",
      debug: opts.debug ? debugInfo : undefined,
    };
    if (__DEV__) console.info("[push] registerPushToken:result", res);
    return res;
  }

  if (inFlight) return inFlight;

  const now = Date.now();
  const lastSuccessAt = lastSuccessAtByUser.get(opts.userId) ?? 0;
  if (now - lastSuccessAt < SUCCESS_THROTTLE_MS) {
    debugInfo.usedThrottle = "success";
    const res: RegisterPushTokenResult = {
      ok: false,
      reason: "throttled",
      debug: opts.debug ? debugInfo : undefined,
    };
    if (__DEV__) console.info("[push] registerPushToken:result", res);
    return res;
  }

  const lastFailureAt = lastFailureAtByUser.get(opts.userId) ?? 0;
  if (now - lastFailureAt < FAILURE_BACKOFF_MS) {
    debugInfo.usedThrottle = "failure";
    const res: RegisterPushTokenResult = {
      ok: false,
      reason: "throttled",
      debug: opts.debug ? debugInfo : undefined,
    };
    if (__DEV__) console.info("[push] registerPushToken:result", res);
    return res;
  }

  inFlight = (async () => {
    try {
      // iOS push token registration generally requires a physical device.
      // We still attempt token retrieval because Android emulators / some dev setups may succeed.
      // If it fails, we just stop.
      const permissions = await Notifications.getPermissionsAsync();
      let status = permissions.status;
      if (status !== "granted") {
        const req = await Notifications.requestPermissionsAsync();
        status = req.status;
      }

      debugInfo.permissions = status;

      if (status !== "granted") {
        lastFailureAtByUser.set(opts.userId, Date.now());
        const res: RegisterPushTokenResult = {
          ok: false,
          reason: "permission_denied",
          debug: opts.debug ? debugInfo : undefined,
        };
        if (__DEV__) console.info("[push] registerPushToken:result", res);
        return res;
      }

      // Optional: skip obviously unsupported iOS simulator path.
      if (Platform.OS === "ios" && Device.isDevice === false) {
        lastFailureAtByUser.set(opts.userId, Date.now());
        const res: RegisterPushTokenResult = {
          ok: false,
          reason: "token_unavailable",
          debug: opts.debug ? debugInfo : undefined,
        };
        if (__DEV__) console.info("[push] registerPushToken:result", res);
        return res;
      }

      const projectId = getExpoProjectId();
      debugInfo.projectId = projectId;
      let expoToken = "";
      try {
        const tokenResp = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined
        );
        expoToken = String(tokenResp.data ?? "").trim();
      } catch (error) {
        lastFailureAtByUser.set(opts.userId, Date.now());
        const res: RegisterPushTokenResult = {
          ok: false,
          reason: "token_unavailable",
          error,
          debug: opts.debug ? debugInfo : undefined,
        };
        if (__DEV__) {
          const projectHint =
            Platform.OS === "ios" && !projectId
              ? "Missing projectId for iOS device"
              : undefined;
          console.info("[push] registerPushToken:token_error", {
            reason: projectHint,
            error,
          });
          console.info("[push] registerPushToken:result", res);
        }
        return res;
      }

      debugInfo.tokenPreview = expoToken ? `...${expoToken.slice(-6)}` : undefined;

      if (!expoToken) {
        lastFailureAtByUser.set(opts.userId, Date.now());
        const res: RegisterPushTokenResult = {
          ok: false,
          reason: "token_unavailable",
          debug: opts.debug ? debugInfo : undefined,
        };
        if (__DEV__) console.info("[push] registerPushToken:result", res);
        return res;
      }

      const stored = await getStoredTokenForUser(opts.userId);
      debugInfo.hadStoredToken = stored === expoToken;
      if (stored === expoToken) {
        lastSuccessAtByUser.set(opts.userId, Date.now());
        const res: RegisterPushTokenResult = {
          ok: true,
          expoToken,
          didUpsert: false,
          debug: opts.debug ? debugInfo : undefined,
        };
        if (__DEV__) console.info("[push] registerPushToken:result", res);
        return res;
      }

      const platform = Platform.OS;

      const { error } = await opts.supabase
        .from("user_push_tokens")
        .upsert(
          {
            user_id: opts.userId,
            expo_token: expoToken,
            platform,
            enabled: true,
          },
          { onConflict: "expo_token" }
        );

      if (error) {
        lastFailureAtByUser.set(opts.userId, Date.now());
        const res: RegisterPushTokenResult = {
          ok: false,
          reason: "supabase_error",
          error,
          debug: opts.debug ? debugInfo : undefined,
        };
        if (__DEV__) console.info("[push] registerPushToken:result", res);
        return res;
      }

      await setStoredTokenForUser(opts.userId, expoToken);
      lastSuccessAtByUser.set(opts.userId, Date.now());
      const res: RegisterPushTokenResult = {
        ok: true,
        expoToken,
        didUpsert: true,
        debug: opts.debug ? debugInfo : undefined,
      };
      if (__DEV__) console.info("[push] registerPushToken:result", res);
      return res;
    } catch (error) {
      lastFailureAtByUser.set(opts.userId, Date.now());
      const res: RegisterPushTokenResult = {
        ok: false,
        reason: "token_unavailable",
        error,
        debug: opts.debug ? debugInfo : undefined,
      };
      if (__DEV__) console.info("[push] registerPushToken:result", res);
      return res;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
