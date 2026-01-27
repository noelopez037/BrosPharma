// app/compra-nueva.tsx
// + Foto por producto en cada línea (expo-image-picker + Supabase Storage)
// - Guarda image_uri (preview) y image_path (storage path) en la línea
// - Al guardar, manda image_path en p_detalles para que el RPC actualice productos.image_path
// - Mantiene el FIX de franja blanca (SafeArea bottom + contentInsetAdjustmentBehavior="never")
// ✅ FIX TEMA: usa ThemePref (toggle del drawer), NO useColorScheme()
// ✅ MODO EDICIÓN: si viene ?editId=123, carga la compra al draft y guarda con rpc_compra_reemplazar
// ✅ FIX: CARGA EDIT ESTABLE (device físico): esperar líneas antes de hidratar productos
// ✅ FIX: si NO es edición, reset al enfocar (nueva compra limpia)
// ✅ UI: botón “+ Agregar otro producto” al final de las líneas
// ✅ FIX (ESTE CAMBIO): no resetear al regresar de /select-proveedor o /select-producto
// ✅ FIX: expo-image-picker deprecación (MediaTypeOptions -> MediaType)

import DateTimePicker, {
  DateTimePickerAndroid,
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useFocusEffect, useTheme } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { Stack, router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useCompraDraft } from "../lib/compraDraft";
import { supabase } from "../lib/supabase";
import { useThemePref } from "../lib/themePreference";
import { alphaColor } from "../lib/ui";

const BUCKET = "productos";

function toYMD(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function parseNumberSafe(s: string) {
  const n = Number(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function extFromUri(uri: string) {
  const clean = uri.split("?")[0];
  const m = clean.match(/\.([a-zA-Z0-9]+)$/);
  const ext = (m?.[1] ?? "jpg").toLowerCase();
  if (ext === "jpeg") return "jpg";
  if (ext === "heic") return "heic";
  if (ext === "png") return "png";
  return "jpg";
}

async function uriToArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error("No se pudo leer la imagen");
  return await res.arrayBuffer();
}

export default function CompraNuevaScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ editId?: string }>();

  const { colors } = useTheme();

  const editIdRaw = params?.editId ? String(params.editId) : null;
  const editId =
    editIdRaw && Number.isFinite(Number(editIdRaw)) && Number(editIdRaw) > 0 ? editIdRaw : null;
  const isEdit = !!editId;

  // ✅ TEMA DESDE TOGGLE (drawer)
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  const C = useMemo(
    () => ({
      bg: colors.background ?? (isDark ? "#000" : "#fff"),
      card: colors.card ?? (isDark ? "#1C1C1E" : "#fff"),
      text: colors.text ?? (isDark ? "#fff" : "#111"),
      sub:
        alphaColor(String(colors.text ?? (isDark ? "#ffffff" : "#000000")), 0.65) ||
        (isDark ? "rgba(255,255,255,0.65)" : "#666"),
      border: colors.border ?? (isDark ? "rgba(255,255,255,0.14)" : "#e5e5e5"),
      blueText: String(colors.primary ?? "#007AFF"),
      blue: alphaColor(String(colors.primary ?? "#007AFF"), 0.18) || "rgba(64, 156, 255, 0.18)",
      backdrop: "rgba(0,0,0,0.35)",
      danger: isDark ? "rgba(255,120,120,0.95)" : "#d00",
    }),
    [isDark, colors.background, colors.border, colors.card, colors.primary, colors.text]
  );

  const {
    draft,
    setProveedor,
    setNumeroFactura,
    setTipoPago,
    setComentarios,
    setFechaVenc,
    addLinea,
    removeLinea,
    updateLinea,
    reset,
  } = useCompraDraft();

  const { proveedor, numeroFactura, tipoPago, comentarios, fechaVenc, lineas } = draft;

  // Mantener referencia al draft actual (para evitar estados stale en timers)
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const [saving, setSaving] = useState(false);

  // ====== LOAD EDIT MODE
  const [loadingEdit, setLoadingEdit] = useState(false);

  // Cancelación/orden de requests para no mezclar compras
  const loadSeqRef = useRef(0);
  const lastLoadedEditIdRef = useRef<string | null>(null);

  // ✅ FIX: cuando navegamos a selectores, al volver NO debemos resetear
  const skipResetOnFocusRef = useRef(false);

  const hydrateWhenReady = useCallback(
    (targetEditId: string, rows: any[]) => {
      const mySeq = loadSeqRef.current;

      const N = rows.length;

      const tick = () => {
        // si cambió la carga, salir
        if (mySeq !== loadSeqRef.current) return;
        if (!targetEditId) return;

        const cur = draftRef.current;
        if (!cur) return;

        if (cur.lineas.length < N) {
          // agregar hasta llegar a N
          const missing = N - cur.lineas.length;
          for (let i = 0; i < missing; i++) addLinea();
          // reintentar en el próximo tick
          setTimeout(tick, 0);
          return;
        }

        const keys = cur.lineas.slice(0, N).map((l) => l.key);

        rows.forEach((r: any, idx: number) => {
          const k = keys[idx];
          if (!k) return;

          const nombre = r.productos?.nombre ?? "";
          const marcaNombre = r.productos?.marcas?.nombre ?? "";
          const label = `${nombre}${marcaNombre ? ` • ${marcaNombre}` : ""}`;

          updateLinea(k, {
            producto_id: Number(r.producto_id),
            producto_label: label,
            lote: r.producto_lotes?.lote ?? "",
            fecha_exp: r.producto_lotes?.fecha_exp ?? null,
            cantidad: String(r.cantidad ?? "1"),
            precio: String(r.precio_compra_unit ?? "0"),
            // En edición: conserva la foto actual del producto (si existe)
            image_path: r.productos?.image_path ?? null,
            image_uri: null,
          });
        });

        lastLoadedEditIdRef.current = targetEditId;
      };

      setTimeout(tick, 0);
    },
    [addLinea, updateLinea]
  );

  const loadEdit = useCallback(
    async (idToLoad: string) => {
      const seq = ++loadSeqRef.current;
      setLoadingEdit(true);

      try {
        const { data: c, error: e1 } = await supabase
          .from("compras")
          .select(
            "id,proveedor_id,numero_factura,tipo_pago,fecha_vencimiento,comentarios,proveedores(nombre)"
          )
          .eq("id", Number(idToLoad))
          .maybeSingle();

        if (seq !== loadSeqRef.current) return;

        if (e1) throw e1;
        if (!c) throw new Error("Compra no encontrada");

        const { data: d, error: e2 } = await supabase
          .from("compras_detalle")
          .select(
            "id,cantidad,precio_compra_unit,producto_id, productos(nombre,image_path,marca_id,marcas(nombre)), producto_lotes(lote,fecha_exp)"
          )
          .eq("compra_id", Number(idToLoad))
          .order("id", { ascending: true });

        if (seq !== loadSeqRef.current) return;

        if (e2) throw e2;

        // Reset primero
        reset();

        // Cabecera
        setProveedor({
          id: Number(c.proveedor_id),
          nombre: (c as any).proveedores?.nombre ?? `Proveedor #${c.proveedor_id}`,
        });
        setNumeroFactura(c.numero_factura ?? "");
        setTipoPago(String(c.tipo_pago).toUpperCase() === "CREDITO" ? "CREDITO" : "CONTADO");
        setFechaVenc(c.fecha_vencimiento ?? null);
        setComentarios(c.comentarios ?? "");

        const rows = (d ?? []) as any[];

        if (rows.length <= 0) {
          updateLinea("l1", {
            producto_id: null,
            producto_label: "",
            lote: "",
            fecha_exp: null,
            cantidad: "1",
            precio: "0",
            image_path: null,
            image_uri: null,
          });
          lastLoadedEditIdRef.current = idToLoad;
          return;
        }

        // Hidratar de forma estable (espera líneas antes de setear productos)
        hydrateWhenReady(idToLoad, rows);
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "No se pudo cargar la compra");
      } finally {
        if (seq === loadSeqRef.current) setLoadingEdit(false);
      }
    },
    [
      hydrateWhenReady,
      reset,
      setProveedor,
      setNumeroFactura,
      setTipoPago,
      setFechaVenc,
      setComentarios,
      updateLinea,
    ]
  );

  // ✅ Al enfocar:
  // - si edit: recargar si cambió editId o si nunca se cargó
  // - si no edit: reset para pantalla limpia, PERO NO cuando regresamos de selectores
  useFocusEffect(
    useCallback(() => {
      if (isEdit && editId) {
        if (lastLoadedEditIdRef.current !== editId) {
          loadEdit(editId).catch(() => {});
        }
      } else {
        if (skipResetOnFocusRef.current) {
          // venimos de /select-proveedor o /select-producto
          skipResetOnFocusRef.current = false;
        } else {
          // nueva compra limpia al entrar "de verdad"
          ++loadSeqRef.current;
          lastLoadedEditIdRef.current = null;
          reset();
        }
      }

      return () => {
        // al salir no hacemos reset (para no romper flow), solo invalidar cargas pendientes
        ++loadSeqRef.current;
      };
    }, [isEdit, editId, loadEdit, reset])
  );

  // ====== DATE PICKERS (iOS modal propio)
  const [iosDateOpen, setIosDateOpen] = useState(false);
  const [iosDateTitle, setIosDateTitle] = useState("");
  const [iosDateValue, setIosDateValue] = useState<Date>(new Date());
  const [iosDateOnConfirm, setIosDateOnConfirm] = useState<(d: Date) => void>(() => () => {});
  const iosTempRef = useRef<Date>(new Date());

  const openDatePicker = (opts: { title: string; initial: Date; onConfirm: (d: Date) => void }) => {
    Keyboard.dismiss();

    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: opts.initial,
        mode: "date",
        is24Hour: true,
        onChange: (_e: DateTimePickerEvent, d?: Date) => {
          if (d) opts.onConfirm(d);
        },
      });
      return;
    }

    iosTempRef.current = opts.initial;
    setIosDateTitle(opts.title);
    setIosDateValue(opts.initial);
    setIosDateOnConfirm(() => opts.onConfirm);
    setIosDateOpen(true);
  };

  // vencimiento crédito default +30 (pero guardado en STORE)
  useEffect(() => {
    if (tipoPago === "CREDITO") {
      if (!draft.fechaVenc) setFechaVenc(toYMD(addDays(new Date(), 30)));
    } else {
      setFechaVenc(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoPago]);

  // total
  const total = useMemo(() => {
    return lineas.reduce((acc, l) => {
      const cant = Math.max(0, Math.floor(parseNumberSafe(l.cantidad)));
      const precio = Math.max(0, parseNumberSafe(l.precio));
      return acc + cant * precio;
    }, 0);
  }, [lineas]);

  const ensureMediaPerm = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permiso requerido", "Necesitas permitir acceso a fotos para escoger una imagen.");
      return false;
    }
    return true;
  };

  const pickFotoParaLinea = async (lineKey: string) => {
    const ok = await ensureMediaPerm();
    if (!ok) return;

    try {
      const res = await ImagePicker.launchImageLibraryAsync({
  mediaTypes: ["images"],
  quality: 0.85,
  allowsEditing: true,
  aspect: [1, 1],
});


      if (res.canceled) return;

      const asset = res.assets?.[0];
      if (!asset?.uri) return;

      updateLinea(lineKey, { image_uri: asset.uri });

      const ext = extFromUri(asset.uri);
      const path = `compras/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;
      const ab = await uriToArrayBuffer(asset.uri);

      const contentType =
        ext === "png" ? "image/png" : ext === "heic" ? "image/heic" : "image/jpeg";

      const { error } = await supabase.storage.from(BUCKET).upload(path, ab, {
        contentType,
        upsert: true,
      });

      if (error) throw error;

      updateLinea(lineKey, { image_path: path });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo subir la imagen");
      updateLinea(lineKey, { image_uri: null, image_path: null });
    }
  };

  const quitarFotoLinea = (lineKey: string) => {
    updateLinea(lineKey, { image_uri: null, image_path: null });
  };

  // ================== GUARDAR (RPC)
  const guardar = async () => {
    if (saving || loadingEdit) return;

    const factura = numeroFactura.trim();
    if (!proveedor?.id) return Alert.alert("Falta proveedor", "Selecciona un proveedor");
    if (!factura) return Alert.alert("Falta factura", "Ingresa el número de factura");
    if (tipoPago === "CREDITO" && !fechaVenc)
      return Alert.alert("Falta vencimiento", "Falta fecha de vencimiento (crédito)");

    const detalles = lineas.map((l) => {
      const cantidad = Math.max(0, Math.floor(parseNumberSafe(l.cantidad)));
      const precio = Math.max(0, parseNumberSafe(l.precio));
      return {
        producto_id: l.producto_id,
        lote: (l.lote ?? "").trim(),
        fecha_exp: l.fecha_exp,
        cantidad,
        precio_compra_unit: precio,
        image_path: (l as any).image_path ?? null,
      };
    });

    const invalid = detalles.some(
      (d) =>
        !d.producto_id ||
        !d.lote ||
        !d.fecha_exp ||
        d.cantidad <= 0 ||
        d.precio_compra_unit < 0
    );
    if (invalid) {
      return Alert.alert(
        "Revisa productos",
        "Cada línea necesita: producto, lote, expiración, cantidad (>0) y precio"
      );
    }

    setSaving(true);
    try {
      const p_compra = {
        proveedor_id: proveedor.id,
        numero_factura: factura,
        tipo_pago: tipoPago,
        fecha_vencimiento: tipoPago === "CREDITO" ? fechaVenc : null,
        comentarios: comentarios.trim() ? comentarios.trim() : null,
        fecha: new Date().toISOString(),
        estado: "ACTIVA",
      };

      if (isEdit && editId) {
        const { error } = await supabase.rpc("rpc_compra_reemplazar", {
          p_compra_id: Number(editId),
          p_compra,
          p_detalles: detalles,
        });
        if (error) throw error;

        Alert.alert("Listo", "Compra actualizada", [{ text: "OK", onPress: () => router.back() }]);
      } else {
        const { error } = await supabase.rpc("rpc_crear_compra", {
          p_compra,
          p_detalles: detalles,
        });
        if (error) throw error;

        Alert.alert("Listo", "Compra guardada!", [
          {
            text: "OK",
            onPress: () => {
              reset();
              router.back();
            },
          },
        ]);
      }
    } catch (e: any) {
      Alert.alert("Error al guardar", e?.message ?? "No se pudo guardar la compra");
    } finally {
      setSaving(false);
    }
  };

  const title = isEdit ? "Editar compra" : "Nueva compra";
  const saveLabel =
    loadingEdit ? "Cargando..." : saving ? "Guardando..." : isEdit ? "Guardar cambios" : "Guardar compra";

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerBackTitle: "Atrás",
        }}
      />

      <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
        <ScrollView
          style={[styles.scroll, { backgroundColor: C.bg }]}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={{
            paddingTop: 12,
            paddingBottom: 12 + insets.bottom,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {loadingEdit ? (
            <View style={{ paddingVertical: 10 }}>
              <ActivityIndicator />
            </View>
          ) : null}

          <Text style={[styles.label, { color: C.text }]}>Proveedor</Text>

          <Pressable
            onPress={() => {
              skipResetOnFocusRef.current = true;
              router.push("/select-proveedor");
            }}
            style={({ pressed }) => [
              styles.select,
              { borderColor: C.border, backgroundColor: C.card },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={[styles.selectText, { color: proveedor ? C.text : C.sub }]}>
              {proveedor ? proveedor.nombre : "Seleccionar proveedor..."}
            </Text>
          </Pressable>

          <Text style={[styles.label, { color: C.text }]}>Número de factura</Text>

          <TextInput
            value={numeroFactura}
            onChangeText={setNumeroFactura}
            placeholder="Ej: F-001"
            placeholderTextColor={C.sub}
            style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.card }]}
            autoCapitalize="characters"
          />

          <Text style={[styles.label, { color: C.text }]}>Tipo de pago</Text>

          <View style={styles.row2}>
            <Pressable
              onPress={() => setTipoPago("CONTADO")}
              style={[
                styles.chip,
                { borderColor: C.border, backgroundColor: C.card },
                tipoPago === "CONTADO" && {
                  borderColor: C.blueText,
                  backgroundColor: "rgba(64,156,255,0.12)",
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: C.text },
                  tipoPago === "CONTADO" && { color: C.blueText },
                ]}
              >
                CONTADO
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setTipoPago("CREDITO")}
              style={[
                styles.chip,
                { borderColor: C.border, backgroundColor: C.card },
                tipoPago === "CREDITO" && {
                  borderColor: C.blueText,
                  backgroundColor: "rgba(64,156,255,0.12)",
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: C.text },
                  tipoPago === "CREDITO" && { color: C.blueText },
                ]}
              >
                CRÉDITO
              </Text>
            </Pressable>
          </View>

          {tipoPago === "CREDITO" && (
            <>
              <Text style={[styles.label, { color: C.text }]}>Vencimiento (crédito)</Text>

              <Pressable
                onPress={() =>
                  openDatePicker({
                    title: "Vencimiento (crédito)",
                    initial: fechaVenc ? new Date(`${fechaVenc}T12:00:00`) : addDays(new Date(), 30),
                    onConfirm: (d) => setFechaVenc(toYMD(d)),
                  })
                }
                style={({ pressed }) => [
                  styles.select,
                  { borderColor: C.border, backgroundColor: C.card },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={[styles.selectText, { color: C.text }]}>
                  {fechaVenc ?? "Seleccionar fecha..."}
                </Text>
              </Pressable>

              <Text style={[styles.help, { color: C.sub }]}>
                Se asigna automáticamente a 30 días. Puedes tocar para cambiar.
              </Text>
            </>
          )}

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

          <View style={[styles.divider, { backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "#eee" }]} />

          <Text style={[styles.h2, { color: C.text }]}>Productos</Text>

          {lineas.map((l: any, idx) => {
            const cant = Math.max(0, Math.floor(parseNumberSafe(l.cantidad)));
            const precio = Math.max(0, parseNumberSafe(l.precio));
            const sub = cant * precio;

            return (
              <View
                key={l.key}
                style={[styles.card, { borderColor: C.border, backgroundColor: C.card }]}
              >
                <View style={styles.rowBetween}>
                  <Text style={[styles.cardTitle, { color: C.text }]}>Línea {idx + 1}</Text>
                  <Pressable onPress={() => removeLinea(l.key)}>
                    <Text style={[styles.linkDanger, { color: C.danger }]}>Eliminar</Text>
                  </Pressable>
                </View>

                <Text style={[styles.label, { color: C.text }]}>Producto</Text>

                <Pressable
                  onPress={() => {
                    skipResetOnFocusRef.current = true;
                    router.push({
                      pathname: "/select-producto",
                      params: { lineKey: l.key },
                    });
                  }}
                  style={({ pressed }) => [
                    styles.select,
                    { borderColor: C.border, backgroundColor: C.card },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.selectText, { color: l.producto_id ? C.text : C.sub }]}>
                    {l.producto_id ? l.producto_label : "Seleccionar producto..."}
                  </Text>
                </Pressable>

                {/* FOTO */}
                <View style={{ marginTop: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Pressable
                      onPress={() => pickFotoParaLinea(l.key)}
                      disabled={!l.producto_id}
                      style={({ pressed }) => [
                        styles.photoBtn,
                        {
                          borderColor: C.border,
                          backgroundColor: C.card,
                          opacity: !l.producto_id ? 0.5 : pressed ? 0.85 : 1,
                        },
                      ]}
                    >
                      <Text style={{ color: C.text, fontWeight: "700" }}>
                        {l.image_path ? "Cambiar foto" : "Agregar foto"}
                      </Text>
                    </Pressable>

                    {l.image_path ? (
                      <Pressable onPress={() => quitarFotoLinea(l.key)}>
                        <Text style={{ color: C.danger, fontWeight: "700" }}>Quitar</Text>
                      </Pressable>
                    ) : null}
                  </View>

                  {l.image_uri ? (
                    <View style={{ marginTop: 10 }}>
                      <Image source={{ uri: l.image_uri }} style={styles.photoPreview} />
                      <Text style={{ marginTop: 6, color: C.sub, fontSize: 12 }}>
                        Se guardará como foto del producto (última compra).
                      </Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.row2}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: C.text }]}>Lote</Text>
                    <TextInput
                      value={l.lote}
                      onChangeText={(t) => updateLinea(l.key, { lote: t })}
                      placeholder="Ej: A123"
                      placeholderTextColor={C.sub}
                      style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.card }]}
                      autoCapitalize="characters"
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: C.text }]}>Expiración</Text>
                    <Pressable
                      onPress={() =>
                        openDatePicker({
                          title: "Expiración",
                          initial: l.fecha_exp ? new Date(`${l.fecha_exp}T12:00:00`) : addDays(new Date(), 365),
                          onConfirm: (d) => updateLinea(l.key, { fecha_exp: toYMD(d) }),
                        })
                      }
                      style={({ pressed }) => [
                        styles.select,
                        { borderColor: C.border, backgroundColor: C.card },
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text style={[styles.selectText, { color: l.fecha_exp ? C.text : C.sub }]}>
                        {l.fecha_exp ?? "Seleccionar fecha..."}
                      </Text>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.row2}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: C.text }]}>Cantidad</Text>
                    <TextInput
                      value={l.cantidad}
                      onChangeText={(t) => updateLinea(l.key, { cantidad: t })}
                      keyboardType="number-pad"
                      style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.card }]}
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: C.text }]}>Precio compra</Text>
                    <TextInput
                      value={l.precio}
                      onChangeText={(t) => updateLinea(l.key, { precio: t })}
                      keyboardType="decimal-pad"
                      style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.card }]}
                      placeholder="0"
                      placeholderTextColor={C.sub}
                    />
                  </View>
                </View>

                <Text style={[styles.subtotal, { color: isDark ? "rgba(255,255,255,0.8)" : "#333" }]}>
                  Subtotal: Q {sub.toFixed(2)}
                </Text>
              </View>
            );
          })}

          {/* ✅ Botón al final */}
          <Pressable
            onPress={addLinea}
            style={({ pressed }) => [
              styles.btnAddBottom,
              { borderColor: C.border, backgroundColor: C.card },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={[styles.btnAddBottomText, { color: C.text }]}>+ Agregar otro producto</Text>
          </Pressable>

          <View style={[styles.totalCard, { borderColor: C.border, backgroundColor: C.card }]}>
            <Text style={[styles.totalLabel, { color: C.text }]}>Total</Text>
            <Text style={[styles.totalValue, { color: C.text }]}>Q {total.toFixed(2)}</Text>
          </View>

          <Pressable
            onPress={guardar}
            disabled={saving || loadingEdit}
            style={({ pressed }) => [
              styles.saveBtn,
              { backgroundColor: C.blue },
              (pressed || saving || loadingEdit) && { opacity: 0.85 },
              { marginBottom: 10 + insets.bottom },
            ]}
          >
            <Text style={styles.saveBtnText}>{saveLabel}</Text>
          </Pressable>
        </ScrollView>

        {/* iOS Date Picker Modal */}
        <Modal visible={iosDateOpen} transparent animationType="fade">
          <Pressable
            style={[styles.dpBackdrop, { backgroundColor: C.backdrop }]}
            onPress={() => setIosDateOpen(false)}
          />
          <View style={[styles.dpCard, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[styles.dpTitle, { color: C.text }]}>{iosDateTitle}</Text>

            <DateTimePicker
              value={iosDateValue}
              mode="date"
              display="inline"
              onChange={(_e, d) => {
                if (d) {
                  iosTempRef.current = d;
                  setIosDateValue(d);
                }
              }}
              themeVariant={isDark ? "dark" : "light"}
              style={{ alignSelf: "center" }}
            />

            <View style={styles.dpBtns}>
              <Pressable
                onPress={() => setIosDateOpen(false)}
                style={[
                  styles.dpBtn,
                  { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "#f2f2f2" },
                ]}
              >
                <Text style={[styles.dpBtnText, { color: C.text }]}>Cancelar</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  iosDateOnConfirm(iosTempRef.current);
                  setIosDateOpen(false);
                }}
                style={[styles.dpBtn, { backgroundColor: C.blueText }]}
              >
                <Text style={[styles.dpBtnText, { color: "#fff" }]}>Listo</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1, paddingHorizontal: 16 },

  h2: { fontSize: 18, fontWeight: "700", marginBottom: 4 },

  label: { marginTop: 10, marginBottom: 6, fontSize: 13, fontWeight: "600" },
  help: { marginTop: 6, fontSize: 12 },

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

  row2: { flexDirection: "row", gap: 12 },

  chip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: Platform.select({ ios: 10, android: 10, default: 10 }),
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: { fontWeight: "700", fontSize: 14 },

  divider: { height: 1, marginVertical: 18 },

  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  card: { marginTop: 12, borderWidth: 1, borderRadius: 16, padding: 14 },
  cardTitle: { fontSize: 16, fontWeight: "700" },

  linkDanger: { fontSize: 14, fontWeight: "600" },

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
  btnAddBottomText: { fontWeight: "700", fontSize: 15 },

  saveBtn: {
    marginTop: 12,
    borderRadius: 14,
    paddingVertical: Platform.select({ ios: 14, android: 12, default: 12 }),
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  photoBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignSelf: "flex-start",
  },
  photoPreview: { width: 120, height: 120, borderRadius: 14 },

  dpBackdrop: { flex: 1 },
  dpCard: {
    position: "absolute",
    left: 16,
    right: 16,
    top: "20%",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
  },
  dpTitle: { fontSize: 16, fontWeight: "700", marginBottom: 10, textAlign: "center" },
  dpBtns: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 10 },
  dpBtn: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 110,
    alignItems: "center",
  },
  dpBtnText: { fontWeight: "700" },
});
