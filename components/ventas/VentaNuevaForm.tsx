// components/ventas/VentaNuevaForm.tsx
// Pure form component — no navigation imports.
// Used inside VentaNuevaModal on web (create-only, no edit mode).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import {
  Alert,
  Image,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppButton } from "../ui/app-button";
import { supabase } from "../../lib/supabase";
import { dispatchNotifs } from "../../lib/notif-dispatch";
import { useVentaDraft } from "../../lib/ventaDraft";

// ─── helpers ────────────────────────────────────────────────────────────────

function parseIntSafe(s: string) {
  const n = Number(String(s ?? "").replace(/[^0-9]/g, ""));
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function parseDecimalSafe(s: string) {
  const n = Number(String(s ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fmtQ(n: number | null | undefined) {
  if (n == null) return "—";
  return `Q ${Number(n).toFixed(2)}`;
}

function extFromUri(uri: string) {
  const clean = String(uri ?? "").split("?")[0];
  const m = clean.match(/\.([a-zA-Z0-9]+)$/);
  const ext = (m?.[1] ?? "jpg").toLowerCase();
  if (ext === "jpeg") return "jpg";
  return ext;
}

function mimeFromExt(ext: string) {
  const e = (ext || "").toLowerCase();
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  if (e === "heic") return "image/heic";
  if (e === "heif") return "image/heif";
  return "image/jpeg";
}

async function uriToArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error("No se pudo leer la imagen");
  return await res.arrayBuffer();
}

const BUCKET_VENTAS_DOCS = "Ventas-Docs";

// ─── types ───────────────────────────────────────────────────────────────────

type Colors = {
  bg: string;
  card: string;
  text: string;
  sub: string;
  border: string;
  blueText: string;
  blue: string;
  danger: string;
};

type Props = {
  onDone: () => void;
  onCancel: () => void;
  isDark: boolean;
  colors: Colors;
  canCreate: boolean;
};

// ─── component ───────────────────────────────────────────────────────────────

export function VentaNuevaForm({ onDone, isDark, colors: C, canCreate }: Props) {
  const {
    draft,
    setCliente,
    setComentarios,
    addLinea,
    removeLinea,
    updateLinea,
    setProductoEnLinea,
    reset,
    setRecetaUri,
  } = useVentaDraft();
  const { cliente, comentarios, lineas, receta_uri } = draft;

  // Reset the draft each time this form mounts (fresh new-sale state)
  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [saving, setSaving] = useState(false);

  // Inline dropdown — client
  const [clienteDropOpen, setClienteDropOpen] = useState(false);
  const [clienteDropQ, setClienteDropQ] = useState("");
  const [clienteDropResults, setClienteDropResults] = useState<any[]>([]);
  const [clienteDropLoading, setClienteDropLoading] = useState(false);

  // Inline dropdown — product (per line key)
  const [openProdKey, setOpenProdKey] = useState<string | null>(null);
  const [prodQByKey, setProdQByKey] = useState<Record<string, string>>({});
  const [prodResultsByKey, setProdResultsByKey] = useState<Record<string, any[]>>({});
  const [prodLoadingByKey, setProdLoadingByKey] = useState<Record<string, boolean>>({});

  // Add-client inline modal
  const [addClienteOpen, setAddClienteOpen] = useState(false);
  const [newClienteNombre, setNewClienteNombre] = useState("");
  const [newClienteNit, setNewClienteNit] = useState("");
  const [newClienteTelefono, setNewClienteTelefono] = useState("");
  const [newClienteDireccion, setNewClienteDireccion] = useState("");
  const [savingNewCliente, setSavingNewCliente] = useState(false);

  const canEditNow = !saving;

  // ── search helpers ────────────────────────────────────────────────────────

  const searchClientes = useCallback(async (term: string) => {
    if (term.trim().length < 2) {
      setClienteDropResults([]);
      setClienteDropLoading(false);
      return;
    }
    setClienteDropLoading(true);
    try {
      const { data } = await supabase
        .from("clientes")
        .select("id,nombre,nit,telefono,direccion")
        .ilike("nombre", `%${term.trim()}%`)
        .limit(20);
      setClienteDropResults(data ?? []);
    } catch {
      setClienteDropResults([]);
    } finally {
      setClienteDropLoading(false);
    }
  }, []);

  const searchProductos = useCallback(async (term: string, lineKey: string) => {
    if (term.trim().length < 2) {
      setProdResultsByKey((prev) => ({ ...prev, [lineKey]: [] }));
      setProdLoadingByKey((prev) => ({ ...prev, [lineKey]: false }));
      return;
    }
    setProdLoadingByKey((prev) => ({ ...prev, [lineKey]: true }));
    try {
      const { data } = await supabase
        .from("vw_inventario_productos_v2")
        .select("id,nombre,marca,stock_disponible,precio_min_venta,tiene_iva,requiere_receta")
        .eq("activo", true)
        .ilike("nombre", `%${term.trim()}%`)
        .limit(20);
      const rows = data ?? [];
      const inStock = rows.filter((p: any) => Number(p.stock_disponible ?? 0) > 0);
      const outOfStock = rows.filter((p: any) => Number(p.stock_disponible ?? 0) <= 0);
      setProdResultsByKey((prev) => ({ ...prev, [lineKey]: [...inStock, ...outOfStock] }));
    } catch {
      setProdResultsByKey((prev) => ({ ...prev, [lineKey]: [] }));
    } finally {
      setProdLoadingByKey((prev) => ({ ...prev, [lineKey]: false }));
    }
  }, []);

  const saveNewCliente = useCallback(async () => {
    if (!newClienteNombre.trim()) return;
    setSavingNewCliente(true);
    try {
      const { data, error } = await supabase
        .from("clientes")
        .insert({
          nombre: newClienteNombre.trim(),
          nit: newClienteNit.trim() || null,
          telefono: newClienteTelefono.trim() || null,
          direccion: newClienteDireccion.trim() || null,
        })
        .select("id,nombre,nit,telefono,direccion")
        .single();
      if (error) throw error;
      setCliente({
        id: Number((data as any).id),
        nombre: String((data as any).nombre ?? ""),
        nit: (data as any).nit == null ? null : String((data as any).nit),
        telefono: (data as any).telefono == null ? null : String((data as any).telefono),
        direccion: (data as any).direccion == null ? null : String((data as any).direccion),
      });
      setAddClienteOpen(false);
      setNewClienteNombre("");
      setNewClienteNit("");
      setNewClienteTelefono("");
      setNewClienteDireccion("");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo crear el cliente");
    } finally {
      setSavingNewCliente(false);
    }
  }, [newClienteNombre, newClienteNit, newClienteTelefono, newClienteDireccion, setCliente]);

  // ── validation ─────────────────────────────────────────────────────────────

  const lineValidation = useCallback((l: any) => {
    if (!l.producto_id) return { ok: false, msg: "Selecciona un producto" };
    const stock = Number(l.stock_disponible ?? 0);
    const min = l.precio_min_venta == null ? 0 : Number(l.precio_min_venta);
    const qty = parseIntSafe(l.cantidad);
    const price = parseDecimalSafe(l.precio_unit);
    if (qty <= 0) return { ok: false, msg: "Cantidad debe ser mayor a 0" };
    if (qty > stock) return { ok: false, msg: `Cantidad supera disponibles (${stock})` };
    if (price < min) return { ok: false, msg: `Precio menor al minimo (${fmtQ(min)})` };
    return { ok: true, msg: "" };
  }, []);

  const allValid = useMemo(() => {
    if (!canCreate) return false;
    if (!cliente?.id) return false;
    if (lineas.length <= 0) return false;
    return lineas.every((l) => lineValidation(l).ok);
  }, [canCreate, cliente?.id, lineValidation, lineas]);

  const total = useMemo(() => {
    return lineas.reduce((acc, l: any) => {
      const qty = parseIntSafe(l.cantidad);
      const price = parseDecimalSafe(l.precio_unit);
      return acc + qty * price;
    }, 0);
  }, [lineas]);

  const requiereReceta = useMemo(() => {
    return lineas.some((l: any) => !!l.producto_id && !!l.requiere_receta);
  }, [lineas]);

  // ── receta picker ──────────────────────────────────────────────────────────

  const pickReceta = useCallback(async () => {
    if (!canCreate) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert("Permiso requerido", "Necesitas permitir acceso a fotos para escoger la receta.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
      });
      if (res.canceled) return;
      const asset = res.assets?.[0];
      if (!asset?.uri) return;
      setRecetaUri(asset.uri);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo seleccionar la receta");
    }
  }, [canCreate, setRecetaUri]);

  // ── save ───────────────────────────────────────────────────────────────────

  const onGuardar = () => {
    Keyboard.dismiss();
    if (!canCreate) return;
    if (!cliente?.id) return Alert.alert("Falta cliente", "Selecciona un cliente");
    const bad = lineas.find((l) => !lineValidation(l).ok);
    if (bad) {
      const v = lineValidation(bad);
      return Alert.alert("Revisa la venta", v.msg || "Hay datos invalidos");
    }
    if (saving) return;

    const p_venta = {
      cliente_id: Number(cliente.id),
      comentarios: comentarios?.trim() ? comentarios.trim() : null,
    };
    const p_items = lineas.map((l: any) => ({
      producto_id: Number(l.producto_id),
      cantidad: parseIntSafe(l.cantidad),
      precio_unit: parseDecimalSafe(l.precio_unit),
    }));

    setSaving(true);
    (async () => {
      try {
        const { data, error } = await supabase.rpc("rpc_crear_venta" as any, { p_venta, p_items } as any);
        if (error) throw error;

        const ventaId = (data as any)?.venta_id ?? null;
        if (ventaId) {
          dispatchNotifs(20).catch((e: any) => console.warn("[notif] dispatch failed", e?.message ?? e));
        }

        let recetaOk = true;
        if (ventaId && receta_uri) {
          try {
            const stamp = Date.now();
            const rnd = Math.random().toString(16).slice(2);
            const ext = extFromUri(receta_uri);
            const contentType = mimeFromExt(ext);
            const path = `ventas/${ventaId}/recetas/${stamp}-${rnd}.${ext}`;
            const ab = await uriToArrayBuffer(receta_uri);
            const bytes = new Uint8Array(ab);
            const { error: upErr } = await supabase.storage
              .from(BUCKET_VENTAS_DOCS)
              .upload(path, bytes, { contentType, upsert: false });
            if (upErr) throw upErr;
            const { error: rpcErr } = await supabase.rpc("rpc_venta_registrar_receta", {
              p_venta_id: Number(ventaId),
              p_path: path,
            });
            if (rpcErr) throw rpcErr;
          } catch {
            recetaOk = false;
          }
        }

        // Web: Alert callbacks don't fire (window.alert has no callback support).
        // Call reset + onDone directly, then show a non-blocking message if needed.
        reset();
        setRecetaUri(null);
        if (!recetaOk) {
          // window.alert is fine here — no callback needed
          window.alert("Venta creada. No se pudo subir la receta; puedes subirla desde el detalle en Ventas.");
        }
        onDone();
      } catch (e: any) {
        window.alert(`Error al guardar: ${String(e?.message ?? "No se pudo guardar la venta")}`);
      } finally {
        setSaving(false);
      }
    })().catch(() => {
      setSaving(false);
    });
  };

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <ScrollView
        style={[styles.scroll, { backgroundColor: C.bg }]}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 20 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Client */}
        <Text style={[styles.label, { color: C.text }]}>Cliente</Text>
        <View>
          <Pressable
            onPress={() => {
              if (!canCreate || !canEditNow) return;
              if (!clienteDropOpen) setClienteDropOpen(true);
            }}
            style={[
              styles.select,
              { borderColor: clienteDropOpen ? C.blueText : C.border, backgroundColor: C.card },
            ]}
          >
            <Text style={[styles.selectText, { color: cliente ? C.text : C.sub }]} numberOfLines={1}>
              {cliente ? `${cliente.nombre} • NIT: ${cliente.nit ?? "CF"}` : "Seleccionar cliente..."}
            </Text>
          </Pressable>
          {clienteDropOpen ? (
            <View style={[styles.dropdown, { borderColor: C.border, backgroundColor: C.card }]}>
              <TextInput
                autoFocus
                value={clienteDropQ}
                onChangeText={(t) => { setClienteDropQ(t); searchClientes(t); }}
                placeholder="Buscar cliente..."
                placeholderTextColor={C.sub}
                style={[styles.dropdownInput, { borderColor: C.border, color: C.text, backgroundColor: C.bg }]}
                onBlur={() => setTimeout(() => setClienteDropOpen(false), 150)}
              />
              <ScrollView style={styles.dropdownScroll} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                {clienteDropQ.trim().length < 2 ? (
                  <Text style={[styles.dropdownMsg, { color: C.sub }]}>Escribe para buscar...</Text>
                ) : clienteDropLoading ? (
                  <Text style={[styles.dropdownMsg, { color: C.sub }]}>Buscando...</Text>
                ) : clienteDropResults.length === 0 ? (
                  <Text style={[styles.dropdownMsg, { color: C.sub }]}>Sin resultados</Text>
                ) : (
                  clienteDropResults.map((c: any) => (
                    <Pressable
                      key={String(c.id)}
                      onPressIn={() => {
                        setCliente({
                          id: Number(c.id),
                          nombre: String(c.nombre ?? ""),
                          nit: c.nit ?? null,
                          telefono: c.telefono ?? null,
                          direccion: c.direccion ?? null,
                        });
                        setClienteDropOpen(false);
                        setClienteDropQ("");
                        setClienteDropResults([]);
                      }}
                      style={({ pressed }) => [
                        styles.dropdownItem,
                        { borderBottomColor: C.border },
                        pressed ? { backgroundColor: C.blue } : null,
                      ]}
                    >
                      <Text style={[styles.dropdownItemText, { color: C.text }]} numberOfLines={1}>{c.nombre}</Text>
                      <Text style={[styles.dropdownItemSub, { color: C.sub }]}>NIT: {c.nit ?? "CF"}</Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>
              <Pressable
                onPress={() => {
                  setClienteDropOpen(false);
                  setClienteDropQ("");
                  setClienteDropResults([]);
                  setAddClienteOpen(true);
                }}
                style={({ pressed }) => [
                  styles.addClienteBtn,
                  { borderTopColor: C.border },
                  pressed ? { backgroundColor: C.blue } : null,
                ]}
              >
                <Text style={[styles.addClienteBtnText, { color: C.blueText }]}>+ Agregar nuevo cliente</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {cliente ? (
          <View style={styles.clientMeta}>
            <Text style={[styles.clientMetaText, { color: C.sub }]} numberOfLines={1}>
              Tel: {cliente.telefono ?? "—"}
            </Text>
            <Text style={[styles.clientMetaText, { color: C.sub }]} numberOfLines={2}>
              Direccion de entrega: {cliente.direccion ?? "—"}
            </Text>
          </View>
        ) : null}

        {/* Comments */}
        <Text style={[styles.label, { color: C.text }]}>Comentarios (opcional)</Text>
        <TextInput
          value={comentarios}
          onChangeText={setComentarios}
          placeholder="Notas..."
          placeholderTextColor={C.sub}
          style={[
            styles.input,
            {
              height: 90,
              textAlignVertical: "top",
              borderColor: C.border,
              color: C.text,
              backgroundColor: C.card,
            },
          ]}
          multiline
        />

        {/* Product lines */}
        <Text style={[styles.h2, { color: C.text }]}>Productos</Text>

        {lineas.map((l: any, idx) => {
          const stock = l.producto_id ? Number(l.stock_disponible ?? 0) : null;
          const min = l.producto_id ? (l.precio_min_venta == null ? null : Number(l.precio_min_venta)) : null;
          const v = lineValidation(l);
          const qty = parseIntSafe(l.cantidad);
          const price = parseDecimalSafe(l.precio_unit);
          const sub = qty * price;

          return (
            <View key={l.key} style={[styles.card, { borderColor: C.border, backgroundColor: C.card }]}>
              <View style={styles.rowBetween}>
                <Text style={[styles.cardTitle, { color: C.text }]}>Linea {idx + 1}</Text>
                <Pressable onPress={() => removeLinea(l.key)} disabled={!canCreate}>
                  <Text style={[styles.linkDanger, { color: C.danger }]}>Eliminar</Text>
                </Pressable>
              </View>

              <Text style={[styles.label, { color: C.text }]}>Producto</Text>
              <View>
                <Pressable
                  onPress={() => {
                    if (!canCreate || !canEditNow) return;
                    if (openProdKey !== l.key) setOpenProdKey(l.key);
                  }}
                  style={[
                    styles.select,
                    { borderColor: openProdKey === l.key ? C.blueText : C.border, backgroundColor: C.card },
                  ]}
                >
                  <Text style={[styles.selectText, { color: l.producto_id ? C.text : C.sub }]} numberOfLines={1}>
                    {l.producto_id ? l.producto_label : "Seleccionar producto..."}
                  </Text>
                </Pressable>
                {openProdKey === l.key ? (
                  <View style={[styles.dropdown, { borderColor: C.border, backgroundColor: C.card }]}>
                    <TextInput
                      autoFocus
                      value={prodQByKey[l.key] ?? ""}
                      onChangeText={(t) => {
                        setProdQByKey((prev) => ({ ...prev, [l.key]: t }));
                        searchProductos(t, l.key);
                      }}
                      placeholder="Buscar producto..."
                      placeholderTextColor={C.sub}
                      style={[styles.dropdownInput, { borderColor: C.border, color: C.text, backgroundColor: C.bg }]}
                      onBlur={() => setTimeout(() => setOpenProdKey((k) => k === l.key ? null : k), 150)}
                    />
                    <ScrollView style={styles.dropdownScroll} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                      {(prodQByKey[l.key] ?? "").trim().length < 2 ? (
                        <Text style={[styles.dropdownMsg, { color: C.sub }]}>Escribe para buscar...</Text>
                      ) : prodLoadingByKey[l.key] ? (
                        <Text style={[styles.dropdownMsg, { color: C.sub }]}>Buscando...</Text>
                      ) : (prodResultsByKey[l.key] ?? []).length === 0 ? (
                        <Text style={[styles.dropdownMsg, { color: C.sub }]}>Sin resultados</Text>
                      ) : (
                        (prodResultsByKey[l.key] ?? []).map((p: any) => {
                          const pLabel = `${p.nombre ?? ""}${p.marca ? ` • ${p.marca}` : ""}`.trim();
                          const pStock = Number(p.stock_disponible ?? 0);
                          const inStock = pStock > 0;
                          return (
                            <Pressable
                              key={String(p.id)}
                              onPressIn={() => {
                                if (!inStock) return;
                                setProductoEnLinea({
                                  lineKey: l.key,
                                  producto_id: Number(p.id),
                                  producto_label: pLabel,
                                  stock_disponible: pStock,
                                  precio_min_venta: p.precio_min_venta == null ? null : Number(p.precio_min_venta),
                                  tiene_iva: !!p.tiene_iva,
                                  requiere_receta: !!p.requiere_receta,
                                });
                                setOpenProdKey(null);
                                setProdQByKey((prev) => ({ ...prev, [l.key]: "" }));
                                setProdResultsByKey((prev) => ({ ...prev, [l.key]: [] }));
                              }}
                              style={({ pressed }) => [
                                styles.dropdownItem,
                                { borderBottomColor: C.border },
                                !inStock
                                  ? { opacity: 0.45, cursor: "not-allowed" as any }
                                  : pressed ? { backgroundColor: C.blue } : null,
                              ]}
                            >
                              <Text style={[styles.dropdownItemText, { color: inStock ? C.text : C.sub }]} numberOfLines={1}>
                                {p.nombre ?? ""}
                              </Text>
                              <Text style={[styles.dropdownItemSub, { color: inStock ? C.sub : C.danger }]}>
                                {p.marca ? `${p.marca} • ` : ""}Stock: {pStock}{inStock ? ` • Min: ${fmtQ(p.precio_min_venta)}` : " unidades"}
                              </Text>
                            </Pressable>
                          );
                        })
                      )}
                    </ScrollView>
                  </View>
                ) : null}
              </View>

              {l.producto_id ? (
                <Text style={[styles.help, { color: C.sub }]}>
                  Disponibles: {stock ?? 0} • Min: {fmtQ(min)}
                </Text>
              ) : null}

              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: C.text }]}>Cantidad</Text>
                  <TextInput
                    value={l.cantidad}
                    onChangeText={(t) => updateLinea(l.key, { cantidad: t })}
                    keyboardType="number-pad"
                    style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.card }]}
                    placeholder="1"
                    placeholderTextColor={C.sub}
                    editable={canCreate}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: C.text }]}>Precio venta</Text>
                  <TextInput
                    value={l.precio_unit}
                    onChangeText={(t) => updateLinea(l.key, { precio_unit: t })}
                    keyboardType="decimal-pad"
                    style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.card }]}
                    placeholder="0.00"
                    placeholderTextColor={C.sub}
                    editable={canCreate}
                  />
                </View>
              </View>

              {!v.ok ? <Text style={[styles.err, { color: C.danger }]}>{v.msg}</Text> : null}

              <Text style={[styles.subtotal, { color: isDark ? "rgba(255,255,255,0.8)" : "#333" }]}>
                Subtotal: Q {sub.toFixed(2)}
              </Text>
            </View>
          );
        })}

        <AppButton
          title="+ Agregar otro producto"
          variant="ghost"
          onPress={() => (canCreate ? addLinea() : null)}
          style={[styles.btnAddBottom, { borderColor: C.border, backgroundColor: C.card }] as any}
          disabled={!canCreate}
        />

        <View style={[styles.totalCard, { borderColor: C.border, backgroundColor: C.card }]}>
          <Text style={[styles.totalLabel, { color: C.text }]}>Total</Text>
          <Text style={[styles.totalValue, { color: C.text }]}>Q {total.toFixed(2)}</Text>
        </View>

        {requiereReceta ? (
          <>
            <View style={[styles.divider, { backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "#eee" }]} />
            <Text style={[styles.h2, { color: C.text }]}>Receta</Text>
            <Text style={[styles.help, { color: C.sub }]}>Esta venta incluye productos que requieren receta.</Text>
            <View style={{ marginTop: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Pressable
                  onPress={pickReceta}
                  disabled={!canCreate}
                  style={({ pressed }) => [
                    styles.photoBtn,
                    {
                      borderColor: C.border,
                      backgroundColor: C.card,
                      opacity: !canCreate ? 0.5 : pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text style={{ color: C.text, fontWeight: "700" }}>
                    {receta_uri ? "Cambiar receta" : "Subir receta"}
                  </Text>
                </Pressable>
                {receta_uri ? (
                  <Pressable onPress={() => setRecetaUri(null)} disabled={!canCreate}>
                    <Text style={{ color: C.danger, fontWeight: "700" }}>Quitar</Text>
                  </Pressable>
                ) : null}
              </View>
              {receta_uri ? (
                <View style={{ marginTop: 10 }}>
                  <Image source={{ uri: receta_uri }} style={styles.photoPreview} />
                  <Text style={{ marginTop: 6, color: C.sub, fontSize: 12 }}>Se subira al guardar la venta.</Text>
                </View>
              ) : null}
            </View>
          </>
        ) : null}

        <AppButton
          title={!allValid ? "Revisa datos" : saving ? "Guardando..." : "Guardar venta"}
          onPress={onGuardar}
          disabled={!allValid || saving}
          style={[styles.saveBtn, { backgroundColor: C.blueText, marginBottom: 10 }] as any}
        />
      </ScrollView>

      {/* Add-client inline modal */}
      {addClienteOpen ? (
        <View style={styles.addClienteOverlay}>
          <Pressable
            style={[styles.addClienteBackdrop, { backgroundColor: isDark ? "rgba(0,0,0,0.65)" : "rgba(0,0,0,0.5)" }]}
            onPress={() => setAddClienteOpen(false)}
          />
          <View style={[styles.addClientePanel, { backgroundColor: C.card }]}>
            <View style={[styles.addClienteHeader, { borderBottomColor: C.border }]}>
              <Text style={[styles.addClienteTitle, { color: C.text }]}>Nuevo cliente</Text>
              <Pressable onPress={() => setAddClienteOpen(false)} style={styles.addClienteClose} hitSlop={8}>
                <Text style={[styles.addClienteCloseText, { color: C.sub }]}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.addClienteScroll} keyboardShouldPersistTaps="handled">
              <Text style={[styles.label, { color: C.text }]}>Nombre *</Text>
              <TextInput
                value={newClienteNombre}
                onChangeText={setNewClienteNombre}
                placeholder="Nombre del cliente"
                placeholderTextColor={C.sub}
                style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.bg }]}
                autoFocus
              />
              <Text style={[styles.label, { color: C.text }]}>NIT</Text>
              <TextInput
                value={newClienteNit}
                onChangeText={setNewClienteNit}
                placeholder="CF"
                placeholderTextColor={C.sub}
                style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.bg }]}
              />
              <Text style={[styles.label, { color: C.text }]}>Teléfono</Text>
              <TextInput
                value={newClienteTelefono}
                onChangeText={setNewClienteTelefono}
                placeholder="—"
                placeholderTextColor={C.sub}
                keyboardType="phone-pad"
                style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.bg }]}
              />
              <Text style={[styles.label, { color: C.text }]}>Dirección</Text>
              <TextInput
                value={newClienteDireccion}
                onChangeText={setNewClienteDireccion}
                placeholder="—"
                placeholderTextColor={C.sub}
                style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.bg }]}
              />
              <AppButton
                title={savingNewCliente ? "Guardando..." : "Guardar cliente"}
                onPress={saveNewCliente}
                disabled={!newClienteNombre.trim() || savingNewCliente}
                style={[styles.saveBtn, { backgroundColor: C.blueText, marginTop: 16, marginBottom: 20 }] as any}
              />
            </ScrollView>
          </View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, paddingHorizontal: 16 },

  h2: { fontSize: 18, fontWeight: "700", marginTop: 12, marginBottom: 8 },
  label: { marginTop: 10, marginBottom: 6, fontSize: 13, fontWeight: "600" },
  help: { marginTop: 8, fontSize: 12, fontWeight: "600" },

  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 10, android: 8, default: 8 }),
    fontSize: 16,
  },
  select: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 12, android: 10, default: 10 }),
  },
  selectText: { fontSize: 16, fontWeight: "500" },

  clientMeta: { marginTop: 8, paddingHorizontal: 12, gap: 4 },
  clientMetaText: { fontSize: 13, fontWeight: "600" },

  divider: { height: 1, marginVertical: 22 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  row2: { flexDirection: "row", gap: 12 },

  card: { marginTop: 12, borderWidth: 1, borderRadius: 16, padding: 14 },
  cardTitle: { fontSize: 16, fontWeight: "700" },
  linkDanger: { fontSize: 14, fontWeight: "600" },

  err: { marginTop: 10, fontSize: 12, fontWeight: "700" },
  subtotal: { marginTop: 10, fontSize: 13, fontWeight: "600" },

  totalCard: {
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: { fontSize: 16, fontWeight: "700" },
  totalValue: { fontSize: 18, fontWeight: "700" },

  btnAddBottom: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  saveBtn: {
    marginTop: 12,
    borderRadius: 14,
    paddingVertical: Platform.select({ ios: 14, android: 12, default: 12 }),
    alignItems: "center",
    justifyContent: "center",
  },

  photoBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignSelf: "flex-start",
  },
  photoPreview: { width: 140, height: 140, borderRadius: 14 },

  // Web inline dropdown
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
  dropdownItemText: { fontSize: 15, fontWeight: "600" },
  dropdownItemSub: { fontSize: 12, marginTop: 2 },

  addClienteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  addClienteBtnText: { fontSize: 14, fontWeight: "700" },

  // Add-client inline modal (web only)
  addClienteOverlay: {
    position: "fixed" as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100001,
    alignItems: "center",
    justifyContent: "center",
  },
  addClienteBackdrop: {
    position: "absolute" as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  addClientePanel: {
    maxWidth: 420,
    width: "100%" as any,
    maxHeight: "85vh" as any,
    borderRadius: 16,
    overflow: "hidden" as any,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    elevation: 20,
  },
  addClienteHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  addClienteTitle: { fontSize: 17, fontWeight: "700" },
  addClienteClose: { padding: 8 },
  addClienteCloseText: { fontSize: 16, fontWeight: "600" },
  addClienteScroll: { paddingHorizontal: 20, paddingTop: 4 },
});
