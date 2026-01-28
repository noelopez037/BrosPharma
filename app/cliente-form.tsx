import { useTheme } from "@react-navigation/native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";

type Role = "ADMIN" | "BODEGA" | "VENDEDOR" | "FACTURACION" | "";

type ClienteRow = {
  id: number;
  nombre: string;
  nit: string | null;
  telefono: string | null;
  direccion: string | null;
  activo: boolean;
  vendedor_id: string | null;
};

type VendedorRow = {
  id: string;
  full_name: string | null;
  role: string;
};

function normalizeUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

function nitToSave(input: string): string | null {
  const t = input.trim();
  if (!t) return null;

  const norm = t.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (norm === "CF" || norm === "CONSUMIDORFINAL") return "CF";

  return t.toUpperCase();
}

export default function ClienteForm() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => styles(colors), [colors]);

  const { id } = useLocalSearchParams<{ id?: string }>();
  const editingId = id && Number.isFinite(Number(id)) ? Number(id) : null;
  const isEditing = editingId != null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [uid, setUid] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("");

  const isAdmin = role === "ADMIN";
  const isVendedor = role === "VENDEDOR";
  const canEdit = role === "ADMIN" || role === "VENDEDOR";

  const [nombre, setNombre] = useState("");
  const [nit, setNit] = useState("CF");
  const [telefono, setTelefono] = useState("");
  const [direccion, setDireccion] = useState("");
  const [activo, setActivo] = useState(true);

  const [vendedorId, setVendedorId] = useState<string | null>(null);
  const [vendedores, setVendedores] = useState<VendedorRow[]>([]);

  const [vendModalOpen, setVendModalOpen] = useState(false);
  const [vendQuery, setVendQuery] = useState("");

  const vendedoresFiltrados = useMemo(() => {
    const q = vendQuery.trim().toLowerCase();
    if (!q) return vendedores;
    return vendedores.filter((v) => {
      const name = String(v.full_name ?? "").toLowerCase();
      return name.includes(q) || v.id.toLowerCase().includes(q);
    });
  }, [vendQuery, vendedores]);

  const vendedorLabel = useMemo(() => {
    if (!isAdmin) return "—";
    if (!vendedorId) return "Sin asignar";
    const v = vendedores.find((x) => x.id === vendedorId);
    const n = String(v?.full_name ?? "").trim();
    const r = normalizeUpper(v?.role);
    return n ? `${n}${r ? ` • ${r}` : ""}` : vendedorId;
  }, [isAdmin, vendedorId, vendedores]);

  const loadContext = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const u = auth.user;
    const userId = u?.id ?? null;
    setUid(userId);

    if (!userId) {
      setRole("");
      return;
    }

    const { data: prof } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
    setRole(normalizeUpper(prof?.role) as Role);
  }, []);

  const loadVendedores = useCallback(async () => {
    if (!isAdmin) {
      setVendedores([]);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id,full_name,role")
      .in("role", ["ADMIN", "VENDEDOR"])
      .order("full_name", { ascending: true })
      .limit(400);

    if (error) throw error;
    setVendedores((data ?? []) as any);
  }, [isAdmin]);

  const loadCliente = useCallback(async () => {
    if (!isEditing || !editingId) return;

    const { data, error } = await supabase
      .from("clientes")
      .select("id,nombre,nit,telefono,direccion,activo,vendedor_id")
      .eq("id", editingId)
      .maybeSingle();

    if (error) throw error;
    const c = (data ?? null) as ClienteRow | null;
    if (!c) return;

    setNombre(c.nombre ?? "");
    setNit(String(c.nit ?? "CF"));
    setTelefono(String(c.telefono ?? ""));
    setDireccion(String(c.direccion ?? ""));
    setActivo(!!c.activo);
    setVendedorId(c.vendedor_id ?? null);
  }, [editingId, isEditing]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        await loadContext();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadContext]);

  useEffect(() => {
    if (!role) return;

    // Si no puede editar, salimos
    if (!canEdit) {
      Alert.alert("Sin permiso", "No tienes permiso para crear o editar clientes");
      router.back();
      return;
    }

    // vendedor: siempre asignado a si mismo
    if (isVendedor && uid) setVendedorId(uid);
  }, [canEdit, isVendedor, role, uid]);

  useEffect(() => {
    if (!role) return;
    // Cargar lista de vendedores SOLO para admin
    loadVendedores().catch(() => {
      setVendedores([]);
    });
  }, [loadVendedores, role]);

  useEffect(() => {
    if (!role) return;
    // Cargar cliente al editar
    setLoading(true);
    loadCliente()
      .catch((e: any) => {
        Alert.alert("Error", e?.message ?? "No se pudo cargar el cliente");
      })
      .finally(() => setLoading(false));
  }, [loadCliente, role]);

  const onSave = useCallback(async () => {
    if (!canEdit) return;
    if (saving) return;

    const cleanNombre = nombre.trim();
    const cleanTel = telefono.trim();
    const cleanDir = direccion.trim();

    if (!cleanNombre) return Alert.alert("Faltan datos", "Nombre es obligatorio");
    if (!cleanTel) return Alert.alert("Faltan datos", "Teléfono es obligatorio");
    if (!cleanDir) return Alert.alert("Faltan datos", "Dirección es obligatoria");

    const nitSave = nitToSave(nit);

    // vendedor: forzar
    const vendIdToSave = isVendedor ? uid : vendedorId;

    setSaving(true);
    try {
      if (!isEditing) {
        const { data, error } = await supabase
          .from("clientes")
          .insert({
            nombre: cleanNombre,
            nit: nitSave,
            telefono: cleanTel,
            direccion: cleanDir,
            activo,
            vendedor_id: vendIdToSave ?? null,
          })
          .select("id")
          .single();

        if (error) throw error;
        const newId = (data as any)?.id;
        Alert.alert("Listo", "Cliente creado");
        if (newId) {
          router.replace({ pathname: "/cliente-detalle" as any, params: { id: String(newId) } } as any);
        } else {
          router.back();
        }
        return;
      }

      const payload: any = {
        nombre: cleanNombre,
        nit: nitSave,
        telefono: cleanTel,
        direccion: cleanDir,
        activo,
      };

      if (isAdmin) payload.vendedor_id = vendedorId ?? null;
      if (isVendedor && uid) payload.vendedor_id = uid;

      const { error } = await supabase.from("clientes").update(payload).eq("id", editingId);
      if (error) throw error;

      Alert.alert("Listo", "Cliente actualizado");
      router.back();
    } catch (e: any) {
      const msg = String(e?.message ?? "No se pudo guardar");
      if (msg.toLowerCase().includes("ux_clientes_nit")) {
        Alert.alert("NIT duplicado", "Ese NIT ya existe");
      } else {
        Alert.alert("Error", msg);
      }
    } finally {
      setSaving(false);
    }
  }, [activo, canEdit, direccion, editingId, isAdmin, isEditing, isVendedor, nit, nombre, saving, telefono, uid, vendedorId]);

  const title = isEditing ? "Editar cliente" : "Nuevo cliente";

  if (loading) {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: colors.background }]} edges={["bottom"]}>
        <Stack.Screen options={{ title, headerShown: true, headerBackTitle: "Atras" }} />
        <View style={s.center}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title, headerShown: true, headerBackTitle: "Atras" }} />

      <SafeAreaView style={[s.safe, { paddingBottom: insets.bottom }]} edges={["bottom"]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
        >
          <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
            <Text style={s.label}>Nombre</Text>
            <TextInput
              value={nombre}
              onChangeText={setNombre}
              style={s.input}
              placeholder="Nombre del cliente"
              placeholderTextColor={colors.text + "66"}
              autoCapitalize="words"
            />

            <Text style={s.label}>NIT</Text>
            <TextInput
              value={nit}
              onChangeText={setNit}
              style={s.input}
              placeholder="CF / Consumidor Final o NIT"
              placeholderTextColor={colors.text + "66"}
              autoCapitalize="characters"
              autoCorrect={false}
            />

            <Text style={s.label}>Teléfono</Text>
            <TextInput
              value={telefono}
              onChangeText={setTelefono}
              style={s.input}
              placeholder="Ej: 5555-5555"
              placeholderTextColor={colors.text + "66"}
              keyboardType="phone-pad"
            />

            <Text style={s.label}>Dirección</Text>
            <TextInput
              value={direccion}
              onChangeText={setDireccion}
              style={s.input}
              placeholder="Dirección"
              placeholderTextColor={colors.text + "66"}
            />

            {isAdmin ? (
              <>
                <Text style={s.label}>Vendedor (opcional)</Text>
                <Pressable
                  style={({ pressed }) => [s.select, pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null]}
                  onPress={() => {
                    setVendQuery("");
                    setVendModalOpen(true);
                  }}
                >
                  <Text style={s.selectText}>{vendedorLabel}</Text>
                </Pressable>
              </>
            ) : null}

            <View style={s.switchRow}>
              <Text style={s.switchText}>Activo</Text>
              <Switch
                value={activo}
                onValueChange={setActivo}
                trackColor={{ false: colors.border, true: "#34C759" }}
                thumbColor={Platform.OS === "android" ? "#FFFFFF" : undefined}
                style={Platform.OS === "android" ? { transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] } : undefined}
              />
            </View>

            <Pressable
              onPress={onSave}
              disabled={saving}
              style={({ pressed }) => [s.btnPrimary, (pressed || saving) && { opacity: 0.85 }]}
            >
              <Text style={s.btnPrimaryText}>{saving ? "Guardando..." : "Guardar"}</Text>
            </Pressable>

            <View style={{ height: 12 }} />
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Modal: seleccionar vendedor */}
        <Modal
          visible={vendModalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setVendModalOpen(false);
            setVendQuery("");
          }}
        >
          <Pressable
            style={s.backdrop}
            onPress={() => {
              setVendModalOpen(false);
              setVendQuery("");
            }}
          />

          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Asignar vendedor</Text>

            <TextInput
              value={vendQuery}
              onChangeText={setVendQuery}
              style={s.input}
              placeholder="Buscar vendedor…"
              placeholderTextColor={colors.text + "66"}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Pressable
              style={s.modalItem}
              onPress={() => {
                setVendedorId(null);
                setVendModalOpen(false);
                setVendQuery("");
              }}
            >
              <Text style={s.modalItemText}>Sin asignar</Text>
            </Pressable>

            <FlatList
              data={vendedoresFiltrados}
              keyExtractor={(it) => it.id}
              style={{ maxHeight: 340 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const name = String(item.full_name ?? "").trim();
                const r = normalizeUpper(item.role);
                const label = name ? `${name}${r ? ` • ${r}` : ""}` : item.id;
                const selected = vendedorId === item.id;
                return (
                  <Pressable
                    style={({ pressed }) => [
                      s.modalItem,
                      selected ? s.modalItemSelected : null,
                      pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
                    ]}
                    onPress={() => {
                      setVendedorId(item.id);
                      setVendModalOpen(false);
                      setVendQuery("");
                    }}
                  >
                    <Text style={[s.modalItemText, selected ? s.modalItemTextSelected : null]}>{label}</Text>
                  </Pressable>
                );
              }}
              ListEmptyComponent={<Text style={[s.helper, { marginTop: 8 }]}>Sin resultados</Text>}
            />
          </View>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const styles = (colors: any) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },

    container: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 16,
      backgroundColor: colors.background,
    },

    label: {
      color: colors.text + "AA",
      marginTop: 12,
      marginBottom: 6,
      fontWeight: Platform.OS === "android" ? "500" : "500",
    },
    helper: {
      color: colors.text + "88",
      marginTop: 6,
      fontSize: 12,
      fontWeight: "400",
    },

    input: {
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: colors.card,
      marginBottom: 10,
      fontWeight: "400",
      fontSize: 16,
    },

    select: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: colors.card,
      justifyContent: "center",
    },
    selectText: { color: colors.text, fontSize: 16, fontWeight: "600" },

    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 12,
      backgroundColor: colors.card,
    },
    switchText: { color: colors.text, fontWeight: Platform.OS === "android" ? "500" : "600" },

    btnPrimary: {
      marginTop: 18,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: Platform.OS === "ios" ? "#007AFF" : (colors.primary ?? "#007AFF"),
    },
    btnPrimaryText: { color: "#fff", fontWeight: Platform.OS === "android" ? "800" : "900", fontSize: 16 },

    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
    modalCard: {
      position: "absolute",
      left: 16,
      right: 16,
      top: 90,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
    },
    modalTitle: { color: colors.text, fontWeight: "800", fontSize: 16, marginBottom: 10 },
    modalItem: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 12,
      marginBottom: 10,
      backgroundColor: colors.background,
    },
    modalItemSelected: {
      borderColor: Platform.OS === "ios" ? "#007AFF" : (colors.primary ?? "#007AFF"),
      backgroundColor: Platform.OS === "ios" ? "rgba(0,122,255,0.10)" : (colors.card ?? "transparent"),
    },
    modalItemText: { color: colors.text, fontWeight: "500" },
    modalItemTextSelected: { fontWeight: "800" },
  });
