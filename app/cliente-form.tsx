import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
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
import { useRole } from "../lib/useRole";
import { AppButton } from "../components/ui/app-button";
import { KeyboardAwareModal } from "../components/ui/keyboard-aware-modal";
import { DoneAccessory } from "../components/ui/done-accessory";
import { useKeyboardAutoScroll } from "../components/ui/use-keyboard-autoscroll";
import { goBackSafe } from "../lib/goBackSafe";
import { FB_DARK_DANGER } from "../src/theme/headerColors";

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
  const DONE_ID = "doneAccessory";
  const { scrollRef, handleFocus } = useKeyboardAutoScroll(110);
  const s = useMemo(() => styles(colors), [colors]);
  const dangerColor = FB_DARK_DANGER;

  const { id } = useLocalSearchParams<{ id?: string }>();
  const editingId = id && Number.isFinite(Number(id)) ? Number(id) : null;
  const isEditing = editingId != null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const { role, uid, isReady, refreshRole } = useRole();
  const roleUp = String(role ?? "").trim().toUpperCase() as Role;
  const isAdmin = isReady && roleUp === "ADMIN";
  const isVendedor = isReady && roleUp === "VENTAS";
  const canEdit = isReady && (roleUp === "ADMIN" || roleUp === "VENTAS");

  useFocusEffect(
    useCallback(() => {
      void refreshRole("focus:cliente-form");
    }, [refreshRole])
  );

  const [nombre, setNombre] = useState("");
  const [nit, setNit] = useState("");
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

  const isFormValid = useMemo(() => {
    return !!(String(nombre ?? "").trim() && String(nit ?? "").trim() && String(telefono ?? "").trim() && String(direccion ?? "").trim());
  }, [nombre, nit, telefono, direccion]);

  const vendedorLabel = useMemo(() => {
    if (!isAdmin) return "—";
    if (!vendedorId) return "Sin asignar";
    const v = vendedores.find((x) => x.id === vendedorId);
    const n = String(v?.full_name ?? "").trim();
    const r = normalizeUpper(v?.role);
    return n ? `${n}${r ? ` • ${r}` : ""}` : vendedorId;
  }, [isAdmin, vendedorId, vendedores]);

  const loadVendedores = useCallback(async () => {
    if (!isAdmin) {
      setVendedores([]);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id,full_name,role")
      .in("role", ["ADMIN", "VENTAS"])
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
    setNit(String(c.nit ?? ""));
    setTelefono(String(c.telefono ?? ""));
    setDireccion(String(c.direccion ?? ""));
    setActivo(!!c.activo);
    setVendedorId(c.vendedor_id ?? null);
  }, [editingId, isEditing]);

  useEffect(() => {
    if (!isReady) return;

    // Si no puede editar, salimos
    if (!canEdit) {
      Alert.alert("Sin permiso", "No tienes permiso para crear o editar clientes");
      goBackSafe("/(drawer)/clientes");
      return;
    }

    // vendedor: siempre asignado a si mismo
    if (isVendedor && uid) setVendedorId(uid);
  }, [canEdit, isReady, isVendedor, uid]);

  useEffect(() => {
    if (!isReady) return;
    // Cargar lista de vendedores SOLO para admin
    loadVendedores().catch(() => {
      setVendedores([]);
    });
  }, [isReady, loadVendedores]);

  useEffect(() => {
    if (!isReady) return;
    // Cargar cliente al editar
    setLoading(true);
    loadCliente()
      .catch((e: any) => {
        Alert.alert("Error", e?.message ?? "No se pudo cargar el cliente");
      })
      .finally(() => setLoading(false));
  }, [isReady, loadCliente]);

  const onSave = useCallback(async () => {
    if (!canEdit) return;
    if (saving) return;

    const cleanNombre = nombre.trim();
    const cleanTel = telefono.trim();
    const cleanDir = direccion.trim();
    const cleanNit = String(nit ?? "").trim();

    if (!cleanNombre) return Alert.alert("Faltan datos", "Nombre es obligatorio");
    if (!cleanNit) return Alert.alert("Faltan datos", "NIT es obligatorio");
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
          goBackSafe("/(drawer)/clientes");
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
      goBackSafe({ pathname: "/cliente-detalle" as any, params: { id: String(editingId) } } as any);
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
        <Stack.Screen options={{ title, headerShown: true, headerBackTitle: "Atrás" }} />
        <View style={s.center}>
          <Text style={{ color: colors.text + "88", fontWeight: "700" }}>Cargando...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title, headerShown: true, headerBackTitle: "Atrás" }} />

      <SafeAreaView style={[s.safe, { paddingBottom: insets.bottom }]} edges={["bottom"]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
        >
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={s.container}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
          >
            <Text style={s.label}>
              Nombre <Text style={{ color: dangerColor }}>*</Text>
            </Text>
            <TextInput
              value={nombre}
              onChangeText={setNombre}
              onFocus={handleFocus}
              style={s.input}
              placeholder="Nombre del cliente"
              placeholderTextColor={colors.text + "66"}
              autoCapitalize="words"
            />

            <Text style={s.label}>
              NIT <Text style={{ color: dangerColor }}>*</Text>
            </Text>
            <TextInput
              value={nit}
              onChangeText={setNit}
              onFocus={handleFocus}
              style={s.input}
              placeholder="CF / Consumidor Final o NIT"
              placeholderTextColor={colors.text + "66"}
              autoCapitalize="characters"
              autoCorrect={false}
            />

            <Text style={s.label}>
              Teléfono <Text style={{ color: dangerColor }}>*</Text>
            </Text>
            <TextInput
              value={telefono}
              onChangeText={setTelefono}
              onFocus={handleFocus}
              style={s.input}
              placeholder="Ej: 5555-5555"
              placeholderTextColor={colors.text + "66"}
              keyboardType="phone-pad"
              inputAccessoryViewID={Platform.OS === "ios" ? DONE_ID : undefined}
            />

            <Text style={s.label}>
              Dirección <Text style={{ color: dangerColor }}>*</Text>
            </Text>
            <TextInput
              value={direccion}
              onChangeText={setDireccion}
              onFocus={handleFocus}
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

            <AppButton title="Guardar" onPress={onSave} loading={saving} disabled={!isFormValid} style={{ marginTop: 18 } as any} />

            <View style={{ height: 12 }} />
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Modal: seleccionar vendedor */}
        <KeyboardAwareModal
          visible={vendModalOpen}
          onClose={() => {
            setVendModalOpen(false);
            setVendQuery("");
          }}
          cardStyle={{ backgroundColor: colors.card, borderColor: colors.border }}
          backdropOpacity={0.35}
        >
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
            automaticallyAdjustKeyboardInsets
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
        </KeyboardAwareModal>

        <DoneAccessory nativeID={DONE_ID} />
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

    // Buttons handled by AppButton

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
      borderColor: (colors.primary ?? "#153c9e"),
      backgroundColor: Platform.OS === "ios" ? "rgba(0,122,255,0.10)" : (colors.card ?? "transparent"),
    },
    modalItemText: { color: colors.text, fontWeight: "500" },
    modalItemTextSelected: { fontWeight: "800" },
  });
