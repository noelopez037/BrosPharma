import { useTheme } from "@react-navigation/native";
import { Stack, useRouter } from "expo-router";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Linking,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "../components/ui/app-button";
import { supabase } from "../lib/supabase";
import { pendingResetUrl, setPendingResetUrl } from "./_layout_root";

type LinkState = "checking" | "valid" | "invalid";

type RecoveryPayload = {
  tokenHash?: string;
  type?: string;
};

const MIN_PASSWORD_LENGTH = 8;

const parseParamsSegment = (segment?: string | null) => {
  if (!segment) return null;
  const trimmed = segment.startsWith("#") || segment.startsWith("?") ? segment.slice(1) : segment;
  if (!trimmed) return null;
  return new URLSearchParams(trimmed);
};

const parseRecoveryPayload = (rawUrl: string): RecoveryPayload => {
  const normalize = (value: string | null) => {
    if (!value) return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  };

  try {
    const parsed = new URL(rawUrl);
    const hashParams = parseParamsSegment(parsed.hash);
    const queryParams = parseParamsSegment(parsed.search);
    const getParam = (key: string) => hashParams?.get(key) ?? queryParams?.get(key) ?? null;
    return {
      tokenHash: normalize(getParam("token_hash") ?? getParam("tokenHash")),
      type: normalize(getParam("type")),
    };
  } catch {
    const hashPart = rawUrl.split("#")[1];
    const queryPart = rawUrl.split("?")[1];
    const bucket = new URLSearchParams();
    if (queryPart) new URLSearchParams(queryPart).forEach((v, k) => bucket.set(k, v));
    if (hashPart) new URLSearchParams(hashPart).forEach((v, k) => bucket.set(k, v));
    return {
      tokenHash: normalize(bucket.get("token_hash") ?? bucket.get("tokenHash")),
      type: normalize(bucket.get("type")),
    };
  }
};

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { colors, dark } = useTheme();

  const palette = useMemo(() => {
    const isDark = !!dark;
    return {
      bg: colors.background ?? (isDark ? "#000" : "#fff"),
      card: colors.card ?? (isDark ? "#0f0f10" : "#fff"),
      text: colors.text ?? (isDark ? "#fff" : "#111"),
      sub: colors.border ?? (isDark ? "rgba(255,255,255,0.45)" : "#666"),
      border: colors.border ?? (isDark ? "rgba(255,255,255,0.2)" : "#dadada"),
      tint: colors.primary ?? "#153c9e",
      danger: "#d9534f",
    } as const;
  }, [colors, dark]);

  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const confirmRef = useRef<TextInput>(null);
  const aliveRef = useRef(true);
  const hasRecoverySessionRef = useRef(false);
  const submittingRef = useRef(false);
  const accessTokenRef = useRef<string | null>(null);

  const handleRecoveryUrl = useCallback(async (incomingUrl: string | null) => {
    if (hasRecoverySessionRef.current) return;

    if (!incomingUrl) {
      setLinkState("invalid");
      setLinkError(null);
      return;
    }

    const payload = parseRecoveryPayload(incomingUrl);
    const normalizedType = payload.type?.trim().toLowerCase() ?? "recovery";
    const hasTokenHash = !!payload.tokenHash;

    if (!hasTokenHash) {
      setLinkState("invalid");
      setLinkError(null);
      return;
    }

    setLinkState("checking");
    setLinkError(null);

    try {
      if (normalizedType !== "recovery") {
        throw new Error("Tipo de enlace no soportado");
      }

      const { error } = await supabase.auth.verifyOtp({
        type: "recovery",
        token_hash: payload.tokenHash!,
      });
      if (error) throw error;

      // Guardar access token para usarlo en el fetch directo
      const { data: sessionData } = await supabase.auth.getSession();
      accessTokenRef.current = sessionData?.session?.access_token ?? null;

      hasRecoverySessionRef.current = true;
      if (!aliveRef.current) return;
      setLinkState("valid");
      setLinkError(null);
    } catch (error: any) {
      if (!aliveRef.current) return;
      setLinkState("invalid");
      setLinkError(error?.message ?? "Link inválido o expirado");
    }
  }, []);

  useLayoutEffect(() => {
    let active = true;
    let initialHandled = false;


    const subscription = Linking.addEventListener("url", (event) => {
      if (!active) return;
      initialHandled = true;
      handleRecoveryUrl(event.url);
    });


    const captureInitialUrl = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 200));
        if (!active || initialHandled) return;


        // Primero verificar si hay un URL pendiente capturado por el layout
        if (pendingResetUrl) {
          const url = pendingResetUrl;
          setPendingResetUrl(null);
          await handleRecoveryUrl(url);
          return;
        }


        const initialUrl = await Linking.getInitialURL();
        if (!active || initialHandled) return;
        await handleRecoveryUrl(initialUrl ?? null);
      } catch {
        if (!active || initialHandled) return;
        await handleRecoveryUrl(null);
      }
    };


    captureInitialUrl();


    return () => {
      active = false;
      subscription.remove();
    };
  }, [handleRecoveryUrl]);

  useEffect(() => {
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const onSubmit = useCallback(async () => {
    const cleanPass = password.trim();
    const cleanConfirm = confirmPassword.trim();

    if (!cleanPass || cleanPass.length < MIN_PASSWORD_LENGTH) {
      Alert.alert("Contraseña inválida", `Usa al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }

    if (cleanPass !== cleanConfirm) {
      Alert.alert("No coinciden", "Verifica tu confirmación.");
      return;
    }

    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = accessTokenRef.current ?? sessionData?.session?.access_token;

      if (!token) {
        Alert.alert("Sesión expirada", "El enlace expiró. Solicita uno nuevo.");
        setSaving(false);
        submittingRef.current = false;
        router.replace("/login");
        return;
      }

      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/auth/v1/user`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "apikey": process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ password: cleanPass }),
        }
      );
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message ?? result.error_description ?? "Error al actualizar");
      }

      supabase.auth.signOut().catch(() => {});

      setSaving(false);
      submittingRef.current = false;
      router.replace("/login");

    } catch (error: any) {
      console.log("[Reset] ERROR", error?.message);
      setSaving(false);
      submittingRef.current = false;
      Alert.alert("No se pudo guardar", error?.message ?? "Intenta de nuevo más tarde");
    }
  }, [confirmPassword, password, router]);

  const isPasswordShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const canSubmit =
    linkState === "valid" &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password === confirmPassword &&
    !saving;

  const renderStatus = () => {
    if (linkState === "checking") {
      return (
        <View style={[styles.statusCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <ActivityIndicator size="small" color={palette.tint} />
          <Text style={[styles.statusText, { color: palette.text }]}>Validando el enlace…</Text>
        </View>
      );
    }

    if (linkState === "invalid") {
      return (
        <View style={[styles.statusCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <Text style={[styles.statusTitle, { color: palette.text }]}>Link inválido o expirado</Text>
          {linkError ? (
            <Text style={[styles.statusText, { color: palette.sub }]}>{linkError}</Text>
          ) : null}
          <AppButton
            title="Volver a login"
            variant="outline"
            onPress={() => router.replace("/login")}
            style={{ marginTop: 16 }}
          />
        </View>
      );
    }

    return null;
  };

  const renderForm = () => {
    if (linkState !== "valid") return null;

    return (
      <View>
        <Text style={[styles.label, { color: palette.text }]}>Nueva contraseña</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="********"
          placeholderTextColor={palette.sub}
          secureTextEntry
          textContentType="newPassword"
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { borderColor: palette.border, color: palette.text, backgroundColor: palette.card }]}
          selectionColor={palette.tint}
          cursorColor={palette.tint}
          keyboardAppearance={dark ? "dark" : "light"}
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
        />
        {isPasswordShort ? (
          <Text style={[styles.helper, { color: palette.danger }]}>Mínimo {MIN_PASSWORD_LENGTH} caracteres.</Text>
        ) : null}

        <Text style={[styles.label, { color: palette.text }]}>Confirmar contraseña</Text>
        <TextInput
          ref={confirmRef}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="********"
          placeholderTextColor={palette.sub}
          secureTextEntry
          textContentType="newPassword"
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { borderColor: palette.border, color: palette.text, backgroundColor: palette.card }]}
          selectionColor={palette.tint}
          cursorColor={palette.tint}
          keyboardAppearance={dark ? "dark" : "light"}
          returnKeyType="done"
          onSubmitEditing={onSubmit}
        />
        {mismatch ? (
          <Text style={[styles.helper, { color: palette.danger }]}>Las contraseñas no coinciden.</Text>
        ) : null}

        <View style={styles.buttonRow}>
          <AppButton
            title="Guardar"
            onPress={onSubmit}
            disabled={!canSubmit}
            loading={saving}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.bg }}>
      <Stack.Screen options={{ title: "Restablecer contraseña" }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.select({ ios: "padding", android: undefined })}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
      >
        <ScrollView
          contentContainerStyle={[styles.container, { backgroundColor: palette.bg }]}
          keyboardShouldPersistTaps="handled"
        >
          {renderStatus()}
          {renderForm()}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 18,
  },
  statusCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  statusTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 6,
  },
  statusText: {
    fontSize: 15,
    lineHeight: 21,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 8,
  },
  helper: {
    fontSize: 13,
    marginBottom: 14,
  },
  buttonRow: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
  },
});
