import { useTheme } from "@react-navigation/native";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { alphaColor } from "../lib/ui";
import { AppButton } from "../components/ui/app-button";
import { claimPushForCurrentSession } from "../lib/pushNotifications";

const logoDark = require("../assets/images/logo-dark.png");
const logoLight = require("../assets/images/logo-light.png");

// En web Alert.alert es no-op — usar window.alert para feedback inmediato
const showAlert = (title: string, message: string) => {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

export default function LoginScreen() {
  const { colors, dark } = useTheme();
  const isDark = !!dark;
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";

  const didNavigateRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    return () => { aliveRef.current = false; };
  }, []);

  const C = {
    bg:     colors.background ?? (isDark ? "#000" : "#f2f2f7"),
    card:   colors.card       ?? (isDark ? "#1c1c1e" : "#fff"),
    text:   colors.text       ?? (isDark ? "#fff" : "#111"),
    sub:    alphaColor(String(colors.text ?? (isDark ? "#ffffff" : "#000000")), 0.55) || (isDark ? "rgba(255,255,255,0.55)" : "#888"),
    border: colors.border     ?? (isDark ? "rgba(255,255,255,0.12)" : "#e0e0e5"),
    tint:   colors.primary    ?? "#153c9e",
  } as const;

  const [email, setEmail]             = useState("");
  const [pass, setPass]               = useState("");
  const [loading, setLoading]         = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    if (isWeb) return; // el teclado en web no usa estos eventos
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const s = Keyboard.addListener(showEvt, () => setIsKeyboardOpen(true));
    const h = Keyboard.addListener(hideEvt, () => setIsKeyboardOpen(false));
    return () => { s.remove(); h.remove(); };
  }, [isWeb]);

  const passRef  = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);

  const isInvalidCredentialsError = (err: unknown) => {
    const e = err as any;
    if (String(e?.code ?? "") === "invalid_credentials") return true;
    if (/invalid login credentials/i.test(String(e?.message ?? ""))) return true;
    return false;
  };

  const isNetworkError = (err: unknown) => {
    if (!err) return false;
    const msg = String((err as any)?.message ?? "");
    if (msg.includes("Network request failed")) return true;
    const status = (err as any)?.status;
    if (status === 0 || status === undefined) return true;
    return false;
  };

  const nextFrame = () =>
    new Promise<void>((resolve) => {
      const raf = (globalThis as any)?.requestAnimationFrame;
      if (typeof raf === "function") raf(() => resolve());
      else setTimeout(() => resolve(), 0);
    });

  const replaceToTabsDeferredOnce = async () => {
    if (didNavigateRef.current) return;
    didNavigateRef.current = true;
    Keyboard.dismiss();
    await new Promise<void>((r) => InteractionManager.runAfterInteractions(() => r()));
    await nextFrame();
    await nextFrame();
    router.replace("/(drawer)/(tabs)");
  };

  const onLogin = async () => {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPass  = pass.trim();

    if (!cleanEmail || !cleanPass) {
      showAlert("Faltan datos", "Ingresa correo y contraseña");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: cleanPass,
      });

      if (error) {
        const message = isInvalidCredentialsError(error)
          ? "Correo o contraseña incorrectos."
          : isNetworkError(error)
            ? "No hay conexión. Verifica tu red e intenta de nuevo."
            : "Ocurrió un error inesperado";
        showAlert("No se pudo iniciar sesión", message);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (__DEV__) console.log("[auth] session", sessionData.session?.user?.email);

      if (Platform.OS !== "web") {
        try {
          await claimPushForCurrentSession(supabase, { forceUpsert: true, reason: "login" });
        } catch (e) {
          console.error("[push] claim:login_error", e);
        }
      }

      await replaceToTabsDeferredOnce();
    } catch (err) {
      showAlert("Error", isNetworkError(err) ? "No hay conexión." : "Ocurrió un error inesperado");
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  };

  // ─── RENDER WEB ─────────────────────────────────────────────────────────────
  if (isWeb) {
    return (
      <View style={[webStyles.root, { backgroundColor: C.bg }]}>
        <View style={[webStyles.card, { backgroundColor: C.card, borderColor: C.border }]}>
          {/* Logo */}
          <Image
            source={isDark ? logoLight : logoDark}
            style={[webStyles.logo, isDark ? { tintColor: "#ffffff" } : { tintColor: "#111111" }]}
            resizeMode="contain"
          />

          <Text style={[webStyles.title, { color: C.text }]}>Iniciar sesión</Text>

          <Text style={[webStyles.label, { color: C.text }]}>Correo</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="correo@ejemplo.com"
            placeholderTextColor={C.sub}
            style={[webStyles.input, { borderColor: C.border, color: C.text, backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#fafafa" }]}
            returnKeyType="next"
            onSubmitEditing={() => passRef.current?.focus()}
          />

          <Text style={[webStyles.label, { color: C.text }]}>Contraseña</Text>
          <TextInput
            ref={passRef}
            value={pass}
            onChangeText={setPass}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={C.sub}
            style={[webStyles.input, { borderColor: C.border, color: C.text, backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#fafafa" }]}
            returnKeyType="done"
            onSubmitEditing={onLogin}
          />

          <AppButton
            title={loading ? "Entrando..." : "Entrar"}
            onPress={onLogin}
            loading={loading}
            style={{ marginTop: 8, minHeight: 48 } as any}
          />
        </View>
      </View>
    );
  }

  // ─── RENDER NATIVO ───────────────────────────────────────────────────────────
  const contentAlignmentStyle = isKeyboardOpen
    ? { justifyContent: "flex-start" as const, paddingTop: Platform.OS === "ios" ? 28 : 18 }
    : { justifyContent: "center" as const, paddingTop: 0 };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.select({ ios: "padding", android: undefined })}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
      >
        <View style={{ flex: 1 }}>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={[
              styles.container,
              contentAlignmentStyle,
              { paddingBottom: 24 },
              isKeyboardOpen && { gap: 6 },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            {!isKeyboardOpen ? (
              <Image
                source={isDark ? logoLight : logoDark}
                style={[styles.logo, isDark ? styles.logoTintDark : styles.logoTintLight]}
                resizeMode="contain"
                fadeDuration={0}
              />
            ) : (
              <View style={{ height: 12 }} />
            )}

            <Text maxFontSizeMultiplier={1.2} style={[styles.title, { color: C.text }, isKeyboardOpen && { marginBottom: 6 }]}>
              Iniciar sesión
            </Text>

            <Text maxFontSizeMultiplier={1.2} style={[styles.label, { color: C.text }]}>Correo</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              placeholder="correo@ejemplo.com"
              placeholderTextColor={C.sub}
              style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.card }]}
              selectionColor={C.tint}
              cursorColor={C.tint}
              keyboardAppearance={isDark ? "dark" : "light"}
              returnKeyType="next"
              onFocus={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
              onSubmitEditing={() => passRef.current?.focus()}
            />

            <Text maxFontSizeMultiplier={1.2} style={[styles.label, { color: C.text }]}>Contraseña</Text>
            <TextInput
              ref={passRef}
              value={pass}
              onChangeText={setPass}
              secureTextEntry
              textContentType="password"
              placeholder="••••••••"
              placeholderTextColor={C.sub}
              style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.card }]}
              selectionColor={C.tint}
              cursorColor={C.tint}
              keyboardAppearance={isDark ? "dark" : "light"}
              returnKeyType="done"
              onFocus={() => scrollRef.current?.scrollTo({ y: 140, animated: true })}
              onSubmitEditing={onLogin}
            />

          </ScrollView>

          <View style={[styles.footer, { backgroundColor: C.bg, paddingBottom: Math.max(insets.bottom, 12) }]}>
            <AppButton title="Entrar" onPress={onLogin} loading={loading} style={{ minHeight: 50 } as any} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Web styles ──────────────────────────────────────────────────────────────
const webStyles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: "100vh" as any,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 36,
    paddingVertical: 40,
    gap: 0,
    // shadow web
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
  },
  logo: {
    width: 160,
    height: 160,
    alignSelf: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 20,
    textAlign: "center",
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
    marginTop: 14,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    minHeight: 44,
    outlineStyle: "none" as any,
  },
  forgotWrapper: {
    alignSelf: "flex-end",
    marginTop: 10,
    marginBottom: 4,
  },
  forgotText: {
    fontSize: 13,
    fontWeight: "600",
  },
});

// ─── Native styles ───────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    justifyContent: "center",
    gap: 10,
  },
  logo: {
    width: 160,
    height: 160,
    alignSelf: "center",
    marginBottom: 10,
  },
  logoTintDark:  { tintColor: "#ffffff" },
  logoTintLight: { tintColor: "#111111" },
  title: {
    fontSize: 26,
    fontWeight: "700",
    marginBottom: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 6,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 46,
    fontSize: 16,
  },
  forgotWrapper: {
    alignSelf: "flex-end",
    marginTop: 2,
  },
  forgotText: {
    fontSize: 13,
    fontWeight: "600",
  },
  forgotLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
});
