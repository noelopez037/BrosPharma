// components/comisiones/ComisionVentaDetallePanel.tsx

import { useTheme } from "@react-navigation/native";
import * as FileSystem from "expo-file-system/legacy";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import ImageViewer from "react-native-image-zoom-viewer";
import { supabase } from "../../lib/supabase";
import { useThemePref } from "../../lib/themePreference";
import { useEmpresaActiva } from "../../lib/useEmpresaActiva";
import { useRole } from "../../lib/useRole";
import { fmtQ, fmtDate } from "../../lib/utils/format";

const BUCKET_VENTAS_DOCS = "Ventas-Docs";
const BUCKET_COMPROBANTES = "comprobantes";

function extFromMime(mime: string) {
  if (!mime) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("pdf")) return "pdf";
  return "jpg";
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
    return { ok: r.ok, contentType: ct, bytes: size, looksLikeImage: ct.toLowerCase().startsWith("image/"), url: target, minOk: size >= minBytes };
  } catch (e: any) {
    return { ok: false, contentType: "", bytes: 0, looksLikeImage: false, url: target, minOk: false };
  }
}

async function downloadToCache(remoteUrl: string, mimeHint?: string) {
  const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!baseDir) throw new Error("No hay cacheDirectory disponible");
  const urlNoQuery = String(remoteUrl).split("?")[0];
  const extFromUrl = (urlNoQuery.match(/\.([a-zA-Z0-9]{2,6})$/)?.[1] ?? "").toLowerCase();
  const extFromHint = mimeHint ? extFromMime(mimeHint) : "";
  const ext = (extFromHint || "").toLowerCase() || (["jpg","jpeg","png","webp"].includes(extFromUrl) ? (extFromUrl === "jpeg" ? "jpg" : extFromUrl) : "jpg");
  const safeName = urlNoQuery.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 90);
  const target = `${baseDir}com_${safeName}.${ext}`;
  try {
    const info = await FileSystem.getInfoAsync(target);
    if (info.exists && (info.size ?? 0) > 1024) return target;
    if (info.exists) await FileSystem.deleteAsync(target, { idempotent: true });
  } catch {}
  const res = await FileSystem.downloadAsync(encodeURI(remoteUrl), target);
  const info2 = await FileSystem.getInfoAsync(res.uri);
  if (!info2.exists || (info2.size ?? 0) < 1024) {
    try { await FileSystem.deleteAsync(res.uri, { idempotent: true }); } catch {}
    throw new Error("Descarga incompleta");
  }
  return res.uri;
}

async function openInBrowser(url: string) {
  if (!url) throw new Error("URL inválida");
  try { await WebBrowser.openBrowserAsync(url); }
  catch { await WebBrowser.openBrowserAsync(encodeURI(url)); }
}

async function openFacturaPdf(pathRaw: string) {
  const path = String(pathRaw ?? "").trim().replace(/^\//, "");
  if (!path) return;
  const { data, error } = await supabase.storage.from(BUCKET_VENTAS_DOCS).createSignedUrl(path, 60 * 15);
  if (error) throw error;
  const url = data?.signedUrl ?? null;
  if (!url) throw new Error("No se pudo abrir el PDF");
  if (Platform.OS === "web") { window.open(url, "_blank"); }
  else { await openInBrowser(url); }
}

type ComisionVentaDetallePanelProps = { ventaId: number | null; embedded?: boolean };

function safeNumber(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

export function ComisionVentaDetallePanel({ ventaId, embedded = false }: ComisionVentaDetallePanelProps) {
  const { colors } = useTheme();
  const { resolved } = useThemePref();
  const { empresaActivaId } = useEmpresaActiva();
  const insets = useSafeAreaInsets();
  const isDark = resolved === "dark";
  const s = useMemo(() => styles(colors), [colors]);

  const C = useMemo(() => ({
    sub: colors.text + "AA",
    border: colors.border,
    divider: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)",
    card: colors.card,
    text: colors.text,
  }), [isDark, colors.text, colors.border, colors.card]);

  const { isAdmin } = useRole();

  const [loading, setLoading] = useState(false);
  const [row, setRow] = useState<any | null>(null);
  const [lineas, setLineas] = useState<any[]>([]);
  const [pagos, setPagos] = useState<any[]>([]);
  const [facturasFiles, setFacturasFiles] = useState<any[]>([]);

  // viewer comprobante
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerRemoteUrl, setViewerRemoteUrl] = useState<string | null>(null);
  const [viewerMimeType, setViewerMimeType] = useState<string | null>(null);
  const viewerBusyRef = useRef(false);

  // eliminar pago
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    if (!ventaId || !Number.isFinite(ventaId) || ventaId <= 0) {
      setRow(null); setLineas([]); setPagos([]); setFacturasFiles([]); return;
    }
    if (!empresaActivaId) return;
    setLoading(true);
    try {
      const [{ data: v }, { data: d }, { data: p }, { data: f }] = await Promise.all([
        supabase.from("vw_cxc_ventas").select("*").eq("empresa_id", empresaActivaId).eq("venta_id", ventaId).maybeSingle(),
        supabase.from("ventas_detalle").select("id,cantidad,precio_venta_unit,subtotal,productos(nombre,marcas(nombre)),producto_lotes(lote)").eq("empresa_id", empresaActivaId).eq("venta_id", ventaId).order("id", { ascending: true }),
        supabase.from("ventas_pagos").select("id,fecha,monto,metodo,referencia,comentario,comprobante_path").eq("empresa_id", empresaActivaId).eq("venta_id", ventaId).order("fecha", { ascending: false }),
        supabase.from("ventas_facturas").select("id,numero_factura,path,monto_total").eq("empresa_id", empresaActivaId).eq("venta_id", ventaId).order("id", { ascending: true }),
      ]);
      setRow(v ?? null);
      setLineas((d ?? []) as any[]);
      setPagos((p ?? []) as any[]);
      setFacturasFiles((f ?? []) as any[]);
    } catch {
      setRow(null); setLineas([]); setPagos([]); setFacturasFiles([]);
    } finally {
      setLoading(false);
    }
  }, [ventaId, empresaActivaId]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const handleOpenComprobante = useCallback(async (raw: string) => {
    const norm = normalizeComprobanteRef(raw);
    if (!norm) { Alert.alert("Sin comprobante", "No hay archivo adjunto"); return; }
    const ref = (norm.path ?? norm.url ?? "").toLowerCase();
    const isPdf = ref.includes(".pdf");

    if (isPdf) {
      try {
        let signed = norm.url ?? null;
        if (!signed && norm.path) {
          const { data, error } = await supabase.storage.from(BUCKET_COMPROBANTES).createSignedUrl(norm.path, 60 * 10);
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
        const { data, error } = await supabase.storage.from(BUCKET_COMPROBANTES).createSignedUrl(norm.path, 60 * 10);
        if (error) throw error;
        signedUrl = data?.signedUrl ?? null;
      }
      if (!signedUrl) throw new Error("No se pudo generar URL del comprobante.");
      let probe = null as any;
      try { probe = await probeImageUrl(signedUrl, 512); } catch { probe = null; }
      const finalUrl = probe?.url ? probe.url : signedUrl;
      setViewerRemoteUrl(finalUrl);
      if (probe?.contentType) setViewerMimeType(String(probe.contentType));
      if (Platform.OS !== "web") {
        try {
          const localUri = await downloadToCache(finalUrl, probe?.contentType ? String(probe.contentType) : undefined);
          setViewerUrl(localUri);
        } catch { /* fallback to remote */ }
      }
    } catch (e: any) {
      setViewerOpen(false);
      Alert.alert("Error", e?.message ?? "No se pudo abrir comprobante");
    } finally {
      viewerBusyRef.current = false;
    }
  }, []);

  const confirmarEliminarPago = useCallback(async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc("rpc_venta_pago_eliminar", { p_pago_id: confirmDeleteId });
      if (error) { Alert.alert("Error", error.message ?? "No se pudo eliminar el pago"); return; }
      setConfirmDeleteId(null);
      void fetchData();
    } finally {
      setDeleting(false);
    }
  }, [confirmDeleteId, fetchData]);

  const saldoNum = safeNumber(row?.saldo);
  const isPaid = saldoNum <= 0;

  const openFull = useCallback(() => {
    if (!ventaId) return;
    router.push({ pathname: "/cxc-venta-detalle", params: { ventaId: String(ventaId) } } as any);
  }, [ventaId]);

  if (!ventaId) {
    return <View style={s.center}><Text style={s.empty}>Sin venta seleccionada</Text></View>;
  }
  if (loading) {
    return <View style={s.center}><Text style={s.empty}>Cargando...</Text></View>;
  }
  if (!row) {
    return <View style={s.center}><Text style={s.empty}>Venta no encontrada</Text></View>;
  }

  const facturas = Array.isArray(row.facturas) ? row.facturas.filter(Boolean) : [];
  const factStr = facturas.length > 0 ? facturas.join(" · ") : "—";

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.background }]} edges={["bottom"]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.clienteNombre} numberOfLines={2}>{row.cliente_nombre ?? "Cliente"}</Text>
            <Text style={[s.sub, { marginTop: 2 }]}>Venta #{ventaId}</Text>
          </View>
          <View style={[s.badge, isPaid ? s.badgePaid : s.badgePending]}>
            <Text style={[s.badgeTxt, isPaid ? s.badgePaidTxt : s.badgePendingTxt]}>
              {isPaid ? "PAGADA" : "PENDIENTE"}
            </Text>
          </View>
        </View>

        {/* Totales */}
        <View style={s.card}>
          <KV k="Total" v={fmtQ(row.total)} s={s} />
          <KV k="Pagado" v={fmtQ(row.pagado)} s={s} />
          <KV k="Saldo" v={fmtQ(row.saldo)} s={s} />
          <KV k="Facturas" v={factStr} s={s} />
          <KV k="Fecha" v={fmtDate(row.fecha)} s={s} />
          <KV k="Fecha último pago" v={fmtDate(row.fecha_ultimo_pago)} s={s} />
          {row.vendedor_codigo ? <KV k="Vendedor" v={String(row.vendedor_codigo)} s={s} /> : null}
        </View>

        {/* Facturas con PDF */}
        {facturasFiles.length > 0 ? (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Facturas</Text>
            {facturasFiles.map((f: any, idx: number) => {
              const numero = String(f.numero_factura ?? "").trim() || `Factura #${f.id}`;
              const hasPdf = !!String(f.path ?? "").trim();
              return (
                <View key={String(f.id ?? idx)} style={[s.lineaRow, idx < facturasFiles.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.divider, paddingBottom: 8, marginBottom: 8 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.lineaNombre}>{numero}</Text>
                    {f.monto_total != null ? <Text style={s.sub}>{fmtQ(f.monto_total)}</Text> : null}
                  </View>
                  {hasPdf ? (
                    <Pressable
                      onPress={() => openFacturaPdf(String(f.path)).catch((e: any) => Alert.alert("Error", e?.message ?? "No se pudo abrir"))}
                      style={({ pressed }) => [s.comprobanteBtn, { borderColor: C.border }, pressed ? { opacity: 0.7 } : null]}
                    >
                      <Text style={[s.comprobanteBtnTxt, { color: colors.text }]}>Ver PDF →</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Líneas de detalle */}
        {lineas.length > 0 ? (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Detalle de productos</Text>
            {lineas.map((l: any, idx: number) => {
              const nombre = String((l as any)?.productos?.nombre ?? "").trim() || `Producto ${idx + 1}`;
              const marca = String((l as any)?.productos?.marcas?.nombre ?? "").trim();
              const lote = String((l as any)?.producto_lotes?.lote ?? "").trim();
              const cant = safeNumber(l.cantidad);
              const price = fmtQ(l.precio_venta_unit);
              const sub = fmtQ(l.subtotal ?? cant * safeNumber(l.precio_venta_unit));
              return (
                <View key={String(l.id ?? idx)} style={[s.lineaRow, idx < lineas.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.divider }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.lineaNombre} numberOfLines={2}>{nombre}{marca ? ` · ${marca}` : ""}</Text>
                    {lote ? <Text style={s.sub}>Lote: {lote}</Text> : null}
                    <Text style={s.sub}>{cant} × {price}</Text>
                  </View>
                  <Text style={s.lineaSub}>{sub}</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Pagos */}
        {pagos.length > 0 ? (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Pagos</Text>
            {pagos.map((p: any, idx: number) => {
              const comprobanteRaw = String(p.comprobante_path ?? "").trim();
              return (
                <View key={String(p.id ?? idx)} style={[s.pagoItem, idx < pagos.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.divider }]}>
                  <View style={s.lineaRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.lineaNombre}>{fmtDate(p.fecha)}</Text>
                      <Text style={s.sub}>{String(p.metodo ?? "—")}{p.referencia ? ` · ${p.referencia}` : ""}</Text>
                      {p.comentario ? <Text style={s.sub}>{p.comentario}</Text> : null}
                    </View>
                    <Text style={s.lineaSub}>{fmtQ(p.monto)}</Text>
                  </View>
                  {(comprobanteRaw || isAdmin) ? (
                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                      {comprobanteRaw ? (
                        <Pressable
                          onPress={() => handleOpenComprobante(comprobanteRaw)}
                          style={({ pressed }) => [s.comprobanteBtn, { borderColor: C.border }, pressed ? { opacity: 0.7 } : null]}
                        >
                          <Text style={[s.comprobanteBtnTxt, { color: colors.text }]}>Ver comprobante →</Text>
                        </Pressable>
                      ) : null}
                      {isAdmin ? (
                        <Pressable
                          onPress={() => setConfirmDeleteId(p.id)}
                          style={({ pressed }) => [s.comprobanteBtn, { borderColor: "#ef4444" }, pressed ? { opacity: 0.7 } : null]}
                        >
                          <Text style={[s.comprobanteBtnTxt, { color: "#ef4444" }]}>Eliminar</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Ver detalle completo (solo móvil no embebido) */}
        {!embedded ? (
          <Pressable
            onPress={openFull}
            style={({ pressed }) => [s.openBtn, { borderColor: colors.border }, pressed && Platform.OS === "ios" ? { opacity: 0.8 } : null]}
          >
            <Text style={[s.openBtnTxt, { color: colors.text }]}>Ver detalle completo →</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* Viewer comprobante */}
      {viewerOpen ? (
        <Modal transparent visible={viewerOpen} animationType="fade" onRequestClose={() => setViewerOpen(false)}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.9)" }}>
            <View style={{ ...StyleSheet.absoluteFillObject }}>
              <View style={{ position: "absolute", top: Math.max(12, insets.top + 10), right: 16, zIndex: 10 }}>
                <Pressable
                  onPress={() => setViewerOpen(false)}
                  style={({ pressed }) => [{ backgroundColor: "rgba(255,255,255,0.15)", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 }, pressed ? { opacity: 0.8 } : null]}
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Cerrar</Text>
                </Pressable>
              </View>
              {!(viewerUrl || viewerRemoteUrl) ? (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
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

      {/* Modal confirmación eliminar pago */}
      <Modal visible={!!confirmDeleteId} transparent animationType="fade" onRequestClose={() => !deleting && setConfirmDeleteId(null)}>
        <Pressable style={{ ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" }} onPress={() => !deleting && setConfirmDeleteId(null)} />
        <View pointerEvents="box-none" style={{ ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <View style={[s.card, { width: "100%", maxWidth: 360 }]}>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginBottom: 6 }}>Eliminar pago</Text>
            <Text style={{ color: colors.text + "AA", fontSize: 14, marginBottom: 20 }}>¿Seguro que deseas eliminar este pago? Esta acción no se puede deshacer.</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable onPress={() => setConfirmDeleteId(null)} disabled={deleting} style={({ pressed }) => [s.comprobanteBtn, { flex: 1, alignItems: "center", borderColor: colors.border }, pressed ? { opacity: 0.7 } : null]}>
                <Text style={[s.comprobanteBtnTxt, { color: colors.text }]}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={confirmarEliminarPago} disabled={deleting} style={({ pressed }) => [s.comprobanteBtn, { flex: 1, alignItems: "center", borderColor: "#ef4444", backgroundColor: "#ef4444" }, pressed || deleting ? { opacity: 0.7 } : null]}>
                <Text style={[s.comprobanteBtnTxt, { color: "#fff" }]}>{deleting ? "Eliminando..." : "Sí, eliminar"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function KV({ k, v, s }: { k: string; v: string; s: ReturnType<typeof styles> }) {
  return (
    <View style={s.kvRow}>
      <Text style={s.k}>{k}</Text>
      <Text style={s.v}>{v}</Text>
    </View>
  );
}

const styles = (colors: any) =>
  StyleSheet.create({
    safe: { flex: 1 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    empty: { color: colors.text + "88", fontSize: 14, textAlign: "center" },
    content: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 24, gap: 10 },
    headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 2 },
    clienteNombre: { color: colors.text, fontSize: 18, fontWeight: "800" },
    sub: { color: colors.text + "AA", fontSize: 12, marginTop: 4 },
    badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, overflow: "hidden" },
    badgePaid: { borderColor: "#7bfd9b", backgroundColor: "#BBF7D0" },
    badgePending: { borderColor: colors.border, backgroundColor: colors.card },
    badgeTxt: { fontSize: 11, fontWeight: "900" },
    badgePaidTxt: { color: "#0a2213" },
    badgePendingTxt: { color: colors.text + "BB" },
    card: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 14, padding: 12 },
    sectionTitle: { color: colors.text, fontSize: 14, fontWeight: "900", marginBottom: 8 },
    kvRow: { marginTop: 8 },
    k: { color: colors.text + "AA", fontSize: 11, fontWeight: "700" },
    v: { color: colors.text, fontSize: 15, fontWeight: "600", marginTop: 2 },
    pagoItem: { paddingVertical: 8 },
    lineaRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    comprobanteBtn: { marginTop: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, alignSelf: "flex-start" },
    comprobanteBtnTxt: { fontSize: 12, fontWeight: "700" },
    lineaNombre: { color: colors.text, fontSize: 13, fontWeight: "700" },
    lineaSub: { color: colors.text, fontSize: 13, fontWeight: "800", minWidth: 70, textAlign: "right" },
    openBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center", backgroundColor: colors.card },
    openBtnTxt: { fontSize: 14, fontWeight: "700" },
  });
