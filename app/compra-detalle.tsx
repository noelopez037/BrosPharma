// app/compra-detalle.tsx
// Detalle de compra + pagos con comprobante (Supabase Storage)
// FIXES IMPORTANTES:
// - Corrige template strings / strings en .select()
// - fmtQ correcto
// - Upload robusto (evita archivos de 0 bytes) usando FileSystem (base64 -> Uint8Array)
// - Usa mimeType real del asset (y extensión acorde)
// - Signed URL + probe + cache local para ver comprobante

import * as FileSystem from "expo-file-system/legacy";
import { Image as ExpoImage } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, TouchableWithoutFeedback } from "react-native";

import {
  ActivityIndicator,
  Alert,
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
import { supabase } from "../lib/supabase";
import { useThemePref } from "../lib/themePreference";

const BUCKET_PRODUCTOS = "productos";
const BUCKET_COMPROBANTES = "comprobantes";

type Compra = {
  id: number;
  fecha: string;
  numero_factura: string | null;
  tipo_pago: string;
  fecha_vencimiento: string | null;
  estado: string;
  monto_total: string | null;
  saldo_pendiente: string | null;
  comentarios: string | null;
  proveedor_id: number;
  proveedor_nombre: string | null;
};

type Linea = {
  detalle_id: number;
  producto_id: number;
  producto_nombre: string | null;
  producto_marca: string | null;
  producto_image_path: string | null;
  lote_id: number;
  lote: string;
  fecha_exp: string | null;
  cantidad: number;
  precio_compra_unit: string;
  subtotal: string | null;
  stock_total: number | null;
  stock_reservado: number | null;
};

type Pago = {
  id: number;
  compra_id: number;
  fecha: string;
  monto: string;
  metodo: string | null;
  referencia: string | null;
  comprobante_path: string | null;
  comentario: string | null;
};

type PickedImage = {
  uri: string;
  mimeType: string; // e.g. image/jpeg
  fileName?: string | null;
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return String(iso).slice(0, 10);
}

function fmtQ(n: string | number | null | undefined) {
  if (n == null) return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `Q ${x.toFixed(2)}`;
}

function normalizeUpper(s: string | null | undefined) {
  return (s ?? "").trim().toUpperCase();
}

function safeNumber(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function storagePublicUrl(bucket: string, path: string) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

function extFromMime(mime: string) {
  const m = (mime || "").toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("heic")) return "heic";
  if (m.includes("heif")) return "heif";
  return "jpg";
}

function makeComprobantePath(compraId: number, mimeType: string) {
  const stamp = Date.now();
  const rnd = Math.random().toString(16).slice(2);
  const ext = extFromMime(mimeType);
  return `compras/${compraId}/${stamp}-${rnd}.${ext}`;
}

// ✅ Normaliza lo guardado en DB: puede ser path o URL completa
function normalizeComprobanteRef(raw: string) {
  const p = (raw ?? "").trim();
  if (!p) return null;

  if (p.startsWith("http://") || p.startsWith("https://")) {
    return { url: p, path: null as string | null };
  }

  let clean = p.startsWith("/") ? p.slice(1) : p;

  // Si por error guardaste "comprobantes/..." quita prefijo de bucket
  const pref = `${BUCKET_COMPROBANTES}/`;
  if (clean.startsWith(pref)) clean = clean.slice(pref.length);

  return { url: null as string | null, path: clean };
}

/**
 * Valida que una URL realmente entregue una imagen (status ok + content-type image/* + bytes > minBytes)
 */
async function probeImageUrl(url: string, minBytes = 1024) {
  const u = encodeURI(url);

  try {
    const r = await fetch(u, {
      method: "GET",
      headers: { Range: "bytes=0-4096", "Cache-Control": "no-cache" },
    });

    const ct = r.headers.get("content-type") ?? "";
    const ab = await r.arrayBuffer();
    const size = ab?.byteLength ?? 0;

    return {
      ok: r.ok,
      status: r.status,
      contentType: ct,
      bytes: size,
      looksLikeImage: ct.toLowerCase().startsWith("image/"),
      url: u,
      minOk: size >= minBytes,
    };
  } catch (e: any) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      bytes: 0,
      looksLikeImage: false,
      url: u,
      minOk: false,
      error: e?.message ?? String(e),
    };
  }
}

async function downloadToCache(remoteUrl: string) {
  const baseDir =
    (FileSystem.cacheDirectory ?? FileSystem.documentDirectory) as string | null;
  if (!baseDir) throw new Error("No se encontró cacheDirectory/documentDirectory.");

  const safeName = remoteUrl
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 140);

  const target = `${baseDir}cmp_${safeName}.bin`;

  try {
    const info = await FileSystem.getInfoAsync(target);
    if (info.exists && info.size && info.size > 1024) return target;
    if (info.exists) {
      try {
        await FileSystem.deleteAsync(target, { idempotent: true });
      } catch { }
    }
  } catch { }

  const res = await FileSystem.downloadAsync(encodeURI(remoteUrl), target);

  const info2 = await FileSystem.getInfoAsync(res.uri);
  if (!info2.exists || !info2.size || info2.size < 1024) {
    try {
      await FileSystem.deleteAsync(res.uri, { idempotent: true });
    } catch { }
    throw new Error("Descarga incompleta (archivo vacío).");
  }

  return res.uri; // file://...
}

/**
 * Upload robusto para evitar objetos de 0 bytes:
 * - Lee el archivo desde uri con FileSystem en base64
 * - Convierte base64 -> Uint8Array
 * - Sube Uint8Array a Supabase
 */
function base64ToUint8Array(base64: string) {
  // atob existe en RN/Expo
  const binary = globalThis.atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function uriToBytes(uri: string) {
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = base64ToUint8Array(b64);

  // sanity check: evita subir vacío
  if (!bytes?.byteLength || bytes.byteLength < 16) {
    throw new Error("El archivo seleccionado está vacío o no se pudo leer.");
  }
  return bytes;
}

export default function CompraDetalleScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const compraId = Number(id);

  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  const C = useMemo(
    () => ({
      bg: isDark ? "#000" : Platform.OS === "ios" ? "#F2F2F7" : "#f4f4f5",
      card: isDark ? "#0f0f10" : "#fff",
      text: isDark ? "#fff" : "#111",
      sub: isDark ? "rgba(255,255,255,0.65)" : "#6b7280",
      border: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",

      primary: Platform.OS === "ios" ? "#007AFF" : "#1976D2",
      danger: Platform.OS === "ios" ? "#FF3B30" : "#D32F2F",

      ok: isDark ? "rgba(140,255,170,0.95)" : "#16a34a",
      warn: isDark ? "rgba(255,210,120,0.95)" : "#b45309",

      okBg: isDark ? "rgba(22,163,74,0.18)" : "rgba(22,163,74,0.10)",
      warnBg: isDark ? "rgba(180,83,9,0.18)" : "rgba(180,83,9,0.10)",
      mutedBg: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
      dangerBg: isDark ? "rgba(255,59,48,0.16)" : "rgba(255,59,48,0.10)",

      divider: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)",
      overlay: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)",
      inputBg: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)",
    }),
    [isDark]
  );

  const [loading, setLoading] = useState(true);
  const [compra, setCompra] = useState<Compra | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [deleting, setDeleting] = useState(false);

  // Modal: aplicar pago
  const [pagoModal, setPagoModal] = useState(false);
  const [pagoMonto, setPagoMonto] = useState("");
  const [pagoMetodo, setPagoMetodo] = useState<
    "EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "OTRO"
  >("EFECTIVO");
  const [pagoReferencia, setPagoReferencia] = useState("");
  const [pagoComentario, setPagoComentario] = useState("");
  const [pagoImg, setPagoImg] = useState<PickedImage | null>(null);
  const [savingPago, setSavingPago] = useState(false);

  // Viewer comprobante
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null); // local file://
  const [viewerRemoteUrl, setViewerRemoteUrl] = useState<string | null>(null); // signed url
  const viewerBusyRef = useRef(false);

  const saldoNum = useMemo(
    () => safeNumber(compra?.saldo_pendiente),
    [compra?.saldo_pendiente]
  );

  const badge = useMemo(() => {
    const estado = normalizeUpper(compra?.estado);
    const tipo = normalizeUpper(compra?.tipo_pago);
    const saldo = Number(compra?.saldo_pendiente ?? 0);

    if (estado === "ANULADA") return { text: "ANULADA", kind: "muted" as const };
    if (tipo === "CONTADO") return { text: "PAGADA", kind: "ok" as const };
    if (tipo === "CREDITO" && saldo <= 0) return { text: "PAGADA", kind: "ok" as const };
    if (tipo === "CREDITO" && saldo > 0) return { text: "PENDIENTE", kind: "warn" as const };
    return { text: estado || tipo || "—", kind: "muted" as const };
  }, [compra]);

  const badgeStyle = useMemo(() => {
    if (badge.kind === "ok") return { color: C.ok, bg: C.okBg };
    if (badge.kind === "warn") return { color: C.warn, bg: C.warnBg };
    return { color: C.sub, bg: C.mutedBg };
  }, [badge.kind, C]);

  const fetchAll = useCallback(async () => {
    if (!Number.isFinite(compraId) || compraId <= 0) return;

    setLoading(true);
    try {
      const { data: c, error: e1 } = await supabase
        .from("compras")
        .select(
          "id,fecha,numero_factura,tipo_pago,fecha_vencimiento,estado,monto_total,saldo_pendiente,comentarios,proveedor_id,proveedores(nombre)"
        )
        .eq("id", compraId)
        .maybeSingle();

      if (e1) throw e1;
      if (!c) throw new Error("Compra no encontrada");

      setCompra({
        id: c.id,
        fecha: c.fecha,
        numero_factura: c.numero_factura,
        tipo_pago: c.tipo_pago,
        fecha_vencimiento: c.fecha_vencimiento,
        estado: c.estado,
        monto_total: c.monto_total,
        saldo_pendiente: c.saldo_pendiente,
        comentarios: c.comentarios,
        proveedor_id: c.proveedor_id,
        proveedor_nombre: (c as any).proveedores?.nombre ?? null,
      });

      const { data: d, error: e2 } = await supabase
        .from("compras_detalle")
        .select(
          "id,compra_id,producto_id,lote_id,cantidad,precio_compra_unit,subtotal,productos(nombre,image_path,marca_id,marcas(nombre)),producto_lotes(lote,fecha_exp)"
        )
        .eq("compra_id", compraId)
        .order("id", { ascending: true });

      if (e2) throw e2;

      const mapped: Linea[] = (d ?? []).map((r: any) => ({
        detalle_id: r.id,
        producto_id: r.producto_id,
        producto_nombre: r.productos?.nombre ?? null,
        producto_marca: r.productos?.marcas?.nombre ?? null,
        producto_image_path: r.productos?.image_path ?? null,
        lote_id: r.lote_id,
        lote: r.producto_lotes?.lote ?? "—",
        fecha_exp: r.producto_lotes?.fecha_exp ?? null,
        cantidad: r.cantidad,
        precio_compra_unit: String(r.precio_compra_unit),
        subtotal: r.subtotal ?? null,
        stock_total: null,
        stock_reservado: null,
      }));

      const loteIds = Array.from(
        new Set(
          mapped
            .map((x) => Number(x.lote_id))
            .filter((x) => Number.isFinite(x) && x > 0)
        )
      );

      if (loteIds.length) {
        const { data: srows, error: se } = await supabase
          .from("stock_lotes")
          .select("lote_id,stock_total,stock_reservado")
          .in("lote_id", loteIds);

        if (se) throw se;

        const byLote = new Map<number, { stock_total: number; stock_reservado: number }>();
        (srows ?? []).forEach((r: any) =>
          byLote.set(Number(r.lote_id), {
            stock_total: Number(r.stock_total ?? 0),
            stock_reservado: Number(r.stock_reservado ?? 0),
          })
        );

        for (const it of mapped) {
          const st = byLote.get(Number(it.lote_id));
          it.stock_total = st?.stock_total ?? 0;
          it.stock_reservado = st?.stock_reservado ?? 0;
        }
      }

      setLineas(mapped);

      const { data: p, error: pe } = await supabase
        .from("compras_pagos")
        .select("id,compra_id,fecha,monto,metodo,referencia,comprobante_path,comentario")
        .eq("compra_id", compraId)
        .order("fecha", { ascending: false });

      if (pe) throw pe;
      setPagos((p ?? []) as any);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo cargar");
      setCompra(null);
      setLineas([]);
      setPagos([]);
    } finally {
      setLoading(false);
    }
  }, [compraId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const eliminarCompra = async () => {
    if (!compra) return;
    if (deleting) return;

    Alert.alert("Eliminar compra", "Esto eliminará la compra y sus líneas. ¿Seguro?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            const { error } = await supabase.rpc("rpc_compra_eliminar_compra", {
              p_compra_id: compra.id,
            });
            if (error) throw error;

            Alert.alert("Listo", "Compra eliminada", [
              { text: "OK", onPress: () => router.back() },
            ]);
          } catch (e: any) {
            Alert.alert("Error", e?.message ?? "No se pudo eliminar");
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  const abrirPagoModal = () => {
    setPagoMonto("");
    setPagoMetodo("EFECTIVO");
    setPagoReferencia("");
    setPagoComentario("");
    setPagoImg(null);
    setPagoModal(true);
  };

  const pickComprobante = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permiso requerido", "Permite acceso a tus fotos para seleccionar el comprobante.");
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsEditing: false,
    });

    if (res.canceled) return;

    const a = res.assets?.[0];
    if (!a?.uri) return;

    const mimeType = (a as any).mimeType || "image/jpeg";
    const fileName = (a as any).fileName ?? null;

    setPagoImg({ uri: a.uri, mimeType, fileName });
  };

  const subirComprobanteSiExiste = async (
    compraIdLocal: number
  ): Promise<string | null> => {
    if (!pagoImg?.uri) return null;

    const path = makeComprobantePath(compraIdLocal, pagoImg.mimeType);

    // 🔒 Upload robusto: bytes reales
    const bytes = await uriToBytes(pagoImg.uri);

    const { error } = await supabase.storage
      .from(BUCKET_COMPROBANTES)
      .upload(path, bytes, {
        upsert: false,
        contentType: pagoImg.mimeType || "image/jpeg",
        cacheControl: "3600",
      });

    if (error) throw error;
    return path;
  };

  const guardarPago = async () => {
    if (!compra) return;
    if (savingPago) return;

    const monto = safeNumber(pagoMonto);
    if (!(monto > 0)) {
      Alert.alert("Monto inválido", "Ingresa un monto mayor a 0.");
      return;
    }
    if (normalizeUpper(compra.tipo_pago) !== "CREDITO") {
      Alert.alert("No aplica", "Solo compras a crédito admiten pagos.");
      return;
    }

    setSavingPago(true);
    try {
      const comprobantePath = await subirComprobanteSiExiste(compra.id);

      const { error } = await supabase.rpc("rpc_compra_aplicar_pago", {
        p_compra_id: compra.id,
        p_monto: monto,
        p_metodo: pagoMetodo,
        p_referencia: pagoReferencia ? pagoReferencia : null,
        p_comprobante_path: comprobantePath,
        p_comentario: pagoComentario ? pagoComentario : null,
      });

      if (error) throw error;

      setPagoModal(false);
      setPagoMonto("");
      setPagoReferencia("");
      setPagoComentario("");
      setPagoImg(null);

      await fetchAll();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo aplicar el pago");
    } finally {
      setSavingPago(false);
    }
  };

  // ✅ Signed URL + probe + cache local
  const abrirComprobante = async (raw: string) => {
    if (viewerBusyRef.current) return;

    const norm = normalizeComprobanteRef(raw);
    if (!norm) {
      Alert.alert("Error", "No hay comprobante");
      return;
    }

    viewerBusyRef.current = true;
    setViewerUrl(null);
    setViewerRemoteUrl(null);
    setViewerOpen(true);

    try {
      let signedUrl: string | null = null;

      if (norm.path) {
        const { data, error } = await supabase.storage
          .from(BUCKET_COMPROBANTES)
          .createSignedUrl(norm.path, 60 * 10);

        if (error) throw error;
        signedUrl = data?.signedUrl ?? null;
      } else if (norm.url) {
        signedUrl = norm.url;
      }

      if (!signedUrl) throw new Error("No se pudo generar URL del comprobante.");

      const probe = await probeImageUrl(signedUrl, 512);
      if (!probe.ok) throw new Error(`HTTP ${probe.status || "?"} al descargar.`);
      if (!probe.looksLikeImage)
        throw new Error(`No es imagen. content-type="${probe.contentType || "?"}"`);
      if (!probe.minOk) throw new Error(`Respuesta vacía (${probe.bytes} bytes).`);

      setViewerRemoteUrl(probe.url);

      try {
        const localUri = await downloadToCache(probe.url);
        setViewerUrl(localUri);
      } catch {
        // fallback a remote
      }
    } catch (e: any) {
      setViewerOpen(false);
      Alert.alert("No se pudo cargar", e?.message ?? "Error al obtener comprobante");
    } finally {
      viewerBusyRef.current = false;
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Detalle compra",
          headerBackTitle: "Atrás",
        }}
      />

      <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
        {loading ? (
          <View style={[styles.center, { paddingTop: 18 }]}>
            <ActivityIndicator />
          </View>
        ) : !compra ? (
          <View style={styles.center}>
            <Text style={{ color: C.text }}>No disponible</Text>
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1, backgroundColor: C.bg }}
            contentInsetAdjustmentBehavior="never"
            contentContainerStyle={{
              paddingTop: 12,
              paddingHorizontal: 16,
              paddingBottom: 12 + insets.bottom + 104,
            }}
          >
            {/* Cabecera */}
            <View
              style={[
                styles.cardBase,
                styles.headerCard,
                styles.shadowCard,
                { borderColor: C.border, backgroundColor: C.card },
              ]}
            >
              <View style={styles.headerTop}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.h1, { color: C.text }]} numberOfLines={2}>
                    {compra.proveedor_nombre ?? `Proveedor #${compra.proveedor_id}`}
                  </Text>

                  <View style={{ marginTop: 8 }}>
                    <Text style={[styles.metaK, { color: C.sub }]}>Factura</Text>
                    <Text style={[styles.metaV, { color: C.text }]} numberOfLines={1}>
                      {compra.numero_factura ?? "—"}
                    </Text>

                    <Text style={[styles.metaK, { color: C.sub, marginTop: 6 }]}>Fecha</Text>
                    <Text style={[styles.metaV, { color: C.text }]} numberOfLines={1}>
                      {fmtDate(compra.fecha)}
                    </Text>
                  </View>
                </View>

                <View
                  style={[
                    styles.badgePill,
                    { backgroundColor: badgeStyle.bg, borderColor: C.border },
                  ]}
                >
                  <Text style={[styles.badgeText, { color: badgeStyle.color }]}>{badge.text}</Text>
                </View>
              </View>

              <View style={[styles.kvGrid, { marginTop: 12 }]}>
                <View style={styles.kv}>
                  <Text style={[styles.k, { color: C.sub }]}>Tipo</Text>
                  <Text style={[styles.v, { color: C.text }]}>
                    {normalizeUpper(compra.tipo_pago) || "—"}
                  </Text>
                </View>

                {normalizeUpper(compra.tipo_pago) === "CREDITO" ? (
                  <View style={styles.kv}>
                    <Text style={[styles.k, { color: C.sub }]}>Vencimiento</Text>
                    <Text style={[styles.v, { color: C.text }]}>
                      {fmtDate(compra.fecha_vencimiento)}
                    </Text>
                  </View>
                ) : null}
              </View>

              {compra.comentarios ? (
                <View style={{ marginTop: 12 }}>
                  <Text style={[styles.k, { color: C.sub }]}>Notas</Text>
                  <Text style={[styles.note, { color: C.text }]}>{compra.comentarios}</Text>
                </View>
              ) : null}

              <View style={[styles.divider, { backgroundColor: C.divider }]} />

              <View style={styles.totalRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.k, { color: C.sub }]}>Total</Text>
                  <Text style={[styles.total, { color: C.text }]}>{fmtQ(compra.monto_total)}</Text>
                </View>

                {normalizeUpper(compra.tipo_pago) === "CREDITO" ? (
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[styles.k, { color: C.sub }]}>Saldo</Text>
                    <Text style={[styles.totalSmall, { color: C.text }]}>
                      {fmtQ(compra.saldo_pendiente)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* Pagos */}
            {normalizeUpper(compra.tipo_pago) === "CREDITO" ? (
              <>
                <Text style={[styles.sectionTitle, { color: C.text }]}>Pagos</Text>

                <View
                  style={[
                    styles.cardBase,
                    styles.shadowCard,
                    { borderColor: C.border, backgroundColor: C.card, marginTop: 12 },
                  ]}
                >
                  {pagos.length === 0 ? (
                    <Text style={{ color: C.sub }}>Sin pagos registrados</Text>
                  ) : (
                    pagos.map((p, idx) => {
                      const hasComprobante = !!p.comprobante_path;
                      const showDivider = idx !== pagos.length - 1;
                      return (
                        <View key={String(p.id)} style={{ paddingVertical: 10 }}>
                          <View style={styles.rowBetween}>
                            <Text style={[styles.payTitle, { color: C.text }]} numberOfLines={1}>
                              {fmtDate(p.fecha)} · {p.metodo ?? "—"}
                            </Text>
                            <Text style={[styles.payAmount, { color: C.text }]}>
                              {fmtQ(p.monto)}
                            </Text>
                          </View>

                          {!!p.referencia ? (
                            <Text style={[styles.payMeta, { color: C.sub }]} numberOfLines={1}>
                              Ref: {p.referencia}
                            </Text>
                          ) : null}

                          {!!p.comentario ? (
                            <Text style={[styles.payMeta, { color: C.sub }]} numberOfLines={2}>
                              {p.comentario}
                            </Text>
                          ) : null}

                          {hasComprobante ? (
                            <Pressable
                              onPress={() => abrirComprobante(p.comprobante_path!)}
                              style={({ pressed }) => [
                                styles.linkBtn,
                                { borderColor: C.border, backgroundColor: C.mutedBg },
                                pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
                              ]}
                            >
                              <Text style={[styles.linkBtnText, { color: C.text }]}>
                                Ver comprobante
                              </Text>
                            </Pressable>
                          ) : null}

                          {showDivider ? (
                            <View style={[styles.divider, { backgroundColor: C.divider }]} />
                          ) : null}
                        </View>
                      );
                    })
                  )}

                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={[styles.k, { color: C.sub }]}>Saldo pendiente</Text>
                    <Text style={[styles.v, { color: C.text }]}>
                      {fmtQ(compra.saldo_pendiente)}
                    </Text>
                  </View>

                  <Pressable
                    onPress={abrirPagoModal}
                    disabled={saldoNum <= 0}
                    android_ripple={
                      Platform.OS === "android"
                        ? { color: "rgba(255,255,255,0.18)" }
                        : undefined
                    }
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      {
                        backgroundColor: C.primary,
                        marginTop: 12,
                        opacity: saldoNum <= 0 ? 0.5 : 1,
                      },
                      pressed && Platform.OS === "ios" && saldoNum > 0 ? { opacity: 0.85 } : null,
                    ]}
                  >
                    <Text style={styles.primaryBtnText}>
                      {saldoNum <= 0 ? "Compra pagada" : "Aplicar pago"}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : null}

            {/* Líneas */}
            <Text style={[styles.sectionTitle, { color: C.text }]}>Productos</Text>

            {lineas.length === 0 ? (
              <View
                style={[
                  styles.cardBase,
                  styles.shadowCard,
                  { borderColor: C.border, backgroundColor: C.card, marginTop: 12 },
                ]}
              >
                <Text style={{ color: C.sub }}>Sin líneas</Text>
              </View>
            ) : (
              lineas.map((d, idx) => {
                const imgUrl = d.producto_image_path
                  ? storagePublicUrl(BUCKET_PRODUCTOS, d.producto_image_path)
                  : null;

                return (
                  <View
                    key={String(d.detalle_id)}
                    style={[
                      styles.cardBase,
                      styles.shadowCard,
                      { borderColor: C.border, backgroundColor: C.card, marginTop: 12 },
                    ]}
                  >
                    <View style={styles.rowBetween}>
                      <Text style={[styles.cardTitle, { color: C.text }]} numberOfLines={2}>
                        {idx + 1}. {d.producto_nombre ?? `Producto #${d.producto_id}`}
                      </Text>
                      {!!d.producto_marca ? (
                        <Text style={[styles.brand, { color: C.sub }]} numberOfLines={1}>
                          {d.producto_marca}
                        </Text>
                      ) : null}
                    </View>

                    <View style={styles.productBody}>
                      {imgUrl ? (
                        <ExpoImage
                          source={{ uri: imgUrl }}
                          style={styles.photo}
                          contentFit="cover"
                          cachePolicy="disk"
                        />
                      ) : (
                        <View
                          style={[
                            styles.photoPlaceholder,
                            { borderColor: C.border, backgroundColor: C.mutedBg },
                          ]}
                        >
                          <Text style={{ color: C.sub, fontWeight: "700", fontSize: 12 }}>
                            Sin foto
                          </Text>
                        </View>
                      )}

                      <View style={{ flex: 1 }}>
                        <View style={styles.miniRow}>
                          <Text style={[styles.miniK, { color: C.sub }]}>Lote</Text>
                          <Text style={[styles.miniV, { color: C.text }]} numberOfLines={1}>
                            {d.lote}
                          </Text>
                        </View>

                        <View style={styles.miniRow}>
                          <Text style={[styles.miniK, { color: C.sub }]}>Expira</Text>
                          <Text style={[styles.miniV, { color: C.text }]}>
                            {fmtDate(d.fecha_exp)}
                          </Text>
                        </View>

                        <View style={styles.miniRow}>
                          <Text style={[styles.miniK, { color: C.sub }]}>Cant.</Text>
                          <Text style={[styles.miniV, { color: C.text }]}>{d.cantidad}</Text>
                        </View>

                        <View style={styles.miniRow}>
                          <Text style={[styles.miniK, { color: C.sub }]}>Precio</Text>
                          <Text style={[styles.miniV, { color: C.text }]}>
                            {fmtQ(d.precio_compra_unit)}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={[styles.subtotalPill, { backgroundColor: C.mutedBg }]}>
                      <Text style={[styles.subtotalText, { color: C.text }]}>
                        Subtotal:{" "}
                        {fmtQ(d.subtotal ?? Number(d.cantidad) * Number(d.precio_compra_unit))}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}

            <View style={{ height: 12 }} />
          </ScrollView>
        )}

        {/* Bottom actions */}
        {!loading && compra ? (
          <View
            style={[
              styles.bottomBar,
              {
                backgroundColor: C.bg,
                borderTopColor: C.divider,
                paddingBottom: Math.max(12, insets.bottom),
              },
            ]}
          >
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/compra-nueva",
                  params: { editId: String(compra.id) },
                })
              }
              android_ripple={
                Platform.OS === "android" ? { color: "rgba(255,255,255,0.18)" } : undefined
              }
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: C.primary },
                pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
              ]}
            >
              <Text style={styles.primaryBtnText}>Editar</Text>
            </Pressable>

            <Pressable
              onPress={eliminarCompra}
              disabled={deleting}
              android_ripple={
                Platform.OS === "android" ? { color: "rgba(140, 38, 38, 0.1)" } : undefined
              }
              style={({ pressed }) => [
                styles.dangerBtn,
                { backgroundColor: C.dangerBg, opacity: deleting ? 0.6 : 1 },
                pressed && Platform.OS === "ios" && !deleting ? { opacity: 0.85 } : null,
              ]}
            >
              <Text style={[styles.dangerBtnText, { color: C.danger }]}>
                {deleting ? "Eliminando..." : "Eliminar"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Modal: Aplicar pago */}
        <Modal
          transparent
          visible={pagoModal}
          animationType="fade"
          onRequestClose={() => setPagoModal(false)}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={[styles.modalBg, { backgroundColor: C.overlay }]}>
              <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                style={{ width: "100%" }}
                keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
              >
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{ paddingBottom: 12 }}
                  showsVerticalScrollIndicator={false}
                >
                  <TouchableWithoutFeedback onPress={() => { }} accessible={false}>
                    <View
                      style={[
                        styles.modalCard,
                        styles.shadowCard,
                        { backgroundColor: C.card, borderColor: C.border },
                      ]}
                    >
                      <Text style={[styles.modalTitle, { color: C.text }]}>Aplicar pago</Text>
                      <Text style={[styles.modalSub, { color: C.sub }]}>
                        Saldo: {fmtQ(compra?.saldo_pendiente)}
                      </Text>

                      <Text style={[styles.inputLabel, { color: C.sub }]}>Monto</Text>
                      <TextInput
                        value={pagoMonto}
                        onChangeText={setPagoMonto}
                        placeholder="0.00"
                        placeholderTextColor={C.sub}
                        keyboardType="decimal-pad"
                        returnKeyType="next"
                        blurOnSubmit={false}
                        style={[
                          styles.input,
                          { color: C.text, borderColor: C.border, backgroundColor: C.inputBg },
                        ]}
                        onSubmitEditing={() => {
                          // enfoca el siguiente input (referencia)
                          // si no usas refs, puedes omitir esto
                        }}
                      />

                      <Text style={[styles.inputLabel, { color: C.sub, marginTop: 10 }]}>Método</Text>
                      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                        {(["EFECTIVO", "TRANSFERENCIA", "TARJETA", "OTRO"] as const).map((m) => {
                          const active = pagoMetodo === m;
                          return (
                            <Pressable
                              key={m}
                              onPress={() => {
                                Keyboard.dismiss();
                                setPagoMetodo(m);
                              }}
                              style={({ pressed }) => [
                                styles.chip,
                                { borderColor: C.border, backgroundColor: active ? C.mutedBg : "transparent" },
                                pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
                              ]}
                            >
                              <Text style={{ color: C.text, fontWeight: "800", fontSize: 12 }}>{m}</Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      <Text style={[styles.inputLabel, { color: C.sub, marginTop: 10 }]}>
                        Referencia (opcional)
                      </Text>
                      <TextInput
                        value={pagoReferencia}
                        onChangeText={setPagoReferencia}
                        placeholder="Ej: #boleta, #transferencia"
                        placeholderTextColor={C.sub}
                        returnKeyType="next"
                        blurOnSubmit={false}
                        style={[
                          styles.input,
                          { color: C.text, borderColor: C.border, backgroundColor: C.inputBg },
                        ]}
                      />

                      <Text style={[styles.inputLabel, { color: C.sub, marginTop: 10 }]}>
                        Comentario (opcional)
                      </Text>
                      <TextInput
                        value={pagoComentario}
                        onChangeText={setPagoComentario}
                        placeholder="Nota breve"
                        placeholderTextColor={C.sub}
                        returnKeyType="done"
                        style={[
                          styles.input,
                          { color: C.text, borderColor: C.border, backgroundColor: C.inputBg },
                        ]}
                        onSubmitEditing={Keyboard.dismiss}
                      />

                      <View style={{ marginTop: 12 }}>
                        <View style={styles.rowBetween}>
                          <Text style={[styles.inputLabel, { color: C.sub }]}>Comprobante (imagen)</Text>
                          <Pressable
                            onPress={() => {
                              Keyboard.dismiss();
                              pickComprobante();
                            }}
                            style={({ pressed }) => [
                              styles.linkBtnSmall,
                              { borderColor: C.border, backgroundColor: C.mutedBg },
                              pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
                            ]}
                          >
                            <Text style={[styles.linkBtnTextSmall, { color: C.text }]}>
                              {pagoImg?.uri ? "Cambiar" : "Agregar"}
                            </Text>
                          </Pressable>
                        </View>

                        {pagoImg?.uri ? (
                          <View style={[styles.previewWrap, { borderColor: C.border, backgroundColor: C.mutedBg }]}>
                            <ExpoImage
                              source={{ uri: pagoImg.uri }}
                              style={styles.previewImg}
                              contentFit="cover"
                              cachePolicy="disk"
                            />
                            <Text style={{ color: C.sub, fontWeight: "700", fontSize: 12, marginTop: 8 }}>
                              Se subirá junto con el pago
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                        <Pressable
                          onPress={() => {
                            Keyboard.dismiss();
                            setPagoModal(false);
                          }}
                          disabled={savingPago}
                          style={({ pressed }) => [
                            styles.secondaryBtn,
                            { borderColor: C.border, backgroundColor: "transparent", opacity: savingPago ? 0.6 : 1 },
                            pressed && Platform.OS === "ios" && !savingPago ? { opacity: 0.85 } : null,
                          ]}
                        >
                          <Text style={{ color: C.text, fontSize: 15, fontWeight: "800" }}>Cancelar</Text>
                        </Pressable>

                        <Pressable
                          onPress={() => {
                            Keyboard.dismiss();
                            guardarPago();
                          }}
                          disabled={savingPago}
                          style={({ pressed }) => [
                            styles.primaryBtn,
                            { backgroundColor: C.primary, flex: 1, opacity: savingPago ? 0.75 : 1 },
                            pressed && Platform.OS === "ios" && !savingPago ? { opacity: 0.85 } : null,
                          ]}
                        >
                          <Text style={styles.primaryBtnText}>
                            {savingPago ? "Guardando..." : "Guardar"}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </TouchableWithoutFeedback>
                </ScrollView>
              </KeyboardAvoidingView>
            </View>
          </TouchableWithoutFeedback>
        </Modal>


        {/* Viewer */}
        <Modal
          transparent
          visible={viewerOpen}
          animationType="fade"
          onRequestClose={() => setViewerOpen(false)}
        >
          <View style={[styles.modalBg, { backgroundColor: "rgba(0,0,0,0.75)" }]}>
            <View style={styles.viewerCard}>
              <Pressable
                onPress={() => setViewerOpen(false)}
                style={({ pressed }) => [styles.viewerClose, pressed ? { opacity: 0.8 } : null]}
              >
                <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>Cerrar</Text>
              </Pressable>

              {!(viewerUrl || viewerRemoteUrl) ? (
                <View style={[styles.center, { paddingTop: 18 }]}>
                  <ActivityIndicator />
                </View>
              ) : (
                <ExpoImage
                  source={{
                    uri: viewerUrl ?? viewerRemoteUrl!,
                    headers: { "Cache-Control": "no-cache" },
                  }}
                  style={styles.viewerImg}
                  contentFit="contain"
                  cachePolicy="none"
                  onError={(e) => {
                    const msg = (e as any)?.error ?? "Image data is nil";
                    Alert.alert("No se pudo cargar", String(msg));
                  }}
                />
              )}
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  cardBase: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: 16,
  },

  shadowCard: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
    },
    android: { elevation: 2 },
    default: {},
  }),

  headerCard: { padding: 16 },

  headerTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },

  h1: { fontSize: 20, fontWeight: "800", letterSpacing: -0.2 },

  metaK: { fontSize: 12, fontWeight: "700" },
  metaV: { marginTop: 2, fontSize: 14, fontWeight: "700" },

  badgePill: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  badgeText: { fontSize: 12, fontWeight: "800", letterSpacing: 0.2 },

  kvGrid: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  kv: { minWidth: 130 },

  k: { fontSize: 12, fontWeight: "700" },
  v: { marginTop: 3, fontSize: 14, fontWeight: "700" },
  note: { marginTop: 6, fontSize: 14, fontWeight: "600", lineHeight: 19 },

  divider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },

  totalRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  total: { fontSize: 24, fontWeight: "800", marginTop: 4, letterSpacing: -0.3 },
  totalSmall: { fontSize: 16, fontWeight: "800", marginTop: 4 },

  sectionTitle: { marginTop: 16, fontSize: 18, fontWeight: "800", letterSpacing: -0.2 },

  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  cardTitle: { fontSize: 16, fontWeight: "800", flex: 1, paddingRight: 10 },
  brand: { fontSize: 13, fontWeight: "700" },

  productBody: { marginTop: 12, flexDirection: "row", gap: 12, alignItems: "flex-start" },

  photo: { width: 92, height: 92, borderRadius: 16 },
  photoPlaceholder: {
    width: 92,
    height: 92,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },

  miniRow: { flexDirection: "row", justifyContent: "space-between", gap: 10, marginBottom: 6 },
  miniK: { fontSize: 12, fontWeight: "700", minWidth: 56 },
  miniV: { fontSize: 13, fontWeight: "700", flex: 1, textAlign: "right" },

  subtotalPill: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  subtotalText: { fontSize: 14, fontWeight: "800" },

  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },

  primaryBtn: {
    borderRadius: 14,
    paddingVertical: Platform.select({ ios: 14, android: 12, default: 12 }),
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },

  dangerBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: Platform.select({ ios: 14, android: 12, default: 12 }),
    alignItems: "center",
    justifyContent: "center",
  },
  dangerBtnText: { fontSize: 16, fontWeight: "800" },

  // Pagos
  payTitle: { fontSize: 14, fontWeight: "800", flex: 1, paddingRight: 8 },
  payAmount: { fontSize: 14, fontWeight: "900" },
  payMeta: { marginTop: 4, fontSize: 12, fontWeight: "700" },

  linkBtn: {
    marginTop: 10,
    alignSelf: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
  },
  linkBtnText: { fontSize: 12, fontWeight: "800" },

  modalBg: { flex: 1, alignItems: "center", justifyContent: "center", padding: 18 },
  modalCard: {
    width: "100%",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: "900", letterSpacing: -0.2 },
  modalSub: { marginTop: 4, fontSize: 13, fontWeight: "700" },

  inputLabel: { fontSize: 12, fontWeight: "800" },
  input: {
    marginTop: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: "700",
  },

  secondaryBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: Platform.select({ ios: 14, android: 12, default: 12 }),
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },

  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },

  linkBtnSmall: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
  },
  linkBtnTextSmall: { fontSize: 12, fontWeight: "900" },

  previewWrap: {
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 10,
    alignItems: "center",
  },
  previewImg: { width: "100%", height: 160, borderRadius: 12 },

  viewerCard: { width: "100%", height: "100%", justifyContent: "center" },
  viewerClose: {
    position: "absolute",
    top: 60,
    right: 18,
    zIndex: 10,
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
  },
  viewerImg: { width: "100%", height: "100%" },
});
