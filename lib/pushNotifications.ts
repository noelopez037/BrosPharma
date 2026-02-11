import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import * as Application from "expo-application";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";

import { supabase } from "./supabase";

type RegisterPushTokenDebugInfo = {
  platform: "ios" | "android" | "web" | "unknown";
  isDevice: boolean | null;
  projectId?: string;
  permissions?: Notifications.PermissionStatus;
  tokenPreview?: string;
  deviceIdPreview?: string;
  hadStoredToken?: boolean;
};

type RegisterPushTokenResult =
  | { ok: true; expoToken: string; didUpsert: boolean; debug?: RegisterPushTokenDebugInfo }
  | {
      ok: false;
      reason:
        | "unsupported_platform"
        | "no_session"
        | "user_mismatch"
        | "logout_in_progress"
        | "throttled"
        | "permission_denied"
        | "token_unavailable"
        | "supabase_error";
      error?: unknown;
      debug?: RegisterPushTokenDebugInfo;
    };

const STORAGE_PREFIX = "pushToken:lastRegistered:";
const DEVICE_ID_STORAGE_KEY = "pushToken:deviceId:v1";
let inFlight: { key: string; promise: Promise<RegisterPushTokenResult> } | null = null;
let logoutSeq = 0;
let suppressClaims = false;

type ClaimPushOptions = {
  forceUpsert?: boolean;
  reason?: string;
};

const SUCCESS_THROTTLE_MS = 15_000;
const FAILURE_BACKOFF_MS = 60_000;
const lastSuccessAtByKey = new Map<string, number>();
const lastFailureAtByUser = new Map<string, number>();

export function beginPushLogoutGuard(): void {
  logoutSeq += 1;
  suppressClaims = true;
}

export function endPushLogoutGuard(): void {
  suppressClaims = false;
}

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

function generateUuidV4(): string {
  const c = (globalThis as any)?.crypto;
  if (c?.randomUUID) return String(c.randomUUID());

  // Fallback: not cryptographically strong, but persisted and only used when native IDs unavailable.
  const bytes = new Array(16).fill(0).map(() => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
}

async function getStableDeviceId(): Promise<string> {
  try {
    if (Platform.OS === "ios") {
      const idfv = await Application.getIosIdForVendorAsync();
      const v = String(idfv ?? "").trim();
      if (v) return v;
    }

    if (Platform.OS === "android") {
      // Some expo-application versions expose an async getter.
      const getAndroidId = (Application as any).getAndroidId as
        | undefined
        | (() => Promise<string> | string);
      if (typeof getAndroidId === "function") {
        const maybe = getAndroidId();
        const resolved = typeof maybe === "string" ? maybe : await maybe;
        const v = String(resolved ?? "").trim();
        if (v) return v;
      }

      const androidId = (Application as any).androidId;
      const v = String(androidId ?? "").trim();
      if (v) return v;
    }
  } catch {
    // fall through to persisted UUID
  }

  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY);
    const v = String(existing ?? "").trim();
    if (v) return v;
  } catch {
    // ignore
  }

  const created = String(generateUuidV4()).trim() || `uuid-${Date.now()}`;
  AsyncStorage.setItem(DEVICE_ID_STORAGE_KEY, created).catch(() => {});
  return created;
}

async function getStoredTokenForUser(userId: string, deviceId: string): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(`${STORAGE_PREFIX}${userId}:${deviceId}`);
    return v ? String(v) : null;
  } catch {
    return null;
  }
}

async function setStoredTokenForUser(
  userId: string,
  deviceId: string,
  token: string
): Promise<void> {
  try {
    await AsyncStorage.setItem(`${STORAGE_PREFIX}${userId}:${deviceId}`, token);
  } catch {
    // ignore
  }
}

function makeAbortResult(debugInfo: RegisterPushTokenDebugInfo, reason: "logout_in_progress" | "no_session" | "user_mismatch"): RegisterPushTokenResult {
  return {
    ok: false,
    reason,
    debug: __DEV__ ? debugInfo : undefined,
  };
}

function previewId(id: string | null | undefined): string | undefined {
  const v = String(id ?? "").trim();
  if (!v) return undefined;
  return `...${v.slice(-6)}`;
}

function shouldAbortClaim(startSeq: number): boolean {
  // Any logout transition invalidates in-flight claims.
  if (startSeq !== logoutSeq) return true;
  // During logout we *always* suppress claiming, even if the session is still briefly present.
  if (suppressClaims) return true;
  return false;
}

export async function claimPushForCurrentSession(
  supabase: SupabaseClient,
  options?: ClaimPushOptions
): Promise<RegisterPushTokenResult> {
  const debugInfo: RegisterPushTokenDebugInfo = {
    platform:
      Platform.OS === "ios" || Platform.OS === "android" || Platform.OS === "web"
        ? Platform.OS
        : "unknown",
    isDevice: Device.isDevice ?? null,
  };

  const startSeq = logoutSeq;
  const reason = String(options?.reason ?? "").trim() || "claim";
  const forceUpsert = !!options?.forceUpsert;

  if (__DEV__) {
    console.log("[push] claim:start", {
      reason,
      platform: debugInfo.platform,
      isDevice: debugInfo.isDevice,
      forceUpsert,
      startSeq,
      logoutSeq,
      suppressClaims,
    });
  }

  try {
    const { data } = await supabase.auth.getSession();
    const userId = data?.session?.user?.id ?? null;

    if (shouldAbortClaim(startSeq)) {
      const res = makeAbortResult(debugInfo, "logout_in_progress");
      if (__DEV__) console.log("[push] claim:aborted", res);
      return res;
    }

    if (!userId) {
      const res = makeAbortResult(debugInfo, "no_session");
      if (__DEV__) console.log("[push] claim:no_session", res);
      return res;
    }

    // Delegate to the same core flow as registerPushToken, but without depending on caller-provided userId.
    return await registerPushTokenCore({
      supabase,
      userId,
      debug: __DEV__,
      startSeq,
      forceUpsert,
      reason,
    });
  } catch (error) {
    console.error("[push] claim:error", error);
    return {
      ok: false,
      reason: "token_unavailable",
      error,
      debug: __DEV__ ? debugInfo : undefined,
    };
  }
}

async function registerPushTokenCore(opts: {
  supabase: SupabaseClient;
  userId: string;
  debug?: boolean;
  startSeq: number;
  forceUpsert?: boolean;
  reason?: string;
}): Promise<RegisterPushTokenResult> {
  const debugInfo: RegisterPushTokenDebugInfo = {
    platform:
      Platform.OS === "ios" || Platform.OS === "android" || Platform.OS === "web"
        ? Platform.OS
        : "unknown",
    isDevice: Device.isDevice ?? null,
  };

  if (__DEV__) {
    console.info("[push] claim:called", {
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
    if (__DEV__) console.info("[push] claim:result", res);
    return res;
  }

  if (shouldAbortClaim(opts.startSeq)) {
    const res = makeAbortResult(debugInfo, "logout_in_progress");
    if (__DEV__) console.info("[push] claim:aborted", res);
    return res;
  }

  const reason = String(opts.reason ?? "").trim() || "claim";
  const forceUpsert = !!opts.forceUpsert;
  const inFlightKey = `${opts.userId}:${forceUpsert ? "1" : "0"}`;

  if (inFlight && inFlight.key === inFlightKey) return inFlight.promise;

  const nowMs = Date.now();
  const lastFailAt = lastFailureAtByUser.get(opts.userId) ?? 0;
  if (!forceUpsert && lastFailAt > 0 && nowMs - lastFailAt < FAILURE_BACKOFF_MS) {
    const res: RegisterPushTokenResult = {
      ok: false,
      reason: "throttled",
      debug: opts.debug ? debugInfo : undefined,
    };
    if (__DEV__) {
      console.info("[push] claim:failure_backoff", {
        reason,
        userId: opts.userId,
        elapsedMs: nowMs - lastFailAt,
        res,
      });
    }
    return res;
  }

  inFlight = {
    key: inFlightKey,
    promise: (async () => {
    try {
      const { data: s0 } = await opts.supabase.auth.getSession();
      const currentUserId0 = s0?.session?.user?.id ?? null;
      if (!currentUserId0) {
        const res = makeAbortResult(debugInfo, "no_session");
        if (__DEV__) console.info("[push] claim:no_session", { reason, res });
        return res;
      }
      if (String(currentUserId0) !== String(opts.userId)) {
        const res = makeAbortResult(debugInfo, "user_mismatch");
        if (__DEV__) {
          console.info("[push] claim:user_mismatch", {
            reason,
            expected: opts.userId,
            actual: currentUserId0,
          });
        }
        return res;
      }

      const markFailure = () => {
        lastFailureAtByUser.set(opts.userId, Date.now());
      };

      const permissions = await Notifications.getPermissionsAsync();
      let status = permissions.status;
      if (status !== "granted") {
        const req = await Notifications.requestPermissionsAsync();
        status = req.status;
      }

      debugInfo.permissions = status;

      if (status !== "granted") {
        markFailure();
        const res: RegisterPushTokenResult = {
          ok: false,
          reason: "permission_denied",
          debug: opts.debug ? debugInfo : undefined,
        };
        if (__DEV__) console.info("[push] claim:result", res);
        return res;
      }

      if (shouldAbortClaim(opts.startSeq)) {
        const res = makeAbortResult(debugInfo, "logout_in_progress");
        if (__DEV__) console.info("[push] claim:aborted", res);
        return res;
      }

      const deviceId = String(await getStableDeviceId()).trim();
      debugInfo.deviceIdPreview = deviceId ? `...${deviceId.slice(-6)}` : undefined;

      if (__DEV__) {
        console.info("[push] claim:device", {
          userId: opts.userId,
          deviceIdPreview: debugInfo.deviceIdPreview,
        });
      }

       if (!deviceId) {
         markFailure();
         const res: RegisterPushTokenResult = {
           ok: false,
           reason: "token_unavailable",
           debug: opts.debug ? debugInfo : undefined,
         };
         if (__DEV__) console.info("[push] claim:result", res);
         return res;
       }

      if (Platform.OS === "ios" && Device.isDevice === false) {
        markFailure();
        const res: RegisterPushTokenResult = {
          ok: false,
          reason: "token_unavailable",
          debug: opts.debug ? debugInfo : undefined,
        };
        if (__DEV__) console.info("[push] claim:result", res);
        return res;
      }

      const projectId = getExpoProjectId();
      debugInfo.projectId = projectId;
      try {
        const { data } = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined
        );
        const expoToken = String(data ?? "").trim();

        debugInfo.tokenPreview = expoToken ? `...${expoToken.slice(-6)}` : undefined;

        if (__DEV__) {
          console.info("[push] claim:token", {
            userId: opts.userId,
            deviceIdPreview: debugInfo.deviceIdPreview,
            tokenPreview: debugInfo.tokenPreview,
          });
        }

        if (!expoToken) {
          markFailure();
          const res: RegisterPushTokenResult = {
            ok: false,
            reason: "token_unavailable",
            debug: opts.debug ? debugInfo : undefined,
          };
          if (__DEV__) console.info("[push] claim:result", res);
          return res;
        }

        if (shouldAbortClaim(opts.startSeq)) {
          const res = makeAbortResult(debugInfo, "logout_in_progress");
          if (__DEV__) console.info("[push] claim:aborted", res);
          return res;
        }

        const stored = await getStoredTokenForUser(opts.userId, deviceId);
        debugInfo.hadStoredToken = stored === expoToken;

        const platform = Platform.OS;

        if (shouldAbortClaim(opts.startSeq)) {
          const res = makeAbortResult(debugInfo, "logout_in_progress");
          if (__DEV__) console.info("[push] claim:aborted", res);
          return res;
        }

        const expoTokenPrefix = expoToken.slice(0, 22);
        const throttleKey = `${opts.userId}:${deviceId}:${expoToken}`;
        const nowMs = Date.now();
        const lastOkAt = lastSuccessAtByKey.get(throttleKey) ?? 0;
        if (!forceUpsert && lastOkAt > 0 && nowMs - lastOkAt < SUCCESS_THROTTLE_MS) {
          const res: RegisterPushTokenResult = {
            ok: true,
            expoToken,
            didUpsert: false,
            debug: opts.debug ? debugInfo : undefined,
          };
          if (__DEV__) {
            console.info("[push] claim:throttled", {
              reason,
              userId: opts.userId,
              deviceId,
              expoTokenPrefix,
              elapsedMs: nowMs - lastOkAt,
              res,
            });
          }
          return res;
        }

        const { data: s1 } = await opts.supabase.auth.getSession();
        const currentUserId1 = s1?.session?.user?.id ?? null;
        if (!currentUserId1) {
          const res = makeAbortResult(debugInfo, "no_session");
          if (__DEV__) console.info("[push] claim:no_session", { reason, res });
          return res;
        }
        if (String(currentUserId1) !== String(opts.userId)) {
          const res = makeAbortResult(debugInfo, "user_mismatch");
          if (__DEV__) {
            console.info("[push] claim:user_mismatch", {
              reason,
              expected: opts.userId,
              actual: currentUserId1,
              deviceId,
              expoTokenPrefix,
            });
          }
          return res;
        }

        if (__DEV__) {
          console.info("[push] claim:rpc:before", {
            reason,
            userId: opts.userId,
            deviceId,
            expoTokenPrefix,
            forceUpsert,
          });
        }

        const claim = await opts.supabase.rpc("rpc_claim_push_token", {
          p_user_id: opts.userId,
          p_device_id: deviceId,
          p_expo_token: expoToken,
          p_platform: platform,
        });

        if (claim.error) {
          markFailure();
          if (__DEV__) {
            console.info("[push] claim:rpc:after", {
              reason,
              userId: opts.userId,
              deviceId,
              expoTokenPrefix,
              ok: false,
              error: claim.error,
            });
          }
          console.error("[push] claim:rpc_failed", claim.error);
          const res: RegisterPushTokenResult = {
            ok: false,
            reason: "supabase_error",
            error: claim.error,
            debug: opts.debug ? debugInfo : undefined,
          };
          if (__DEV__) console.info("[push] claim:result", res);
          return res;
        }

        lastSuccessAtByKey.set(throttleKey, nowMs);
        lastFailureAtByUser.delete(opts.userId);

        if (__DEV__) {
          console.info("[push] claim:rpc:after", {
            reason,
            userId: opts.userId,
            deviceId,
            expoTokenPrefix,
            ok: true,
          });
        }

        if (__DEV__) {
          console.log("[push] claim:done", {
            userId: opts.userId,
            deviceIdPreview: `...${deviceId.slice(-6)}`,
          });
        }

        await setStoredTokenForUser(opts.userId, deviceId, expoToken);
        const res: RegisterPushTokenResult = {
          ok: true,
          expoToken,
          didUpsert: true,
          debug: opts.debug ? debugInfo : undefined,
        };
        if (__DEV__) {
          console.info("[push] claim:success", {
            ok: true,
            userId: opts.userId,
            deviceIdPreview: debugInfo.deviceIdPreview,
            tokenPreview: debugInfo.tokenPreview,
          });
        }
        return res;
      } catch (error) {
        markFailure();
        console.error(
          "[push] claim:token_error",
          { userIdPreview: previewId(opts.userId) },
          error
        );
        const res: RegisterPushTokenResult = {
          ok: false,
          reason: "token_unavailable",
          error,
          debug: opts.debug ? debugInfo : undefined,
        };
        if (__DEV__) {
          const projectHint =
            Platform.OS === "ios" && !projectId ? "Missing projectId for iOS device" : undefined;
          console.info("[push] claim:token_error", {
            reason: projectHint,
            userId: opts.userId,
            deviceIdPreview: debugInfo.deviceIdPreview,
            error,
          });
          console.info("[push] claim:done", {
            ok: false,
            reason: res.reason,
            userId: opts.userId,
            deviceIdPreview: debugInfo.deviceIdPreview,
            tokenPreview: debugInfo.tokenPreview,
          });
        }
        return res;
      }
    } catch (error) {
      lastFailureAtByUser.set(opts.userId, Date.now());
      console.error("[push] claim:core_error", { userIdPreview: previewId(opts.userId) }, error);
      const res: RegisterPushTokenResult = {
        ok: false,
        reason: "token_unavailable",
        error,
        debug: opts.debug ? debugInfo : undefined,
      };
      if (__DEV__) {
        console.info("[push] claim:done", {
          ok: false,
          reason: res.reason,
          userId: opts.userId,
          deviceIdPreview: debugInfo.deviceIdPreview,
          tokenPreview: debugInfo.tokenPreview,
          error,
        });
      }
      return res;
    } finally {
      inFlight = null;
    }
  })(),
  };

  return inFlight.promise;
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

  const startSeq = logoutSeq;

  const { data } = await opts.supabase.auth.getSession();
  const currentUserId = data?.session?.user?.id ?? null;

  if (shouldAbortClaim(startSeq)) {
    const res = makeAbortResult(debugInfo, "logout_in_progress");
    if (__DEV__) console.info("[push] registerPushToken:aborted", res);
    return res;
  }

  if (!currentUserId) {
    const res = makeAbortResult(debugInfo, "no_session");
    if (__DEV__) console.info("[push] registerPushToken:no_session", res);
    return res;
  }

  if (String(currentUserId) !== String(opts.userId)) {
    const res = makeAbortResult(debugInfo, "user_mismatch");
    if (__DEV__) {
      console.info("[push] registerPushToken:user_mismatch", {
        expected: opts.userId,
        actual: currentUserId,
      });
    }
    return res;
  }

  return registerPushTokenCore({
    supabase: opts.supabase,
    userId: opts.userId,
    debug: opts.debug,
    startSeq,
  });
}

function isMissingUpdatedAtColumnError(error: PostgrestError): boolean {
  const msg = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return msg.includes("updated_at") && (msg.includes("schema cache") || msg.includes("does not exist"));
}

export async function disablePushForThisDevice(): Promise<void> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return;

  try {
    const deviceId = String(await getStableDeviceId()).trim();
    if (!deviceId) return;

    const deviceIdPreview = `...${deviceId.slice(-6)}`;
    if (__DEV__) console.info("[push] disable:start", { deviceIdPreview });

    const isoNow = new Date().toISOString();
    const { error } = await supabase
      .from("user_push_tokens")
      .update({ enabled: false, updated_at: isoNow })
      .eq("device_id", deviceId);

    if (!error) {
      if (__DEV__) console.info("[push] disable:done", { deviceIdPreview });
      return;
    }

    if (isMissingUpdatedAtColumnError(error)) {
      const { error: retryError } = await supabase
        .from("user_push_tokens")
        .update({ enabled: false })
        .eq("device_id", deviceId);
      if (!retryError) {
        if (__DEV__) console.info("[push] disable:done", { deviceIdPreview });
        return;
      }
      throw retryError;
    }

    throw error;
  } catch (err: unknown) {
    if (__DEV__) console.warn("[push] disable token failed", err);
  }
}
