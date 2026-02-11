import { useCallback, useMemo, useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { supabase } from "./supabase";

type RoleState = {
  role: string;
  uid: string | null;
  isReady: boolean;
  updatedAt: number;
};

let state: RoleState = {
  role: "",
  uid: null,
  isReady: false,
  updatedAt: 0,
};

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(patch: Partial<RoleState>) {
  state = { ...state, ...patch };
  emit();
}

function normalizeRole(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

const ROLE_CACHE_PREFIX = "role_cache_v1:";

async function cacheGet(uid: string) {
  const key = ROLE_CACHE_PREFIX + uid;
  try {
    if (Platform.OS === "web") {
      const v = localStorage.getItem(key);
      return v ? normalizeRole(v) : "";
    }
    const v = await SecureStore.getItemAsync(key);
    return v ? normalizeRole(v) : "";
  } catch {
    return "";
  }
}

async function cacheSet(uid: string, role: string) {
  const key = ROLE_CACHE_PREFIX + uid;
  const v = normalizeRole(role);
  try {
    if (Platform.OS === "web") {
      if (v) localStorage.setItem(key, v);
      else localStorage.removeItem(key);
      return;
    }
    if (v) await SecureStore.setItemAsync(key, v);
    else await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore
  }
}

async function fetchRole(uid: string): Promise<string> {
  // Prefer RPC: role from server-side context (current user)
  try {
    const { data, error } = await supabase.rpc("current_role");
    if (!error) {
      const r = normalizeRole(data);
      if (r) return r;
    }
  } catch {
    // fallback below
  }

  // Fallback: profiles.role
  const { data, error } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
  if (error) throw error;
  return normalizeRole((data as any)?.role);
}

let didInit = false;
let inflight: Promise<string> | null = null;
let inflightSeq = 0;

export async function refreshRole(reason?: string): Promise<string> {
  if (inflight) return inflight;

  const seq = ++inflightSeq;

  const p = (async () => {
    let result = "";
    try {
      const { data: sessData } = await supabase.auth.getSession();
      const uid = sessData?.session?.user?.id ?? null;

      if (__DEV__) {
        console.log("[role] refresh:start", {
          reason: reason ?? "manual",
          uid,
          prevRole: state.role,
          prevReady: state.isReady,
        });
      }

      if (!uid) {
        setState({ role: "", uid: null, isReady: true, updatedAt: Date.now() });
        if (__DEV__) console.log("[role] refresh:done", { uid: null, role: "" });
        result = "";
      } else {
        // If uid switched, clear role to avoid flashing previous user's permissions.
        if (state.uid && state.uid !== uid) {
          setState({ role: "", uid, isReady: false, updatedAt: Date.now() });
        } else {
          // Keep previous role while revalidating (avoid transient wipes)
          setState({ uid });
        }

        // If we don't have a role yet, try local cache so UI doesn't depend on network.
        if (!state.role) {
          const cached = await cacheGet(uid);
          if (cached) {
            setState({ role: cached, uid, isReady: true, updatedAt: Date.now() });
            if (__DEV__) console.log("[role] cache:hit", { uid, role: cached });
          }
        }

        try {
          const role = await fetchRole(uid);

          // Prevent applying a stale role if the active user changed mid-fetch.
          const { data: sessAfter } = await supabase.auth.getSession();
          const uidAfter = sessAfter?.session?.user?.id ?? null;
          if (uidAfter !== uid) {
            if (__DEV__) console.log("[role] refresh:stale", { uid, uidAfter, stateUid: state.uid });

            // Stale-safe return: never return an unrelated user's role.
            if (state.uid === uidAfter) {
              result = state.role;
            } else {
              if (__DEV__) console.log("[role] refresh:stale_discarded", { uid, uidAfter, stateUid: state.uid });
              result = "";
            }
          } else {
            void cacheSet(uid, role);
            setState({ role, uid, isReady: true, updatedAt: Date.now() });
            if (__DEV__) console.log("[role] refresh:done", { uid, role });
            result = role;
          }
        } catch (e: any) {
          // Rule: never clear role on transient failures while session exists.
          const { data: sess2 } = await supabase.auth.getSession();
          const uid2 = sess2?.session?.user?.id ?? null;
          const hasSession = !!uid2;

          const msg = String(e?.message ?? e ?? "unknown");
          if (__DEV__) console.warn("[role] refresh:error", { reason: reason ?? "manual", uid: uid2 ?? uid, message: msg });

          if (!hasSession) {
            if (uid) void cacheSet(uid, "");
            setState({ role: "", uid: null, isReady: true, updatedAt: Date.now() });
            result = "";
          } else {
            // Keep role (if any). If we don't have one yet, remain not-ready to avoid false "sin permiso".
            setState({ uid: uid2, isReady: !!state.role, updatedAt: Date.now() });
            result = state.role;
          }
        }
      }
    } finally {
      // Only clear if we're still the active inflight.
      if (inflightSeq === seq) inflight = null;
    }

    return result;
  })();

  inflight = p;
  return p;
}

function ensureInit() {
  if (didInit) return;
  didInit = true;

  void refreshRole("init").catch(() => {});

  supabase.auth.onAuthStateChange((event, session) => {
    const uid = session?.user?.id ?? null;
    if (__DEV__) console.log("[role] auth", { event, uid });

    if (event === "SIGNED_OUT") {
      const prevUid = state.uid;
      if (prevUid) void cacheSet(prevUid, "");
      setState({ role: "", uid: null, isReady: true, updatedAt: Date.now() });
      if (__DEV__) console.log("[role] cleared", { event });
      return;
    }

    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
      // Force an immediate refresh on session changes, even if an old refresh is still running.
      inflight = null;
      void refreshRole(event).catch(() => {});
    }
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return state;
}

export function useRole() {
  ensureInit();
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const refresh = useCallback(() => refreshRole("hook"), []);

  return useMemo(
    () => ({
      role: snap.role,
      isAdmin: snap.role === "ADMIN",
      isReady: snap.isReady,
      refreshRole: refresh,
    }),
    [refresh, snap.isReady, snap.role]
  );
}
