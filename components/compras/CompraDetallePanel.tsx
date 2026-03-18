// components/compras/CompraDetallePanel.tsx
// Embeddable panel version of app/compra-detalle.tsx for the split master-detail layout.

import { useFocusEffect, useTheme } from "@react-navigation/native";
import * as FileSystem from "expo-file-system/legacy";
import { Image as ExpoImage } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
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
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import ImageViewer from "react-native-image-zoom-viewer";
import { useEmpresaActiva } from "../../lib/useEmpresaActiva";
import { useRole } from "../../lib/useRole";
import { supabase } from "../../lib/supabase";
import { useThemePref } from "../../lib/themePreference";
import { alphaColor } from "../../lib/ui";
import { AppButton } from "../ui/app-button";
import { DoneAccessory } from "../ui/done-accessory";
import { goBackSafe } from "../../lib/goBackSafe";
import { fmtQ, fmtDate } from "../../lib/utils/format";
import { normalizeUpper } from "../../lib/utils/text";
import { FB_DARK_DANGER } from "../../src/theme/headerColors";
import { CompraNuevaModal } from "./CompraNuevaModal";

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
  mimeType: string;
  fileName?: string | null;
};

type CompraDetallePanelProps = {
  compraId: number;
  embedded?: boolean;
  onRefresh?: () => void;
  onDeleted?: () => void;
};

type CompraDetallePanelContentProps = {
  embedded: boolean;
  compraIdProp: number;
  onRefresh?: () => void;
  onDeleted?: () => void;
};

function safeNumber(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
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

function makeComprobantePath(empresaId: number, compraId: number, mimeType: string) {
  const stamp = Date.now();
  const rnd = Math.random().toString(16).slice(2);
  const ext = extFromMime(mimeType);
  return `${empresaId}/compras/${compraId}/${stamp}-${rnd}.${ext}`;
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

  const safeStem = safeName.replace(/\.(jpe?g|png|webp|heic|heif)$/i, "");

  const extFromUrl = (() => {
    try {
      const u = new URL(remoteUrl);
      const p = (u.pathname || "").toLowerCase();
      const m = p.match(/\.(jpe?g|png|webp|heic|heif)$/);
      return m?.[1] ?? null;
    } catch {
      const p = String(remoteUrl).toLowerCase();
      const m = p.match(/\.(jpe?g|png|webp|heic|heif)(?:\?|#|$)/);
      return m?.[1] ?? null;
    }
  })();

  const target = `${baseDir}cmp_${safeStem}.${extFromUrl ?? "jpg"}`;

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

  return res.uri;
}

function base64ToUint8Array(base64: string) {
  const binary = globalThis.atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function uriToBytes(uri: string) {
  if (Platform.OS === "web") {
    const res = await fetch(uri);
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (!bytes.byteLength || bytes.byteLength < 16) {
      throw new Error("El archivo seleccionado está vacío o no se pudo leer.");
    }
    return bytes;
  }
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = base64ToUint8Array(b64);
  if (!bytes?.byteLength || bytes.byteLength < 16) {
    throw new Error("El archivo seleccionado está vacío o no se pudo leer.");
  }
  return bytes;
}

export function CompraDetallePanel({ compraId, embedded = false, onRefresh, onDeleted }: CompraDetallePanelProps) {
  if (embedded) {
    return <CompraDetallePanelContent embedded compraIdProp={compraId} onRefresh={onRefresh} onDeleted={onDeleted} />;
  }
  return <CompraDetallePanelWithParams fallbackCompraId={compraId} />;
}

function CompraDetallePanelWithParams({ fallbackCompraId }: { fallbackCompraId: number }) {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const idFromParams = id ? Number(id) : NaN;
  const resolvedId = Number.isFinite(idFromParams) && idFromParams > 0 ? idFromParams : fallbackCompraId;
  return <CompraDetallePanelContent embedded={false} compraIdProp={resolvedId} />;
}

function CompraDetallePanelContent({ embedded, compraIdProp, onRefresh, onDeleted }: CompraDetallePanelContentProps) {
  const DONE_ID = "doneAccessory";
  const insets = useSafeAreaInsets();
  const compraId = compraIdProp;

  const { colors } = useTheme();
  const { empresaActivaId, isReady: empresaReady } = useEmpresaActiva();
  const { role } = useRole();
  const canEditDelete = role !== "BODEGA";

  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  const C = useMemo(
    () => ({
      bg: colors.background ?? (isDark ? "#000" : "#fff"),
      card: colors.card ?? (isDark ? "#1C1C1E" : "#fff"),
      text: colors.text ?? (isDark ? "#fff" : "#111"),
      sub:
        alphaColor(String(colors.text ?? (isDark ? "#ffffff" : "#000000")), 0.65) ||
        (isDark ? "rgba(255,255,255,0.65)" : "#6b7280"),
      border: colors.border ?? (isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)"),
      primary: String(colors.primary ?? "#153c9e"),
      danger: FB_DARK_DANGER,
      ok: isDark ? "rgba(140,255,170,0.95)" : "#16a34a",
      warn: isDark ? "rgba(255,210,120,0.95)" : "#b45309",
      okBg: isDark ? "rgba(22,163,74,0.18)" : "rgba(22,163,74,0.10)",
      warnBg: isDark ? "rgba(180,83,9,0.18)" : "rgba(180,83,9,0.10)",
      mutedBg: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
      dangerBg: alphaColor(FB_DARK_DANGER, isDark ? 0.18 : 0.12),
      divider: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)",
      overlay: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)",
      inputBg: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)",
    }),
    [isDark, colors.background, colors.border, colors.card, colors.primary, colors.text]
  );

  const [loading, setLoading] = useState(true);
  const [compra, setCompra] = useState<Compra | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [thumbByPath, setThumbByPath] = useState<Record<string, string>>({});
  const thumbByPathRef = useRef<Record<string, string>>({});
  const [deleting, setDeleting] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const [pagoModal, setPagoModal] = useState(false);
  const [pagoMonto, setPagoMonto] = useState("");
  const [pagoMetodo, setPagoMetodo] = useState<
    "EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "OTRO"
  >("EFECTIVO");
  const [pagoReferencia, setPagoReferencia] = useState("");
  const [pagoComentario, setPagoComentario] = useState("");
  const [pagoImg, setPagoImg] = useState<PickedImage | null>(null);
  const [savingPago, setSavingPago] = useState(false);
  const [pagoError, setPagoError] = useState<string | null>(null);
  const [deletingPagoId, setDeletingPagoId] = useState<number | null>(null);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerRemoteUrl, setViewerRemoteUrl] = useState<string | null>(null);
  const [viewerRefRaw, setViewerRefRaw] = useState<string | null>(null);
  const [viewerSaving, setViewerSaving] = useState(false);
  const viewerBusyRef = useRef(false);

  useEffect(() => {
    const raws = (pagos ?? []).map((p) => p.comprobante_path).filter(Boolean) as string[];
    const norms = raws
      .map((r) => normalizeComprobanteRef(r))
      .filter((x): x is NonNullable<ReturnType<typeof normalizeComprobanteRef>> => x != null);

    const paths = norms
      .map((x) => x.path)
      .filter((p): p is string => typeof p === "string" && p.length > 0);

    const missing = Array.from(new Set(paths)).filter((p) => !thumbByPathRef.current[p]);
    if (!missing.length) return;

    let cancelled = false;

    (async () => {
      for (const p of missing) {
        if (cancelled) return;
        try {
          const { data, error } = await supabase.storage
            .from(BUCKET_COMPROBANTES)
            .createSignedUrl(p, 60 * 10);
          if (error) continue;
          const url = data?.signedUrl;
          if (!url) continue;

          setThumbByPath((prev) => {
            if (prev[p]) return prev;
            const next = { ...prev, [p]: url };
            thumbByPathRef.current = next;
            return next;
          });
        } catch {
          // ignore thumbs errors
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pagos]);

  const saldoNum = useMemo(
    () => safeNumber(compra?.saldo_pendiente),
    [compra?.saldo_pendiente]
  );

  const totalProductos = useMemo(() => {
    return (lineas ?? []).reduce((acc: number, d: any) => {
      const sub = d?.subtotal ?? safeNumber(d?.cantidad) * safeNumber(d?.precio_compra_unit);
      return acc + safeNumber(sub);
    }, 0);
  }, [lineas]);

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
    if (!empresaActivaId) return;

    setLoading(true);
    try {
      // Run independent queries in parallel (compras, compras_detalle, compras_pagos)
      const [compraRes, detalleRes, pagosRes] = await Promise.all([
        supabase
          .from("compras")
          .select(
            "id,fecha,numero_factura,tipo_pago,fecha_vencimiento,estado,monto_total,saldo_pendiente,comentarios,proveedor_id,proveedores(nombre)"
          )
          .eq("empresa_id", empresaActivaId)
          .eq("id", compraId)
          .maybeSingle(),
        supabase
          .from("compras_detalle")
          .select(
            "id,compra_id,producto_id,lote_id,cantidad,precio_compra_unit,subtotal,productos(nombre,image_path,marca_id,marcas(nombre)),producto_lotes(lote,fecha_exp)"
          )
          .eq("empresa_id", empresaActivaId)
          .eq("compra_id", compraId)
          .order("id", { ascending: true }),
        supabase
          .from("compras_pagos")
          .select("id,compra_id,fecha,monto,metodo,referencia,comprobante_path,comentario")
          .eq("empresa_id", empresaActivaId)
          .eq("compra_id", compraId)
          .order("fecha", { ascending: false }),
      ]);

      if (compraRes.error) throw compraRes.error;
      if (!compraRes.data) throw new Error("Compra no encontrada");
      if (detalleRes.error) throw detalleRes.error;
      if (pagosRes.error) throw pagosRes.error;

      const c = compraRes.data;
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

      const mapped: Linea[] = (detalleRes.data ?? []).map((r: any) => ({
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

      // stock_lotes depends on detalle loteIds — must run after detalle query
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
          .eq("empresa_id", empresaActivaId)
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
      setPagos((pagosRes.data ?? []) as any);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo cargar");
      setCompra(null);
      setLineas([]);
      setPagos([]);
    } finally {
      setLoading(false);
    }
  }, [compraId, empresaActivaId]);

  useFocusEffect(
    useCallback(() => {
      fetchAll();
    }, [fetchAll])
  );

  const doEliminarCompra = async () => {
    if (!compra) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc("rpc_compra_eliminar_compra", {
        p_compra_id: compra.id,
      });
      if (error) throw error;

      onDeleted?.();
      if (embedded) {
        Alert.alert("Listo", "Compra eliminada");
      } else {
        Alert.alert("Listo", "Compra eliminada", [
          { text: "OK", onPress: () => goBackSafe("/compras") },
        ]);
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo eliminar");
    } finally {
      setDeleting(false);
    }
  };

  const eliminarCompra = () => {
    if (!compra) return;
    if (deleting) return;

    if (Platform.OS === "web") {
      setConfirmDeleteOpen(true);
    } else {
      Alert.alert(
        "Eliminar compra",
        "⚠️ Esto revertirá el stock. Si el inventario ya fue consumido podrían quedar cantidades negativas. ¿Deseas continuar?",
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Eliminar", style: "destructive", onPress: doEliminarCompra },
        ]
      );
    }
  };

  const abrirPagoModal = () => {
    setPagoMonto("");
    setPagoMetodo("EFECTIVO");
    setPagoReferencia("");
    setPagoComentario("");
    setPagoImg(null);
    setPagoError(null);
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

    const path = makeComprobantePath(empresaActivaId!, compraIdLocal, pagoImg.mimeType);
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
    if (!compra || savingPago) return;
    if (!empresaActivaId) {
      setPagoError("Sin empresa activa. Contacta al administrador.");
      return;
    }

    const monto = safeNumber(pagoMonto);
    if (!(monto > 0)) {
      setPagoError("Ingresa un monto mayor a 0.");
      return;
    }
    if (normalizeUpper(compra.tipo_pago) !== "CREDITO") {
      setPagoError("Solo compras a crédito admiten pagos.");
      return;
    }

    setPagoError(null);
    setSavingPago(true);
    try {
      const comprobantePath = await subirComprobanteSiExiste(compra.id);

      const { error } = await supabase.rpc("rpc_compra_aplicar_pago", {
        p_compra_id: compra.id,
        p_monto: monto,
        p_metodo: pagoMetodo,
        p_referencia: pagoReferencia || null,
        p_comprobante_path: comprobantePath,
        p_comentario: pagoComentario || null,
      });

      if (error) throw error;

      setPagoModal(false);
      setPagoMonto("");
      setPagoReferencia("");
      setPagoComentario("");
      setPagoImg(null);
      await fetchAll();
      if (onRefresh) onRefresh();
    } catch (e: any) {
      setPagoError(e?.message ?? "No se pudo aplicar el pago.");
    } finally {
      setSavingPago(false);
    }
  };

  const eliminarPago = async (pagoId: number) => {
    if (deletingPagoId) return;
    setDeletingPagoId(pagoId);
    try {
      const { error } = await supabase.rpc("rpc_compra_eliminar_pago", { p_pago_id: pagoId });
      if (error) throw error;
      await fetchAll();
      if (onRefresh) onRefresh();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo eliminar el pago.");
    } finally {
      setDeletingPagoId(null);
    }
  };

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
    setViewerRefRaw(raw);
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

  const getViewerRemoteUrlFresh = useCallback(async () => {
    if (!viewerRefRaw) return null;
    const norm = normalizeComprobanteRef(viewerRefRaw);
    if (!norm) return null;

    if (norm.url) return norm.url;
    if (!norm.path) return null;

    const { data, error } = await supabase.storage
      .from(BUCKET_COMPROBANTES)
      .createSignedUrl(norm.path, 60 * 10);
    if (error) throw error;
    return data?.signedUrl ?? null;
  }, [viewerRefRaw]);

  const descargarComprobante = useCallback(async () => {
    if (viewerSaving) return;
    if (Platform.OS === "web") {
      Alert.alert("No disponible", "La descarga a galería no está disponible en web.");
      return;
    }

    setViewerSaving(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permiso requerido", "Permite acceso a tu galería para guardar el comprobante.");
        return;
      }

      let localUri = viewerUrl;
      if (!localUri) {
        const remote = viewerRemoteUrl ?? (await getViewerRemoteUrlFresh());
        if (!remote) throw new Error("No se encontró URL del comprobante.");

        const probe = await probeImageUrl(remote, 512);
        if (!probe.ok) throw new Error(`HTTP ${probe.status || "?"} al descargar.`);
        if (!probe.looksLikeImage)
          throw new Error(`No es imagen. content-type=\"${probe.contentType || "?"}\"`);
        if (!probe.minOk) throw new Error(`Respuesta vacía (${probe.bytes} bytes).`);

        localUri = await downloadToCache(probe.url);
        setViewerRemoteUrl(probe.url);
        setViewerUrl(localUri);
      }

      const asset = await MediaLibrary.createAssetAsync(localUri);

      try {
        const albumName = "BrosPharma";
        const existing = await MediaLibrary.getAlbumAsync(albumName);
        if (!existing) {
          await MediaLibrary.createAlbumAsync(albumName, asset, false);
        } else {
          await MediaLibrary.addAssetsToAlbumAsync([asset], existing, false);
        }
      } catch {
        // ignore
      }

      Alert.alert("Listo", "Comprobante guardado en tu galería.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo guardar el comprobante");
    } finally {
      setViewerSaving(false);
    }
  }, [getViewerRemoteUrlFresh, viewerRemoteUrl, viewerSaving, viewerUrl]);

  return (
    <>
      {!embedded && (
        <Stack.Screen
          options={{
            headerShown: true,
            title: "Detalle compra",
            headerBackTitle: "Atrás",
          }}
        />
      )}

      <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
        {loading ? (
          <View style={[styles.center, { paddingTop: 18 }]}>
            <Text style={{ color: C.sub, fontWeight: "700" }}>Cargando...</Text>
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
              width: "100%",
              alignItems: "stretch",
              paddingTop: 12,
              paddingHorizontal: 16,
              paddingBottom: 12 + insets.bottom + 104,
            }}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
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
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.h1, { color: C.text }]} numberOfLines={2}>
                    {compra.proveedor_nombre ?? `Proveedor #${compra.proveedor_id}`}
                  </Text>
                </View>

                <View
                  style={[
                    styles.badgePill,
                    {
                      backgroundColor: badgeStyle.bg,
                      borderColor: alphaColor(badgeStyle.color, isDark ? 0.32 : 0.22) || C.border,
                    },
                  ]}
                >
                  <Text style={[styles.badgeText, { color: badgeStyle.color }]}>{badge.text}</Text>
                </View>
              </View>

              <View style={[styles.kvGrid, { marginTop: 12 }]}>
                <View style={styles.kv}>
                  <Text style={[styles.k, { color: C.sub }]}>Factura</Text>
                  <Text style={[styles.v, { color: C.text }]} numberOfLines={1}>
                    {compra.numero_factura ?? "—"}
                  </Text>
                </View>

                <View style={styles.kv}>
                  <Text style={[styles.k, { color: C.sub }]}>Fecha</Text>
                  <Text style={[styles.v, { color: C.text }]} numberOfLines={1}>
                    {fmtDate(compra.fecha)}
                  </Text>
                </View>

                <View style={styles.kv}>
                  <Text style={[styles.k, { color: C.sub }]}>Tipo</Text>
                  <Text style={[styles.v, { color: C.text }]} numberOfLines={1}>
                    {normalizeUpper(compra.tipo_pago) || "—"}
                  </Text>
                </View>

                {normalizeUpper(compra.tipo_pago) === "CREDITO" ? (
                  <View style={styles.kv}>
                    <Text style={[styles.k, { color: C.sub }]}>Vencimiento</Text>
                    <Text style={[styles.v, { color: C.text }]} numberOfLines={1}>
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
              <View style={[styles.tableWrap, styles.shadowCard, { borderColor: C.border, backgroundColor: C.card, marginTop: 12 }]}>
                <View
                  style={[
                    styles.tableHeaderRow,
                    {
                      borderBottomColor: C.divider,
                      backgroundColor: C.mutedBg,
                    },
                  ]}
                >
                  <Text style={[styles.th, { color: C.sub, flex: 1 }]}>Detalle</Text>
                  <Text style={[styles.th, { color: C.sub, width: 140, textAlign: "right" }]}>Importe</Text>
                </View>

                {lineas.map((d: any, idx: number) => {
                  const nombre = d.producto_nombre ?? `Producto #${d.producto_id}`;
                  const lote = String(d.lote ?? "—");
                  const venc = fmtDate(d.fecha_exp);
                  const cant = safeNumber(d.cantidad);
                  const unit = safeNumber(d.precio_compra_unit);

                  return (
                    <View key={String(d.detalle_id ?? idx)} style={[styles.tableRow, { borderTopColor: C.divider }]}>
                      <View style={{ flex: 1, paddingRight: 10, minWidth: 0 }}>
                        <Text style={[styles.td, { color: C.text }]} numberOfLines={2}>
                          {idx + 1}. {nombre}
                        </Text>
                        {d.producto_marca ? (
                          <Text style={[styles.tdSub, { color: C.sub }]} numberOfLines={1}>
                            {d.producto_marca}
                          </Text>
                        ) : null}
                        <Text style={[styles.tdSub, { color: C.sub }]} numberOfLines={1}>
                          Lote: {lote}
                        </Text>
                        <Text style={[styles.tdSub, { color: C.sub }]} numberOfLines={1}>
                          Venc: {venc}
                        </Text>
                      </View>

                      <View style={{ width: 140, paddingLeft: 8, alignItems: "flex-end" }}>
                        <Text style={[styles.td, { color: C.text }]} numberOfLines={1}>
                          {cant} x {fmtQ(unit)}
                        </Text>
                      </View>
                    </View>
                  );
                })}

                <View style={[styles.tableFooterRow, { borderTopColor: C.divider, backgroundColor: C.mutedBg }]}>
                  <Text style={[styles.td, { color: C.sub, flex: 1 }]}>Total</Text>
                  <Text style={[styles.td, { color: C.text, width: 140, textAlign: "right" }]}>
                    {fmtQ(compra?.monto_total ?? totalProductos)}
                  </Text>
                </View>
              </View>
            )}

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
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                              <Text style={[styles.payAmount, { color: C.text }]}>
                                {fmtQ(p.monto)}
                              </Text>
                              <Pressable
                                onPress={() => {
                                  if (Platform.OS === "web") {
                                    if (window.confirm("¿Eliminar este pago?")) eliminarPago(p.id);
                                  } else {
                                    Alert.alert("Eliminar pago", `¿Eliminar pago de ${fmtQ(p.monto)}?`, [
                                      { text: "Cancelar", style: "cancel" },
                                      { text: "Eliminar", style: "destructive", onPress: () => eliminarPago(p.id) },
                                    ]);
                                  }
                                }}
                                disabled={deletingPagoId === p.id}
                                style={({ pressed }) => ({ opacity: pressed || deletingPagoId === p.id ? 0.4 : 1, padding: 4 })}
                              >
                                <Text style={{ color: "#e53e3e", fontSize: 13, fontWeight: "700" }}>
                                  {deletingPagoId === p.id ? "..." : "✕"}
                                </Text>
                              </Pressable>
                            </View>
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

                          {hasComprobante ? (() => {
                            const norm = normalizeComprobanteRef(p.comprobante_path!);
                            const thumbUrl =
                              norm?.path ? thumbByPath[norm.path] ?? null : norm?.url ?? null;

                            return (
                              <Pressable
                                onPress={() => abrirComprobante(p.comprobante_path!)}
                                style={({ pressed }) => [
                                  styles.receiptBtn,
                                  { borderColor: C.border, backgroundColor: C.mutedBg },
                                  pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
                                ]}
                              >
                                {thumbUrl ? (
                                  <ExpoImage
                                    source={{ uri: thumbUrl }}
                                    style={styles.receiptThumb}
                                    contentFit="cover"
                                    cachePolicy="disk"
                                  />
                                ) : (
                                  <View
                                    style={[
                                      styles.receiptThumbPlaceholder,
                                      { borderColor: C.border, backgroundColor: "rgba(0,0,0,0.06)" },
                                    ]}
                                  >
                                    <Text style={[styles.receiptThumbText, { color: C.sub }]}>IMG</Text>
                                  </View>
                                )}

                                <View style={{ flex: 1 }}>
                                  <Text style={[styles.linkBtnText, { color: C.text }]}>
                                    Comprobante
                                  </Text>
                                </View>
                              </Pressable>
                            );
                          })() : null}

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
                    <Text style={[styles.v, { color: C.text }]}>{fmtQ(compra.saldo_pendiente)}</Text>
                  </View>

                  {canEditDelete && (
                    <AppButton
                      title={saldoNum <= 0 ? "Compra pagada" : "Aplicar pago"}
                      onPress={abrirPagoModal}
                      disabled={saldoNum <= 0}
                      variant="primary"
                      androidRipple={Platform.OS === "android" ? { color: "rgba(255,255,255,0.18)" } : undefined}
                      style={{
                        backgroundColor: C.primary,
                        borderColor: C.primary,
                        marginTop: 12,
                        opacity: saldoNum <= 0 ? 0.5 : 1,
                      } as any}
                    />
                  )}
                </View>
              </>
            ) : null}

            <View style={{ height: 12 }} />
          </ScrollView>
        )}

        {/* Bottom actions */}
        {!loading && compra && canEditDelete ? (
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
            <AppButton
              title="Editar"
              onPress={() => {
                if (Platform.OS === "web") {
                  setEditModalOpen(true);
                } else {
                  router.push({
                    pathname: "/compra-nueva",
                    params: { editId: String(compra.id) },
                  });
                }
              }}
              variant="primary"
              androidRipple={Platform.OS === "android" ? { color: "rgba(255,255,255,0.18)" } : undefined}
              style={{ flex: 1, minHeight: 48, backgroundColor: C.primary, borderColor: C.primary } as any}
            />

            <AppButton
              title={deleting ? "Eliminando..." : "Eliminar"}
              onPress={eliminarCompra}
              disabled={deleting}
              variant="danger"
              androidRipple={Platform.OS === "android" ? { color: "rgba(140, 38, 38, 0.1)" } : undefined}
              style={{ flex: 1, minHeight: 48 } as any}
            />
          </View>
        ) : null}

        {/* Modal: Aplicar pago */}
        {pagoModal ? (
          <Modal
            transparent
            visible={pagoModal}
            animationType="fade"
            onRequestClose={() => setPagoModal(false)}
          >
            <View
              style={
                Platform.OS === "web"
                  ? [styles.modalBgWeb, { backgroundColor: C.overlay }]
                  : [styles.modalBg, { backgroundColor: C.overlay }]
              }
            >
              <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} />
              <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                style={{ width: "100%", maxWidth: Platform.OS === "web" ? 480 : undefined }}
                keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
              >
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  contentContainerStyle={{ paddingBottom: 12 }}
                  showsVerticalScrollIndicator={false}
                  automaticallyAdjustKeyboardInsets
                >
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
                          inputAccessoryViewID={Platform.OS === "ios" ? DONE_ID : undefined}
                          returnKeyType="next"
                          blurOnSubmit={false}
                          style={[
                            styles.input,
                            { color: C.text, borderColor: C.border, backgroundColor: C.inputBg },
                          ]}
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

                        <View style={{ marginTop: 14 }}>
                          <Text style={[styles.inputLabel, { color: C.sub, marginBottom: 8 }]}>Comprobante (opcional)</Text>
                          <Pressable
                            onPress={() => {
                              Keyboard.dismiss();
                              pickComprobante();
                            }}
                            style={({ pressed }) => [
                              styles.uploadZone,
                              { borderColor: C.border, backgroundColor: C.mutedBg },
                              pressed ? { opacity: 0.75 } : null,
                            ]}
                          >
                            {pagoImg?.uri ? (
                              <>
                                <ExpoImage
                                  source={{ uri: pagoImg.uri }}
                                  style={styles.previewImg}
                                  contentFit="cover"
                                  cachePolicy="disk"
                                />
                                <View style={styles.uploadZoneOverlay}>
                                  <Text style={styles.uploadZoneOverlayText}>Cambiar imagen</Text>
                                </View>
                              </>
                            ) : (
                              <>
                                <Text style={{ fontSize: 28, marginBottom: 6 }}>📎</Text>
                                <Text style={[styles.uploadZoneLabel, { color: C.text }]}>Agregar comprobante</Text>
                                <Text style={[styles.uploadZoneSub, { color: C.sub }]}>JPG, PNG o PDF</Text>
                              </>
                            )}
                          </Pressable>
                        </View>

                        {pagoError ? (
                          <Text style={{ color: "#e53e3e", fontSize: 13, marginTop: 10, textAlign: "center" }}>
                            {pagoError}
                          </Text>
                        ) : null}

                        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                          <AppButton
                            title="Cancelar"
                            variant="outline"
                            onPress={() => {
                              Keyboard.dismiss();
                              setPagoModal(false);
                            }}
                            disabled={savingPago}
                            style={{ flex: 1, minHeight: 48 } as any}
                          />

                          <AppButton
                            title="Guardar"
                            variant="primary"
                            onPress={() => {
                              Keyboard.dismiss();
                              guardarPago();
                            }}
                            loading={savingPago}
                            style={{ flex: 1, minHeight: 48, backgroundColor: C.primary, borderColor: C.primary } as any}
                          />
                        </View>
                  </View>
                </ScrollView>
              </KeyboardAvoidingView>
            </View>
          </Modal>
        ) : null}

        {/* Viewer */}
        {viewerOpen ? (
          <Modal
            transparent
            visible={viewerOpen}
            animationType="fade"
            onRequestClose={() => setViewerOpen(false)}
          >
            <View style={[styles.viewerBg, { backgroundColor: "rgba(0,0,0,0.75)" }]}>
              <View style={styles.viewerCard}>
                <View style={[styles.viewerTopBar, { top: Math.max(12, insets.top + 10) }]}>
                  <Pressable
                    onPress={() => setViewerOpen(false)}
                    style={({ pressed }) => [styles.viewerTopBtn, pressed ? { opacity: 0.8 } : null]}
                  >
                    <Text style={styles.viewerTopBtnText}>Cerrar</Text>
                  </Pressable>

                  <Pressable
                    onPress={descargarComprobante}
                    disabled={viewerSaving}
                    style={({ pressed }) => [
                      styles.viewerTopBtn,
                      viewerSaving ? { opacity: 0.6 } : null,
                      pressed ? { opacity: 0.8 } : null,
                    ]}
                  >
                    <Text style={styles.viewerTopBtnText}>{viewerSaving ? "Guardando..." : "Descargar"}</Text>
                  </Pressable>
                </View>

                {!(viewerUrl || viewerRemoteUrl) ? (
                  <View style={[styles.center, { paddingTop: 18 }]}>
                    <Text style={{ color: "rgba(255,255,255,0.85)", fontWeight: "700" }}>Cargando...</Text>
                  </View>
                ) : (
                  <ImageViewer
                    imageUrls={[{ url: viewerUrl ?? viewerRemoteUrl! }]}
                    enableSwipeDown
                    onSwipeDown={() => setViewerOpen(false)}
                    onCancel={() => setViewerOpen(false)}
                    renderIndicator={() => <View />}
                    backgroundColor="transparent"
                    saveToLocalByLongPress={false}
                  />
                )}
              </View>
            </View>
          </Modal>
        ) : null}

        <DoneAccessory nativeID={DONE_ID} />

        {Platform.OS === "web" && confirmDeleteOpen ? (
          <Modal transparent visible animationType="fade" onRequestClose={() => setConfirmDeleteOpen(false)}>
            <View
              style={{
                position: "fixed" as any,
                top: 0, left: 0, right: 0, bottom: 0,
                alignItems: "center", justifyContent: "center",
                zIndex: 99999,
                backgroundColor: "rgba(0,0,0,0.5)",
              }}
            >
              <View style={{ width: 420, maxWidth: "90%" as any, borderRadius: 16, padding: 24, backgroundColor: C.card, borderWidth: 1, borderColor: C.border }}>
                <Text style={{ fontSize: 17, fontWeight: "700", color: C.text, marginBottom: 10 }}>
                  ¿Eliminar esta compra?
                </Text>
                <Text style={{ fontSize: 14, color: C.warn, fontWeight: "600", marginBottom: 8 }}>
                  ⚠️ Advertencia
                </Text>
                <Text style={{ fontSize: 14, color: C.sub, lineHeight: 20, marginBottom: 20 }}>
                  Esta acción revertirá el stock ingresado por esta compra. Si los productos ya fueron vendidos o consumidos, el inventario podría quedar en cantidades negativas.{"\n\n"}¿Deseas continuar?
                </Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Pressable
                    onPress={() => setConfirmDeleteOpen(false)}
                    style={({ pressed }) => ({
                      flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center" as any,
                      backgroundColor: C.mutedBg, opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ fontWeight: "700", color: C.text }}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { setConfirmDeleteOpen(false); doEliminarCompra(); }}
                    disabled={deleting}
                    style={({ pressed }) => ({
                      flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center" as any,
                      backgroundColor: C.dangerBg, opacity: pressed || deleting ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ fontWeight: "700", color: C.danger }}>
                      {deleting ? "Eliminando..." : "Eliminar"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        {Platform.OS === "web" && compra ? (
          <CompraNuevaModal
            visible={editModalOpen}
            onClose={() => setEditModalOpen(false)}
            onDone={() => {
              setEditModalOpen(false);
              fetchAll();
              onRefresh?.();
            }}
            isDark={isDark}
            colors={{ card: C.card, text: C.text, border: C.border, sub: C.sub }}
            editId={String(compra.id)}
          />
        ) : null}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  cardBase: {
    width: "100%",
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

  h1: { fontSize: 20, fontWeight: "700", letterSpacing: -0.2, lineHeight: 24 },

  badgePill: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  badgeText: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },

  kvGrid: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  kv: { minWidth: 140, flexBasis: 140, flexGrow: 1 },

  k: { fontSize: 12, fontWeight: "600" },
  v: { marginTop: 3, fontSize: 14, fontWeight: "600", lineHeight: 18 },
  note: { marginTop: 6, fontSize: 14, fontWeight: "600", lineHeight: 20 },

  divider: { height: StyleSheet.hairlineWidth, marginVertical: 14 },

  totalRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  total: { fontSize: 26, fontWeight: "800", marginTop: 4, letterSpacing: -0.5 },
  totalSmall: { fontSize: 17, fontWeight: "800", marginTop: 4 },

  sectionTitle: { marginTop: 18, fontSize: 18, fontWeight: "700", letterSpacing: -0.2 },

  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  cardTitle: { fontSize: 16, fontWeight: "700", flex: 1, paddingRight: 10, lineHeight: 20 },

  tableWrap: { width: "100%", borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, overflow: "hidden" },
  tableHeaderRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  tableRow: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  tableFooterRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth },
  th: { fontSize: 11, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  td: { fontSize: 13, fontWeight: "800" },
  tdSub: { marginTop: 2, fontSize: 12, fontWeight: "700" },

  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
    flexDirection: "row",
    alignItems: "center",
  },

  payTitle: { fontSize: 14, fontWeight: "700", flex: 1, paddingRight: 8 },
  payAmount: { fontSize: 14, fontWeight: "800" },
  payMeta: { marginTop: 4, fontSize: 12, fontWeight: "600" },

  linkBtnText: { fontSize: 12, fontWeight: "700" },

  receiptBtn: {
    marginTop: 10,
    alignSelf: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 220,
  },
  receiptThumb: { width: 46, height: 46, borderRadius: 12 },
  receiptThumbPlaceholder: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  receiptThumbText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.2 },

  modalBg: { flex: 1, alignItems: "center", justifyContent: "center", padding: 18 },
  modalBgWeb: {
    position: "fixed" as any,
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    zIndex: 9999,
  },
  modalCard: {
    width: "100%",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: "800", letterSpacing: -0.2 },
  modalSub: { marginTop: 4, fontSize: 13, fontWeight: "600" },

  inputLabel: { fontSize: 12, fontWeight: "700" },
  input: {
    marginTop: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: "600",
  },

  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },

  linkBtnSmall: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  linkBtnTextSmall: { fontSize: 12, fontWeight: "700" },

  previewWrap: {
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 10,
    alignItems: "center",
  },
  previewImg: { width: "100%", height: 160, borderRadius: 10 },

  uploadZone: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 14,
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    minHeight: 100,
  },
  uploadZoneLabel: { fontSize: 14, fontWeight: "700" },
  uploadZoneSub: { fontSize: 12, fontWeight: "600", marginTop: 3 },
  uploadZoneOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingVertical: 8,
    alignItems: "center",
  },
  uploadZoneOverlayText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  viewerBg: { flex: 1 },
  viewerCard: { flex: 1 },
  viewerTopBar: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  viewerTopBtn: {
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  viewerTopBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
