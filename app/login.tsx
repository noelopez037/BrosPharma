// app/login.tsx
// Reemplaza tu archivo completo por este.
// Cambios:
// - Estilo nativo consistente (iOS/Android): inputs con altura correcta, botón azul iOS, tipografía normal
// - Soporta dark/light (colores correctos)
// - El teclado ya no tapa: KeyboardAvoidingView + ScrollView
// - TextInput siempre visible (color, selectionColor, cursorColor, keyboardAppearance)
// - SafeAreaView

import { useTheme } from "@react-navigation/native";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { alphaColor } from "../lib/ui";

export default function LoginScreen() {
  const { colors, dark } = useTheme();
  const isDark = !!dark;

  const C = {
    bg: colors.background ?? (isDark ? "#000" : "#fff"),
    card: colors.card ?? (isDark ? "#0f0f10" : "#fff"),
    text: colors.text ?? (isDark ? "#fff" : "#111"),
    sub: alphaColor(String(colors.text ?? (isDark ? "#ffffff" : "#000000")), 0.65) || (isDark ? "rgba(255,255,255,0.65)" : "#666"),
    border: colors.border ?? (isDark ? "rgba(255,255,255,0.14)" : "#e5e5e5"),
    tint: colors.primary ?? "#007AFF",
  } as const;

  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false);

  const passRef = useRef<TextInput>(null);

  const onLogin = async () => {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPass = pass.trim();

    if (!cleanEmail || !cleanPass) {
      Alert.alert("Faltan datos", "Ingresa correo y contraseña");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: cleanPass,
      });

      if (error) {
        Alert.alert("No se pudo iniciar sesión", "Correo o contraseña incorrectos");
        return;
      }

      router.replace("/(drawer)/(tabs)");
    } catch {
      Alert.alert("Error", "Ocurrió un error inesperado");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.select({ ios: "padding", android: undefined })}
        keyboardVerticalOffset={Platform.select({ ios: 10, android: 0 })}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
        >
          <Image
            source={require("../assets/images/logo.png")}
            style={[styles.logo, { tintColor: C.text }]}
            resizeMode="contain"
          />

          <Text maxFontSizeMultiplier={1.2} style={[styles.title, { color: C.text }]}>
            Iniciar sesión
          </Text>

          <Text maxFontSizeMultiplier={1.2} style={[styles.label, { color: C.text }]}>
            Correo
          </Text>
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
            onSubmitEditing={() => passRef.current?.focus()}
          />

          <Text maxFontSizeMultiplier={1.2} style={[styles.label, { color: C.text }]}>
            Contraseña
          </Text>
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
            onSubmitEditing={onLogin}
          />

          <Pressable
            onPress={onLogin}
            disabled={loading}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: C.tint, opacity: loading ? 0.7 : pressed ? 0.85 : 1 },
            ]}
          >
            <Text maxFontSizeMultiplier={1.2} style={styles.buttonText}>
              {loading ? "Entrando..." : "Entrar"}
            </Text>
          </Pressable>

          <View style={{ height: 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

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
  button: {
    marginTop: 12,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
