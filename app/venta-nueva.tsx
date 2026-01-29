// app/venta-nueva.tsx
// Nueva venta (borrador local). No toca BD hasta que exista el RPC de guardar.

import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import {
  Alert,
  Keyboard,
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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/app-button";
import { DoneAccessory } from "../components/ui/done-accessory";
import { useKeyboardAutoScroll } from "../components/ui/use-keyboard-autoscroll";
import { supabase } from "../lib/supabase";
import { useThemePref } from "../lib/themePreference";
import { alphaColor } from "../lib/ui";
import { useVentaDraft } from "../lib/ventaDraft";

const BUCKET_VENTAS_DOCS = "Ventas-Docs";

type Role = "ADMIN" | "BODEGA" | "VENTAS" | "FACTURACION" | "";

function normalizeUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

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

export default function VentaNuevaScreen() {
  const DONE_ID = "doneAccessory";
  const { scrollRef, handleFocus } = useKeyboardAutoScroll(110);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const params = useLocalSearchParams<{ editId?: string }>();
  const editIdRaw = params?.editId ? String(params.editId) : null;
  const editId = editIdRaw && Number.isFinite(Number(editIdRaw)) && Number(editIdRaw) > 0 ? editIdRaw : null;
  const isEdit = !!editId;

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
      danger: isDark ? "rgba(255,120,120,0.95)" : "#d00",
    }),
    [isDark, colors.background, colors.border, colors.card, colors.primary, colors.text]
  );

  const { draft, setCliente, setComentarios, addLinea, removeLinea, updateLinea, reset, setRecetaUri } =
    useVentaDraft();
  const { cliente, comentarios, lineas, receta_uri } = draft;

  const draftRef = useRef(draft);
  React.useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const skipResetOnFocusRef = useRef(false);
  const loadedEditIdRef = useRef<string | null>(null);
  const [role, setRole] = useState<Role>("");
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);

  // En modo edicion: sumar la cantidad original de la venta al disponible,
  // porque el RPC libera y re-reserva (el UI debe permitir editar sin bloquearse).
  const [originalQtyByProd, setOriginalQtyByProd] = useState<Record<string, number>>({});

  const effectiveStockForLine = useCallback(
    (l: any) => {
      const base = Number(l?.stock_disponible ?? 0);
      if (!Number.isFinite(base)) return 0;
      if (!isEdit) return base;
      const pid = l?.producto_id ? String(l.producto_id) : "";
      if (!pid) return base;
      const add = Number(originalQtyByProd[pid] ?? 0);
      return base + (Number.isFinite(add) ? add : 0);
    },
    [isEdit, originalQtyByProd]
  );

  const loadRole = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) {
      setRole("");
      return;
    }
    const { data } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
    setRole((normalizeUpper(data?.role) as Role) ?? "");
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        await loadRole();
        if (!alive) return;
      })().catch(() => {});

      // reset al entrar, excepto cuando volvemos de selectores
      if (skipResetOnFocusRef.current) {
        skipResetOnFocusRef.current = false;
      } else if (!isEdit) {
        reset();
      }

      // modo edicion: cargar la venta al draft una sola vez
      if (isEdit && editId && loadedEditIdRef.current !== editId) {
        (async () => {
          try {
            setLoadingEdit(true);

            // Validar que exista autorizacion de edicion activa
            const { data: trows, error: te } = await supabase
              .from("ventas_tags")
              .select("tag")
              .eq("venta_id", Number(editId))
              .is("removed_at", null)
              .in("tag", ["EDICION_REQUERIDA"])
              .limit(1);
            if (te) throw te;
            if (!trows?.length) throw new Error("No hay autorizacion de edicion para esta venta");

            const { data: v, error: ve } = await supabase
              .from("ventas")
              .select("id,cliente_id,comentarios,estado")
              .eq("id", Number(editId))
              .maybeSingle();
            if (ve) throw ve;
            if (!v) throw new Error("Venta no encontrada");
            if (String((v as any).estado ?? "").toUpperCase() !== "NUEVO") {
              throw new Error("Solo se puede editar cuando la venta esta en NUEVO");
            }

            const { data: c, error: ce } = await supabase
              .from("clientes")
              .select("id,nombre,nit,telefono,direccion")
              .eq("id", Number((v as any).cliente_id))
              .maybeSingle();
            if (ce) throw ce;
            if (!c) throw new Error("Cliente no encontrado");

            const { data: d, error: de } = await supabase
              .from("ventas_detalle")
              .select("id,cantidad,precio_venta_unit,producto_id, productos(nombre,marca_id,marcas(nombre))")
              .eq("venta_id", Number(editId))
              .order("id", { ascending: true });
            if (de) throw de;

            const detalles = (d ?? []) as any[];
            if (!detalles.length) throw new Error("La venta no tiene lineas");

            const origMap: Record<string, number> = {};
            detalles.forEach((row: any) => {
              const pid = Number(row.producto_id);
              if (!Number.isFinite(pid) || pid <= 0) return;
              const qty = Number(row.cantidad ?? 0);
              if (!Number.isFinite(qty) || qty <= 0) return;
              const k = String(pid);
              origMap[k] = (origMap[k] ?? 0) + qty;
            });
            setOriginalQtyByProd(origMap);

            const prodIds = Array.from(
              new Set(detalles.map((x) => Number(x.producto_id)).filter((x) => Number.isFinite(x) && x > 0))
            );

            const invByProd = new Map<number, any>();
            if (prodIds.length) {
              const { data: inv, error: ie } = await supabase
                .from("vw_inventario_productos_v2")
                .select("id,stock_disponible,precio_min_venta,tiene_iva,requiere_receta")
                .in("id", prodIds);
              if (ie) throw ie;
              (inv ?? []).forEach((r: any) => invByProd.set(Number(r.id), r));
            }

            // Reset y llenar
            reset();
            setRecetaUri(null);
            setComentarios(String((v as any).comentarios ?? ""));
            setCliente({
              id: Number((c as any).id),
              nombre: String((c as any).nombre ?? ""),
              nit: (c as any).nit == null ? null : String((c as any).nit),
              telefono: (c as any).telefono == null ? null : String((c as any).telefono),
              direccion: (c as any).direccion == null ? null : String((c as any).direccion),
            });

            const targetN = detalles.length;

            const hydrate = () => {
              const cur = draftRef.current;
              if (!cur) return;

              if (cur.lineas.length < targetN) {
                const missing = targetN - cur.lineas.length;
                for (let i = 0; i < missing; i++) addLinea();
                setTimeout(hydrate, 0);
                return;
              }

              const keys = cur.lineas.slice(0, targetN).map((l) => l.key);

              detalles.forEach((row: any, idx: number) => {
                const key = keys[idx];
                if (!key) return;

                const nombre = row.productos?.nombre ?? "";
                const marca = row.productos?.marcas?.nombre ?? row.productos?.marcas?.[0]?.nombre ?? "";
                const label = `${nombre}${marca ? ` • ${marca}` : ""}`;
                const pid = Number(row.producto_id);
                const inv = invByProd.get(pid);

                updateLinea(key, {
                  producto_id: pid,
                  producto_label: label,
                  stock_disponible: inv ? Number(inv.stock_disponible ?? 0) : null,
                  precio_min_venta: inv?.precio_min_venta == null ? null : Number(inv.precio_min_venta),
                  tiene_iva: inv ? !!inv.tiene_iva : null,
                  requiere_receta: inv ? !!inv.requiere_receta : null,
                  cantidad: String(row.cantidad ?? "1"),
                  precio_unit: String(row.precio_venta_unit ?? "0"),
                });
              });

              loadedEditIdRef.current = editId;
              setLoadingEdit(false);
            };

            setTimeout(hydrate, 0);
          } catch (e) {
            setLoadingEdit(false);
            throw e;
          }
        })().catch((e: any) => {
          Alert.alert("No se puede editar", e?.message ?? "No se pudo cargar la venta", [
            { text: "OK", onPress: () => router.back() },
          ]);
          setLoadingEdit(false);
        });
      }

      return () => {
        alive = false;
      };
    }, [addLinea, editId, isEdit, loadRole, reset, setCliente, setComentarios, setRecetaUri, updateLinea])
  );

  const canCreate = role === "VENTAS" || role === "ADMIN";
  const canEditNow = !loadingEdit && !saving;

  React.useEffect(() => {
    if (!role) return;
    if (canCreate) return;
    Alert.alert("Sin permiso", "Tu rol no puede crear ventas.", [{ text: "OK", onPress: () => router.back() }]);
  }, [role, canCreate]);

  const lineValidation = useCallback(
    (l: any) => {
      if (!l.producto_id) return { ok: false, msg: "Selecciona un producto" };
      const stock = effectiveStockForLine(l);
      const min = l.precio_min_venta == null ? 0 : Number(l.precio_min_venta);
      const qty = parseIntSafe(l.cantidad);
      const price = parseDecimalSafe(l.precio_unit);

      if (qty <= 0) return { ok: false, msg: "Cantidad debe ser mayor a 0" };
      if (qty > stock) return { ok: false, msg: `Cantidad supera disponibles (${stock})` };
      if (price < min) return { ok: false, msg: `Precio menor al minimo (${fmtQ(min)})` };

      return { ok: true, msg: "" };
    },
    [effectiveStockForLine]
  );

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
        const rpcName = isEdit ? "rpc_venta_editar" : "rpc_crear_venta";
        const rpcArgs = isEdit
          ? { p_venta_id: Number(editId), p_venta, p_items }
          : { p_venta, p_items };

        const { data, error } = await supabase.rpc(rpcName as any, rpcArgs as any);
        if (error) throw error;

        const ventaId = isEdit ? Number(editId) : ((data as any)?.venta_id ?? null);

        // Si el usuario adjunto receta en el formulario, subirla ahora (no bloquea la venta si falla).
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

        Alert.alert(
          "Listo",
          isEdit
            ? "Venta actualizada."
            : recetaOk
              ? "Venta creada."
              : "Venta creada. No se pudo subir la receta; puedes subirla desde el detalle en Ventas.",
          [
            {
              text: "OK",
              onPress: () => {
                reset();
                setRecetaUri(null);
                if (isEdit) {
                  // Volver al detalle existente (evita duplicar pantallas de detalle en el stack).
                  router.back();
                } else {
                  router.replace("/ventas" as any);
                }
              },
            },
          ]
        );
      } catch (e: any) {
        const msg = String(e?.message ?? "No se pudo guardar la venta");
        Alert.alert("Error al guardar", msg);
      } finally {
        setSaving(false);
      }
    })().catch(() => {
      setSaving(false);
    });
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: loadingEdit ? "Cargando..." : isEdit ? "Editar venta" : "Nueva venta",
          headerBackTitle: "Atras",
        }}
      />

      <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
        >
          <ScrollView
            ref={scrollRef}
            style={[styles.scroll, { backgroundColor: C.bg }]}
            contentInsetAdjustmentBehavior="never"
            contentContainerStyle={{ paddingTop: 12, paddingBottom: 12 + insets.bottom }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
          >
          <Text style={[styles.label, { color: C.text }]}>Cliente</Text>
          <Pressable
            onPress={() => {
              if (!canCreate) return;
              if (!canEditNow) return;
              skipResetOnFocusRef.current = true;
              router.push("/select-cliente" as any);
            }}
            style={({ pressed }) => [
              styles.select,
              { borderColor: C.border, backgroundColor: C.card },
              pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
            ]}
          >
            <Text style={[styles.selectText, { color: cliente ? C.text : C.sub }]} numberOfLines={1}>
              {cliente ? `${cliente.nombre} • NIT: ${cliente.nit ?? "CF"}` : "Seleccionar cliente..."}
            </Text>
          </Pressable>

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

          <Text style={[styles.label, { color: C.text }]}>Comentarios (opcional)</Text>
          <TextInput
            value={comentarios}
            onChangeText={setComentarios}
            onFocus={handleFocus}
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

          <Text style={[styles.h2, { color: C.text }]}>Productos</Text>

          {lineas.map((l: any, idx) => {
            const stock = l.producto_id ? effectiveStockForLine(l) : null;
            const addedStock =
              isEdit && l.producto_id ? Number(originalQtyByProd[String(l.producto_id)] ?? 0) : 0;
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
                <Pressable
                  onPress={() => {
                    if (!canCreate) return;
                    if (!canEditNow) return;
                    skipResetOnFocusRef.current = true;
                    router.push({ pathname: "/select-producto", params: { lineKey: l.key, mode: "venta" } });
                  }}
                  style={({ pressed }) => [
                    styles.select,
                    { borderColor: C.border, backgroundColor: C.card },
                    pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
                  ]}
                >
                  <Text style={[styles.selectText, { color: l.producto_id ? C.text : C.sub }]} numberOfLines={1}>
                    {l.producto_id ? l.producto_label : "Seleccionar producto..."}
                  </Text>
                </Pressable>

                {l.producto_id ? (
                  <Text style={[styles.help, { color: C.sub }]}>
                    Disponibles: {stock ?? 0}
                    {isEdit && addedStock > 0 ? " (incluye reserva)" : ""} • Min: {fmtQ(min)}
                  </Text>
                ) : null}

                <View style={styles.row2}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: C.text }]}>Cantidad</Text>
                    <TextInput
                      value={l.cantidad}
                      onChangeText={(t) => updateLinea(l.key, { cantidad: t })}
                      keyboardType="number-pad"
                      inputAccessoryViewID={Platform.OS === "ios" ? DONE_ID : undefined}
                      onFocus={handleFocus}
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
                      inputAccessoryViewID={Platform.OS === "ios" ? DONE_ID : undefined}
                      onFocus={handleFocus}
                      style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.card }]}
                      placeholder="0.00"
                      placeholderTextColor={C.sub}
                      editable={canCreate}
                    />
                  </View>
                </View>

                {!v.ok ? <Text style={[styles.err, { color: C.danger }]}>{v.msg}</Text> : null}

                <Text style={[styles.subtotal, { color: isDark ? "rgba(255,255,255,0.8)" : "#333" }]}>Subtotal: Q {sub.toFixed(2)}</Text>
              </View>
            );
          })}

          <AppButton
            title={"+ Agregar otro producto"}
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
                    <Text style={{ marginTop: 6, color: C.sub, fontSize: 12 }}>
                      Se subira al guardar la venta.
                    </Text>
                  </View>
                ) : null}
              </View>
            </>
          ) : null}

          <AppButton
            title={
              !allValid
                ? "Revisa datos"
                : saving
                  ? "Guardando..."
                  : isEdit
                    ? "Guardar cambios"
                    : "Guardar venta"
            }
            onPress={onGuardar}
            disabled={!allValid || saving || loadingEdit}
            style={[styles.saveBtn, { backgroundColor: C.blueText, marginBottom: 10 + insets.bottom }] as any}
          />
          </ScrollView>
        </KeyboardAvoidingView>

        <DoneAccessory nativeID={DONE_ID} />
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
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
});
