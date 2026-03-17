// components/clientes/ClienteFormInline.tsx
// Pure form component — no navigation imports.
// Used inside ClienteFormModal on web (create-only flow).

import React, { useCallback, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppButton } from "../ui/app-button";
import { supabase } from "../../lib/supabase";

// ─── types ───────────────────────────────────────────────────────────────────

type VendedorRow = {
  id: string;
  full_name: string | null;
  role: string;
};

type Colors = {
  bg: string;
  card: string;
  text: string;
  sub: string;
  border: string;
  primary: string;
};

type Props = {
  onDone: (newClienteId: number) => void;
  onCancel: () => void;
  isDark: boolean;
  colors: Colors;
  isAdmin: boolean;
  vendedorId: string | null; // pre-set for VENTAS role
  uid: string | null;
  empresaActivaId: number | null;
  editClienteId?: number; // when provided: load & update instead of insert
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function nitToSave(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  const norm = t.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (norm === "CF" || norm === "CONSUMIDORFINAL") return "CF";
  return t.toUpperCase();
}

// ─── component ───────────────────────────────────────────────────────────────

export function ClienteFormInline({
  onDone,
  onCancel: _onCancel,
  isDark,
  colors: C,
  isAdmin,
  vendedorId: initialVendedorId,
  empresaActivaId,
  editClienteId,
}: Props) {
  const isEditing = editClienteId != null;

  const [nombre, setNombre] = useState("");
  const [nit, setNit] = useState("");
  const [telefono, setTelefono] = useState("");
  const [direccion, setDireccion] = useState("");
  const [activo, setActivo] = useState(true);

  // Vendedor state (only relevant for isAdmin)
  const [vendedorId, setVendedorId] = useState<string | null>(null);
  const [vendedores, setVendedores] = useState<VendedorRow[]>([]);
  const [vendedoresLoaded, setVendedoresLoaded] = useState(false);
  const [vendDropOpen, setVendDropOpen] = useState(false);
  const [vendQuery, setVendQuery] = useState("");

  const [saving, setSaving] = useState(false);
  const [nitError, setNitError] = useState<string | null>(null);

  // Load existing data when editing
  React.useEffect(() => {
    if (!isEditing || !editClienteId || !empresaActivaId) return;
    // Load vendedores first so the label resolves correctly
    if (isAdmin) loadVendedores().catch(() => {});
    supabase
      .from("clientes")
      .select("id,nombre,nit,telefono,direccion,activo,vendedor_id")
      .eq("empresa_id", empresaActivaId)
      .eq("id", editClienteId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setNombre(String(data.nombre ?? ""));
        setNit(String(data.nit ?? ""));
        setTelefono(String(data.telefono ?? ""));
        setDireccion(String(data.direccion ?? ""));
        setActivo(!!(data as any).activo);
        setVendedorId((data as any).vendedor_id ?? null);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editClienteId, isEditing, empresaActivaId, isAdmin]);

  const danger = isDark ? "#FF6B6B" : "#CC0000";
  const blue = C.primary;
  const blueLight = isDark ? "rgba(21,60,158,0.22)" : "rgba(21,60,158,0.12)";

  const isFormValid = useMemo(() => {
    return !!(nombre.trim() && nit.trim() && telefono.trim() && direccion.trim());
  }, [nombre, nit, telefono, direccion]);

  // ── vendedor helpers ───────────────────────────────────────────────────────

  const loadVendedores = useCallback(async () => {
    if (vendedoresLoaded) return;
    const { data } = await supabase
      .from("profiles")
      .select("id,full_name,role")
      .in("role", ["ADMIN", "VENTAS"])
      .order("full_name", { ascending: true })
      .limit(400);
    setVendedores((data ?? []) as VendedorRow[]);
    setVendedoresLoaded(true);
  }, [vendedoresLoaded]);

  const vendedorLabel = useMemo(() => {
    if (!vendedorId) return "Sin asignar";
    const v = vendedores.find((x) => x.id === vendedorId);
    const n = String(v?.full_name ?? "").trim();
    const r = String(v?.role ?? "").trim().toUpperCase();
    return n ? `${n}${r ? ` • ${r}` : ""}` : vendedorId;
  }, [vendedorId, vendedores]);

  const vendedoresFiltrados = useMemo(() => {
    const q = vendQuery.trim().toLowerCase();
    if (!q) return vendedores;
    return vendedores.filter((v) => {
      const name = String(v.full_name ?? "").toLowerCase();
      return name.includes(q) || v.id.toLowerCase().includes(q);
    });
  }, [vendQuery, vendedores]);

  // ── save ──────────────────────────────────────────────────────────────────

  const onSave = useCallback(async () => {
    if (!isFormValid || saving) return;
    setNitError(null);

    const cleanNombre = nombre.trim();
    const cleanTel = telefono.trim();
    const cleanDir = direccion.trim();
    const nitSave = nitToSave(nit);
    const vendIdToSave = isAdmin ? vendedorId : initialVendedorId;

    if (!empresaActivaId) {
      setNitError("Sin empresa activa. Contacta al administrador.");
      return;
    }
    setSaving(true);
    try {
      if (isEditing && editClienteId) {
        const payload: any = {
          nombre: cleanNombre,
          nit: nitSave,
          telefono: cleanTel,
          direccion: cleanDir,
          activo,
          vendedor_id: vendIdToSave ?? null,
        };
        const { error } = await supabase
          .from("clientes")
          .update(payload)
          .eq("empresa_id", empresaActivaId)
          .eq("id", editClienteId);
        if (error) throw error;
        onDone(editClienteId);
      } else {
        const { data, error } = await supabase
          .from("clientes")
          .insert({
            empresa_id: empresaActivaId,
            nombre: cleanNombre,
            nit: nitSave,
            telefono: cleanTel,
            direccion: cleanDir,
            activo: true,
            vendedor_id: vendIdToSave ?? null,
          })
          .select("id")
          .single();
        if (error) throw error;
        const newId = (data as any)?.id;
        onDone(Number(newId));
      }
    } catch (e: any) {
      const msg = String(e?.message ?? "No se pudo guardar");
      if (msg.toLowerCase().includes("ux_clientes_nit")) {
        setNitError("Ese NIT ya existe");
      } else {
        setNitError(msg);
      }
    } finally {
      setSaving(false);
    }
  }, [
    isFormValid,
    saving,
    nombre,
    telefono,
    direccion,
    nit,
    activo,
    isAdmin,
    isEditing,
    editClienteId,
    vendedorId,
    initialVendedorId,
    onDone,
    empresaActivaId,
  ]);

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <View style={s.container}>
      {/* Nombre */}
      <View style={s.fieldRow}>
        <Text style={[s.label, { color: C.text }]}>
          Nombre <Text style={{ color: danger }}>*</Text>
        </Text>
        <TextInput
          value={nombre}
          onChangeText={setNombre}
          placeholder="Nombre del cliente"
          placeholderTextColor={C.sub}
          autoCapitalize="words"
          style={[s.input, { borderColor: C.border, color: C.text, backgroundColor: C.bg }]}
        />
      </View>

      {/* NIT */}
      <View style={s.fieldRow}>
        <Text style={[s.label, { color: C.text }]}>
          NIT <Text style={{ color: danger }}>*</Text>
        </Text>
        <View style={s.inputWrap}>
          <TextInput
            value={nit}
            onChangeText={(t) => {
              setNit(t);
              setNitError(null);
            }}
            placeholder="CF / Consumidor Final o NIT"
            placeholderTextColor={C.sub}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[
              s.input,
              { borderColor: nitError ? danger : C.border, color: C.text, backgroundColor: C.bg },
            ]}
          />
          {nitError ? <Text style={[s.err, { color: danger }]}>{nitError}</Text> : null}
        </View>
      </View>

      {/* Teléfono */}
      <View style={s.fieldRow}>
        <Text style={[s.label, { color: C.text }]}>
          Teléfono <Text style={{ color: danger }}>*</Text>
        </Text>
        <TextInput
          value={telefono}
          onChangeText={setTelefono}
          placeholder="Ej: 5555-5555"
          placeholderTextColor={C.sub}
          keyboardType="phone-pad"
          style={[s.input, { borderColor: C.border, color: C.text, backgroundColor: C.bg }]}
        />
      </View>

      {/* Dirección */}
      <View style={s.fieldRow}>
        <Text style={[s.label, { color: C.text }]}>
          Dirección <Text style={{ color: danger }}>*</Text>
        </Text>
        <TextInput
          value={direccion}
          onChangeText={setDireccion}
          placeholder="Dirección"
          placeholderTextColor={C.sub}
          style={[s.input, { borderColor: C.border, color: C.text, backgroundColor: C.bg }]}
        />
      </View>

      {/* Vendedor dropdown — admin only */}
      {isAdmin ? (
        <>
          <View style={s.fieldRow}>
            <Text style={[s.label, { color: C.text }]}>Vendedor (opcional)</Text>
            <View style={s.inputWrap}>
            <Pressable
              onPress={() => {
                if (!vendDropOpen) {
                  loadVendedores().catch(() => {});
                  setVendDropOpen(true);
                } else {
                  setVendDropOpen(false);
                }
              }}
              style={[
                s.select,
                { borderColor: vendDropOpen ? blue : C.border, backgroundColor: C.bg },
              ]}
            >
              <Text style={[s.selectText, { color: C.text }]}>{vendedorLabel}</Text>
            </Pressable>

            {vendDropOpen ? (
              <View style={[s.dropdown, { borderColor: C.border, backgroundColor: C.card }]}>
                <TextInput
                  autoFocus
                  value={vendQuery}
                  onChangeText={setVendQuery}
                  placeholder="Buscar vendedor..."
                  placeholderTextColor={C.sub}
                  style={[
                    s.dropdownInput,
                    { borderColor: C.border, color: C.text, backgroundColor: C.bg },
                  ]}
                  onBlur={() => setTimeout(() => setVendDropOpen(false), 150)}
                />
                <ScrollView
                  style={s.dropdownScroll}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                >
                  {/* Sin asignar */}
                  <Pressable
                    onPressIn={() => {
                      setVendedorId(null);
                      setVendDropOpen(false);
                      setVendQuery("");
                    }}
                    style={({ pressed }) => [
                      s.dropdownItem,
                      { borderBottomColor: C.border },
                      pressed ? { backgroundColor: blueLight } : null,
                    ]}
                  >
                    <Text style={[s.dropdownItemText, { color: C.text }]}>Sin asignar</Text>
                  </Pressable>

                  {/* Vendedor rows */}
                  {!vendedoresLoaded ? (
                    <Text style={[s.dropdownMsg, { color: C.sub }]}>Cargando...</Text>
                  ) : vendedoresFiltrados.length === 0 ? (
                    <Text style={[s.dropdownMsg, { color: C.sub }]}>Sin resultados</Text>
                  ) : (
                    vendedoresFiltrados.map((v) => {
                      const name = String(v.full_name ?? "").trim();
                      const r = String(v.role ?? "").trim().toUpperCase();
                      const label = name ? `${name}${r ? ` • ${r}` : ""}` : v.id;
                      const selected = vendedorId === v.id;
                      return (
                        <Pressable
                          key={v.id}
                          onPressIn={() => {
                            setVendedorId(v.id);
                            setVendDropOpen(false);
                            setVendQuery("");
                          }}
                          style={({ pressed }) => [
                            s.dropdownItem,
                            { borderBottomColor: C.border },
                            selected || pressed ? { backgroundColor: blueLight } : null,
                          ]}
                        >
                          <Text
                            style={[
                              s.dropdownItemText,
                              { color: C.text, fontWeight: selected ? "800" : "600" },
                            ]}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>
              </View>
            ) : null}
            </View>
          </View>
        </>
      ) : null}

      {/* Activo toggle — only shown when editing */}
      {isEditing ? (
        <View style={[s.switchRow, { borderColor: C.border }]}>
          <Text style={[s.switchLabel, { color: C.text }]}>Activo</Text>
          <Switch
            value={activo}
            onValueChange={setActivo}
            trackColor={{ false: C.border, true: "#34C759" }}
            thumbColor={Platform.OS === "android" ? "#FFFFFF" : undefined}
            style={Platform.OS === "android" ? { transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] } : undefined}
          />
        </View>
      ) : null}

      {/* Save button */}
      <AppButton
        title={saving ? "Guardando..." : isEditing ? "Guardar cambios" : "Guardar cliente"}
        onPress={onSave}
        disabled={!isFormValid || saving}
        style={[s.saveBtn, { backgroundColor: blue, marginTop: 20 }] as any}
      />
    </View>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
  },
  inputWrap: {
    flex: 1,
  },
  label: {
    width: 110,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "right",
    paddingRight: 12,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 10, android: 8, default: 8 }),
    fontSize: 16,
  },
  err: { marginTop: 4, fontSize: 12, fontWeight: "700" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  switchLabel: { fontSize: 14, fontWeight: "600" },
  select: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 12, android: 10, default: 10 }),
  },
  selectText: { fontSize: 16, fontWeight: "600" },
  saveBtn: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  dropdown: {
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  dropdownInput: {
    borderWidth: 1,
    borderRadius: 8,
    margin: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  dropdownScroll: { maxHeight: 200 },
  dropdownMsg: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dropdownItemText: { fontSize: 15 },
});
