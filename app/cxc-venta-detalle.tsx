import { useFocusEffect, useTheme } from "@react-navigation/native";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { Image as ExpoImage } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import * as MediaLibrary from "expo-media-library";
import { useThemePref } from "../lib/themePreference";
import { alphaColor } from "../lib/ui";
import { AppButton } from "../components/ui/app-button";
import { DoneAccessory } from "../components/ui/done-accessory";

const BUCKET_COMPROBANTES = "comprobantes";
const BUCKET_VENTAS_DOCS = "Ventas-Docs";

function normalizeStoragePath(raw: string) {
  const p = String(raw ?? "").trim();
  if (!p) return "";
  let clean = p.startsWith("/") ? p.slice(1) : p;
  const pref = `${BUCKET_VENTAS_DOCS}/`;
  if (clean.startsWith(pref)) clean = clean.slice(pref.length);
  return clean;
}

async function openInBrowser(url: string) {
  if (!url) throw new Error("URL inválida");
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    await WebBrowser.openBrowserAsync(encodeURI(url));
  }
}

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

function shortUid(u: string | null | undefined) {
  const s = String(u ?? "").trim();
  if (!s) return "—";
  return s.slice(0, 8);
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

function base64ToUint8Array(base64: string) {
  const binary = globalThis.atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function uriToBytes(uri: string) {
  const anyFS: any = FileSystem as any;
  const encoding = anyFS?.EncodingType?.Base64 ?? "base64";
  const b64 = await anyFS.readAsStringAsync(uri, { encoding });
  const atobFn: any = (globalThis as any).atob;
  if (typeof atobFn !== "function") throw new Error("No se pudo decodificar el archivo (atob no disponible)");
  const bin = atobFn(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function makeComprobantePath(ventaId: number, mimeType: string) {
  const stamp = Date.now();
  const rnd = Math.random().toString(16).slice(2);
  const ext = extFromMime(mimeType);
  return `ventas/${ventaId}/comprobantes/${stamp}-${rnd}.${ext}`;
}

function normalizeComprobanteRef(raw: string) {
  const p = (raw ?? "").trim();
  if (!p) return null;

  if (p.startsWith("http://") || p.startsWith("https://")) {
    return { url: p, path: null as string | null };
  }

  let clean = p.startsWith("/") ? p.slice(1) : p;
  const pref = `${BUCKET_COMPROBANTES}/`;
  if (clean.startsWith(pref)) clean = clean.slice(pref.length);
  return { url: null as string | null, path: clean };
}

async function probeImageUrl(url: string, minBytes = 512) {
  const target = encodeURI(url);
  try {
    const r = await fetch(target, { headers: { Range: "bytes=0-4096", "Cache-Control": "no-cache" } });
    const ct = r.headers.get("content-type") ?? "";
    const ab = await r.arrayBuffer();
    const size = ab?.byteLength ?? 0;
    return {
      ok: r.ok,
      status: r.status,
      contentType: ct,
      bytes: size,
      looksLikeImage: ct.toLowerCase().startsWith("image/"),
      url: target,
      minOk: size >= minBytes,
    };
  } catch (e: any) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      bytes: 0,
      looksLikeImage: false,
      url: target,
      minOk: false,
      error: e?.message ?? String(e),
    };
  }
}

async function downloadToCache(remoteUrl: string, mimeHint?: string) {
  const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!baseDir) throw new Error("No hay cacheDirectory disponible");

  const urlNoQuery = String(remoteUrl).split("?")[0];
  const extFromUrl = (urlNoQuery.match(/\.([a-zA-Z0-9]{2,6})$/)?.[1] ?? "").toLowerCase();
  const extFromHint = mimeHint ? extFromMime(mimeHint) : "";
  const ext = (extFromHint || "").toLowerCase() || (["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(extFromUrl) ? (extFromUrl === "jpeg" ? "jpg" : extFromUrl) : "jpg");
  const safeName = urlNoQuery
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 90);
  const target = `${baseDir}cxc_${safeName}.${ext}`;

  try {
    const info = await FileSystem.getInfoAsync(target);
    if (info.exists && (info.size ?? 0) > 1024) return target;
    if (info.exists) await FileSystem.deleteAsync(target, { idempotent: true });
  } catch {}

  const res = await FileSystem.downloadAsync(encodeURI(remoteUrl), target);
  const info2 = await FileSystem.getInfoAsync(res.uri);
  if (!info2.exists || (info2.size ?? 0) < 1024) {
    try {
      await FileSystem.deleteAsync(res.uri, { idempotent: true });
    } catch {}
    throw new Error("Descarga incompleta");
  }
  return res.uri;
}

export default function CxcVentaDetalle() {
  const insets = useSafeAreaInsets();
  const { ventaId } = useLocalSearchParams<{ ventaId: string }>();
  const id = Number(ventaId);

  const { colors } = useTheme();
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  const C = useMemo(
    () => ({
      bg: colors.background ?? (isDark ? "#000" : "#fff"),
      card: colors.card ?? (isDark ? "#1C1C1E" : "#fff"),
      text: colors.text ?? (isDark ? "#fff" : "#111"),
      sub: alphaColor(String(colors.text ?? (isDark ? "#ffffff" : "#000000")), 0.65) || (isDark ? "rgba(255,255,255,0.65)" : "#6b7280"),
      border: colors.border ?? (isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)"),
      primary: String(colors.primary ?? "#007AFF"),

      ok: isDark ? "rgba(140,255,170,0.95)" : "#16a34a",
      warn: isDark ? "rgba(255,210,120,0.95)" : "#b45309",
      okBg: isDark ? "rgba(22,163,74,0.18)" : "rgba(22,163,74,0.10)",
      warnBg: isDark ? "rgba(180,83,9,0.18)" : "rgba(180,83,9,0.10)",
      mutedBg: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
      overlay: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)",
      inputBg: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)",
      divider: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)",
    }),
    [isDark, colors.background, colors.border, colors.card, colors.primary, colors.text]
  );

  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<any | null>(null);
  const [lineas, setLineas] = useState<any[]>([]);
  const [pagos, setPagos] = useState<any[]>([]);
  const [facturas, setFacturas] = useState<any[]>([]);
  const [vendedorDisplay, setVendedorDisplay] = useState<string>("");

  // pago modal
  const [pagoModal, setPagoModal] = useState(false);
  const [pagoMonto, setPagoMonto] = useState("");
  const [pagoMetodo, setPagoMetodo] = useState<"EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "OTRO">("EFECTIVO");
  const [pagoReferencia, setPagoReferencia] = useState("");
  const [pagoComentario, setPagoComentario] = useState("");
  const [pagoImg, setPagoImg] = useState<{ uri: string; mimeType: string } | null>(null);
  const [savingPago, setSavingPago] = useState(false);

  // Viewer de comprobantes
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerRemoteUrl, setViewerRemoteUrl] = useState<string | null>(null);
  const [viewerMimeType, setViewerMimeType] = useState<string | null>(null);
  const viewerBusyRef = useRef(false);
  const [savingDownload, setSavingDownload] = useState(false);

  // role check
  const [role, setRole] = useState<string>("");
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid) return;
        const { data } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
        const r = normalizeUpper(data?.role);
        if (mounted) setRole(r);
      } catch {
        if (mounted) setRole("");
      }
    })();
    return () => { mounted = false; };
  }, []);

  const fetchAll = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) return;
    setLoading(true);
    try {
      // summary from vw
      const { data: v } = await supabase.from("vw_cxc_ventas").select("*").eq("venta_id", id).maybeSingle();
      setRow(v as any);

      const { data: d } = await supabase.from("ventas_detalle").select("id,venta_id,producto_id,lote_id,cantidad,precio_venta_unit,subtotal,producto_lotes(lote,fecha_exp),productos(nombre,marcas(nombre))").eq("venta_id", id).order("id", { ascending: true });
      setLineas((d ?? []) as any[]);

      const { data: f } = await supabase
        .from("ventas_facturas")
        .select("id,venta_id,tipo,path,numero_factura,original_name,size_bytes,created_at")
        .eq("venta_id", id)
        .order("created_at", { ascending: false });
      const frows = (f ?? []).map((r: any) => ({ ...r, path: normalizeStoragePath(r.path) }));
      setFacturas(frows);

      const { data: p } = await supabase.from("ventas_pagos").select("id,venta_id,fecha,monto,metodo,referencia,comprobante_path,comentario,created_by").eq("venta_id", id).order("fecha", { ascending: false });
      setPagos((p ?? []) as any[]);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo cargar");
      setRow(null);
      setLineas([]);
      setPagos([]);
      setFacturas([]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { fetchAll(); }, [fetchAll]));

  useEffect(() => {
    const vid = row?.vendedor_id ?? null;
    const codigo = String(row?.vendedor_codigo ?? "").trim();
    if (!vid) {
      setVendedorDisplay(codigo || "—");
      return;
    }

    let alive = true;
    setVendedorDisplay(codigo || shortUid(vid));

    (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("full_name,codigo")
          .eq("id", vid)
          .maybeSingle();
        if (error) throw error;
        const display =
          String(data?.codigo ?? "").trim() ||
          String(data?.full_name ?? "").trim() ||
          codigo ||
          shortUid(vid);
        if (alive) setVendedorDisplay(display);
      } catch {
        // keep previous display
      }
    })();

    return () => {
      alive = false;
    };
  }, [row?.vendedor_id, row?.vendedor_codigo]);


  const pickComprobante = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permiso requerido", "Permite acceso a tus fotos para seleccionar el comprobante."); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9, allowsEditing: false });
    if (res.canceled) return;
    const a = res.assets?.[0]; if (!a?.uri) return;
    const mimeType = (a as any).mimeType || "image/jpeg";
    setPagoImg({ uri: a.uri, mimeType });
  };

  const subirComprobanteSiExiste = async (ventaIdLocal: number): Promise<string | null> => {
    if (!pagoImg?.uri) return null;
    const path = makeComprobantePath(ventaIdLocal, pagoImg.mimeType);
    const bytes = await uriToBytes(pagoImg.uri);
    const { error } = await supabase.storage.from(BUCKET_COMPROBANTES).upload(path, bytes, { upsert: false, contentType: pagoImg.mimeType || "image/jpeg" });
    if (error) throw error;
    return path;
  };

  const guardarPago = async () => {
    if (!row) return;
    if (savingPago) return;
    const monto = safeNumber(pagoMonto);
    if (!(monto > 0)) { Alert.alert("Monto inválido", "Ingresa un monto mayor a 0."); return; }
    setSavingPago(true);
    try {
      const comprobantePath = await subirComprobanteSiExiste(Number(row.venta_id));
      const { error } = await supabase.rpc("rpc_venta_aplicar_pago", {
        p_venta_id: Number(row.venta_id),
        p_monto: monto,
        p_metodo: pagoMetodo,
        p_referencia: pagoReferencia ? pagoReferencia : null,
        p_comprobante_path: comprobantePath,
        p_comentario: pagoComentario ? pagoComentario : null,
      });
      if (error) throw error;
      setPagoModal(false);
      setPagoMonto(""); setPagoReferencia(""); setPagoComentario(""); setPagoImg(null);
      await fetchAll();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo aplicar el pago");
    } finally {
      setSavingPago(false);
    }
  };

  // protect route by role
  useEffect(() => {
    if (!role) return;
    const allowed = role === "ADMIN" || role === "VENTAS";
    if (!allowed) {
      Alert.alert("Acceso denegado", "No tienes permiso para ver esta pantalla.", [{ text: "OK", onPress: () => router.replace("/(drawer)/(tabs)") }]);
    }
  }, [role]);

  const saldoNum = useMemo(() => safeNumber(row?.saldo), [row?.saldo]);


  const openFacturaPdf = useCallback(async (pathRaw: string) => {
    const path = normalizeStoragePath(pathRaw);
    if (!path) return;
    const { data: s, error: se } = await supabase.storage.from(BUCKET_VENTAS_DOCS).createSignedUrl(path, 60 * 15);
    if (se) throw se;
    const url = (s as any)?.signedUrl ?? null;
    if (!url) throw new Error("No se pudo abrir el PDF");
    await openInBrowser(url);
  }, []);

  const handleOpenComprobante = useCallback(
    async (raw: string) => {
      const norm = normalizeComprobanteRef(raw);
      if (!norm) {
        Alert.alert("Sin comprobante", "No hay archivo adjunto");
        return;
      }

      const ref = (norm.path ?? norm.url ?? "").toLowerCase();
      const isPdf = ref.includes(".pdf");

      if (isPdf) {
        try {
          let signed = norm.url ?? null;
          if (!signed && norm.path) {
            const { data, error } = await supabase.storage
              .from(BUCKET_COMPROBANTES)
              .createSignedUrl(norm.path, 60 * 10);
            if (error) throw error;
            signed = data?.signedUrl ?? null;
          }
          if (!signed) throw new Error("No se pudo generar URL del comprobante.");
          await openInBrowser(signed);
        } catch (e: any) {
          Alert.alert("Error", e?.message ?? "No se pudo abrir comprobante");
        }
        return;
      }

      if (viewerBusyRef.current) return;
      viewerBusyRef.current = true;
      setViewerUrl(null);
      setViewerRemoteUrl(null);
      setViewerMimeType(null);
      setViewerOpen(true);

      try {
        let signedUrl = norm.url ?? null;
        if (!signedUrl && norm.path) {
          const { data, error } = await supabase.storage
            .from(BUCKET_COMPROBANTES)
            .createSignedUrl(norm.path, 60 * 10);
          if (error) throw error;
          signedUrl = data?.signedUrl ?? null;
        }
        if (!signedUrl) throw new Error("No se pudo generar URL del comprobante.");

        // probe la URL para obtener info, pero no fallamos totalmente si probe falla
        let probe = null as any;
        try {
          probe = await probeImageUrl(signedUrl, 512);
        } catch {
          probe = null;
        }

        // si probe indica que no es imagen o está pequeño, lo aceptamos como fallback
        const finalUrl = (probe && probe.url) ? probe.url : signedUrl;
        setViewerRemoteUrl(finalUrl);
        if (probe?.contentType) setViewerMimeType(String(probe.contentType));
        try {
          const localUri = await downloadToCache(finalUrl, probe?.contentType ? String(probe.contentType) : undefined);
          setViewerUrl(localUri);
        } catch {
          // fallback al signed url remoto
        }
      } catch (e: any) {
        setViewerOpen(false);
        Alert.alert("Error", e?.message ?? "No se pudo abrir comprobante");
      } finally {
        viewerBusyRef.current = false;
      }
    },
    []
  );

  const downloadViewerImage = useCallback(async () => {
    if (!viewerRemoteUrl && !viewerUrl) {
      Alert.alert("Nada que descargar", "No hay imagen disponible para descargar.");
      return;
    }
    setSavingDownload(true);
    try {
      const src = viewerUrl ?? viewerRemoteUrl!;
      let localUri = src;
      if (/^https?:\/\//i.test(src)) {
        // descarga al cache (con extension reconocible)
        localUri = await downloadToCache(src, viewerMimeType ?? undefined);
      } else {
        // algunos downloads anteriores eran .bin; copiar a .jpg para que MediaLibrary lo acepte
        const p = String(src);
        if (p.toLowerCase().endsWith(".bin")) {
          const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
          if (!baseDir) throw new Error("No hay directorio de cache disponible");
          const ext = viewerMimeType ? extFromMime(viewerMimeType) : "jpg";
          const target = `${baseDir}cxc_download_${Date.now()}.${ext}`;
          await FileSystem.copyAsync({ from: p, to: target });
          localUri = target;
        }
      }

      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") throw new Error("Permiso para guardar archivos denegado");
      const asset = await MediaLibrary.createAssetAsync(localUri);
      try {
        await MediaLibrary.createAlbumAsync("Downloads", asset, false);
      } catch {
        // si falla (ya existe), ignorar
      }
      Alert.alert("Descargado", "La imagen se guardó en la galería.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo descargar la imagen");
    } finally {
      setSavingDownload(false);
    }
  }, [viewerRemoteUrl, viewerUrl]);

  const confirmDeletePago = useCallback(
    (p: any) => {
      const refInfo = p.referencia ? `\nRef: ${p.referencia}` : "";
      Alert.alert(
        "Eliminar pago",
        `Se eliminará el pago del ${fmtDate(p.fecha)} por ${fmtQ(p.monto)}.${refInfo}`,
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Eliminar",
            style: "destructive",
            onPress: async () => {
              try {
                const { error } = await supabase.rpc("rpc_venta_pago_eliminar", {
                  p_pago_id: Number(p.id),
                });
                if (error) throw error;
                await fetchAll();
              } catch (e: any) {
                Alert.alert("Error", e?.message ?? "No se pudo eliminar");
              }
            },
          },
        ]
      );
    },
    [fetchAll]
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Detalle cuenta", headerBackTitle: "Atrás" }} />

      <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
        {loading ? (
          <View style={styles.center}><Text style={{ color: C.sub, fontWeight: "700" }}>Cargando...</Text></View>
        ) : !row ? (
          <View style={styles.center}><Text style={{ color: C.text }}>No disponible</Text></View>
        ) : (
          <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: 12 + insets.bottom + 104 }} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <View style={[styles.cardBase, styles.headerCard, styles.shadowCard, { borderColor: C.border, backgroundColor: C.card }]}>
              <View style={styles.headerTop}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.h1, { color: C.text }]} numberOfLines={2}>{row.cliente_nombre ?? `Cliente #${row.cliente_id}`}</Text>
                  <View style={{ marginTop: 8 }}>
                    <Text style={[styles.metaK, { color: C.sub }]}>Fecha</Text>
                    <Text style={[styles.metaV, { color: C.text }]} numberOfLines={1}>{fmtDate(row.fecha)}</Text>
                    <Text style={[styles.metaK, { color: C.sub, marginTop: 6 }]}>Vencimiento</Text>
                    <Text style={[styles.metaV, { color: C.text }]} numberOfLines={1}>{fmtDate(row.fecha_vencimiento)}</Text>
                    <Text style={[styles.metaK, { color: C.sub, marginTop: 6 }]}>Vendedor</Text>
                    <Text style={[styles.metaV, { color: C.text }]} numberOfLines={1}>
                      {vendedorDisplay || shortUid(row.vendedor_id)}
                    </Text>
                  </View>
                </View>

                <View style={[styles.badgePill, { backgroundColor: saldoNum <= 0 ? C.okBg : C.warnBg, borderColor: C.border }]}>
                  <Text style={[styles.badgeText, { color: saldoNum <= 0 ? C.ok : C.warn }]}>{saldoNum <= 0 ? "PAGADA" : "PENDIENTE"}</Text>
                </View>
              </View>

              <View style={[styles.kvGrid, { marginTop: 12 }]}>
                <View style={styles.kv}><Text style={[styles.k, { color: C.sub }]}>Total</Text><Text style={[styles.v, { color: C.text }]}>{fmtQ(row?.total)}</Text></View>
                <View style={styles.kv}><Text style={[styles.k, { color: C.sub }]}>Pagado</Text><Text style={[styles.v, { color: C.text }]}>{fmtQ(row?.pagado)}</Text></View>
                <View style={styles.kv}><Text style={[styles.k, { color: C.sub }]}>Saldo</Text><Text style={[styles.v, { color: C.text }]}>{fmtQ(row?.saldo)}</Text></View>
              </View>
            </View>

            <Text style={[styles.sectionTitle, { color: C.text }]}>Productos</Text>
            {lineas.length === 0 ? (
              <View style={[styles.cardBase, styles.shadowCard, { borderColor: C.border, backgroundColor: C.card, marginTop: 12 }]}><Text style={{ color: C.sub }}>Sin líneas</Text></View>
            ) : (
              lineas.map((d, idx) => {
                const nombre = d.productos?.nombre ?? `Producto #${d.producto_id}`;
                const marca = d.productos?.marcas?.nombre ?? d.productos?.marcas?.[0]?.nombre ?? null;
                const subtotal = d.subtotal ?? (Number(d.cantidad ?? 0) * Number(d.precio_venta_unit ?? 0));
                return (
                  <View key={String(d.id)} style={[styles.cardBase, styles.shadowCard, { borderColor: C.border, backgroundColor: C.card, marginTop: 12 }]}>
                    <View style={styles.rowBetween}>
                      <Text style={[styles.cardTitle, { color: C.text }]} numberOfLines={2}>
                        {idx + 1}. {nombre}{marca ? ` • ${marca}` : ""}
                      </Text>
                      <Text style={[styles.lineAmt, { color: C.text }]}>{fmtQ(subtotal)}</Text>
                    </View>

                    <View style={[styles.lineRow, { borderTopColor: C.divider }]}>
                      <Text style={[styles.lineSub, { color: C.sub }]}>Cantidad</Text>
                      <Text style={[styles.lineSubV, { color: C.text }]}>
                        {Number(d.cantidad ?? 0)} x {fmtQ(d.precio_venta_unit)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}

            <Text style={[styles.sectionTitle, { color: C.text }]}>Facturas</Text>
            <View style={[styles.cardBase, styles.shadowCard, { borderColor: C.border, backgroundColor: C.card, marginTop: 12 }]}>
              {facturas.length === 0 ? (
                <Text style={{ color: C.sub }}>—</Text>
              ) : (
                facturas.slice(0, 2).map((f: any) => (
                  <View key={String(f.id)} style={{ paddingVertical: 10 }}>
                    <View style={styles.rowBetween}>
                      <Text style={[styles.payTitle, { color: C.text }]} numberOfLines={1}>
                        {String(f.numero_factura ?? "—")}
                      </Text>
                      <Pressable
                        onPress={() => openFacturaPdf(String(f.path ?? "")).catch((e: any) => Alert.alert("Error", e?.message ?? "No se pudo abrir"))}
                        style={({ pressed }) => [
                          styles.linkBtnSmall,
                          { borderColor: C.border, backgroundColor: C.mutedBg },
                          pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
                        ]}
                      >
                        <Text style={[styles.linkBtnTextSmall, { color: C.text }]}>Ver PDF</Text>
                      </Pressable>
                    </View>
                    <View style={[styles.divider, { backgroundColor: C.divider }]} />
                  </View>
                ))
              )}
            </View>

            <Text style={[styles.sectionTitle, { color: C.text }]}>Pagos</Text>
            <View style={[styles.cardBase, styles.shadowCard, { borderColor: C.border, backgroundColor: C.card, marginTop: 12 }]}>
              {pagos.length === 0 ? (
                <Text style={{ color: C.sub }}>Sin pagos registrados</Text>
              ) : (
                pagos.map((p: any) => {
                  const comprobanteRaw = String(p.comprobante_path ?? "").trim();
                  const hasComprobante = !!comprobanteRaw;
                  const canDeletePago = normalizeUpper(role) === "ADMIN" || normalizeUpper(role) === "VENTAS";

                  return (
                    <View key={String(p.id)} style={{ paddingVertical: 10 }}>
                      <View style={styles.rowBetween}>
                        <Text style={[styles.payTitle, { color: C.text }]}>{fmtDate(p.fecha)} · {p.metodo ?? "—"}</Text>
                        <Text style={[styles.payAmount, { color: C.text }]}>{fmtQ(p.monto)}</Text>
                      </View>
                      {!!p.referencia ? <Text style={[styles.payMeta, { color: C.sub }]}>Ref: {p.referencia}</Text> : null}
                      {!!p.comentario ? <Text style={[styles.payMeta, { color: C.sub }]}>{p.comentario}</Text> : null}

                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: hasComprobante || canDeletePago ? 10 : 0 }}>
                        {hasComprobante ? (
                          <AppButton
                            title="Ver comprobante"
                            size="sm"
                            variant="outline"
                            onPress={() => {
                              handleOpenComprobante(comprobanteRaw);
                            }}
                          />
                        ) : null}

                        {canDeletePago ? (
                          <AppButton
                            title="Eliminar pago"
                            size="sm"
                            variant="danger"
                            onPress={() => confirmDeletePago(p)}
                          />
                        ) : null}
                      </View>
                    </View>
                  );
                })
              )}

                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[styles.k, { color: C.sub }]}>Saldo pendiente</Text>
                <Text style={[styles.v, { color: C.text }]}>{fmtQ(row?.saldo)}</Text>
              </View>

              {/** Edición de pagos no expuesta. Solo se permite eliminar pagos. **/}
              {saldoNum > 0 ? (
                <AppButton title="Aplicar pago" onPress={() => setPagoModal(true)} disabled={false} variant="primary" style={{ marginTop: 12, backgroundColor: C.primary, borderColor: C.primary } as any} />
              ) : null}
            </View>

            <View style={{ height: 12 }} />
          </ScrollView>
        )}

        {/* Bottom actions not required */}

        {/* Modal: Aplicar pago */}
        <Modal transparent visible={pagoModal} animationType="fade" onRequestClose={() => setPagoModal(false)}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={[styles.modalBg, { backgroundColor: C.overlay }]}> 
              <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ width: '100%' }} keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}>
                <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>
                  <TouchableWithoutFeedback onPress={() => {}} accessible={false}>
                    <View style={[styles.modalCard, styles.shadowCard, { backgroundColor: C.card, borderColor: C.border }]}> 
                      <Text style={[styles.modalTitle, { color: C.text }]}>Aplicar pago</Text>
                      <Text style={[styles.modalSub, { color: C.sub }]}>Saldo: {fmtQ(row?.saldo)}</Text>

                      <Text style={[styles.inputLabel, { color: C.sub }]}>Monto</Text>
                      <TextInput value={pagoMonto} onChangeText={setPagoMonto} placeholder="0.00" placeholderTextColor={C.sub} keyboardType="decimal-pad" inputAccessoryViewID={Platform.OS === "ios" ? 'doneAccessory' : undefined} style={[styles.input, { color: C.text, borderColor: C.border, backgroundColor: C.inputBg }]} />

                      <Text style={[styles.inputLabel, { color: C.sub, marginTop: 10 }]}>Método</Text>
                      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                        {(['EFECTIVO','TRANSFERENCIA','TARJETA','OTRO'] as const).map((m) => {
                          const active = pagoMetodo === m;
                          return (
                            <Pressable key={m} onPress={() => { Keyboard.dismiss(); setPagoMetodo(m); }} style={({ pressed }) => [styles.chip, { borderColor: C.border, backgroundColor: active ? C.mutedBg : 'transparent' }, pressed && Platform.OS === 'ios' ? { opacity: 0.85 } : null]}>
                              <Text style={{ color: C.text, fontWeight: '800', fontSize: 12 }}>{m}</Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      <Text style={[styles.inputLabel, { color: C.sub, marginTop: 10 }]}>Referencia (opcional)</Text>
                      <TextInput value={pagoReferencia} onChangeText={setPagoReferencia} placeholder="Ej: #boleta" placeholderTextColor={C.sub} style={[styles.input, { color: C.text, borderColor: C.border, backgroundColor: C.inputBg }]} />

                      <Text style={[styles.inputLabel, { color: C.sub, marginTop: 10 }]}>Comentario (opcional)</Text>
                      <TextInput value={pagoComentario} onChangeText={setPagoComentario} placeholder="Nota breve" placeholderTextColor={C.sub} style={[styles.input, { color: C.text, borderColor: C.border, backgroundColor: C.inputBg }]} />

                      <View style={{ marginTop: 12 }}>
                        <View style={styles.rowBetween}>
                          <Text style={[styles.inputLabel, { color: C.sub }]}>Comprobante (imagen)</Text>
                          <Pressable onPress={() => { Keyboard.dismiss(); pickComprobante(); }} style={({ pressed }) => [styles.linkBtnSmall, { borderColor: C.border, backgroundColor: C.mutedBg }, pressed && Platform.OS === 'ios' ? { opacity: 0.85 } : null]}>
                            <Text style={[styles.linkBtnTextSmall, { color: C.text }]}>{pagoImg?.uri ? 'Cambiar' : 'Agregar'}</Text>
                          </Pressable>
                        </View>
                        {pagoImg?.uri ? <Text style={{ color: C.sub, marginTop: 8 }}>Se subirá junto con el pago</Text> : null}
                      </View>

                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                        <AppButton title="Cancelar" variant="outline" onPress={() => { Keyboard.dismiss(); setPagoModal(false); }} disabled={savingPago} style={{ flex: 1, minHeight: 48 } as any} />
                        <AppButton title="Guardar" variant="primary" onPress={() => { Keyboard.dismiss(); guardarPago(); }} loading={savingPago} style={{ flex: 1, minHeight: 48, backgroundColor: C.primary, borderColor: C.primary } as any} />
                      </View>
                    </View>
                  </TouchableWithoutFeedback>
                </ScrollView>
              </KeyboardAvoidingView>
            </View>
          </TouchableWithoutFeedback>
        </Modal>



        {/* Viewer comprobante */}
        <Modal transparent visible={viewerOpen} animationType="fade" onRequestClose={() => setViewerOpen(false)}>
          <View style={[styles.modalBg, { backgroundColor: "rgba(0,0,0,0.8)" }]}>
            <View style={styles.viewerCard}>
              <Pressable onPress={() => setViewerOpen(false)} style={({ pressed }) => [styles.viewerClose, pressed ? { opacity: 0.8 } : null]}>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Cerrar</Text>
              </Pressable>

              <Pressable onPress={() => downloadViewerImage()} style={({ pressed }) => [styles.viewerDownload, pressed ? { opacity: 0.85 } : null]}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>{savingDownload ? "..." : "Descargar"}</Text>
              </Pressable>

              {!(viewerUrl || viewerRemoteUrl) ? (
                <View style={[styles.center, { paddingTop: 18 }]}>
                  <Text style={{ color: "rgba(255,255,255,0.85)", fontWeight: "700" }}>Cargando...</Text>
                </View>
              ) : (
                <ScrollView
                  style={styles.viewerScroll}
                  contentContainerStyle={styles.viewerScrollContent}
                  maximumZoomScale={3}
                  minimumZoomScale={1}
                  showsHorizontalScrollIndicator={false}
                  showsVerticalScrollIndicator={false}
                >
                  <ExpoImage
                    source={{ uri: viewerUrl ?? viewerRemoteUrl!, headers: { "Cache-Control": "no-cache" } }}
                    style={styles.viewerImg}
                    contentFit="contain"
                    cachePolicy="none"
                    onError={(e) => {
                      const msg = (e as any)?.error ?? "Image data is nil";
                      Alert.alert("No se pudo cargar", String(msg));
                    }}
                  />
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        <DoneAccessory nativeID={"doneAccessory"} />
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardBase: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 16 },
  shadowCard: Platform.select({ ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }, android: { elevation: 2 }, default: {} }),
  headerCard: { padding: 16 },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  h1: { fontSize: 20, fontWeight: '700', letterSpacing: -0.2, lineHeight: 24 },
  metaK: { fontSize: 12, fontWeight: '600' },
  metaV: { marginTop: 2, fontSize: 14, fontWeight: '600', lineHeight: 18 },
  badgePill: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  kvGrid: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  kv: { minWidth: 130 },
  k: { fontSize: 12, fontWeight: '600' },
  v: { marginTop: 3, fontSize: 14, fontWeight: '600', lineHeight: 18 },
  sectionTitle: { marginTop: 18, fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700', flex: 1, paddingRight: 10, lineHeight: 20 },
  lineAmt: { fontSize: 14, fontWeight: '800' },
  lineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  lineSub: { fontSize: 12, fontWeight: '700' },
  lineSubV: { fontSize: 12, fontWeight: '800' },
  miniK: { fontSize: 12, fontWeight: '600', minWidth: 56 },
  miniV: { fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 10 },
  payTitle: { fontSize: 14, fontWeight: '700', flex: 1, paddingRight: 8 },
  payAmount: { fontSize: 14, fontWeight: '800' },
  payMeta: { marginTop: 4, fontSize: 12, fontWeight: '600' },
  modalBg: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  modalCard: { width: '100%', borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  modalSub: { marginTop: 4, fontSize: 13, fontWeight: '600' },
  inputLabel: { fontSize: 13, fontWeight: '700', marginTop: 8 },
  input: { marginTop: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  linkBtnSmall: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12 },
  linkBtnTextSmall: { fontSize: 12, fontWeight: '700' },
  viewerCard: { flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  viewerClose: { position: 'absolute', top: 40, right: 24, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 1000, elevation: 20 },
  viewerDownload: { position: 'absolute', top: 40, left: 24, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 1000, elevation: 20 },
  viewerScroll: { flex: 1, alignSelf: 'stretch', width: '100%' },
  viewerScrollContent: { flexGrow: 1, minHeight: 320, justifyContent: 'center', alignItems: 'center' },
  viewerImg: { flex: 1, width: '100%', minHeight: 320 },
});
