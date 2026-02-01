// app/select-cliente.tsx
import { useTheme } from "@react-navigation/native";
import { Stack } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
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
import { AppButton } from "../components/ui/app-button";
import { DoneAccessory } from "../components/ui/done-accessory";
import { useKeyboardAutoScroll } from "../components/ui/use-keyboard-autoscroll";
import { useVentaDraft, type Cliente } from "../lib/ventaDraft";
import { supabase } from "../lib/supabase";
import { goBackSafe } from "../lib/goBackSafe";
import { getHeaderColors } from "../src/theme/headerColors";

type Role = "ADMIN" | "BODEGA" | "VENTAS" | "FACTURACION" | "";

type ClienteRow = {
  id: number;
  nombre: string;
  nit: string | null;
  telefono: string | null;
  direccion: string | null;
  activo: boolean;
  vendedor_id: string | null;
};

function alpha(hexOrRgb: string, a: number) {
  if (!hexOrRgb?.startsWith("#") || hexOrRgb.length !== 7) return hexOrRgb;
  const r = parseInt(hexOrRgb.slice(1, 3), 16);
  const g = parseInt(hexOrRgb.slice(3, 5), 16);
  const b = parseInt(hexOrRgb.slice(5, 7), 16);
  const aa = Math.max(0, Math.min(1, a));
  return `rgba(${r},${g},${b},${aa})`;
}

function normalizeUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

function nitToSave(input: string): string | null {
  const t = String(input ?? "").trim();
  if (!t) return null;

  const norm = t.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (norm === "CF" || norm === "CONSUMIDORFINAL") return "CF";

  return t.toUpperCase();
}

function displayNit(nit: string | null | undefined) {
  const t = String(nit ?? "").trim();
  return t ? t : "CF";
}

export default function SelectCliente() {
  const { colors, dark } = useTheme();
  const header = useMemo(() => getHeaderColors(!!dark), [dark]);
  const { setCliente } = useVentaDraft();
  const DONE_ID = "doneAccessory";
  const { scrollRef, handleFocus } = useKeyboardAutoScroll(110);

  const C = useMemo(() => {
    const tint = colors.primary ?? "#153c9e";
    const text = colors.text ?? (dark ? "#fff" : "#111");
    const bg = colors.background ?? (dark ? "#000" : "#fff");
    const card = colors.card ?? (dark ? "#0f0f10" : "#fff");
    const border = colors.border ?? (dark ? "rgba(255,255,255,0.14)" : "#e5e5e5");
    const sub = alpha(text, 0.65);
    return { bg, card, text, sub, border, tint };
  }, [colors, dark]);

  const [q, setQ] = useState("");
  const [items, setItems] = useState<ClienteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<Role>("");
  const [uid, setUid] = useState<string | null>(null);

  const [mode, setMode] = useState<"LISTA" | "CREAR">("LISTA");
  const [newNombre, setNewNombre] = useState("");
  const [newNit, setNewNit] = useState("CF");
  const [newTel, setNewTel] = useState("");
  const [newDir, setNewDir] = useState("");

  const loadRole = async () => {
    const { data: auth } = await supabase.auth.getUser();
    const id = auth.user?.id ?? null;
    setUid(id);
    if (!id) {
      setRole("");
      return;
    }
    const { data: prof } = await supabase.from("profiles").select("role").eq("id", id).maybeSingle();
    setRole((normalizeUpper(prof?.role) as Role) ?? "");
  };

  const load = async () => {
    setLoading(true);
    try {
      let req = supabase
        .from("clientes")
        .select("id,nombre,nit,telefono,direccion,activo,vendedor_id")
        .eq("activo", true)
        .order("nombre", { ascending: true })
        .limit(300);

      const search = q.trim();
      if (search) {
        req = req.or(`nombre.ilike.%${search}%,nit.ilike.%${search}%,telefono.ilike.%${search}%`);
      }

      // VENTAS: solo clientes asignados al vendedor
      if (role === "VENTAS") {
        if (!uid) {
          setItems([]);
          return;
        }
        req = req.eq("vendedor_id", uid);
      }

      const { data, error } = await req;
      if (error) throw error;
      setItems((data ?? []) as any);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudieron cargar clientes");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRole().catch(() => {});
  }, []);

  useEffect(() => {
    if (mode !== "LISTA") return;
    const t = setTimeout(() => {
      load().catch(() => {});
    }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, role, uid, mode]);

  const pick = (c: ClienteRow) => {
    const payload: Cliente = {
      id: c.id,
      nombre: c.nombre,
      nit: c.nit ?? null,
      telefono: c.telefono ?? null,
      direccion: c.direccion ?? null,
    };
    setCliente(payload);
    goBackSafe("/venta-nueva");
  };

  const canCreateCliente = role === "ADMIN" || role === "VENTAS";

  const resetCrear = () => {
    setNewNombre("");
    setNewNit("CF");
    setNewTel("");
    setNewDir("");
  };

  const crear = async () => {
    if (!canCreateCliente) return;

    const nombre = newNombre.trim();
    const telefono = newTel.trim();
    const direccion = newDir.trim();

    if (!nombre) return Alert.alert("Faltan datos", "Nombre es obligatorio");
    if (!telefono) return Alert.alert("Faltan datos", "Teléfono es obligatorio");
    if (!direccion) return Alert.alert("Faltan datos", "Dirección es obligatoria");

    if (role === "VENTAS" && !uid) {
      return Alert.alert("Error", "Usuario no autenticado");
    }

    const nitSave = nitToSave(newNit);
    const vendedorIdToSave = role === "VENTAS" ? uid : null;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("clientes")
        .insert({
          nombre,
          nit: nitSave,
          telefono,
          direccion,
          activo: true,
          vendedor_id: vendedorIdToSave,
        })
        .select("id,nombre,nit,telefono,direccion,activo,vendedor_id")
        .single();

      if (error) throw error;

      pick(data as any);
    } catch (e: any) {
      const msg = String(e?.message ?? "No se pudo crear el cliente");
      if (msg.toLowerCase().includes("ux_clientes_nit")) {
        Alert.alert("NIT duplicado", "Ese NIT ya existe");
      } else {
        Alert.alert("Error", msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: mode === "LISTA" ? "Cliente" : "Nuevo cliente",
          headerBackTitle: "Atrás",
          ...(Platform.OS === "android"
            ? {
                headerStyle: { backgroundColor: header.bg as any },
                headerTitleStyle: { color: header.fg as any },
                headerTintColor: header.fg as any,
              }
            : {}),
        }}
      />

      <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
        {mode === "LISTA" ? (
          <>
            <View style={styles.content}>
              <View style={styles.row}>
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder="Buscar cliente..."
                  placeholderTextColor={C.sub}
                  selectionColor={C.tint as any}
                  cursorColor={C.tint as any}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[
                    styles.input,
                    styles.inputFlex,
                    {
                      borderColor: C.border,
                      backgroundColor: C.card,
                      color: C.text,
                    },
                  ]}
                />

                {canCreateCliente ? (
                  <AppButton
                    title={"+ Nuevo"}
                    variant="outline"
                    size="sm"
                    onPress={() => {
                      setMode("CREAR");
                      setNewNombre(q.trim());
                      setNewNit("CF");
                      setNewTel("");
                      setNewDir("");
                    }}
                  />
                ) : null}
              </View>

              {loading ? (
                <Text style={{ marginTop: 10, color: C.sub, fontWeight: "700" }}>Cargando...</Text>
              ) : null}
            </View>

            <FlatList
              data={items}
              keyExtractor={(it) => String(it.id)}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={{ paddingBottom: 24 }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => pick(item)}
                  style={({ pressed }) => [
                    styles.rowItem,
                    { borderTopColor: C.border },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={[styles.itemTitle, { color: C.text }]} numberOfLines={1}>
                    {item.nombre}
                  </Text>
                  <Text style={[styles.itemSub, { color: C.sub }]} numberOfLines={1}>
                    NIT: {displayNit(item.nit)} • Tel: {item.telefono ?? "—"}
                  </Text>
                  {!!item.direccion ? (
                    <Text style={[styles.itemSub, { color: C.sub }]} numberOfLines={1}>
                      Dir: {item.direccion}
                    </Text>
                  ) : null}
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={{ padding: 16, color: C.sub, fontWeight: "700" }}>
                  {loading ? "Cargando..." : "Sin clientes"}
                </Text>
              }
            />
          </>
        ) : (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
          >
            <ScrollView
              ref={scrollRef}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={[styles.content, { paddingBottom: 20 }]}
            >
              <Text style={[styles.label, { color: C.text }]}>Nombre</Text>
              <TextInput
                value={newNombre}
                onChangeText={setNewNombre}
                onFocus={handleFocus}
                placeholder="Nombre del cliente"
                placeholderTextColor={C.sub}
                selectionColor={C.tint as any}
                cursorColor={C.tint as any}
                autoCapitalize="words"
                style={[styles.input, { borderColor: C.border, backgroundColor: C.card, color: C.text }]}
              />

              <Text style={[styles.label, { color: C.text }]}>NIT</Text>
              <TextInput
                value={newNit}
                onChangeText={setNewNit}
                onFocus={handleFocus}
                placeholder="CF / Consumidor Final o NIT"
                placeholderTextColor={C.sub}
                selectionColor={C.tint as any}
                cursorColor={C.tint as any}
                autoCapitalize="characters"
                autoCorrect={false}
                style={[styles.input, { borderColor: C.border, backgroundColor: C.card, color: C.text }]}
              />

              <Text style={[styles.label, { color: C.text }]}>Teléfono</Text>
              <TextInput
                value={newTel}
                onChangeText={setNewTel}
                onFocus={handleFocus}
                placeholder="Ej: 5555-5555"
                placeholderTextColor={C.sub}
                selectionColor={C.tint as any}
                cursorColor={C.tint as any}
                keyboardType="phone-pad"
                inputAccessoryViewID={Platform.OS === "ios" ? DONE_ID : undefined}
                style={[styles.input, { borderColor: C.border, backgroundColor: C.card, color: C.text }]}
              />

              <Text style={[styles.label, { color: C.text }]}>Dirección</Text>
              <TextInput
                value={newDir}
                onChangeText={setNewDir}
                onFocus={handleFocus}
                placeholder="Dirección"
                placeholderTextColor={C.sub}
                selectionColor={C.tint as any}
                cursorColor={C.tint as any}
                style={[styles.input, { borderColor: C.border, backgroundColor: C.card, color: C.text }]}
              />

              <AppButton title={loading ? "Guardando..." : "Guardar cliente"} onPress={crear} loading={loading} />
              <AppButton
                title="Cancelar"
                variant="outline"
                size="sm"
                onPress={() => {
                  setMode("LISTA");
                  resetCrear();
                }}
              />
            </ScrollView>
          </KeyboardAvoidingView>
        )}

        <DoneAccessory nativeID={DONE_ID} />
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, gap: 12 },
  row: { flexDirection: "row", gap: 12, alignItems: "center" },
  label: { marginTop: 6, marginBottom: 6, fontSize: 13, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  inputFlex: { flex: 1 },

  rowItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  itemTitle: { fontSize: 16, fontWeight: "600" },
  itemSub: { marginTop: 4, fontSize: 13 },
});
