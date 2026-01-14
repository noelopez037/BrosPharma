import { router } from "expo-router";
import { useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false);

  const passRef = useRef<TextInput>(null);

  const onLogin = async () => {
    if (!email.trim() || !pass.trim()) {
      Alert.alert("Faltan datos", "Ingresa correo y contraseña");
      return;
    }

    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 600));
      router.replace("/(tabs)");
    } catch {
      Alert.alert("Error", "No se pudo iniciar sesión");
    } finally {
      // si ya navegaste, igual no pasa nada grave, pero puedes dejarlo
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Iniciar sesión</Text>

      <Text style={styles.label}>Correo</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="correo@ejemplo.com"
        style={styles.input}
        returnKeyType="next"
        onSubmitEditing={() => passRef.current?.focus()}
      />

      <Text style={styles.label}>Contraseña</Text>
      <TextInput
        ref={passRef}
        value={pass}
        onChangeText={setPass}
        secureTextEntry
        placeholder="••••••••"
        style={styles.input}
        returnKeyType="done"
        onSubmitEditing={onLogin}
      />

      <Pressable style={styles.button} onPress={onLogin} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? "Entrando..." : "Entrar"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: "center", gap: 10 },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 10 },
  label: { fontSize: 14, opacity: 0.8 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  button: {
    marginTop: 10,
    backgroundColor: "black",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonText: { color: "white", fontWeight: "700" },
});
