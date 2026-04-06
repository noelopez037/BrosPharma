// components/ventas/VentaNuevaForm.tsx
// Pure form component — no navigation imports.
// Used inside VentaNuevaModal on web (create-only, no edit mode).

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
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
import { useVentaDraft } from "../../lib/ventaDraft";
import { useEmpresaActiva } from "../../lib/useEmpresaActiva";
import { useRole } from "../../lib/useRole";
import { generarCotizacionPdf } from "../../lib/cotizacionPdf";
import { extFromUri, mimeFromExt, uriToArrayBuffer } from "../../lib/utils/file";
import { fmtQ, parseIntSafe, parseDecimalSafe } from "../../lib/utils/format";
import { safeIlike } from "../../lib/utils/text";

// ─── helpers ────────────────────────────────────────────────────────────────

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
  mode?: "create" | "edit" | "cotizacion";
  ventaId?: number | null;
};

// ─── component ───────────────────────────────────────────────────────────────

export function VentaNuevaForm({ onDone, onCancel, isDark, colors: C, canCreate, mode = "create", ventaId = null }: Props) {
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
  const { empresaActivaId, empresas, isReady: empresaReady } = useEmpresaActiva();
  const { role, uid, isReady: roleReady } = useRole();
  const roleUpNF = String(role ?? "").trim().toUpperCase();
  const isVentas = roleReady && (roleUpNF === "VENTAS" || roleUpNF === "MENSAJERO");

  const isEdit = mode === "edit" && !!ventaId;
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [originalQtyByProd, setOriginalQtyByProd] = useState<Record<string, number>>({});
  const [stockBaseByProd, setStockBaseByProd] = useState<Record<string, number>>({});
  const loadedEditIdRef = useRef<number | null>(null);
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);

  // Reset or load edit data on mount / when ventaId changes
  useEffect(() => {
    if (!isEdit || !ventaId) {
      reset();
      return;
    }
    if (loadedEditIdRef.current === ventaId) return;
    let alive = true;
    (async () => {
      try {
        setLoadingEdit(true);
        reset();
        setOriginalQtyByProd({});
        setStockBaseByProd({});

        if (!empresaActivaId) throw new Error("Sin empresa activa");

        const { data: trows, error: te } = await supabase
          .from("ventas_tags")
          .select("tag")
          .eq("empresa_id", empresaActivaId)
          .eq("venta_id", ventaId)
          .is("removed_at", null)
          .in("tag", ["EDICION_REQUERIDA"])
          .limit(1);
        if (te) throw te;
        if (!trows?.length) throw new Error("No hay autorizacion de edicion para esta venta");

        const { data: v, error: ve } = await supabase
          .from("ventas")
          .select("id,cliente_id,comentarios,estado")
          .eq("empresa_id", empresaActivaId)
          .eq("id", ventaId)
          .maybeSingle();
        if (ve) throw ve;
        if (!v) throw new Error("Venta no encontrada");
        if (String((v as any).estado ?? "").toUpperCase() !== "NUEVO") {
          throw new Error("Solo se puede editar cuando la venta esta en NUEVO");
        }

        const { data: c, error: ce } = await supabase
          .from("clientes")
          .select("id,nombre,nit,telefono,direccion")
          .eq("empresa_id", empresaActivaId)
          .eq("id", Number((v as any).cliente_id))
          .maybeSingle();
        if (ce) throw ce;
        if (!c) throw new Error("Cliente no encontrado");

        const { data: d, error: de } = await supabase
          .from("ventas_detalle")
          .select("id,cantidad,precio_venta_unit,producto_id,productos(nombre,marca_id,marcas(nombre))")
          .eq("empresa_id", empresaActivaId)
          .eq("venta_id", ventaId)
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
          origMap[String(pid)] = (origMap[String(pid)] ?? 0) + qty;
        });
        if (alive) setOriginalQtyByProd(origMap);

        const prodIds = Array.from(
          new Set(detalles.map((x) => Number(x.producto_id)).filter((x) => Number.isFinite(x) && x > 0))
        );
        const invByProd = new Map<number, any>();
        if (prodIds.length) {
          const { data: inv, error: ie } = await supabase
            .from("vw_inventario_productos_v2")
            .select("id,stock_disponible,precio_min_venta,tiene_iva,requiere_receta")
            .eq("empresa_id", empresaActivaId)
            .in("id", prodIds);
          if (ie) throw ie;
          const baseMap: Record<string, number> = {};
          (inv ?? []).forEach((r: any) => {
            const k = String(r?.id ?? "");
            if (!k) return;
            const s = Number(r?.stock_disponible ?? 0);
            baseMap[k] = Number.isFinite(s) ? s : 0;
            invByProd.set(Number(r.id), r);
          });
          if (alive) setStockBaseByProd(baseMap);
        }

        if (!alive) return;
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
          if (!alive) return;
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
            const nombre = (row.productos as any)?.nombre ?? "";
            const marca =
              (row.productos as any)?.marcas?.nombre ??
              (row.productos as any)?.marcas?.[0]?.nombre ??
              "";
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
          loadedEditIdRef.current = ventaId;
          if (alive) setLoadingEdit(false);
        };
        setTimeout(hydrate, 0);
      } catch (e: any) {
        if (!alive) return;
        setLoadingEdit(false);
        window.alert(`No se puede editar: ${e?.message ?? "No se pudo cargar la venta"}`);
        onCancel?.();
      }
    })().catch(() => {
      if (alive) setLoadingEdit(false);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ventaId, isEdit]);

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

  const canEditNow = !saving && !loadingEdit;

  const effectiveStockByProd = useMemo(() => {
    const base = stockBaseByProd ?? {};
    if (!isEdit) return base;
    const out: Record<string, number> = { ...base };
    for (const pid of Object.keys(originalQtyByProd)) {
      const add = Number(originalQtyByProd[pid] ?? 0);
      const cur = Number((out as any)[pid] ?? 0);
      out[pid] = (Number.isFinite(cur) ? cur : 0) + (Number.isFinite(add) ? add : 0);
    }
    return out;
  }, [isEdit, originalQtyByProd, stockBaseByProd]);

  const effectiveStockForLine = useCallback(
    (l: any) => {
      const pid = String(l?.producto_id ?? "");
      const fromMap = (effectiveStockByProd as any)?.[pid];
      if (Number.isFinite(fromMap)) return fromMap;
      const base = Number(l?.stock_disponible ?? 0);
      if (!Number.isFinite(base)) return 0;
      if (!isEdit) return base;
      if (!pid) return base;
      const add = Number(originalQtyByProd[pid] ?? 0);
      return base + (Number.isFinite(add) ? add : 0);
    },
    [effectiveStockByProd, isEdit, originalQtyByProd]
  );

  // ── search helpers ────────────────────────────────────────────────────────

  const searchClientes = useCallback(async (term: string) => {
    if (term.trim().length < 2) {
      setClienteDropResults([]);
      setClienteDropLoading(false);
      return;
    }
    setClienteDropLoading(true);
    try {
      if (!empresaActivaId) { setClienteDropResults([]); return; }
      // VENTAS: esperar a que el rol esté listo y filtrar solo sus clientes
      if (!roleReady) { setClienteDropResults([]); return; }
      if (isVentas && !uid) { setClienteDropResults([]); return; }

      let req = supabase
        .from("clientes")
        .select("id,nombre,nit,telefono,direccion")
        .eq("empresa_id", empresaActivaId)
        .ilike("nombre", `%${safeIlike(term)}%`)
        .limit(20);

      if (isVentas) {
        req = req.eq("vendedor_id", uid!);
      }

      const { data } = await req;
      setClienteDropResults(data ?? []);
    } catch {
      setClienteDropResults([]);
    } finally {
      setClienteDropLoading(false);
    }
  }, [empresaActivaId, isVentas, roleReady, uid]);

  const searchProductos = useCallback(async (term: string, lineKey: string) => {
    if (term.trim().length < 2) {
      setProdResultsByKey((prev) => ({ ...prev, [lineKey]: [] }));
      setProdLoadingByKey((prev) => ({ ...prev, [lineKey]: false }));
      return;
    }
    if (!empresaActivaId) { setProdResultsByKey((prev) => ({ ...prev, [lineKey]: [] })); return; }
    setProdLoadingByKey((prev) => ({ ...prev, [lineKey]: true }));
    try {
      const { data } = await supabase
        .from("vw_inventario_productos_v2")
        .select("id,nombre,marca,stock_disponible,precio_min_venta,tiene_iva,requiere_receta")
        .eq("empresa_id", empresaActivaId)
        .eq("activo", true)
        .ilike("nombre", `%${safeIlike(term)}%`)
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
  }, [empresaActivaId]);

  const saveNewCliente = useCallback(async () => {
    if (!newClienteNombre.trim()) return;
    setSavingNewCliente(true);
    try {
      const { data, error } = await supabase
        .from("clientes")
        .insert({
          empresa_id: empresaActivaId,
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
  }, [newClienteNombre, newClienteNit, newClienteTelefono, newClienteDireccion, setCliente, empresaActivaId]);

  // ── validation ─────────────────────────────────────────────────────────────

  const lineValidation = useCallback((l: any) => {
    if (!l.producto_id) return { ok: false, msg: "Selecciona un producto" };
    const stock = effectiveStockForLine(l);
    const min = l.precio_min_venta == null ? 0 : Number(l.precio_min_venta);
    const qty = parseIntSafe(l.cantidad);
    const price = parseDecimalSafe(l.precio_unit);
    if (qty <= 0) return { ok: false, msg: "Cantidad debe ser mayor a 0" };
    if (mode !== "cotizacion" && qty > stock) return { ok: false, msg: `Cantidad supera disponibles (${stock})` };
    if (price < min) return { ok: false, msg: `Precio menor al minimo (${fmtQ(min)})` };
    return { ok: true, msg: "" };
  }, [effectiveStockForLine, mode]);

  const allValid = useMemo(() => {
    if (loadingEdit) return false;
    if (!canCreate) return false;
    if (!cliente?.id) return false;
    if (lineas.length <= 0) return false;
    return lineas.every((l) => lineValidation(l).ok);
  }, [loadingEdit, canCreate, cliente?.id, lineValidation, lineas]);

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
    const productIds = lineas
      .map((l) => Number(l.producto_id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (new Set(productIds).size !== productIds.length) {
      Alert.alert("Aviso", "No puedes agregar el mismo producto más de una vez. Edita la cantidad en una sola línea.");
      return;
    }
    if (saving) return;

    if (!empresaReady) {
      return;
    }

    if (!empresaActivaId) {
      Alert.alert("Sin empresa", "No tienes una empresa activa asignada. Contacta al administrador.");
      return;
    }

    if (mode === "cotizacion") {
      const empresaInfo = empresas.find((e) => e.id === empresaActivaId);
      setSaving(true);
      generarCotizacionPdf({
        empresa: {
          nombre: empresaInfo?.nombre ?? "Bros Pharma",
          logo_url: empresaInfo?.logo_url ?? null,
        },
        cliente: {
          nombre: cliente?.nombre ?? "",
          nit: cliente?.nit ?? null,
          telefono: cliente?.telefono ?? null,
          direccion: cliente?.direccion ?? null,
        },
        lineas: lineas.map((l: any) => ({
          producto_label: String(l.producto_label ?? ""),
          cantidad: parseIntSafe(String(l.cantidad ?? 0)),
          precio_unit: parseDecimalSafe(String(l.precio_unit ?? 0)),
          tiene_iva: l.tiene_iva ?? null,
        })),
        comentarios: comentarios?.trim() || null,
      }, {
        fileName: (() => { const d = new Date(); const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"]; const dd = String(d.getDate()).padStart(2,"0"); const mm = meses[d.getMonth()]; const yyyy = d.getFullYear(); return `cotizacion-${cliente?.nombre?.replace(/[^a-zA-Z0-9]/g, "-") ?? "cliente"}-${dd}-${mm}-${yyyy}`; })(),
      }).then(() => {
        setSaving(false);
        reset();
        onDone();
      }).catch((e: any) => {
        setSaving(false);
        Alert.alert("Error", String(e?.message ?? "No se pudo generar el PDF"));
      });
      return;
    }

    const p_venta = {
      empresa_id: empresaActivaId,
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
        let savedVentaId: number | null = null;
        if (isEdit && ventaId) {
          const { error } = await supabase.rpc("rpc_venta_editar" as any, {
            p_venta_id: ventaId,
            p_venta,
            p_items,
          } as any);
          if (error) throw error;
          savedVentaId = ventaId;
        } else {
          const { data, error } = await supabase.rpc("rpc_crear_venta" as any, { p_venta, p_items } as any);
          if (error) throw error;
          savedVentaId = (data as any)?.venta_id ?? null;
        }

        let recetaOk = true;
        if (savedVentaId && receta_uri) {
          try {
            const stamp = Date.now();
            const rnd = Math.random().toString(16).slice(2);
            const ext = extFromUri(receta_uri);
            const contentType = mimeFromExt(ext);
            const path = `${empresaActivaId}/ventas/${savedVentaId}/recetas/${stamp}-${rnd}.${ext}`;
            const ab = await uriToArrayBuffer(receta_uri);
            const bytes = new Uint8Array(ab);
            const { error: upErr } = await supabase.storage
              .from(BUCKET_VENTAS_DOCS)
              .upload(path, bytes, { contentType, upsert: false });
            if (upErr) throw upErr;
            const { error: rpcErr } = await supabase.rpc("rpc_venta_registrar_receta", {
              p_venta_id: Number(savedVentaId),
              p_path: path,
            });
            if (rpcErr) throw rpcErr;
          } catch {
            recetaOk = false;
          }
        }

        reset();
        setRecetaUri(null);
        if (!isEdit && !recetaOk) {
          window.alert("Venta creada. No se pudo subir la receta; puedes subirla desde el detalle en Ventas.");
        }
        onDone();
      } catch (e: any) {
        const raw = String(e?.message ?? "").toLowerCase();
        let msg = "No se pudo guardar la venta.";
        if (raw.includes("there is no unique or exclusion constraint matching the on conflict specification")) {
          msg = "No se puede agregar el mismo producto más de una vez en la venta. Edita la cantidad en una sola línea.";
        } else if (raw.includes("empresa_invalida") || raw.includes("no_membresia_empresa")) {
          msg = "No tienes membresía activa en esta empresa. Contacta al administrador.";
        } else if (e?.message) {
          msg = String(e.message);
        }
        window.alert(`Error al guardar: ${msg}`);
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
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
      <ScrollView
        style={[styles.scroll, { backgroundColor: C.bg }]}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 20 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
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
              borderColor: C.border,
              color: C.text,
              backgroundColor: C.card,
            },
          ]}
        />

        {/* Product lines */}
        <Text style={[styles.h2, { color: C.text }]}>Productos</Text>

        {lineas.map((l: any, idx) => {
          const stock = l.producto_id ? effectiveStockForLine(l) : null;
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
                                if (!inStock && mode !== "cotizacion") return;
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
                                !inStock && mode !== "cotizacion"
                                  ? { opacity: 0.45, cursor: "not-allowed" as any }
                                  : pressed ? { backgroundColor: C.blue } : null,
                              ]}
                            >
                              <Text style={[styles.dropdownItemText, { color: inStock || mode === "cotizacion" ? C.text : C.sub }]} numberOfLines={1}>
                                {p.nombre ?? ""}
                              </Text>
                              <Text style={[styles.dropdownItemSub, { color: inStock || mode === "cotizacion" ? C.sub : C.danger }]}>
                                {p.marca ? `${p.marca} • ` : ""}Stock: {pStock}{inStock ? ` • Min: ${fmtQ(p.precio_min_venta)}` : mode === "cotizacion" ? ` • Min: ${fmtQ(p.precio_min_venta)}` : " unidades"}
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

        {loadingEdit ? (
          <View style={{ alignItems: "center", paddingVertical: 16 }}>
            <Text style={[styles.help, { color: C.sub }]}>Cargando venta...</Text>
          </View>
        ) : null}
        <AppButton
          title={!empresaReady ? "Cargando..." : loadingEdit ? "Cargando..." : !allValid ? "Revisa datos" : saving ? (mode === "cotizacion" ? "Generando PDF..." : "Guardando...") : mode === "cotizacion" ? "Generar cotización PDF" : isEdit ? "Guardar cambios" : "Guardar venta"}
          onPress={onGuardar}
          disabled={!empresaReady || loadingEdit || !allValid || saving}
          style={[styles.saveBtn, { backgroundColor: C.blueText, marginBottom: 10 }] as any}
        />
      </ScrollView>
      </KeyboardAvoidingView>

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
              <Text style={[styles.label, { color: C.text }]}>NIT *</Text>
              <TextInput
                value={newClienteNit}
                onChangeText={setNewClienteNit}
                placeholder="CF"
                placeholderTextColor={C.sub}
                style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.bg }]}
              />
              <Text style={[styles.label, { color: C.text }]}>Teléfono *</Text>
              <TextInput
                value={newClienteTelefono}
                onChangeText={setNewClienteTelefono}
                placeholder="—"
                placeholderTextColor={C.sub}
                keyboardType="phone-pad"
                style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.bg }]}
              />
              <Text style={[styles.label, { color: C.text }]}>Dirección *</Text>
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
                disabled={!newClienteNombre.trim() || !newClienteNit.trim() || !newClienteTelefono.trim() || !newClienteDireccion.trim() || savingNewCliente}
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

  h2: { fontSize: Platform.OS === "web" ? 18 : 15, fontWeight: "700", marginTop: 12, marginBottom: 8 },
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
  cardTitle: { fontSize: Platform.OS === "web" ? 16 : 13, fontWeight: "700" },
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
  totalLabel: { fontSize: Platform.OS === "web" ? 16 : 13, fontWeight: "700" },
  totalValue: { fontSize: Platform.OS === "web" ? 18 : 16, fontWeight: "700" },

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
