import { useFocusEffect, useTheme } from "@react-navigation/native";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import { Stack, router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
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
import ImageViewer from "react-native-image-zoom-viewer";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/app-button";
import { DoneAccessory } from "../components/ui/done-accessory";
import { supabase } from "../lib/supabase";
import { useThemePref } from "../lib/themePreference";
import { alphaColor } from "../lib/ui";

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
      primary: String(colors.primary ?? "#153c9e"),

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
  const [pagoFacturaId, setPagoFacturaId] = useState<number | null>(null);
  const [facturaPickerOpen, setFacturaPickerOpen] = useState(false);
  const [pagoMonto, setPagoMonto] = useState("");
  type PagoMetodo = "EFECTIVO" | "TRANSFERENCIA" | "CHEQUE" | "TARJETA" | "OTRO";
  const [pagoMetodo, setPagoMetodo] = useState<PagoMetodo>("EFECTIVO");
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
        .select("id,venta_id,tipo,path,numero_factura,original_name,size_bytes,created_at,monto_total,fecha_vencimiento")
        .eq("venta_id", id)
        .order("created_at", { ascending: false });
      const frows = (f ?? []).map((r: any) => ({ ...r, path: normalizeStoragePath(r.path) }));
      setFacturas(frows);

      const { data: p } = await supabase
        .from("ventas_pagos")
        .select("id,venta_id,factura_id,fecha,monto,metodo,referencia,comprobante_path,comentario,created_by")
        .eq("venta_id", id)
        .order("fecha", { ascending: false });
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

  const saldoNum = useMemo(() => safeNumber(row?.saldo), [row?.saldo]);
  const totalProductos = useMemo(() => {
    return (lineas ?? []).reduce((acc: number, d: any) => {
      const sub = d?.subtotal ?? safeNumber(d?.cantidad) * safeNumber(d?.precio_venta_unit);
      return acc + safeNumber(sub);
    }, 0);
  }, [lineas]);

  const facturasById = useMemo(() => {
    const m = new Map<number, any>();
    for (const f of facturas ?? []) {
      const fid = Number((f as any)?.id);
      if (Number.isFinite(fid) && fid > 0) m.set(fid, f);
    }
    return m;
  }, [facturas]);

  const facturaLabel = (f: any) => {
    const n = String(f?.numero_factura ?? "").trim();
    const numero = n || `Factura #${String(f?.id ?? "").trim() || "—"}`;
    const montoRaw = f?.monto_total;
    const m = montoRaw == null ? NaN : safeNumber(montoRaw);
    if (Number.isFinite(m) && m > 0) return `${numero} · ${fmtQ(m)}`;

    if ((facturas?.length ?? 0) === 1) {
      const t = safeNumber(row?.total ?? totalProductos);
      if (Number.isFinite(t) && t > 0) return `${numero} · ${fmtQ(t)}`;
    }

    return numero;
  };

  const facturaMonto = useCallback(
    (f: any): number | null => {
      const montoRaw = f?.monto_total;
      const m = montoRaw == null ? NaN : safeNumber(montoRaw);
      if (Number.isFinite(m) && m > 0) return m;

      // fallback: si solo existe 1 factura y no tiene monto, usar total de la venta
      if ((facturas?.length ?? 0) === 1) {
        const t = safeNumber(row?.total ?? totalProductos);
        if (Number.isFinite(t) && t > 0) return t;
      }

      return null;
    },
    [facturas?.length, row?.total, totalProductos]
  );

  const pagadoPorFacturaId = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of pagos ?? []) {
      const fid = p?.factura_id == null ? NaN : Number(p.factura_id);
      if (!Number.isFinite(fid) || fid <= 0) continue;
      const monto = safeNumber(p?.monto);
      m.set(fid, (m.get(fid) ?? 0) + monto);
    }
    return m;
  }, [pagos]);

  const facturasPendientes = useMemo(() => {
    const TOL = 0.000001;
    return (facturas ?? []).filter((f: any) => {
      const fid = Number(f?.id);
      if (!Number.isFinite(fid) || fid <= 0) return false;
      const total = facturaMonto(f);
      const pagado = pagadoPorFacturaId.get(fid) ?? 0;
      if (total == null) return true;
      return total - pagado > TOL;
    });
  }, [facturas, facturaMonto, pagadoPorFacturaId]);

  const selectedFactura = useMemo(() => {
    if (!pagoFacturaId) return null;
    return facturasById.get(Number(pagoFacturaId)) ?? null;
  }, [facturasById, pagoFacturaId]);

  const guardarPago = async () => {
    if (!row) return;
    if (savingPago) return;
    const montoRaw = String(pagoMonto ?? "").trim();
    const monto = safeNumber(pagoMonto);
    if (!montoRaw) {
      Alert.alert("Falta monto", "El monto es obligatorio.");
      return;
    }
    if (!(monto > 0)) {
      Alert.alert("Monto inválido", "Ingresa un monto mayor a 0.");
      return;
    }

    if (!pagoFacturaId) {
      Alert.alert("Falta factura", "Selecciona la factura a la que aplicarás este pago.");
      return;
    }

    const isPendiente = (facturasPendientes ?? []).some((ff: any) => Number(ff?.id) === Number(pagoFacturaId));
    if (!isPendiente) {
      Alert.alert("Factura no pendiente", "La factura seleccionada ya está totalmente pagada.");
      return;
    }

    const f = facturasById.get(Number(pagoFacturaId)) ?? null;
    if (!f || Number(f?.venta_id) !== Number(row.venta_id)) {
      Alert.alert("Factura inválida", "La factura seleccionada no pertenece a esta venta.");
      return;
    }

    if (!pagoImg?.uri) {
      Alert.alert("Falta comprobante", "El comprobante es obligatorio.");
      return;
    }

    setSavingPago(true);
    try {
      const comprobantePath = await subirComprobanteSiExiste(Number(row.venta_id));
      const { error } = await supabase.rpc("rpc_venta_aplicar_pago", {
        p_venta_id: Number(row.venta_id),
        p_factura_id: Number(pagoFacturaId),
        p_monto: monto,
        p_metodo: pagoMetodo,
        p_referencia: pagoReferencia ? pagoReferencia : null,
        p_comprobante_path: comprobantePath,
        p_comentario: pagoComentario ? pagoComentario : null,
      });
      if (error) throw error;
      setFacturaPickerOpen(false);
      setPagoModal(false);
      setPagoFacturaId(null);
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

  const allowedMetodosPago = useMemo<readonly PagoMetodo[]>(() => {
    const r = normalizeUpper(role);
    if (r === "ADMIN") return ["EFECTIVO", "TRANSFERENCIA", "CHEQUE"] as const;
    return ["TRANSFERENCIA", "CHEQUE"] as const;
  }, [role]);

  useEffect(() => {
    // si cambia el rol o la lista permitida, asegurar que el método actual sea válido
    if (!allowedMetodosPago.length) return;
    if (!allowedMetodosPago.includes(pagoMetodo)) {
      setPagoMetodo(allowedMetodosPago[0]);
    }
  }, [allowedMetodosPago, pagoMetodo]);

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
  }, [viewerRemoteUrl, viewerUrl, viewerMimeType]);

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
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.h1, { color: C.text }]} numberOfLines={2}>{row.cliente_nombre ?? `Cliente #${row.cliente_id}`}</Text>
                </View>

                <View
                  style={[
                    styles.badgePill,
                    {
                      backgroundColor: saldoNum <= 0 ? C.okBg : C.warnBg,
                      borderColor: alphaColor(saldoNum <= 0 ? C.ok : C.warn, isDark ? 0.32 : 0.22) || C.border,
                    },
                  ]}
                >
                  <Text style={[styles.badgeText, { color: saldoNum <= 0 ? C.ok : C.warn }]}>{saldoNum <= 0 ? "PAGADA" : "PENDIENTE"}</Text>
                </View>
              </View>

              <View style={[styles.kvGrid, { marginTop: 12 }]}>
                <View style={styles.kv}><Text style={[styles.k, { color: C.sub }]}>Fecha de emisión</Text><Text style={[styles.v, { color: C.text }]} numberOfLines={1}>{fmtDate(row.fecha)}</Text></View>
                <View style={styles.kv}><Text style={[styles.k, { color: C.sub }]}>Vencimiento</Text><Text style={[styles.v, { color: C.text }]} numberOfLines={1}>{fmtDate(row.fecha_vencimiento)}</Text></View>
                <View style={styles.kv}><Text style={[styles.k, { color: C.sub }]}>Vendedor</Text><Text style={[styles.v, { color: C.text }]} numberOfLines={1}>{vendedorDisplay || shortUid(row.vendedor_id)}</Text></View>
              </View>

              <View style={[styles.divider, { backgroundColor: C.divider }]} />

              <View style={styles.kvGrid}>
                <View style={styles.kv}><Text style={[styles.k, { color: C.sub }]}>Total</Text><Text style={[styles.v, { color: C.text }]}>{fmtQ(row?.total)}</Text></View>
                <View style={styles.kv}><Text style={[styles.k, { color: C.sub }]}>Pagado</Text><Text style={[styles.v, { color: C.text }]}>{fmtQ(row?.pagado)}</Text></View>
                <View style={styles.kv}><Text style={[styles.k, { color: C.sub }]}>Saldo</Text><Text style={[styles.v, { color: C.text }]}>{fmtQ(row?.saldo)}</Text></View>
              </View>
            </View>

            <Text style={[styles.sectionTitle, { color: C.text }]}>Productos</Text>
            {lineas.length === 0 ? (
              <View style={[styles.cardBase, styles.shadowCard, { borderColor: C.border, backgroundColor: C.card, marginTop: 12 }]}><Text style={{ color: C.sub }}>Sin líneas</Text></View>
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

                {lineas.map((d: any) => {
                  const nombre = d.productos?.nombre ?? `Producto #${d.producto_id}`;
                  const marca = d.productos?.marcas?.nombre ?? d.productos?.marcas?.[0]?.nombre ?? null;
                  const title = `${String(nombre ?? "—")}${marca ? ` • ${marca}` : ""}`;
                  const lote = d.producto_lotes?.lote ?? "—";
                  const venc = fmtDate(d.producto_lotes?.fecha_exp);
                  const cant = safeNumber(d.cantidad);
                  const unit = safeNumber(d.precio_venta_unit);

                  return (
                    <View key={String(d.id)} style={[styles.tableRow, { borderTopColor: C.divider }]}>
                      <View style={{ flex: 1, paddingRight: 10, minWidth: 0 }}>
                        <Text style={[styles.td, { color: C.text }]} numberOfLines={1}>
                          {title}
                        </Text>
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
                    {fmtQ(row?.total ?? totalProductos)}
                  </Text>
                </View>
              </View>
            )}

            <Text style={[styles.sectionTitle, { color: C.text }]}>Facturas</Text>
            <View style={[styles.cardBase, styles.shadowCard, { borderColor: C.border, backgroundColor: C.card, marginTop: 12 }]}>
              {facturas.length === 0 ? (
                <Text style={{ color: C.sub }}>—</Text>
              ) : (
                facturas.slice(0, 2).map((f: any) => (
                  <View key={String(f.id)} style={{ paddingVertical: 10 }}>
                    <View style={styles.rowBetween}>
                      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, flex: 1, minWidth: 0, paddingRight: 10 }}>
                        <Text
                          selectable
                          selectionColor={C.primary}
                          style={[styles.payTitle, { color: C.text }]}
                          numberOfLines={1}
                        >
                          {String(f.numero_factura ?? "—")}
                        </Text>

                        {(() => {
                          const monto = facturaMonto(f);
                          return monto != null ? (
                            <Text style={[styles.payAmount, { color: C.text }]} numberOfLines={1}>
                              {fmtQ(monto)}
                            </Text>
                          ) : null;
                        })()}
                      </View>

                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
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
                  const pfid = p?.factura_id == null ? null : Number(p.factura_id);
                  const pf = pfid ? (facturasById.get(pfid) ?? null) : null;
                  const facturaNum = pf ? String(pf?.numero_factura ?? "").trim() : "";

                  return (
                    <View key={String(p.id)} style={{ paddingVertical: 10 }}>
                      <View style={styles.rowBetween}>
                        <Text style={[styles.payTitle, { color: C.text }]}>{fmtDate(p.fecha)} · {p.metodo ?? "—"}</Text>
                        <Text style={[styles.payAmount, { color: C.text }]}>{fmtQ(p.monto)}</Text>
                      </View>
                      {pfid ? (
                        <Text style={[styles.payMeta, { color: C.sub }]}>Factura: {facturaNum || `#${pfid}`}</Text>
                      ) : null}
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
                <AppButton
                  title="Aplicar pago"
                  onPress={() => {
                    // limpiar selección para evitar aplicar a factura equivocada
                    const only = (facturasPendientes ?? []).length === 1 ? Number((facturasPendientes as any[])[0]?.id) : null;
                    setPagoFacturaId(Number.isFinite(only as any) && (only as any) > 0 ? (only as any) : null);
                    // set default metodo segun rol
                    setPagoMetodo(allowedMetodosPago[0]);
                    setFacturaPickerOpen(false);
                    setPagoModal(true);
                  }}
                  disabled={false}
                  variant="primary"
                  style={{ marginTop: 12, backgroundColor: C.primary, borderColor: C.primary } as any}
                />
              ) : null}
            </View>

            <View style={{ height: 12 }} />
          </ScrollView>
        )}

        {/* Bottom actions not required */}

        {/* Modal: Aplicar pago */}
        {pagoModal ? (
          <Modal
            transparent
            visible={pagoModal}
            animationType="fade"
            onRequestClose={() => {
              setFacturaPickerOpen(false);
              setPagoModal(false);
            }}
          >
            <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
              <View style={[styles.modalBg, { backgroundColor: C.overlay }]}> 
                <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ width: '100%' }} keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}>
                  <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>
                    <TouchableWithoutFeedback onPress={() => {}} accessible={false}>
                      <View style={[styles.modalCard, styles.shadowCard, { backgroundColor: C.card, borderColor: C.border }]}> 
                      {facturaPickerOpen ? (
                        <>
                          <Text style={[styles.modalTitle, { color: C.text }]}>Seleccionar factura</Text>
                          <Text style={[styles.modalSub, { color: C.sub }]}>El pago se aplicará a la factura elegida.</Text>

                          {facturasPendientes.length === 0 ? (
                            <Text style={{ color: C.sub, marginTop: 12, fontWeight: "700" }}>No hay facturas pendientes para esta venta.</Text>
                          ) : (
                            <ScrollView style={{ maxHeight: 340, marginTop: 12 }} keyboardShouldPersistTaps="handled">
                              {facturasPendientes.map((f: any) => {
                                const fid = Number(f?.id);
                                const active = !!pagoFacturaId && fid === Number(pagoFacturaId);
                                const numero = String(f?.numero_factura ?? "").trim() || `Factura #${fid || "—"}`;
                                const venc = fmtDate(f?.fecha_vencimiento);
                                const monto = facturaMonto(f);
                                const meta = [
                                  monto != null && monto > 0 ? `Total: ${fmtQ(monto)}` : "",
                                ]
                                  .filter(Boolean)
                                  .join(" · ");
                                return (
                                  <Pressable
                                    key={String(fid)}
                                    onPress={() => {
                                      if (!fid) return;
                                      setPagoFacturaId(fid);
                                      setFacturaPickerOpen(false);
                                    }}
                                    style={({ pressed }) => [
                                      {
                                        borderWidth: StyleSheet.hairlineWidth,
                                        borderColor: active ? alphaColor(C.primary, 0.35) || C.border : C.border,
                                        backgroundColor: active ? C.mutedBg : "transparent",
                                        borderRadius: 14,
                                        paddingHorizontal: 12,
                                        paddingVertical: 12,
                                        marginBottom: 10,
                                      },
                                      pressed && Platform.OS === "ios" ? { opacity: 0.92 } : null,
                                    ]}
                                  >
                                    <Text style={{ color: C.text, fontWeight: "800" }} numberOfLines={1}>
                                      {numero}
                                    </Text>
                                    {meta ? (
                                      <Text style={{ color: C.sub, marginTop: 4, fontWeight: "700" }} numberOfLines={2}>
                                        {meta}
                                      </Text>
                                    ) : null}
                                  </Pressable>
                                );
                              })}
                            </ScrollView>
                          )}

                          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                            <AppButton
                              title="Volver"
                              variant="outline"
                              onPress={() => {
                                Keyboard.dismiss();
                                setFacturaPickerOpen(false);
                              }}
                              style={{ flex: 1, minHeight: 48 } as any}
                            />
                          </View>
                        </>
                      ) : (
                        <>
                          <Text style={[styles.modalTitle, { color: C.text }]}>Aplicar pago</Text>
                          <Text style={[styles.modalSub, { color: C.sub }]}>Saldo: {fmtQ(row?.saldo)}</Text>

                          {facturasPendientes.length === 0 ? (
                            <Text style={{ color: C.sub, marginTop: 10, fontWeight: "700" }}>No hay facturas pendientes para esta venta.</Text>
                          ) : null}

                          <Text style={[styles.inputLabel, { color: C.sub, marginTop: 10 }]}>Factura</Text>
                          <Pressable
                            onPress={() => {
                              Keyboard.dismiss();
                              setFacturaPickerOpen(true);
                            }}
                            disabled={facturasPendientes.length === 0}
                            style={({ pressed }) => [
                              styles.input,
                              {
                                borderColor: C.border,
                                backgroundColor: C.inputBg,
                                justifyContent: "center",
                                opacity: facturasPendientes.length === 0 ? 0.55 : 1,
                              },
                              pressed && Platform.OS === "ios" ? { opacity: 0.92 } : null,
                            ]}
                          >
                            <Text style={{ color: selectedFactura ? C.text : C.sub, fontWeight: "700" }} numberOfLines={1}>
                              {selectedFactura ? facturaLabel(selectedFactura) : "Seleccionar factura"}
                            </Text>
                          </Pressable>

                          <Text style={[styles.inputLabel, { color: C.sub }]}>Monto</Text>
                          <TextInput value={pagoMonto} onChangeText={setPagoMonto} placeholder="0.00" placeholderTextColor={C.sub} keyboardType="decimal-pad" inputAccessoryViewID={Platform.OS === "ios" ? 'doneAccessory' : undefined} style={[styles.input, { color: C.text, borderColor: C.border, backgroundColor: C.inputBg }]} />

                          <Text style={[styles.inputLabel, { color: C.sub, marginTop: 10 }]}>Método</Text>
                          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                            {allowedMetodosPago.map((m) => {
                              const active = pagoMetodo === m;
                              return (
                                <Pressable key={m} onPress={() => { Keyboard.dismiss(); setPagoMetodo(m); }} style={({ pressed }) => [styles.chip, { borderColor: C.border, backgroundColor: active ? C.mutedBg : 'transparent' }, pressed && Platform.OS === 'ios' ? { opacity: 0.85 } : null]}>
                                  <Text style={{ color: C.text, fontWeight: '800', fontSize: 12 }}>{m}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                          {normalizeUpper(role) !== "ADMIN" ? (
                            <Text style={{ color: C.sub, marginTop: 6, fontWeight: "600", fontSize: 12 }}>
                              Solo administradores pueden registrar pagos en efectivo.
                            </Text>
                          ) : null}

                          <Text style={[styles.inputLabel, { color: C.sub, marginTop: 10 }]}>Referencia (opcional)</Text>
                          <TextInput value={pagoReferencia} onChangeText={setPagoReferencia} placeholder="Ej: #boleta #cheque" placeholderTextColor={C.sub} style={[styles.input, { color: C.text, borderColor: C.border, backgroundColor: C.inputBg }]} />

                          <Text style={[styles.inputLabel, { color: C.sub, marginTop: 10 }]}>Comentario (opcional)</Text>
                          <TextInput value={pagoComentario} onChangeText={setPagoComentario} placeholder="Nota breve" placeholderTextColor={C.sub} style={[styles.input, { color: C.text, borderColor: C.border, backgroundColor: C.inputBg }]} />

                          <View style={{ marginTop: 12 }}>
                            <Text style={[styles.inputLabel, { color: C.sub }]}>Comprobante (requerido)</Text>

                            <Pressable
                              onPress={() => {
                                Keyboard.dismiss();
                                pickComprobante();
                              }}
                              style={({ pressed }) => {
                                const has = !!pagoImg?.uri;
                                const primaryBorder = alphaColor(C.primary, isDark ? 0.45 : 0.35) || C.border;
                                const primaryBg = alphaColor(C.primary, isDark ? 0.14 : 0.08) || C.mutedBg;
                                return [
                                  styles.comprobanteCta,
                                  {
                                    borderColor: has ? C.border : primaryBorder,
                                    backgroundColor: has ? C.mutedBg : primaryBg,
                                  },
                                  pressed && Platform.OS === "ios" ? { opacity: 0.92 } : null,
                                ];
                              }}
                            >
                              <View style={styles.comprobanteCtaInner}>
                                <View
                                  style={[
                                    styles.comprobanteBadge,
                                    {
                                      backgroundColor: pagoImg?.uri ? C.okBg : (alphaColor(C.primary, isDark ? 0.14 : 0.08) || C.mutedBg),
                                      borderColor: alphaColor(pagoImg?.uri ? C.ok : C.primary, isDark ? 0.32 : 0.22) || C.border,
                                    },
                                  ]}
                                >
                                  <Text style={[styles.comprobanteBadgeText, { color: pagoImg?.uri ? C.ok : C.primary }]}>
                                    {pagoImg?.uri ? "OK" : "+"}
                                  </Text>
                                </View>

                                <View style={{ flex: 1, minWidth: 0 }}>
                                  <Text style={{ color: C.text, fontWeight: "900", fontSize: 14 }} numberOfLines={1}>
                                    {pagoImg?.uri ? "Comprobante adjunto" : "Agregar comprobante"}
                                  </Text>
                                  <Text style={{ color: C.sub, marginTop: 2, fontWeight: "700", fontSize: 12 }} numberOfLines={2}>
                                    {pagoImg?.uri ? "Toca para cambiar la imagen" : "Requerido para habilitar Guardar"}
                                  </Text>
                                </View>

                                {pagoImg?.uri ? (
                                  <Image source={{ uri: pagoImg.uri }} style={[styles.comprobanteThumb, { borderColor: C.border }]} />
                                ) : null}
                              </View>
                            </Pressable>

                            <Text style={{ color: C.sub, marginTop: 8, fontWeight: "600", fontSize: 12 }}>
                              {pagoImg?.uri ? "Listo. Se subirá junto con el pago." : "Debes adjuntar una imagen como comprobante."}
                            </Text>
                          </View>

                          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                            <AppButton
                              title="Cancelar"
                              variant="outline"
                              onPress={() => {
                                Keyboard.dismiss();
                                setFacturaPickerOpen(false);
                                setPagoModal(false);
                              }}
                              disabled={savingPago}
                              style={{ flex: 1, minHeight: 48 } as any}
                            />
                            <AppButton title="Guardar" variant="primary" onPress={() => { Keyboard.dismiss(); guardarPago(); }} loading={savingPago} disabled={savingPago || !pagoImg?.uri || facturasPendientes.length === 0} style={{ flex: 1, minHeight: 48, backgroundColor: C.primary, borderColor: C.primary } as any} />
                          </View>
                        </>
                      )}
                      </View>
                    </TouchableWithoutFeedback>
                  </ScrollView>
                </KeyboardAvoidingView>
              </View>
            </TouchableWithoutFeedback>
          </Modal>
        ) : null}




        {/* Viewer comprobante */}
        {viewerOpen ? (
          <Modal transparent visible={viewerOpen} animationType="fade" onRequestClose={() => setViewerOpen(false)}>
            <View style={[styles.viewerBg, { backgroundColor: "rgba(0,0,0,0.8)" }]}>
              <View style={styles.viewerCard}>
                <View style={[styles.viewerTopBar, { top: Math.max(12, insets.top + 10) }]}>
                  <Pressable
                    onPress={() => setViewerOpen(false)}
                    style={({ pressed }) => [styles.viewerTopBtn, pressed ? { opacity: 0.8 } : null]}
                  >
                    <Text style={styles.viewerTopBtnText}>Cerrar</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => downloadViewerImage()}
                    disabled={savingDownload}
                    style={({ pressed }) => [
                      styles.viewerTopBtn,
                      savingDownload ? { opacity: 0.6 } : null,
                      pressed ? { opacity: 0.85 } : null,
                    ]}
                  >
                    <Text style={styles.viewerTopBtnText}>{savingDownload ? "Guardando..." : "Descargar"}</Text>
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
                    backgroundColor="transparent"
                    renderIndicator={() => <View />}
                    saveToLocalByLongPress={false}
                  />
                )}
              </View>
            </View>
          </Modal>
        ) : null}

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
  badgeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  kvGrid: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  kv: { minWidth: 140, flexBasis: 140, flexGrow: 1 },
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

  tableWrap: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, overflow: 'hidden' },
  tableHeaderRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  tableRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  tableFooterRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth },
  th: { fontSize: 11, fontWeight: '800', letterSpacing: 0.7, textTransform: 'uppercase' },
  td: { fontSize: 13, fontWeight: '800' },
  tdSub: { marginTop: 2, fontSize: 12, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 14 },
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
  comprobanteCta: { marginTop: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 12, borderStyle: 'dashed' },
  comprobanteCtaInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  comprobanteBadge: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  comprobanteBadgeText: { fontSize: 15, fontWeight: '900' },
  comprobanteThumb: { width: 44, height: 44, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, backgroundColor: 'rgba(0,0,0,0.08)' },
  viewerBg: { flex: 1 },
  viewerCard: { width: '100%', height: '100%' },
  viewerTopBar: {
    position: 'absolute',
    left: 18,
    right: 18,
    zIndex: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  viewerTopBtn: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  viewerTopBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
