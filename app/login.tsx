import { useTheme } from "@react-navigation/native";
import { router } from "expo-router";
import { useRef, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";

export default function LoginScreen() {
  const { colors } = useTheme();
  const s = styles(colors);

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

      router.replace("/(tabs)");
    } catch {
      Alert.alert("Error", "Ocurrió un error inesperado");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={s.container}>
      <Image
        source={require("../assets/images/logo.png")}
        style={[s.logo, { tintColor: colors.text }]}
        resizeMode="contain"
      />

      <Text style={s.title}>Iniciar sesión</Text>

      <Text style={s.label}>Correo</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="correo@ejemplo.com"
        placeholderTextColor={colors.border}
        style={s.input}
        returnKeyType="next"
        onSubmitEditing={() => passRef.current?.focus()}
      />

      <Text style={s.label}>Contraseña</Text>
      <TextInput
        ref={passRef}
        value={pass}
        onChangeText={setPass}
        secureTextEntry
        placeholder="••••••••"
        placeholderTextColor={colors.border}
        style={s.input}
        returnKeyType="done"
        onSubmitEditing={onLogin}
      />

      <Pressable style={s.button} onPress={onLogin} disabled={loading}>
        <Text style={s.buttonText}>
          {loading ? "Entrando..." : "Entrar"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: 20,
      justifyContent: "center",
      backgroundColor: colors.background,
      gap: 10,
    },
    logo: {
      width: 180,
      height: 180,
      alignSelf: "center",
      marginBottom: 10,
    },
    title: {
      fontSize: 28,
      fontWeight: "700",
      marginBottom: 10,
      color: colors.text,
    },
    label: {
      fontSize: 14,
      opacity: 0.8,
      color: colors.text,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
      color: colors.text,
      backgroundColor: colors.card,
    },
    button: {
      marginTop: 10,
      backgroundColor: colors.text,
      paddingVertical: 14,
      borderRadius: 10,
      alignItems: "center",
    },
    buttonText: {
      color: colors.background,
      fontWeight: "700",
    },
  });
