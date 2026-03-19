import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import "react-native-url-polyfill/auto";
// Necesario para crypto.getRandomValues en React Native
import "react-native-get-random-values";
import * as aesjs from "aes-js";

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
  setItem: async (key: string, value: string) =>
    window.localStorage.setItem(key, value),
  removeItem: async (key: string) => window.localStorage.removeItem(key),
});

/**
 * LargeSecureStore — soluciona el límite de 2048 bytes de expo-secure-store.
 *
 * Estrategia:
 *   - El valor (sesión Supabase, potencialmente >2 KB) se cifra con AES-256-CTR
 *     y se guarda en AsyncStorage (sin límite de tamaño).
 *   - La clave de cifrado (32 bytes → 64 hex chars, bien bajo el límite) se
 *     guarda en SecureStore, respaldada por Keychain (iOS) / Keystore (Android).
 *
 * De esta forma los tokens nunca quedan en texto plano en AsyncStorage.
 */
class LargeSecureStore implements StorageLike {
  private async _encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));
    const cipher = new aesjs.ModeOfOperation.ctr(
      encryptionKey,
      new aesjs.Counter(1)
    );
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(
      key,
      aesjs.utils.hex.fromBytes(encryptionKey),
      { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }
    );
    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async _decrypt(key: string, value: string): Promise<string | null> {
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(encryptionKeyHex),
      new aesjs.Counter(1)
    );
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));
    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async getItem(key: string): Promise<string | null> {
    try {
      const encrypted = await AsyncStorage.getItem(key);
      if (!encrypted) return null;
      return await this._decrypt(key, encrypted);
    } catch (e) {
      if (__DEV__) console.warn("[supabase] LargeSecureStore.getItem failed:", key, e);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      const encrypted = await this._encrypt(key, value);
      await AsyncStorage.setItem(key, encrypted);
    } catch (e) {
      // No crashear; la sesión se recuperará vía refresh_token
      if (__DEV__) console.warn("[supabase] LargeSecureStore.setItem failed:", key, e);
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
      await SecureStore.deleteItemAsync(key);
    } catch (e) {
      if (__DEV__) console.warn("[supabase] LargeSecureStore.removeItem failed:", key, e);
    }
  }
}

const supabaseStorage: StorageLike =
  Platform.OS === "web"
    ? typeof window !== "undefined" &&
      typeof window.localStorage !== "undefined"
      ? createWebStorage()
      : createNoopStorage()
    : new LargeSecureStore();

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: supabaseStorage,
    detectSessionInUrl: false,
    persistSession: true,
    autoRefreshToken: true,
  },
});
