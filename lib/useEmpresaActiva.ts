// lib/useEmpresaActiva.ts
// Obtiene la empresa activa del usuario desde empresa_usuarios.
// Persiste la seleccion entre sesiones (SecureStore en native, localStorage en web).
// Patron identico a lib/useRole.ts — useSyncExternalStore + store modular.

import { useCallback, useMemo, useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { supabase } from "./supabase";

export type EmpresaInfo = {
  id: number;
  nombre: string;
  slug: string;
  logo_url: string | null;
};

type EmpresaActivaState = {
  empresaActivaId: number | null;
  empresas: EmpresaInfo[];
  loading: boolean;
  error: string | null;
  uid: string | null;
  isReady: boolean;
  updatedAt: number;
};

let state: EmpresaActivaState = {
  empresaActivaId: null,
  empresas: [],
  loading: false,
  error: null,
  uid: null,
  isReady: false,
  updatedAt: 0,
};

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(patch: Partial<EmpresaActivaState>) {
  state = { ...state, ...patch };
  emit();
}

const CACHE_PREFIX = "empresa_activa_v1:";

async function cacheGet(uid: string): Promise<number | null> {
  const key = CACHE_PREFIX + uid;
  try {
    if (Platform.OS === "web") {
      const v = localStorage.getItem(key);
      const n = v ? Number(v) : NaN;
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    const v = await SecureStore.getItemAsync(key);
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function cacheSet(uid: string, empresaId: number | null) {
  const key = CACHE_PREFIX + uid;
  try {
    if (Platform.OS === "web") {
      if (empresaId) localStorage.setItem(key, String(empresaId));
      else localStorage.removeItem(key);
      return;
    }
    if (empresaId) await SecureStore.setItemAsync(key, String(empresaId));
    else await SecureStore.deleteItemAsync(key);
  } catch {
    // ignorar — no es critico
  }
}

async function fetchEmpresas(uid: string): Promise<EmpresaInfo[]> {
  const { data, error } = await supabase
    .from("empresa_usuarios")
    .select("empresa_id, empresas(id, nombre, slug, logo_url)")
    .eq("user_id", uid)
    .eq("estado", "ACTIVO");

  if (error) throw error;

  return (data ?? [])
    .map((r: any) => r.empresas)
    .filter((e: any) => e && Number.isFinite(Number(e.id)) && Number(e.id) > 0)
    .map((e: any) => ({
      id: Number(e.id),
      nombre: String(e.nombre ?? ""),
      slug: String(e.slug ?? ""),
      logo_url: e.logo_url ?? null,
    }));
}

let inflight: Promise<void> | null = null;
let inflightSeq = 0;
let didInit = false;

export async function refreshEmpresaActiva(): Promise<void> {
  if (inflight) return inflight;

  const seq = ++inflightSeq;

  const p = (async () => {
    try {
      setState({ loading: true });

      const { data: sessData } = await supabase.auth.getSession();
      const uid = sessData?.session?.user?.id ?? null;

      if (!uid) {
        setState({ empresaActivaId: null, empresas: [], uid: null, loading: false, error: null, isReady: true, updatedAt: Date.now() });
        return;
      }

      // Si el uid cambio, limpiar seleccion previa para no mezclar sesiones.
      if (state.uid && state.uid !== uid) {
        setState({ empresaActivaId: null, empresas: [], uid, isReady: false, updatedAt: Date.now() });
      } else {
        setState({ uid });
      }

      // Intentar leer cache para respuesta inmediata mientras llega la red.
      if (!state.empresaActivaId) {
        const cached = await cacheGet(uid);
        if (cached) {
          setState({ empresaActivaId: cached, uid, isReady: true, updatedAt: Date.now() });
        }
      }

      try {
        const empresas = await fetchEmpresas(uid);

        // Evitar aplicar resultado si el usuario cambio durante el fetch.
        const { data: sessAfter } = await supabase.auth.getSession();
        const uidAfter = sessAfter?.session?.user?.id ?? null;
        if (inflightSeq !== seq || uidAfter !== uid) return;

        if (empresas.length === 0) {
          void cacheSet(uid, null);
          setState({ empresaActivaId: null, empresas: [], uid, loading: false, error: "Sin empresa activa asignada", isReady: true, updatedAt: Date.now() });
          return;
        }

        const ids = empresas.map((e) => e.id);

        // Si la empresa persistida sigue en la lista, mantenerla; si no, usar la primera.
        const persisted = await cacheGet(uid);
        const resolved = persisted && ids.includes(persisted) ? persisted : ids[0];

        void cacheSet(uid, resolved);
        setState({ empresaActivaId: resolved, empresas, uid, loading: false, error: null, isReady: true, updatedAt: Date.now() });
      } catch (e: any) {
        if (inflightSeq !== seq) return;
        const msg = String(e?.message ?? e ?? "Error al obtener empresa");
        // Mantener valor previo si existe; no borrar en errores transitorios.
        setState({ loading: false, error: state.empresaActivaId ? null : msg, isReady: !!state.empresaActivaId, updatedAt: Date.now() });
      }
    } finally {
      if (inflightSeq === seq) inflight = null;
      setState({ loading: false });
    }
  })();

  inflight = p;
  return p;
}

export function setEmpresaActiva(id: number): void {
  const empresa = state.empresas.find((e) => e.id === id);
  if (!empresa) return;
  if (state.uid) void cacheSet(state.uid, id);
  setState({ empresaActivaId: id, updatedAt: Date.now() });
}

function ensureInit() {
  if (didInit) return;
  didInit = true;

  void refreshEmpresaActiva().catch(() => {});

  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      setState({ empresaActivaId: null, empresas: [], uid: null, loading: false, error: null, isReady: true, updatedAt: Date.now() });
      return;
    }
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
      inflight = null;
      void refreshEmpresaActiva().catch(() => {});
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

export function useEmpresaActiva() {
  ensureInit();
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const refresh = useCallback(() => refreshEmpresaActiva(), []);

  return useMemo(
    () => ({
      empresaActivaId: snap.empresaActivaId,
      empresas: snap.empresas,
      loading: snap.loading,
      error: snap.error,
      isReady: snap.isReady,
      updatedAt: snap.updatedAt,
      refresh,
    }),
    [refresh, snap.empresaActivaId, snap.empresas, snap.error, snap.isReady, snap.loading, snap.updatedAt]
  );
}
