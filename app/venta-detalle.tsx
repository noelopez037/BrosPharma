import { useFocusEffect, useTheme } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import { Stack, router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import ImageViewer from "react-native-image-zoom-viewer";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AppButton } from "../components/ui/app-button";
import { KeyboardAwareModal } from "../components/ui/keyboard-aware-modal";
import { useKeyboardAutoScroll } from "../components/ui/use-keyboard-autoscroll";
import { goBackSafe } from "../lib/goBackSafe";
import { emitSolicitudesChanged } from "../lib/solicitudesEvents";
import { supabase } from "../lib/supabase";
import { useThemePref } from "../lib/themePreference";
import { alphaColor } from "../lib/ui";
import { FB_DARK_DANGER } from "../src/theme/headerColors";

type Role = "ADMIN" | "BODEGA" | "VENTAS" | "FACTURACION" | "";

type Venta = {
  id: number;
  fecha: string;
  estado: string;
  cliente_id: number;
  cliente_nombre: string | null;
  vendedor_id: string | null;
  vendedor_codigo?: string | null;
  comentarios: string | null;
  requiere_receta: boolean;
  receta_cargada: boolean;
};

type ClienteMini = {
  id: number;
  nombre: string;
  nit: string | null;
  telefono: string | null;
  direccion: string | null;
};

function displayNit(nit: string | null | undefined) {
  const t = String(nit ?? "").trim();
  return t ? t : "CF";
}

type DetalleRow = {
  id: number;
  producto_id: number;
  lote_id: number;
  cantidad: number;
  precio_venta_unit: string;
  subtotal: string | null;
  producto_nombre: string | null;
  producto_marca: string | null;
  tiene_iva?: boolean | null;
  lote: string | null;
  fecha_exp: string | null;
};

type RecetaRow = {
  id: number;
  venta_id: number;
  path: string;
  created_at: string;
  uploaded_by: string | null;
};

type RecetaItem = {
  row: RecetaRow;
  signedUrl: string | null;
};

type FacturaRow = {
  id: number;
  venta_id: number;
  tipo: "IVA" | "EXENTO";
  path: string;
  numero_factura: string | null;
  original_name: string | null;
  size_bytes: number | null;
  monto_total?: number | null;
  fecha_emision?: string | null;
  fecha_vencimiento?: string | null;
};

type FacturaDraft = {
  tipo: "IVA" | "EXENTO";
  numero: string;
  monto: string;
  path: string | null;
  originalName: string | null;
  sizeBytes: number | null;
};

type SolicitudAnulacion = {
  venta_id: number;
  solicitud_nota: string | null;
  solicitud_fecha: string | null;
  solicitud_user_id: string | null;
};

const BUCKET = "Ventas-Docs";

function normalizeUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

function shortUid(u: string | null | undefined) {
  const s = String(u ?? "").trim();
  if (!s) return "—";
  return s.slice(0, 8);
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

function toIsoDateLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, days: number) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + days);
  return x;
}

function sanitizeMontoDraftInput(v: string) {
  return String(v ?? "").replace(/[^0-9.,]/g, "");
}

function parseMontoInput(raw: string) {
  const s0 = String(raw ?? "").trim();
  if (!s0) return NaN;
  const noPrefix = s0.replace(/^Q\s*/i, "");
  const noSpaces = noPrefix.replace(/\s+/g, "");
  const normalized = noSpaces.replace(/,/g, ".");
  // Keep digits and first dot only
  let out = "";
  let dot = false;
  for (const ch of normalized) {
    if (ch >= "0" && ch <= "9") out += ch;
    else if (ch === "." && !dot) {
      out += ".";
      dot = true;
    }
  }
  const n = Number(out);
  return Number.isFinite(n) ? n : NaN;
}

function isValidMonto(raw: string) {
  const n = parseMontoInput(raw);
  return Number.isFinite(n) && n > 0;
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

function guessMimeFromExt(ext: string) {
  const e = (ext || "").toLowerCase();
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  if (e === "heic") return "image/heic";
  if (e === "heif") return "image/heif";
  return "image/jpeg";
}

function normalizeStoragePath(raw: string) {
  const p = String(raw ?? "").trim();
  if (!p) return "";
  let clean = p.startsWith("/") ? p.slice(1) : p;
  const pref = `${BUCKET}/`;
  if (clean.startsWith(pref)) clean = clean.slice(pref.length);
  return clean;
}

async function uriToArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error("No se pudo leer la imagen");
  return await res.arrayBuffer();
}

async function uriToBytes(uri: string): Promise<Uint8Array> {
  // Prefer fetch -> ArrayBuffer (file:// on iOS)
  try {
    const ab = await uriToArrayBuffer(uri);
    return new Uint8Array(ab);
  } catch {}

  // Fallback for content:// (Android)
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

function extFromUrl(url: string) {
  const clean = String(url ?? "").split("?")[0];
  const m = clean.match(/\.([a-zA-Z0-9]+)$/);
  const ext = (m?.[1] ?? "jpg").toLowerCase();
  if (ext === "jpeg") return "jpg";
  return ext;
}

async function saveImageToPhotos(imageUrl: string) {
  if (!imageUrl) throw new Error("URL de imagen inválida");
  if (Platform.OS === "web") throw new Error("Guardar a Fotos no está disponible en Web");

  const perm = await MediaLibrary.requestPermissionsAsync();
  if (!perm.granted) throw new Error("Permiso de Fotos denegado");

  const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!baseDir) throw new Error("No hay directorio local disponible");

  const downloadDir = baseDir + "downloads/";
  await FileSystem.makeDirectoryAsync(downloadDir, { intermediates: true }).catch(() => {});

  const ext = extFromUrl(imageUrl);
  const localUri = `${downloadDir}receta-${Date.now()}.${ext}`;

  const dl = await FileSystem.downloadAsync(encodeURI(imageUrl), localUri);
  if (!dl?.uri) throw new Error("No se pudo descargar la imagen");

  const asset = await MediaLibrary.createAssetAsync(dl.uri);
  try {
    await MediaLibrary.createAlbumAsync("BrosPharma", asset, false);
  } catch {}

  try {
    await FileSystem.deleteAsync(dl.uri, { idempotent: true });
  } catch {}
}

async function openInBrowser(url: string) {
  if (!url) throw new Error("URL inválida");
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    // fallback
    await WebBrowser.openBrowserAsync(encodeURI(url));
  }
}

async function downloadAndShareFile(url: string, filename: string) {
  if (!url) throw new Error("URL inválida");
  const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!baseDir) throw new Error("No hay directorio local disponible");

  const downloadDir = baseDir + "downloads/";
  await FileSystem.makeDirectoryAsync(downloadDir, { intermediates: true }).catch(() => {});
  const safeName = (filename || "archivo").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const target = `${downloadDir}${safeName}`;

  const dl = await FileSystem.downloadAsync(encodeURI(url), target);
  if (!dl?.uri) throw new Error("No se pudo descargar");

  await Share.share({ url: dl.uri });
}

export default function VentaDetalleScreen() {
  const insets = useSafeAreaInsets();
  const { scrollRef, handleFocus } = useKeyboardAutoScroll(110);
  const { colors } = useTheme();
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  const params = useLocalSearchParams<{ ventaId?: string; returnTo?: string }>();
  const ventaIdRaw = String(params?.ventaId ?? "");
  const ventaId = Number(ventaIdRaw);
  const returnTo = String(params?.returnTo ?? "");

  const C = useMemo(
    () => ({
      bg: colors.background ?? (isDark ? "#000" : "#fff"),
      card: colors.card ?? (isDark ? "#1C1C1E" : "#fff"),
      text: colors.text ?? (isDark ? "#fff" : "#111"),
      sub:
        alphaColor(String(colors.text ?? (isDark ? "#ffffff" : "#000000")), 0.65) ||
        (isDark ? "rgba(255,255,255,0.65)" : "#666"),
      border: colors.border ?? (isDark ? "rgba(255,255,255,0.14)" : "#e5e5e5"),
      danger: FB_DARK_DANGER,
      ok: isDark ? "rgba(140,255,170,0.95)" : "#16a34a",
      okBg: isDark ? "rgba(22,163,74,0.18)" : "rgba(22,163,74,0.10)",
      mutedBg: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
      warnBg: isDark ? "rgba(255,201,107,0.18)" : "rgba(255,170,0,0.12)",
      warnText: isDark ? "rgba(255,201,107,0.92)" : "#b25a00",
    }),
    [colors.background, colors.border, colors.card, colors.text, isDark]
  );

  const [role, setRole] = useState<Role>("");
  const [venta, setVenta] = useState<Venta | null>(null);
  const [clienteMini, setClienteMini] = useState<ClienteMini | null>(null);
  const [lineas, setLineas] = useState<DetalleRow[]>([]);
  const [recetas, setRecetas] = useState<RecetaItem[]>([]);
  const [facturas, setFacturas] = useState<FacturaRow[]>([]);
  const [facturaDraft, setFacturaDraft] = useState<Record<string, FacturaDraft>>({});
  const [montoTouched, setMontoTouched] = useState<Record<"IVA" | "EXENTO", boolean>>({ IVA: false, EXENTO: false });

  const [tagsActivos, setTagsActivos] = useState<string[]>([]);
  const [solicitudAnulacion, setSolicitudAnulacion] = useState<SolicitudAnulacion | null>(null);
  const [solicitudAnulacionByName, setSolicitudAnulacionByName] = useState<string | null>(null);
  const [solOpen, setSolOpen] = useState(false);
  const [solAccion, setSolAccion] = useState<"EDICION" | "ANULACION" | null>(null);
  const [solNota, setSolNota] = useState("");
  const [solSending, setSolSending] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [uploadingPdfTipo, setUploadingPdfTipo] = useState<"IVA" | "EXENTO" | null>(null);
  const [facturando, setFacturando] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [enRutaLoading, setEnRutaLoading] = useState(false);
  const [entregarLoading, setEntregarLoading] = useState(false);

  const canViewRecetaTools = role === "ADMIN" || role === "FACTURACION" || role === "VENTAS";
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const viewerOpacity = useRef(new Animated.Value(0)).current;
  const viewerScale = useRef(new Animated.Value(0.98)).current;

  const canSplitIva = role === "ADMIN" || role === "FACTURACION";
  const canEditRecetas = role === "ADMIN" || role === "VENTAS";
  const canFacturar = role === "ADMIN" || role === "FACTURACION";
  const canVerFacturas = role === "ADMIN" || role === "FACTURACION" || role === "VENTAS";
  const canBodega = role === "ADMIN" || role === "BODEGA";
  const canEntregar = role === "ADMIN" || role === "BODEGA" || role === "VENTAS";
  const canSolicitar = role === "VENTAS" || role === "ADMIN";

  // When venta status changes (after actions), return to Ventas list.
  const lastEstadoRef = useRef<string | null>(null);
  const estadoBootRef = useRef(false);

  React.useEffect(() => {
    const cur = String(venta?.estado ?? "").trim();
    if (!cur) return;

    if (!estadoBootRef.current) {
      estadoBootRef.current = true;
      lastEstadoRef.current = cur;
      return;
    }

    const prev = String(lastEstadoRef.current ?? "").trim();
    lastEstadoRef.current = cur;
    if (prev && prev !== cur) {
      router.replace("/(drawer)/(tabs)/ventas" as any);
    }
  }, [venta?.estado]);

  // Al cambiar de venta, limpiar drafts locales.
  React.useEffect(() => {
    setFacturas([]);
    setFacturaDraft({});
    setMontoTouched({ IVA: false, EXENTO: false });
    setTagsActivos([]);
    setClienteMini(null);
    setSolicitudAnulacion(null);
    setSolicitudAnulacionByName(null);
  }, [ventaId]);

  React.useEffect(() => {
    let alive = true;
    const cid = Number(venta?.cliente_id);
    if (!Number.isFinite(cid) || cid <= 0) {
      setClienteMini(null);
      return;
    }

    (async () => {
      try {
        const { data, error } = await supabase
          .from("clientes")
          .select("id,nombre,nit,telefono,direccion")
          .eq("id", cid)
          .maybeSingle();
        if (error) throw error;
        if (alive) setClienteMini((data ?? null) as any);
      } catch {
        if (alive) setClienteMini(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [venta?.cliente_id]);

  const fetchTags = useCallback(async () => {
    const { data, error } = await supabase
      .from("ventas_tags")
      .select("tag")
      .eq("venta_id", ventaId)
      .is("removed_at", null);
    if (error) throw error;
    const tags = (data ?? []).map((r: any) => String(r.tag ?? "").trim().toUpperCase()).filter(Boolean);
    setTagsActivos(tags);
  }, [ventaId]);

  const fetchSolicitudAnulacion = useCallback(async () => {
    const { data, error } = await supabase
      .from("vw_venta_razon_anulacion")
      .select("venta_id,solicitud_nota,solicitud_fecha,solicitud_user_id")
      .eq("venta_id", ventaId)
      .maybeSingle();
    if (error) throw error;
    const row = (data ?? null) as any as SolicitudAnulacion | null;
    setSolicitudAnulacion(row);

    const uid = String(row?.solicitud_user_id ?? "").trim();
    if (!uid) {
      setSolicitudAnulacionByName(null);
      return;
    }

    try {
      const { data: p, error: pe } = await supabase.from("profiles").select("full_name").eq("id", uid).maybeSingle();
      if (pe) throw pe;
      const name = String((p as any)?.full_name ?? "").trim();
      setSolicitudAnulacionByName(name || null);
    } catch {
      setSolicitudAnulacionByName(null);
    }
  }, [ventaId]);

  const loadRole = useCallback(async (): Promise<Role> => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) {
      setRole("");
      return "";
    }
    const { data } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
    const r = (normalizeUpper(data?.role) as Role) ?? "";
    setRole(r);
    return r;
  }, []);

  const fetchVenta = useCallback(async () => {
    const { data, error } = await supabase
      .from("ventas")
      .select(
        "id,fecha,estado,cliente_id,cliente_nombre,vendedor_id,vendedor_codigo,comentarios,requiere_receta,receta_cargada"
      )
      .eq("id", ventaId)
      .maybeSingle();
    if (error) throw error;
    setVenta((data ?? null) as any);
  }, [ventaId]);

  const fetchLineas = useCallback(async (allowSplit: boolean) => {
    const base = "id,producto_id,lote_id,cantidad,precio_venta_unit,subtotal,producto_lotes(lote,fecha_exp),productos(nombre,marca_id,marcas(nombre)";
    const select = allowSplit ? `${base},tiene_iva)` : `${base})`;

    const { data, error } = await supabase
      .from("ventas_detalle")
      .select(select)
      .eq("venta_id", ventaId)
      .order("id", { ascending: true });
    if (error) throw error;

    const mapped: DetalleRow[] = (data ?? []).map((r: any) => ({
      id: Number(r.id),
      producto_id: Number(r.producto_id),
      lote_id: Number(r.lote_id),
      cantidad: Number(r.cantidad ?? 0),
      precio_venta_unit: String(r.precio_venta_unit ?? "0"),
      subtotal: r.subtotal == null ? null : String(r.subtotal),
      producto_nombre: r.productos?.nombre ?? null,
      producto_marca: r.productos?.marcas?.nombre ?? r.productos?.marcas?.[0]?.nombre ?? null,
      tiene_iva: allowSplit ? !!r.productos?.tiene_iva : null,
      lote: r.producto_lotes?.lote ?? null,
      fecha_exp: r.producto_lotes?.fecha_exp ?? null,
    }));

    setLineas(mapped);
  }, [ventaId]);

  const fetchFacturas = useCallback(async () => {
    const { data, error } = await supabase
      .from("ventas_facturas")
      .select("id,venta_id,tipo,path,numero_factura,original_name,size_bytes,monto_total,fecha_emision,fecha_vencimiento")
      .eq("venta_id", ventaId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const rows = ((data ?? []) as any as FacturaRow[]).map((r) => ({
      ...r,
      path: normalizeStoragePath((r as any).path),
    }));
    setFacturas(rows);

    const next: Record<string, FacturaDraft> = {};
    rows.forEach((r) => {
      const t = String(r.tipo).toUpperCase();
      if (t !== "IVA" && t !== "EXENTO") return;
      // toma el mas reciente por tipo (por order)
      if (next[t]) return;
      next[t] = {
        tipo: t as any,
        numero: String(r.numero_factura ?? ""),
        monto: r.monto_total == null ? "" : String(r.monto_total),
        path: r.path || null,
        originalName: r.original_name ?? null,
        sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
      };
    });
    setFacturaDraft((prev) => ({ ...prev, ...next }));
  }, [ventaId]);

  const fetchRecetas = useCallback(async () => {
    const { data, error } = await supabase
      .from("ventas_recetas")
      .select("id,venta_id,path,created_at,uploaded_by")
      .eq("venta_id", ventaId)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const rows = (data ?? []) as any as RecetaRow[];
    const items: RecetaItem[] = [];

    for (const r of rows) {
      const path = normalizeStoragePath(r.path);
      let signedUrl: string | null = null;
      try {
        const { data: s, error: se } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 30);
        if (!se) signedUrl = (s as any)?.signedUrl ?? null;
      } catch {
        signedUrl = null;
      }
      items.push({ row: { ...r, path }, signedUrl });
    }

    setRecetas(items);
  }, [ventaId]);

  const fetchAll = useCallback(async () => {
    if (!Number.isFinite(ventaId) || ventaId <= 0) {
      setVenta(null);
      setLineas([]);
      setRecetas([]);
      setFacturas([]);
      setSolicitudAnulacion(null);
      return;
    }

    const r = await loadRole();
    const allowSplit = r === "ADMIN" || r === "FACTURACION";
    await Promise.all([
      fetchVenta(),
      fetchLineas(allowSplit),
      fetchRecetas(),
      fetchFacturas(),
      fetchTags(),
      fetchSolicitudAnulacion().catch(() => {
        // non-blocking: view may be missing or RLS may restrict
        setSolicitudAnulacion(null);
      }),
    ]);
  }, [fetchFacturas, fetchLineas, fetchRecetas, fetchSolicitudAnulacion, fetchTags, fetchVenta, loadRole, ventaId]);

  useFocusEffect(
    useCallback(() => {
      fetchAll().catch((e: any) => {
        Alert.alert("Error", e?.message ?? "No se pudo cargar la venta");
      });
    }, [fetchAll])
  );

  const ivaLineas = useMemo(() => {
    if (!canSplitIva) return [] as DetalleRow[];
    return lineas.filter((l) => !!l.tiene_iva);
  }, [canSplitIva, lineas]);
  const exentoLineas = useMemo(() => {
    if (!canSplitIva) return [] as DetalleRow[];
    return lineas.filter((l) => !l.tiene_iva);
  }, [canSplitIva, lineas]);

  const totalIVA = useMemo(() => {
    return ivaLineas.reduce((acc, l) => acc + Number(l.subtotal ?? 0), 0);
  }, [ivaLineas]);

  const totalEXENTO = useMemo(() => {
    return exentoLineas.reduce((acc, l) => acc + Number(l.subtotal ?? 0), 0);
  }, [exentoLineas]);

  const total = useMemo(() => {
    return lineas.reduce((acc, l) => acc + Number(l.subtotal ?? 0), 0);
  }, [lineas]);

  const facturaNumeros = useMemo(() => {
    const nums = (facturas ?? [])
      .map((f) => String((f as any)?.numero_factura ?? "").trim())
      .filter((x) => !!x);
    // unique, preserve order
    const out: string[] = [];
    const seen = new Set<string>();
    for (const n of nums) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out;
  }, [facturas]);

  const needsIVA = canFacturar && ivaLineas.length > 0;
  const needsEXENTO = canFacturar && exentoLineas.length > 0;

  const isNuevo = normalizeUpper(venta?.estado) === "NUEVO";
  const isFacturado = normalizeUpper(venta?.estado) === "FACTURADO";
  const isEnRuta = normalizeUpper(venta?.estado) === "EN_RUTA";

  const facturaCurrentByTipo = useMemo(() => {
    const map: Record<string, { path: string; numero: string; monto: string; fecha_emision: string; fecha_vencimiento: string }> = {};
    for (const f of facturas) {
      const t = String((f as any)?.tipo ?? "").toUpperCase();
      if (t !== "IVA" && t !== "EXENTO") continue;
      if (map[t]) continue; // facturas ya viene ordenado desc
      map[t] = {
        path: String((f as any)?.path ?? "").trim(),
        numero: String((f as any)?.numero_factura ?? "").trim(),
        monto: String((f as any)?.monto_total ?? "").trim(),
        fecha_emision: String((f as any)?.fecha_emision ?? "").trim(),
        fecha_vencimiento: String((f as any)?.fecha_vencimiento ?? "").trim(),
      };
    }
    return map;
  }, [facturas]);

  const requiredTipos = useMemo(() => {
    const req: ("IVA" | "EXENTO")[] = [];
    if (needsIVA) req.push("IVA");
    if (needsEXENTO) req.push("EXENTO");
    return req;
  }, [needsEXENTO, needsIVA]);

  // Autopoblar monto por tipo (solo si no hay monto guardado y el usuario no lo ha tocado).
  React.useEffect(() => {
    if (!venta) return;
    if (!requiredTipos.length) return;

    setFacturaDraft((prev) => {
      let next: Record<string, FacturaDraft> | null = null;

      for (const tipo of requiredTipos) {
        const dbMonto = String(facturaCurrentByTipo[tipo]?.monto ?? "").trim();
        if (dbMonto) continue;
        if (montoTouched[tipo]) continue;

        const cur =
          prev[tipo] ??
          ({ tipo, numero: "", monto: "", path: null, originalName: null, sizeBytes: null } as FacturaDraft);
        const curMonto = String(cur?.monto ?? "").trim();
        if (isValidMonto(curMonto)) continue;

        const totalTipo = tipo === "IVA" ? totalIVA : totalEXENTO;
        if (!Number.isFinite(totalTipo) || totalTipo <= 0) continue;

        const autoMonto = sanitizeMontoDraftInput(Number(totalTipo).toFixed(2));
        if (!autoMonto) continue;

        if (next == null) next = { ...prev };
        next[tipo] = { ...cur, monto: autoMonto };
      }

      return next ?? prev;
    });
  }, [facturaCurrentByTipo, montoTouched, requiredTipos, totalEXENTO, totalIVA, venta]);

  const facturaDraftComplete = useMemo(() => {
    if (!requiredTipos.length) return false;
    return requiredTipos.every((t) => {
      const d = facturaDraft[t];
      const hasPdf = !!String(d?.path ?? facturaCurrentByTipo[t]?.path ?? "").trim();
      const hasNum = !!String(d?.numero ?? facturaCurrentByTipo[t]?.numero ?? "").trim();
      const hasMonto = isValidMonto(String(d?.monto ?? facturaCurrentByTipo[t]?.monto ?? "").trim());
      return hasPdf && hasNum && hasMonto;
    });
  }, [facturaCurrentByTipo, facturaDraft, requiredTipos]);

  const buildFacturaPayload = useCallback(() => {
    const now = new Date();
    const emisionDefault = toIsoDateLocal(now);
    const vencDefault = toIsoDateLocal(addDays(now, 30));

    const payload: any[] = [];
    for (const tipo of requiredTipos) {
      const uiLabel = `Factura ${requiredTipos.indexOf(tipo) + 1}`;
      const d = facturaDraft[tipo] ?? null;
      const numero = String(d?.numero ?? facturaCurrentByTipo[tipo]?.numero ?? "").trim();
      const path = String(d?.path ?? facturaCurrentByTipo[tipo]?.path ?? "").trim();
      const montoRaw = String(d?.monto ?? facturaCurrentByTipo[tipo]?.monto ?? "").trim();
      const monto = parseMontoInput(montoRaw);
      if (!numero || !path || !Number.isFinite(monto) || monto <= 0) {
        throw new Error(`Completa numero, monto y PDF para ${uiLabel}.`);
      }

      const cur = facturaCurrentByTipo[tipo] ?? null;
      const fecha_emision = (cur?.fecha_emision || "").trim() || emisionDefault;
      const fecha_vencimiento = (cur?.fecha_vencimiento || "").trim() || vencDefault;
      payload.push({
        tipo,
        numero_factura: numero,
        path,
        original_name: d?.originalName ?? null,
        size_bytes: d?.sizeBytes ?? null,
        monto_total: monto,
        fecha_emision,
        fecha_vencimiento,
      });
    }
    return payload;
  }, [facturaCurrentByTipo, facturaDraft, requiredTipos]);

  const facturaHasChanges = useMemo(() => {
    if (!requiredTipos.length) return false;
    return requiredTipos.some((t) => {
      const cur = facturaCurrentByTipo[t] ?? { path: "", numero: "", monto: "" };
      const d = facturaDraft[t] ?? ({ path: "", numero: "", monto: "" } as any);
      const dp = String((d as any).path ?? "").trim();
      const dn = String((d as any).numero ?? "").trim();
      const dm = String((d as any).monto ?? "").trim();
      return dp !== cur.path || dn !== cur.numero || dm !== cur.monto;
    });
  }, [facturaCurrentByTipo, facturaDraft, requiredTipos]);

  const facturaTipo1: "IVA" | "EXENTO" | null = useMemo(() => {
    if (!canFacturar) return null;
    if (needsIVA) return "IVA";
    if (needsEXENTO) return "EXENTO";
    return null;
  }, [canFacturar, needsEXENTO, needsIVA]);

  const facturaTipo2: "IVA" | "EXENTO" | null = useMemo(() => {
    if (!canFacturar) return null;
    if (needsIVA && needsEXENTO) return "EXENTO";
    return null;
  }, [canFacturar, needsEXENTO, needsIVA]);

  const facturaRequiredCount = requiredTipos.length;

  const pickAndUploadReceta = useCallback(async () => {
    if (!venta) return;
    if (!venta.requiere_receta) return;
    if (!canEditRecetas) return;
    if (uploading) return;

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
       const uri = asset?.uri;
       if (!uri) return;

       // Reduce size before upload (faster + less data)
       let uploadUri = uri;
       let ext = "jpg";
       let ct = "image/jpeg";
       try {
         const man = await ImageManipulator.manipulateAsync(
           uri,
           [{ resize: { width: 1600 } }],
           { compress: 0.78, format: ImageManipulator.SaveFormat.JPEG }
         );
         if (man?.uri) uploadUri = man.uri;
       } catch {
         const mimeType = String((asset as any)?.mimeType ?? "").trim();
         ext = extFromMime(mimeType);
         ct = mimeType || guessMimeFromExt(ext);
       }
       const stamp = Date.now();
       const rnd = Math.random().toString(16).slice(2);
       const path = `ventas/${venta.id}/recetas/${stamp}-${rnd}.${ext}`;

       setUploading(true);
       const bytes = await uriToBytes(uploadUri);

       const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, {
         contentType: ct,
         upsert: false,
       });
      if (upErr) throw upErr;

      const { error: rpcErr } = await supabase.rpc("rpc_venta_registrar_receta", {
        p_venta_id: Number(venta.id),
        p_path: path,
      });
      if (rpcErr) throw rpcErr;

      await fetchVenta();
      await fetchRecetas();

      // If the user is adding more than one receta, keep the newest visible.
      try {
        setTimeout(() => {
          try {
            scrollRef.current?.scrollToEnd?.({ animated: true });
          } catch {}
        }, 180);
      } catch {}
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo subir la receta");
    } finally {
      setUploading(false);
    }
  }, [canEditRecetas, fetchRecetas, fetchVenta, scrollRef, uploading, venta, returnTo]);

  const setNumero = useCallback((tipo: "IVA" | "EXENTO", val: string) => {
    setFacturaDraft((prev) => {
      const cur = prev[tipo] ?? { tipo, numero: "", monto: "", path: null, originalName: null, sizeBytes: null };
      return { ...prev, [tipo]: { ...cur, numero: val } };
    });
  }, []);

  const setMonto = useCallback((tipo: "IVA" | "EXENTO", val: string) => {
    const clean = sanitizeMontoDraftInput(val);
    setMontoTouched((prev) => (prev[tipo] ? prev : { ...prev, [tipo]: true }));
    setFacturaDraft((prev) => {
      const cur = prev[tipo] ?? { tipo, numero: "", monto: "", path: null, originalName: null, sizeBytes: null };
      return { ...prev, [tipo]: { ...cur, monto: clean } };
    });
  }, []);

  const pickAndUploadPdf = useCallback(
    async (tipo: "IVA" | "EXENTO") => {
      if (!venta) return;
      if (!canFacturar) return;
      if (uploadingPdfTipo) return;

      setUploadingPdfTipo(tipo);
      try {
        const res = await DocumentPicker.getDocumentAsync({
          type: "application/pdf",
          multiple: false,
          copyToCacheDirectory: true,
        });
        if (res.canceled) return;
        const asset = res.assets?.[0];
        const uri = asset?.uri;
        if (!uri) return;

        const stamp = Date.now();
        const rnd = Math.random().toString(16).slice(2);
        const path = `ventas/${venta.id}/facturas/${tipo}/${stamp}-${rnd}.pdf`;

        const bytes = await uriToBytes(uri);
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, {
          contentType: "application/pdf",
          upsert: false,
        });
        if (upErr) throw upErr;

        const name = (asset as any)?.name ?? null;
        const size = (asset as any)?.size ?? null;

        // 1) Guardar PDF en draft
        // 2) Autollenar monto por tipo (solo si no existe en DB, no lo tocaron manualmente y esta vacio/invalido)
        setFacturaDraft((prev) => {
          const cur = prev[tipo] ?? { tipo, numero: "", monto: "", path: null, originalName: null, sizeBytes: null };

          const dbMonto = String(facturaCurrentByTipo[tipo]?.monto ?? "").trim();
          const curMonto = String(cur?.monto ?? "").trim();
          const shouldAutoMonto = !dbMonto && !montoTouched[tipo] && !isValidMonto(curMonto);

          let nextMonto = cur.monto;
          if (shouldAutoMonto) {
            const totalTipo = tipo === "IVA" ? totalIVA : totalEXENTO;
            if (Number.isFinite(totalTipo) && totalTipo > 0) {
              nextMonto = sanitizeMontoDraftInput(Number(totalTipo).toFixed(2));
            }
          }

          return {
            ...prev,
            [tipo]: {
              ...cur,
              path,
              originalName: name ? String(name) : cur.originalName,
              sizeBytes: typeof size === "number" ? Number(size) : cur.sizeBytes,
              monto: String(nextMonto ?? ""),
            },
          };
        });

        // 3) Extraer No: desde el PDF (fallback silencioso; el usuario puede escribirlo)
        try {
          const { data, error } = await supabase.functions.invoke("invoice_extract", { body: { path } });
          console.log("[invoice_extract] invoke", { tipo, path, data, error });

          let payload: any = data as any;

          // If Edge returned non-2xx (FunctionsHttpError), fetch directly to capture the body.
          if (error && String((error as any)?.name ?? "") === "FunctionsHttpError") {
            try {
              const baseUrl = String(process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").trim();
              const anonKey = String(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
              if (baseUrl && anonKey) {
                const { data: sess } = await supabase.auth.getSession();
                const token = String(sess?.session?.access_token ?? anonKey);
                const url = `${baseUrl.replace(/\/+$/, "")}/functions/v1/invoice_extract`;
                const fr = await fetch(url, {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    apikey: anonKey,
                    authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ path }),
                });

                const raw = await fr.text().catch(() => "");
                let parsed: any = null;
                try {
                  parsed = raw ? JSON.parse(raw) : null;
                } catch {
                  parsed = raw;
                }
                console.log("[invoice_extract] fetch fallback", { tipo, path, status: fr.status, ok: fr.ok, body: parsed });
                if (parsed && typeof parsed === "object") payload = parsed;
              }
            } catch (fe: any) {
              console.log("[invoice_extract] fetch fallback error", { tipo, path, message: fe?.message, error: fe });
            }
          }

          if (payload?.ok === false) {
            Alert.alert("Aviso", "No se pudo leer No: del PDF, puedes escribirlo manualmente.");
            return;
          }

          const extractedNumero = String(payload?.numero ?? "").trim();
          if (!extractedNumero) return;

          setFacturaDraft((prev) => {
            const dbNumero = String(facturaCurrentByTipo[tipo]?.numero ?? "").trim();
            const prevNumero = String(prev?.[tipo]?.numero ?? "").trim();
            if (dbNumero || prevNumero) return prev;

            const cur = prev[tipo] ?? {
              tipo,
              numero: "",
              monto: "",
              path: null,
              originalName: null,
              sizeBytes: null,
            };

            return { ...prev, [tipo]: { ...cur, numero: extractedNumero } };
          });
        } catch (e: any) {
          console.log("[invoice_extract] error", { tipo, path, message: e?.message, error: e });
        }
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "No se pudo subir el PDF");
      } finally {
        setUploadingPdfTipo(null);
      }
    },
    [canFacturar, facturaCurrentByTipo, montoTouched, totalEXENTO, totalIVA, uploadingPdfTipo, venta]
  );

  const openFacturaPdf = useCallback(
    async (tipo: "IVA" | "EXENTO") => {
      if (!canFacturar) return;
      const d = facturaDraft[tipo];
      const path = String(d?.path ?? facturaCurrentByTipo[tipo]?.path ?? "").trim();
      if (!path) return;

      const { data: s, error: se } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 15);
      if (se) throw se;
      const url = (s as any)?.signedUrl ?? null;
      if (!url) throw new Error("No se pudo abrir el PDF");
      await openInBrowser(url);
    },
    [canFacturar, facturaCurrentByTipo, facturaDraft]
  );

  const deleteFactura = useCallback(
    async (tipo: "IVA" | "EXENTO") => {
      if (!venta) return;
      if (!canFacturar) return;

      const d = facturaDraft[tipo];
      const path = String(d?.path ?? facturaCurrentByTipo[tipo]?.path ?? "").trim();
      if (!path) return;

      Alert.alert("Eliminar factura", "Se eliminara el PDF y el registro. ¿Seguro?", [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              // 1) borrar archivo
              const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path]);
              if (rmErr) throw rmErr;

              // 2) borrar fila
              const { error: delErr } = await supabase
                .from("ventas_facturas")
                .delete()
                .eq("venta_id", Number(venta.id))
                .eq("tipo", tipo);
              if (delErr) throw delErr;

              setFacturaDraft((prev) => {
                const cur = prev[tipo] ?? { tipo, numero: "", monto: "", path: null, originalName: null, sizeBytes: null };
                return { ...prev, [tipo]: { ...cur, path: null, originalName: null, sizeBytes: null, numero: "", monto: "" } };
              });

              await fetchVenta();
              await fetchFacturas();
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "No se pudo eliminar la factura");
            }
          },
        },
      ]);
    },
    [canFacturar, facturaCurrentByTipo, facturaDraft, fetchFacturas, fetchVenta, venta]
  );

  const onFacturar = useCallback(async () => {
    if (!venta) return;
    if (!canFacturar) return;
    if (facturando) return;

    let payload: any[] = [];
    try {
      payload = buildFacturaPayload();
    } catch (e: any) {
      Alert.alert("Falta info", e?.message ?? "Completa numero, monto y PDF.");
      return;
    }

    setFacturando(true);
    try {
      const { error } = await supabase.rpc("rpc_venta_facturar", {
        p_venta_id: Number(venta.id),
        p_facturas: payload,
      });
      if (error) throw error;

      Alert.alert("Listo", "Venta facturada.");
      await fetchVenta();
      await fetchFacturas();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo facturar");
    } finally {
      setFacturando(false);
    }
  }, [buildFacturaPayload, canFacturar, facturando, fetchFacturas, fetchVenta, venta]);

  const pasarEnRuta = useCallback(
    async (nota?: string) => {
      if (!venta) return;
      if (!canBodega) return;
      if (enRutaLoading) return;
      if (!isFacturado) return;

      setEnRutaLoading(true);
      try {
        const { error } = await supabase.rpc("rpc_venta_pasar_en_ruta", {
          p_venta_id: Number(venta.id),
          p_nota: nota?.trim() ? nota.trim() : null,
        });
        if (error) throw error;

        Alert.alert("Listo", "Venta marcada como EN RUTA.");
        await fetchVenta();
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "No se pudo marcar EN RUTA");
      } finally {
        setEnRutaLoading(false);
      }
    },
    [canBodega, enRutaLoading, fetchVenta, isFacturado, venta]
  );

  const confirmPasarEnRuta = useCallback(() => {
    if (!venta) return;
    if (!canBodega) return;
    if (!isFacturado) return;

    if (Platform.OS === "ios" && typeof (Alert as any).prompt === "function") {
      (Alert as any).prompt(
        "Marcar EN RUTA",
        "Opcional: nota para auditoria",
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Confirmar", onPress: (text: string) => pasarEnRuta(text).catch(() => {}) },
        ],
        "plain-text"
      );
      return;
    }

    Alert.alert("Marcar EN RUTA", "¿Confirmas que esta venta ya esta empacada y sale a ruta?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Confirmar", onPress: () => pasarEnRuta().catch(() => {}) },
    ]);
  }, [canBodega, isFacturado, pasarEnRuta, venta]);

  const marcarEntregado = useCallback(
    async (nota?: string) => {
      if (!venta) return;
      if (!canEntregar) return;
      if (entregarLoading) return;
      if (!isEnRuta) return;

      setEntregarLoading(true);
      try {
        const { error } = await supabase.rpc("rpc_venta_marcar_entregada", {
          p_venta_id: Number(venta.id),
          p_nota: nota?.trim() ? nota.trim() : null,
        });
        if (error) throw error;

        Alert.alert("Listo", "Venta marcada como ENTREGADO.");
        await fetchVenta();
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "No se pudo marcar ENTREGADO");
      } finally {
        setEntregarLoading(false);
      }
    },
    [canEntregar, entregarLoading, fetchVenta, isEnRuta, venta]
  );

  const confirmMarcarEntregado = useCallback(() => {
    if (!venta) return;
    if (!canEntregar) return;
    if (!isEnRuta) return;

    if (Platform.OS === "ios" && typeof (Alert as any).prompt === "function") {
      (Alert as any).prompt(
        "Marcar ENTREGADO",
        "Opcional: nota para auditoria",
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Confirmar", onPress: (text: string) => marcarEntregado(text).catch(() => {}) },
        ],
        "plain-text"
      );
      return;
    }

    Alert.alert("Marcar ENTREGADO", "¿Confirmas que esta venta fue entregada?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Confirmar", onPress: () => marcarEntregado().catch(() => {}) },
    ]);
  }, [canEntregar, isEnRuta, marcarEntregado, venta]);

  const hasTag = useCallback(
    (t: string) => {
      const x = String(t ?? "").trim().toUpperCase();
      return tagsActivos.includes(x);
    },
    [tagsActivos]
  );

  const solicitudPendiente = useMemo(() => {
    return tagsActivos.some((t) => t === "PEND_AUTORIZACION_ADMIN" || t.startsWith("SOLICITA_"));
  }, [tagsActivos]);

  const anulada = useMemo(() => hasTag("ANULADO"), [hasTag]);
  const anulacionRequerida = useMemo(() => hasTag("ANULACION_REQUERIDA"), [hasTag]);
  const bloqueaLogistica = useMemo(
    () => anulada || anulacionRequerida,
    [anulada, anulacionRequerida]
  );

  const canAnular =
    (role === "ADMIN" || role === "FACTURACION") &&
    !anulada &&
    anulacionRequerida &&
    normalizeUpper(venta?.estado) === "FACTURADO";

  const runAnular = useCallback(async () => {
    if (!venta) return;
    if (!canAnular) return;
    if (anulando || facturando || uploadingPdfTipo) return;

    if (!facturaDraftComplete) {
      Alert.alert("Falta info", "Completa numero, monto y PDF de las facturas requeridas para anular.");
      return;
    }

    let payload: any[] = [];
    try {
      payload = buildFacturaPayload();
    } catch (e: any) {
      Alert.alert("Falta info", e?.message ?? "Completa numero, monto y PDF.");
      return;
    }

    setAnulando(true);
    try {
      // Guardar/upsert de facturas solo si hubo cambios (evita eventos extra).
      if (!isFacturado || facturaHasChanges) {
        const { error: fe } = await supabase.rpc("rpc_venta_facturar", {
          p_venta_id: Number(venta.id),
          p_facturas: payload,
        });
        if (fe) throw fe;
        await fetchFacturas();
      }

      const { error: ae } = await supabase.rpc("rpc_venta_anular", {
        p_venta_id: Number(venta.id),
        p_nota: null,
      });
      if (ae) throw ae;

      Alert.alert("Listo", "Venta anulada.", [{ text: "OK", onPress: () => goBackSafe("/(drawer)/(tabs)/ventas") }]);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo anular");
    } finally {
      setAnulando(false);
    }
  }, [anulando, buildFacturaPayload, canAnular, facturaDraftComplete, facturaHasChanges, facturando, fetchFacturas, isFacturado, uploadingPdfTipo, venta]);

  const confirmAnular = useCallback(() => {
    if (!venta) return;
    if (!canAnular) return;
    Alert.alert(
      "Anular venta",
      "Esto liberara el stock reservado y marcara la venta como ANULADA. ¿Confirmas?",
      [
        { text: "Cancelar", style: "cancel" },
        { text: anulando ? "..." : "Anular", style: "destructive", onPress: () => runAnular().catch(() => {}) },
      ]
    );
  }, [anulando, canAnular, runAnular, venta]);

  const edicionAutorizada = useMemo(() => {
    return hasTag("EDICION_REQUERIDA") && normalizeUpper(venta?.estado) === "NUEVO";
  }, [hasTag, venta?.estado]);

  const openSolicitud = useCallback((accion: "EDICION" | "ANULACION") => {
    setSolAccion(accion);
    setSolNota("");
    setSolOpen(true);
  }, []);

  const enviarSolicitud = useCallback(async () => {
    if (!venta) return;
    if (!canSolicitar) return;
    if (!solAccion) return;
    const nota = solNota.trim();
    if (!nota) {
      Alert.alert("Falta razon", "Debes escribir la razon de la solicitud.");
      return;
    }
    if (solSending) return;

    setSolSending(true);
    try {
      const { error } = await supabase.rpc("rpc_ventas_solicitar_accion", {
        p_venta_id: Number(venta.id),
        p_accion: solAccion,
        p_nota: nota,
      });
      if (error) throw error;

      // ADMIN: auto-aprobar (no requiere aprobacion manual)
      if (role === "ADMIN") {
        const { error: ae } = await supabase.rpc("rpc_admin_resolver_solicitud", {
          p_venta_id: Number(venta.id),
          p_decision: "APROBAR",
        });
        if (ae) throw ae;
      }

      setSolOpen(false);
      setSolAccion(null);
      setSolNota("");
      emitSolicitudesChanged();
      await fetchVenta();
      await fetchTags();
      Alert.alert("Listo", role === "ADMIN" ? "Solicitud aprobada." : "Solicitud enviada.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo enviar la solicitud");
    } finally {
      setSolSending(false);
    }
  }, [canSolicitar, fetchTags, fetchVenta, role, solAccion, solNota, solSending, venta]);

  const deleteReceta = useCallback(
    async (r: RecetaItem) => {
      if (!venta) return;
      if (!canEditRecetas) return;
      if (deletingId) return;

      const recetaId = Number(r.row.id);
      if (!recetaId) return;

      setDeletingId(recetaId);
      try {
        const path = normalizeStoragePath(r.row.path);
        const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path]);
        if (rmErr) throw rmErr;

        const { error: rpcErr } = await supabase.rpc("rpc_venta_borrar_receta", {
          p_receta_id: recetaId,
        });
        if (rpcErr) throw rpcErr;

        await fetchVenta();
        await fetchRecetas();
        // If caller requested a return path, go back there so the list can refresh.
        if (returnTo) {
          try {
            router.replace(returnTo as any);
            return;
          } catch {
            // ignore navigation error and stay on detail
          }
        }
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "No se pudo eliminar la receta");
      } finally {
        setDeletingId(null);
      }
    },
    [canEditRecetas, deletingId, fetchRecetas, fetchVenta, venta]
  );

  const confirmDelete = useCallback(
    (r: RecetaItem) => {
      Alert.alert("Eliminar receta", "Se eliminara la receta. ¿Seguro?", [
        { text: "Cancelar", style: "cancel" },
        { text: "Eliminar", style: "destructive", onPress: () => deleteReceta(r).catch(() => {}) },
      ]);
    },
    [deleteReceta]
  );

  const title = "Detalles";

  const badge = useMemo(() => {
    const estado = String(venta?.estado ?? "").trim().toUpperCase();
    if (!estado) return { text: "—", kind: "muted" as const };
    if (estado === "PENDIENTE") return { text: estado, kind: "warn" as const };
    if (estado === "ENTREGADA") return { text: estado, kind: "ok" as const };
    return { text: estado, kind: "muted" as const };
  }, [venta?.estado]);

  const badgeStyle = useMemo(() => {
    if (badge.kind === "ok") return { color: C.ok, bg: C.okBg };
    if (badge.kind === "warn") return { color: C.warnText, bg: C.warnBg };
    return { color: C.sub, bg: C.mutedBg };
  }, [badge.kind, C.ok, C.okBg, C.sub, C.mutedBg, C.warnBg, C.warnText]);

  const openViewer = useCallback(
    async (r: RecetaItem) => {
      if (!canViewRecetaTools) return;

      const path = normalizeStoragePath(r.row.path);
      let url = r.signedUrl;

      if (!url) {
        const { data: s, error: se } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 30);
        if (se) throw se;
        url = (s as any)?.signedUrl ?? null;
      }

      if (!url) throw new Error("No se pudo obtener URL de la receta");

      setViewerUrl(url);
      setViewerOpen(true);
      viewerOpacity.setValue(0);
      viewerScale.setValue(0.98);
      Animated.parallel([
        Animated.timing(viewerOpacity, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.timing(viewerScale, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    },
    [canViewRecetaTools, viewerOpacity, viewerScale]
  );

  const closeViewer = useCallback(() => {
    Animated.parallel([
      Animated.timing(viewerOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(viewerScale, { toValue: 0.98, duration: 140, useNativeDriver: true }),
    ]).start(() => {
      setViewerOpen(false);
      setViewerUrl(null);
    });
  }, [viewerOpacity, viewerScale]);

  const onDownloadViewer = useCallback(async () => {
    if (!viewerUrl) return;
    try {
      await saveImageToPhotos(viewerUrl);
      Alert.alert("Listo", "Receta guardada en Fotos");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo guardar la receta");
    }
  }, [viewerUrl]);

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

          {!Number.isFinite(ventaId) || ventaId <= 0 ? (
            <View style={[styles.card, { borderColor: C.border, backgroundColor: C.card }]}>
              <Text style={[styles.title, { color: C.text }]}>Venta invalida</Text>
              <Text style={[styles.sub, { color: C.sub }]}>No se encontro el ID de la venta.</Text>
              <AppButton title="Volver" onPress={() => goBackSafe("/(drawer)/(tabs)/ventas")} />
            </View>
          ) : null}

           {venta ? (
             <View style={[styles.card, { borderColor: C.border, backgroundColor: C.card }]}>
               <View style={styles.rowBetween}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={[styles.clientName, { color: C.text }]} numberOfLines={2}>
                      {venta.cliente_nombre ?? clienteMini?.nombre ?? "—"}
                    </Text>
                    {(Number(venta.cliente_id ?? 0) > 0 || clienteMini) ? (
                      <Text style={[styles.clientNit, { color: C.sub }]} numberOfLines={1}>
                        NIT: {clienteMini ? displayNit(clienteMini.nit) : "—"}
                      </Text>
                    ) : null}
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
                   <Text style={[styles.k, { color: C.sub }]}>Fecha</Text>
                   <Text style={[styles.v, { color: C.text }]} numberOfLines={1}>
                     {fmtDate(venta.fecha)}
                   </Text>
                 </View>
                 <View style={styles.kv}>
                   <Text style={[styles.k, { color: C.sub }]}>Teléfono</Text>
                   <Text style={[styles.v, { color: C.text }]} numberOfLines={1}>
                     {clienteMini?.telefono ?? "—"}
                   </Text>
                 </View>
                 <View style={styles.kv}>
                   <Text style={[styles.k, { color: C.sub }]}>Vendedor</Text>
                   <Text style={[styles.v, { color: C.text }]} numberOfLines={1}>
                     {venta.vendedor_codigo ? String(venta.vendedor_codigo) : shortUid(venta.vendedor_id)}
                   </Text>
                 </View>
               </View>

               <Text style={[styles.k, { color: C.sub, marginTop: 12 }]}>Dirección</Text>
               <Text style={[styles.note, { color: C.text, marginTop: 6 }]} numberOfLines={3}>
                 {clienteMini?.direccion ?? "—"}
               </Text>

               {venta.requiere_receta && !venta.receta_cargada ? (
                 <View style={styles.chipsRow}>
                   <View style={[styles.chip, { borderColor: C.border, backgroundColor: C.warnBg }]}>
                     <Text style={[styles.chipText, { color: C.warnText }]}>Falta receta</Text>
                  </View>
                </View>
              ) : null}

              {!!venta.comentarios ? (
                <Text style={[styles.note, { color: C.text }]}>Notas: {venta.comentarios}</Text>
              ) : null}

              {!!solicitudAnulacion?.solicitud_nota ? (
                <View
                  style={[
                    styles.warn,
                    {
                      borderColor: alphaColor(C.danger, isDark ? 0.35 : 0.25) || C.border,
                      backgroundColor: isDark ? "rgba(255,90,90,0.10)" : "rgba(220,0,0,0.06)",
                    },
                  ]}
                >
                  <Text style={[styles.warnText, { color: C.danger }]}>Razón de solicitud de anulación</Text>
                  <Text style={[styles.note, { color: C.text, marginTop: 6 }]}>{solicitudAnulacion.solicitud_nota}</Text>
                  <Text style={[styles.sub, { color: C.sub, marginTop: 6 }]}>Solicitado: {fmtDate(solicitudAnulacion.solicitud_fecha)} • Por: {solicitudAnulacionByName ?? shortUid(solicitudAnulacion.solicitud_user_id)}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Productos */}
          <View style={[styles.card, { borderColor: C.border, backgroundColor: C.card }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.sectionTitle, { color: C.text }]}>Productos</Text>
            </View>

            {!canSplitIva ? (
              <>
                {!lineas.length ? (
                  <Text style={{ paddingTop: 10, color: C.sub, fontWeight: "700" }}>Sin productos</Text>
                ) : (
                  <>
                    <View style={[styles.tableWrap, { borderColor: C.border }]}>
                      <View
                        style={[
                          styles.tableHeaderRow,
                          {
                            borderBottomColor: C.border,
                            backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                          },
                        ]}
                      >
                        <Text style={[styles.th, { color: C.sub, flex: 1 }]}>Detalle</Text>
                        <Text style={[styles.th, { color: C.sub, width: 140, textAlign: "right" }]}>Importe</Text>
                      </View>

                      {lineas.map((l) => {
                        const unit = Number(l.precio_venta_unit ?? 0);
                        const title = `${String(l.producto_nombre ?? "—")}${l.producto_marca ? ` • ${l.producto_marca}` : ""}`;
                        return (
                          <View key={l.id} style={[styles.tableRow, { borderTopColor: C.border }]}>
                            <View style={{ flex: 1, paddingRight: 10, minWidth: 0 }}>
                              <Text style={[styles.td, { color: C.text }]} numberOfLines={1}>
                                {title}
                              </Text>
                              <Text style={[styles.tdSub, { color: C.sub }]} numberOfLines={1}>
                                Lote: {l.lote ?? "—"}
                              </Text>
                              <Text style={[styles.tdSub, { color: C.sub }]} numberOfLines={1}>
                                Ven: {fmtDate(l.fecha_exp)}
                              </Text>
                            </View>

                            <View style={{ width: 140, paddingLeft: 8, alignItems: "flex-end" }}>
                              <Text style={[styles.td, { color: C.text }]} numberOfLines={1}>
                                {Number(l.cantidad ?? 0)} x {fmtQ(unit)}
                              </Text>
                            </View>
                          </View>
                        );
                      })}

                      <View
                        style={[
                          styles.tableFooterRow,
                          {
                            borderTopColor: C.border,
                            backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                          },
                        ]}
                      >
                        <Text style={[styles.td, { color: C.sub, flex: 1 }]}>Total</Text>
                        <Text style={[styles.td, { color: C.text, width: 140, textAlign: "right" }]}>{fmtQ(total)}</Text>
                      </View>
                    </View>
                  </>
                )}
              </>
            ) : (
              <>
                <Text style={[styles.groupLabel, { color: C.sub }]}>IVA</Text>
                {!ivaLineas.length ? (
                  <Text style={{ paddingTop: 10, color: C.sub, fontWeight: "700" }}>Sin productos</Text>
                ) : (
                  <>
                    <View style={[styles.tableWrap, { borderColor: C.border }]}>
                      <View
                        style={[
                          styles.tableHeaderRow,
                          {
                            borderBottomColor: C.border,
                            backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                          },
                        ]}
                      >
                        <Text style={[styles.th, { color: C.sub, flex: 1 }]}>Detalle</Text>
                        <Text style={[styles.th, { color: C.sub, width: 140, textAlign: "right" }]}>Importe</Text>
                      </View>

                      {ivaLineas.map((l) => {
                        const unit = Number(l.precio_venta_unit ?? 0);
                        const title = `${String(l.producto_nombre ?? "—")}${l.producto_marca ? ` • ${l.producto_marca}` : ""}`;
                        return (
                          <View key={l.id} style={[styles.tableRow, { borderTopColor: C.border }]}>
                            <View style={{ flex: 1, paddingRight: 10, minWidth: 0 }}>
                              <Text style={[styles.td, { color: C.text }]} numberOfLines={1}>
                                {title}
                              </Text>
                              <Text style={[styles.tdSub, { color: C.sub }]} numberOfLines={1}>
                                Lote: {l.lote ?? "—"}
                              </Text>
                              <Text style={[styles.tdSub, { color: C.sub }]} numberOfLines={1}>
                                Vence: {fmtDate(l.fecha_exp)}
                              </Text>
                            </View>

                            <View style={{ width: 140, paddingLeft: 8, alignItems: "flex-end" }}>
                              <Text style={[styles.td, { color: C.text }]} numberOfLines={1}>
                                {Number(l.cantidad ?? 0)} x {fmtQ(unit)}
                              </Text>
                            </View>
                          </View>
                        );
                      })}

                      <View
                        style={[
                          styles.tableFooterRow,
                          {
                            borderTopColor: C.border,
                            backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                          },
                        ]}
                      >
                        <Text style={[styles.td, { color: C.sub, flex: 1 }]}>Total IVA</Text>
                        <Text style={[styles.td, { color: C.text, width: 140, textAlign: "right" }]}>
                          {fmtQ(ivaLineas.reduce((acc, l) => acc + Number(l.subtotal ?? 0), 0))}
                        </Text>
                      </View>
                    </View>
                  </>
                )}

                <View style={[styles.divider, { backgroundColor: C.border }]} />
                <Text style={[styles.groupLabel, { color: C.sub }]}>EXENTO</Text>
                {!exentoLineas.length ? (
                  <Text style={{ paddingTop: 10, color: C.sub, fontWeight: "700" }}>Sin productos</Text>
                ) : (
                  <>
                    <View style={[styles.tableWrap, { borderColor: C.border }]}>
                      <View
                        style={[
                          styles.tableHeaderRow,
                          {
                            borderBottomColor: C.border,
                            backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                          },
                        ]}
                      >
                        <Text style={[styles.th, { color: C.sub, flex: 1 }]}>Detalle</Text>
                        <Text style={[styles.th, { color: C.sub, width: 140, textAlign: "right" }]}>Importe</Text>
                      </View>

                      {exentoLineas.map((l) => {
                        const unit = Number(l.precio_venta_unit ?? 0);
                        const title = `${String(l.producto_nombre ?? "—")}${l.producto_marca ? ` • ${l.producto_marca}` : ""}`;
                        return (
                          <View key={l.id} style={[styles.tableRow, { borderTopColor: C.border }]}>
                            <View style={{ flex: 1, paddingRight: 10, minWidth: 0 }}>
                              <Text style={[styles.td, { color: C.text }]} numberOfLines={1}>
                                {title}
                              </Text>
                              <Text style={[styles.tdSub, { color: C.sub }]} numberOfLines={1}>
                                Lote: {l.lote ?? "—"}
                              </Text>
                              <Text style={[styles.tdSub, { color: C.sub }]} numberOfLines={1}>
                                Ven: {fmtDate(l.fecha_exp)}
                              </Text>
                            </View>

                            <View style={{ width: 140, paddingLeft: 8, alignItems: "flex-end" }}>
                              <Text style={[styles.td, { color: C.text }]} numberOfLines={1}>
                                {Number(l.cantidad ?? 0)} x {fmtQ(unit)}
                              </Text>
                            </View>
                          </View>
                        );
                      })}

                      <View
                        style={[
                          styles.tableFooterRow,
                          {
                            borderTopColor: C.border,
                            backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                          },
                        ]}
                      >
                        <Text style={[styles.td, { color: C.sub, flex: 1 }]}>Total EXENTO</Text>
                        <Text style={[styles.td, { color: C.text, width: 140, textAlign: "right" }]}>
                          {fmtQ(exentoLineas.reduce((acc, l) => acc + Number(l.subtotal ?? 0), 0))}
                        </Text>
                      </View>
                    </View>
                  </>
                )}

                <View style={[styles.totalRow, { borderTopColor: C.border }]}>
                  <Text style={[styles.totalLabel, { color: C.sub }]}>Total</Text>
                  <Text style={[styles.totalValue, { color: C.text }]}>{fmtQ(total)}</Text>
                </View>
              </>
            )}
          </View>

          {/* Documentos: Facturas + Recetas */}
          <View style={[styles.card, { borderColor: C.border, backgroundColor: C.card }]}
          >
            <Text style={[styles.sectionTitle, { color: C.text }]}>Documentos</Text>

            <Text style={[styles.blockTitle, { color: C.sub }]}>Facturas</Text>

            {canFacturar ? (
              <>
                <Text style={[styles.sub, { color: C.sub }]}>
                  {canAnular
                    ? "Sube el PDF primero; se autollenan numero (No:) y monto. Completa/ajusta lo necesario para anular."
                    : "Sube el PDF primero; se autollenan numero (No:) y monto. Completa/ajusta lo necesario para facturar."}
                </Text>

                {!facturaRequiredCount ? null : (
                  <Text style={[styles.sub, { color: C.sub, marginTop: 6 }]}
                  >
                    {facturaRequiredCount === 1
                      ? "Esta venta requiere 1 factura (segun el tipo de productos)."
                      : "Esta venta requiere 2 facturas (IVA y EXENTO)."}
                  </Text>
                )}

                {facturaTipo1
                  ? (() => {
                      const tipo = facturaTipo1 as "IVA" | "EXENTO";
                      const hasPdf = !!String(facturaDraft[tipo]?.path ?? facturaCurrentByTipo[tipo]?.path ?? "").trim();
                      const numeroDb = String(facturaCurrentByTipo[tipo]?.numero ?? "").trim();
                      const montoDb = String(facturaCurrentByTipo[tipo]?.monto ?? "").trim();
                      const draftNumero = facturaDraft[tipo]?.numero;
                      const draftMonto = facturaDraft[tipo]?.monto;
                      return (
                        <View style={[styles.facturaCard, { borderColor: C.border }]}>
                          <View style={styles.rowBetween}>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={[styles.facturaTitle, { color: C.text }]}>
                                {tipo === "IVA" ? "Factura con IVA" : "Factura Exenta"}
                              </Text>
                              <Text style={[styles.facturaMeta, { color: C.sub, marginTop: 2 }]}>Factura 1</Text>
                            </View>
                            {hasPdf ? null : (
                              <AppButton
                                title={uploadingPdfTipo === tipo ? "Subiendo..." : "Subir PDF"}
                                size="sm"
                                onPress={() => pickAndUploadPdf(tipo)}
                                disabled={!!uploadingPdfTipo || facturando}
                              />
                            )}
                          </View>

                          <View style={styles.facturaInputsRow}>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={[styles.label, { color: C.sub }]}>Numero de factura *</Text>
                              <TextInput
                                value={draftNumero ?? numeroDb}
                                onChangeText={(t: string) => setNumero(tipo, t)}
                                onFocus={handleFocus}
                                placeholder="Ej: 12345"
                                placeholderTextColor={C.sub}
                                style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.card }]}
                              />
                            </View>

                            <View style={styles.facturaMontoCol}>
                              <Text style={[styles.label, { color: C.sub }]}>Monto de factura (Q)</Text>
                              <TextInput
                                value={draftMonto ?? montoDb}
                                onChangeText={(t: string) => setMonto(tipo, t)}
                                onFocus={handleFocus}
                                placeholder="Ej: 1250.00"
                                placeholderTextColor={C.sub}
                                keyboardType={Platform.OS === "ios" ? "decimal-pad" : "numeric"}
                                style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.card }]}
                              />
                            </View>
                          </View>

                          <Text style={[styles.facturaMeta, { color: C.sub }]}>PDF: {hasPdf ? "Listo" : "Pendiente"}</Text>

                          {hasPdf ? (
                            <View style={styles.pdfRow}>
                              <Pressable
                                onPress={() => openFacturaPdf(tipo).catch(() => {})}
                                style={({ pressed }) => [styles.pdfOpen, pressed ? { opacity: 0.85 } : null]}
                              >
                                <View style={styles.pdfThumb}>
                                  <Text style={styles.pdfThumbText}>PDF</Text>
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={[styles.pdfOpenTitle, { color: C.text }]}>Ver PDF</Text>
                                  <Text style={[styles.pdfOpenSub, { color: C.sub }]} numberOfLines={1}>
                                    {facturaDraft[tipo]?.originalName ?? "Factura"}
                                  </Text>
                                </View>
                              </Pressable>

                              <Pressable
                                onPress={() => deleteFactura(tipo).catch(() => {})}
                                style={({ pressed }) => [styles.pdfDelete, pressed ? { opacity: 0.85 } : null]}
                              >
                                <Text style={[styles.pdfDeleteText, { color: C.danger }]}>Eliminar</Text>
                              </Pressable>
                            </View>
                          ) : null}
                        </View>
                      );
                    })()
                  : null}

                {facturaTipo2
                  ? (() => {
                      const tipo = facturaTipo2 as "IVA" | "EXENTO";
                      const hasPdf = !!String(facturaDraft[tipo]?.path ?? facturaCurrentByTipo[tipo]?.path ?? "").trim();
                      const numeroDb = String(facturaCurrentByTipo[tipo]?.numero ?? "").trim();
                      const montoDb = String(facturaCurrentByTipo[tipo]?.monto ?? "").trim();
                      const draftNumero = facturaDraft[tipo]?.numero;
                      const draftMonto = facturaDraft[tipo]?.monto;
                      return (
                        <View style={[styles.facturaCard, { borderColor: C.border }]}>
                          <View style={styles.rowBetween}>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={[styles.facturaTitle, { color: C.text }]}>
                                {tipo === "IVA" ? "Factura con IVA" : "Factura Exenta"}
                              </Text>
                              <Text style={[styles.facturaMeta, { color: C.sub, marginTop: 2 }]}>Factura 2</Text>
                            </View>
                            {hasPdf ? null : (
                              <AppButton
                                title={uploadingPdfTipo === tipo ? "Subiendo..." : "Subir PDF"}
                                size="sm"
                                onPress={() => pickAndUploadPdf(tipo)}
                                disabled={!!uploadingPdfTipo || facturando}
                              />
                            )}
                          </View>

                          <View style={styles.facturaInputsRow}>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={[styles.label, { color: C.sub }]}>Numero de factura *</Text>
                              <TextInput
                                value={draftNumero ?? numeroDb}
                                onChangeText={(t: string) => setNumero(tipo, t)}
                                onFocus={handleFocus}
                                placeholder="Ej: 12346"
                                placeholderTextColor={C.sub}
                                style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.card }]}
                              />
                            </View>

                            <View style={styles.facturaMontoCol}>
                              <Text style={[styles.label, { color: C.sub }]}>Monto de factura (Q)</Text>
                              <TextInput
                                value={draftMonto ?? montoDb}
                                onChangeText={(t: string) => setMonto(tipo, t)}
                                onFocus={handleFocus}
                                placeholder="Ej: 1250.00"
                                placeholderTextColor={C.sub}
                                keyboardType={Platform.OS === "ios" ? "decimal-pad" : "numeric"}
                                style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.card }]}
                              />
                            </View>
                          </View>

                          <Text style={[styles.facturaMeta, { color: C.sub }]}>PDF: {hasPdf ? "Listo" : "Pendiente"}</Text>

                          {hasPdf ? (
                            <View style={styles.pdfRow}>
                              <Pressable
                                onPress={() => openFacturaPdf(tipo).catch(() => {})}
                                style={({ pressed }) => [styles.pdfOpen, pressed ? { opacity: 0.85 } : null]}
                              >
                                <View style={styles.pdfThumb}>
                                  <Text style={styles.pdfThumbText}>PDF</Text>
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={[styles.pdfOpenTitle, { color: C.text }]}>Ver PDF</Text>
                                  <Text style={[styles.pdfOpenSub, { color: C.sub }]} numberOfLines={1}>
                                    {facturaDraft[tipo]?.originalName ?? "Factura"}
                                  </Text>
                                </View>
                              </Pressable>

                              <Pressable
                                onPress={() => deleteFactura(tipo).catch(() => {})}
                                style={({ pressed }) => [styles.pdfDelete, pressed ? { opacity: 0.85 } : null]}
                              >
                                <Text style={[styles.pdfDeleteText, { color: C.danger }]}>Eliminar</Text>
                              </Pressable>
                            </View>
                          ) : null}
                        </View>
                      );
                    })()
                  : null}

              <View style={{ height: 10 }} />
              {!canAnular && !isNuevo ? null : (
                <AppButton
                  title={
                    canAnular
                      ? (anulando ? "Anulando..." : "Anular venta")
                      : facturando
                        ? "Facturando..."
                        : "Facturar"
                  }
                  onPress={canAnular ? confirmAnular : onFacturar}
                  disabled={
                    canAnular
                      ? (
                          anulando ||
                          facturando ||
                          !!uploadingPdfTipo ||
                          (!facturaTipo1 && !facturaTipo2) ||
                          !facturaDraftComplete
                        )
                      : (
                          facturando ||
                          !!uploadingPdfTipo ||
                          (!facturaTipo1 && !facturaTipo2) ||
                          !facturaDraftComplete
                        )
                  }
                />
              )}
              </>
            ) : (
              <>
                {facturaNumeros.length ? (
                  <Text style={[styles.facturasFlat, { color: C.text }]}>{facturaNumeros.join(", ")}</Text>
                ) : (
                  <Text style={[styles.facturasFlat, { color: C.text }]}>Sin facturas</Text>
                )}

                {(facturas ?? []).length ? (
                  <View style={{ marginTop: 10, gap: 10 }}>
                    {(facturas ?? []).slice(0, 2).map((f, idx) => {
                      const path = String((f as any)?.path ?? "").trim();
                      const numero = String((f as any)?.numero_factura ?? "").trim();
                      const name = String((f as any)?.original_name ?? "Factura.pdf").trim() || "Factura.pdf";
                      const label = `Factura ${idx + 1}${numero ? `: ${numero}` : ""}`;

                      return (
                        <View key={String((f as any).id)} style={[styles.pdfRow, { alignItems: "flex-start" }]}>
                          <Pressable
                            disabled={!canVerFacturas || !path}
                            onPress={async () => {
                              try {
                                const { data: s, error: se } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 15);
                                if (se) throw se;
                                const url = (s as any)?.signedUrl ?? null;
                                if (!url) throw new Error("No se pudo abrir el PDF");
                                await openInBrowser(url);
                              } catch (e: any) {
                                Alert.alert("Error", e?.message ?? "No se pudo abrir la factura");
                              }
                            }}
                            style={({ pressed }) => [styles.pdfOpen, pressed ? { opacity: 0.85 } : null]}
                          >
                            <View style={styles.pdfThumb}>
                              <Text style={styles.pdfThumbText}>PDF</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.pdfOpenTitle, { color: C.text }]} numberOfLines={1}>
                                {label}
                              </Text>
                              <Text style={[styles.pdfOpenSub, { color: C.sub }]} numberOfLines={1}>
                                Ver factura
                              </Text>
                            </View>
                          </Pressable>

                          <Pressable
                            disabled={!canVerFacturas || !path}
                            onPress={async () => {
                              try {
                                const { data: s, error: se } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 15);
                                if (se) throw se;
                                const url = (s as any)?.signedUrl ?? null;
                                if (!url) throw new Error("No se pudo descargar");
                                await downloadAndShareFile(url, name);
                              } catch (e: any) {
                                Alert.alert("Error", e?.message ?? "No se pudo descargar la factura");
                              }
                            }}
                            style={({ pressed }) => [styles.pdfDelete, pressed ? { opacity: 0.85 } : null]}
                          >
                            <Text style={[styles.pdfDeleteText, { color: C.text }]}>Descargar</Text>
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </>
            )}

            {!venta?.requiere_receta ? null : (
              <>
                <View style={[styles.divider, { backgroundColor: C.border }]} />

                <View style={styles.rowBetween}>
                  <Text style={[styles.blockTitle, { color: C.sub }]}>Recetas</Text>
                  {!canEditRecetas ? null : (
                    <AppButton
                      title={uploading ? "Subiendo..." : "+ Agregar receta"}
                      size="sm"
                      variant="outline"
                      onPress={pickAndUploadReceta}
                      disabled={uploading}
                      accessibilityLabel="Agregar receta"
                    />
                  )}
                </View>

                {recetas.length ? (
                  <View style={{ marginTop: 10, gap: 12 }}>
                    {recetas.map((r) => {
                      const isDeleting = deletingId === Number(r.row.id);
                      return (
                        <View key={r.row.id} style={[styles.recetaRow, { borderColor: C.border }]}>
                          <Pressable
                            disabled={!canViewRecetaTools}
                            onPress={() => {
                              openViewer(r).catch((e: any) => {
                                Alert.alert("Error", e?.message ?? "No se pudo abrir la receta");
                              });
                            }}
                            style={({ pressed }) => [pressed && canViewRecetaTools ? { opacity: 0.85 } : null]}
                          >
                            {r.signedUrl ? (
                              <Image source={{ uri: r.signedUrl }} style={styles.recetaThumb} />
                            ) : (
                              <View
                                style={[
                                  styles.recetaThumb,
                                  { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "#f3f3f3" },
                                ]}
                              />
                            )}
                          </Pressable>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.lineTitle, { color: C.text }]} numberOfLines={1}>
                              {fmtDate(r.row.created_at)}
                            </Text>
                            <Text style={[styles.lineSub, { color: C.sub }]} numberOfLines={1}>
                              Receta
                            </Text>
                          </View>

                          {!canEditRecetas ? null : (
                            <Pressable
                              disabled={isDeleting}
                              onPress={() => confirmDelete(r)}
                              style={({ pressed }) => [
                                styles.deleteBtn,
                                { opacity: isDeleting ? 0.5 : pressed ? 0.85 : 1 },
                              ]}
                            >
                              <Text style={{ color: C.danger, fontWeight: "800" }}>{isDeleting ? "..." : "Eliminar"}</Text>
                            </Pressable>
                          )}
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={{ marginTop: 10, color: C.sub, fontWeight: "700" }}>Sin recetas</Text>
                )}
              </>
            )}
          </View>

          {/* Solicitudes (VENTAS) */}
          {!canSolicitar || !venta || anulada ? null : (
            <View style={[styles.card, { borderColor: C.border, backgroundColor: C.card }]}> 
              <View style={styles.rowBetween}>
                <Text style={[styles.sectionTitle, { color: C.text }]}>Solicitudes</Text>
                {solicitudPendiente ? (
                  <Text style={[styles.blockTitle, { color: C.sub }]}>PENDIENTE</Text>
                ) : edicionAutorizada ? (
                  <Text style={[styles.blockTitle, { color: C.sub }]}>AUTORIZADO</Text>
                ) : null}
              </View>

              {solicitudPendiente ? (
                <Text style={[styles.sub, { color: C.sub }]}>Ya hay una solicitud pendiente de aprobación.</Text>
              ) : edicionAutorizada ? (
                <>
                  <Text style={[styles.sub, { color: C.sub }]}>Edición autorizada por admin.</Text>
                  <View style={{ height: 10 }} />
                  <AppButton
                    title="Editar venta"
                    onPress={() => router.push({ pathname: "/venta-nueva", params: { editId: String(venta.id) } } as any)}
                  />
                </>
              ) : normalizeUpper(venta.estado) === "NUEVO" ? (
                <>
                  <Text style={[styles.sub, { color: C.sub }]}>Solicita autorización para editar esta venta.</Text>
                  <View style={{ height: 10 }} />
                  <AppButton title="Solicitar edición" onPress={() => openSolicitud("EDICION")} />
                </>
              ) : (
                <>
                  <Text style={[styles.sub, { color: C.sub }]}>Solicita autorización para anular.</Text>
                  <View style={{ height: 10 }} />
                  <AppButton
                    title="Solicitar anulación"
                    size="sm"
                    variant="outline"
                    onPress={() => openSolicitud("ANULACION")}
                    style={{ borderColor: C.danger, backgroundColor: isDark ? "rgba(255,90,90,0.10)" : "rgba(220,0,0,0.06)" }}
                    textStyle={{ color: C.danger }}
                  />
                </>
              )}
            </View>
          )}

          {/* Bodega */}
          {!canBodega || !venta || !isFacturado || bloqueaLogistica ? null : (
            <View style={[styles.card, { borderColor: C.border, backgroundColor: C.card }]}
            >
              <View style={styles.rowBetween}>
                <Text style={[styles.sectionTitle, { color: C.text }]}>Bodega</Text>
                <Text style={[styles.blockTitle, { color: C.sub }]}>FACTURADO</Text>
              </View>
              <Text style={[styles.sub, { color: C.sub }]}>Venta lista para entregar.</Text>
              <View style={{ height: 10 }} />
              <AppButton
                title={enRutaLoading ? "Marcando..." : "Marcar en ruta"}
                onPress={confirmPasarEnRuta}
                disabled={enRutaLoading}
              />
            </View>
          )}

          {/* Entrega */}
          {!canEntregar || !venta || !isEnRuta || bloqueaLogistica ? null : (
            <View style={[styles.card, { borderColor: C.border, backgroundColor: C.card }]}
            >
              <View style={styles.rowBetween}>
                <Text style={[styles.sectionTitle, { color: C.text }]}>Entrega</Text>
                <Text style={[styles.blockTitle, { color: C.sub }]}>EN RUTA</Text>
              </View>
              <Text style={[styles.sub, { color: C.sub }]}>Marca la venta como entregada al cliente.</Text>
              <View style={{ height: 10 }} />
              <AppButton
                title={entregarLoading ? "Marcando..." : "Marcar entregado"}
                onPress={confirmMarcarEntregado}
                disabled={entregarLoading}
              />
            </View>
          )}
          </ScrollView>
        </KeyboardAvoidingView>

        <KeyboardAwareModal
          visible={solOpen}
          onClose={() => setSolOpen(false)}
          cardStyle={{ backgroundColor: C.card, borderColor: C.border }}
          backdropOpacity={isDark ? 0.6 : 0.4}
        >
          <Text style={[styles.sectionTitle, { color: C.text }]}>Razón</Text>
          <Text style={[styles.sub, { color: C.sub }]}>{solAccion ? `Solicitud: ${solAccion}` : ""}</Text>
          <TextInput
            value={solNota}
            onChangeText={setSolNota}
            placeholder="Escribe la razón..."
            placeholderTextColor={C.sub}
            multiline
            style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.card, height: 90 }]}
          />
          <View style={{ height: 10 }} />
          <View style={{ flexDirection: "row", gap: 10, justifyContent: "flex-end" }}>
            <AppButton title="Cancelar" variant="outline" size="sm" onPress={() => setSolOpen(false)} disabled={solSending} />
            <AppButton title={solSending ? "Enviando..." : "Enviar"} size="sm" onPress={enviarSolicitud} disabled={solSending} />
          </View>
        </KeyboardAwareModal>

        {viewerOpen ? (
          <Modal visible={viewerOpen} transparent animationType="none" onRequestClose={closeViewer}>
            <Pressable
              style={[
                styles.viewerBackdrop,
                { backgroundColor: isDark ? "rgba(0,0,0,0.60)" : "rgba(0,0,0,0.40)" },
              ]}
              onPress={closeViewer}
            />

            <Animated.View
              style={[
                styles.viewerFull,
                {
                  opacity: viewerOpacity,
                  transform: [{ scale: viewerScale }],
                },
              ]}
            >
              <View style={[styles.viewerTopBar, { top: Math.max(12, insets.top + 10) }]}>
                <Pressable
                  onPress={closeViewer}
                  style={({ pressed }) => [styles.viewerTopBtn, pressed ? { opacity: 0.8 } : null]}
                >
                  <Text style={styles.viewerTopBtnText}>Cerrar</Text>
                </Pressable>

                <Pressable
                  onPress={onDownloadViewer}
                  disabled={!viewerUrl}
                  style={({ pressed }) => [
                    styles.viewerTopBtn,
                    !viewerUrl ? { opacity: 0.5 } : null,
                    pressed ? { opacity: 0.8 } : null,
                  ]}
                >
                  <Text style={styles.viewerTopBtnText}>Descargar</Text>
                </Pressable>
              </View>

              <ImageViewer
                imageUrls={viewerUrl ? [{ url: viewerUrl }] : []}
                enableSwipeDown
                onSwipeDown={closeViewer}
                onCancel={closeViewer}
                backgroundColor="transparent"
                renderIndicator={() => <View />}
                saveToLocalByLongPress={false}
              />
            </Animated.View>
          </Modal>
        ) : null}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1, paddingHorizontal: 16 },

  card: { borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 10 },
  title: { fontSize: 18, fontWeight: "800" },
  clientName: { fontSize: 16, fontWeight: "800" },
  clientNit: { marginTop: 4, fontSize: 13, fontWeight: "700" },
  sub: { marginTop: 6, fontSize: 13, fontWeight: "700" },
  note: { marginTop: 10, fontSize: 13, fontWeight: "600", lineHeight: 18 },

  metaRow: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  metaText: { fontSize: 13, fontWeight: "700" },
  metaDot: { fontSize: 13, fontWeight: "900" },

  chipsRow: { marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: "900" },

  badgePill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, alignSelf: "flex-start" },
  badgeText: { fontSize: 12, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase" },

  kvGrid: { marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 14 },
  kv: { minWidth: 140, flexBasis: 140, flexGrow: 1 },
  k: { fontSize: 12, fontWeight: "800" },
  v: { marginTop: 3, fontSize: 14, fontWeight: "800" },

  sectionTitle: { fontSize: 15, fontWeight: "900" },
  sectionTotal: { fontSize: 15, fontWeight: "900" },
  blockTitle: { marginTop: 10, fontSize: 12, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase" },
  groupLabel: { marginTop: 12, fontSize: 12, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase" },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 14, marginBottom: 10 },

  label: { marginTop: 10, marginBottom: 6, fontSize: 13, fontWeight: "800" },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 12, android: 10, default: 10 }),
    fontSize: 16,
  },

  warn: { marginTop: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  warnText: { fontSize: 12, fontWeight: "900" },

  lineRow: { paddingTop: 12, marginTop: 12, borderTopWidth: 1, flexDirection: "row", gap: 12 },
  lineTitle: { fontSize: 14, fontWeight: "800" },
  lineSub: { marginTop: 4, fontSize: 12, fontWeight: "700" },
  lineAmt: { fontSize: 13, fontWeight: "800" },

  tableWrap: { marginTop: 10, borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  tableHeaderRow: { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: 1 },
  tableRow: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  tableFooterRow: { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 12, borderTopWidth: 1 },
  th: { fontSize: 11, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase" },
  td: { fontSize: 13, fontWeight: "800" },
  tdSub: { marginTop: 2, fontSize: 12, fontWeight: "700" },


  totalRow: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between" },
  totalLabel: { fontSize: 15, fontWeight: "900" },
  totalValue: { fontSize: 15, fontWeight: "900" },

  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  recetaRow: { borderWidth: 1, borderRadius: 14, padding: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  recetaThumb: { width: 52, height: 52, borderRadius: 12 },
  deleteBtn: { paddingHorizontal: 10, paddingVertical: 8 },

  facturaCard: { marginTop: 12, borderWidth: 1, borderRadius: 14, padding: 12 },
  facturaTitle: { fontSize: 14, fontWeight: "900" },
  facturaMeta: { marginTop: 8, fontSize: 12, fontWeight: "800" },
  facturasFlat: { marginTop: 10, fontSize: 16, fontWeight: "900" },

  facturaInputsRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  facturaMontoCol: { width: 150 },

  pdfRow: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  pdfOpen: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  pdfThumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(220,0,0,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  pdfThumbText: { fontSize: 12, fontWeight: "900", color: "#F02849" },
  pdfOpenTitle: { fontSize: 14, fontWeight: "900" },
  pdfOpenSub: { marginTop: 2, fontSize: 12, fontWeight: "700" },
  pdfDelete: { paddingHorizontal: 10, paddingVertical: 8 },
  pdfDeleteText: { fontSize: 13, fontWeight: "900" },

  viewerBackdrop: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  viewerFull: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  viewerTopBar: {
    position: "absolute",
    left: 18,
    right: 18,
    zIndex: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  viewerTopBtn: {
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
  },
  viewerTopBtnText: { color: "#fff", fontWeight: "900", fontSize: 16 },
  viewerCard: {
    position: "absolute",
    left: 14,
    right: 14,
    top: "12%",
    bottom: "12%",
    borderWidth: 1,
    borderRadius: 18,
    overflow: "hidden",
  },
  viewerTop: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  viewerTitle: { fontSize: 16, fontWeight: "900" },
  viewerImgWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.06)" },
  viewerImg: { width: "100%", height: "100%" },
  viewerBtns: { padding: 14, flexDirection: "row", justifyContent: "flex-end", alignItems: "center" },

});
