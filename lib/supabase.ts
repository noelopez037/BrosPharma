import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import "react-native-url-polyfill/auto";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

type StorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

// Evita crashear cuando Expo Web ejecuta en SSR/Node (no existe window/localStorage).
const createNoopStorage = (): StorageLike => ({
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
});

const createWebStorage = (): StorageLike => ({
  getItem: async (key: string) => window.localStorage.getItem(key),
  setItem: async (key: string, value: string) => window.localStorage.setItem(key, value),
  removeItem: async (key: string) => window.localStorage.removeItem(key),
});

const createNativeSecureStore = (): StorageLike => ({
  getItem: async (key: string) => {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      await SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });
    } catch {
      // ignore
    }
  },
  removeItem: async (key: string) => {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // ignore
    }
  },
});

const supabaseStorage: StorageLike =
  Platform.OS === "web"
    ? typeof window !== "undefined" && typeof window.localStorage !== "undefined"
      ? createWebStorage()
      : createNoopStorage()
    : createNativeSecureStore();

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: supabaseStorage,
    // En web normalmente true, pero si lo tienes off por deep links/routing, lo dejamos como lo tenías.
    detectSessionInUrl: false,
    persistSession: true,
    autoRefreshToken: true,
  },
});