// components/compras/CompraNuevaForm.tsx
// Pure form component — no navigation imports.
// Web-only: used inside CompraNuevaModal (create & edit mode).

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppButton } from "../ui/app-button";
import { useCompraDraft } from "../../lib/compraDraft";
import { dispatchNotifs } from "../../lib/notif-dispatch";
import { supabase } from "../../lib/supabase";
import { useRole } from "../../lib/useRole";

// ─── helpers ──────────────────────────────────────────────────────────────────

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

const BUCKET = "productos";

// ─── types ────────────────────────────────────────────────────────────────────

type Marca = { id: number; nombre: string };

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
  editId?: string | null;
  isDark: boolean;
  colors: Colors;
  canCreate: boolean;
};

// ─── component ────────────────────────────────────────────────────────────────

export function CompraNuevaForm({ onDone, editId, isDark, colors: C, canCreate }: Props) {
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
    setProductoEnLinea,
    reset,
  } = useCompraDraft();
  const { proveedor, numeroFactura, tipoPago, comentarios, fechaVenc, lineas } = draft;
  const { isAdmin } = useRole();

  const isEdit = !!(editId && Number.isFinite(Number(editId)) && Number(editId) > 0);

  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);

  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const loadSeqRef = useRef(0);

  // ── Hydrate helper (mirrors compra-nueva.tsx logic) ───────────────────────

  const hydrateWhenReady = useCallback(
    (rows: any[]) => {
      const mySeq = loadSeqRef.current;
      const N = rows.length;

      const tick = () => {
        if (mySeq !== loadSeqRef.current) return;
        const cur = draftRef.current;
        if (!cur) return;

        if (cur.lineas.length < N) {
          const missing = N - cur.lineas.length;
          for (let i = 0; i < missing; i++) addLinea();
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
            image_path: r.productos?.image_path ?? null,
            image_uri: null,
          });
        });
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
          .select("id,proveedor_id,numero_factura,tipo_pago,fecha_vencimiento,comentarios,proveedores(nombre)")
          .eq("id", Number(idToLoad))
          .maybeSingle();
        if (seq !== loadSeqRef.current) return;
        if (e1) throw e1;
        if (!c) throw new Error("Compra no encontrada");

        const { data: d, error: e2 } = await supabase
          .from("compras_detalle")
          .select("id,cantidad,precio_compra_unit,producto_id, productos(nombre,image_path,marca_id,marcas(nombre)), producto_lotes(lote,fecha_exp)")
          .eq("compra_id", Number(idToLoad))
          .order("id", { ascending: true });
        if (seq !== loadSeqRef.current) return;
        if (e2) throw e2;

        reset();
        setProveedor({
          id: Number(c.proveedor_id),
          nombre: (c as any).proveedores?.nombre ?? `Proveedor #${c.proveedor_id}`,
        });
        setNumeroFactura((c as any).numero_factura ?? "");
        setTipoPago(String((c as any).tipo_pago).toUpperCase() === "CREDITO" ? "CREDITO" : "CONTADO");
        setFechaVenc((c as any).fecha_vencimiento ?? null);
        setComentarios((c as any).comentarios ?? "");

        const rows = (d ?? []) as any[];
        if (rows.length <= 0) {
          updateLinea("l1", {
            producto_id: null, producto_label: "", lote: "", fecha_exp: null,
            cantidad: "1", precio: "0", image_path: null, image_uri: null,
          });
          return;
        }
        hydrateWhenReady(rows);
      } catch (e: any) {
        window.alert(`Error: ${e?.message ?? "No se pudo cargar la compra"}`);
      } finally {
        if (seq === loadSeqRef.current) setLoadingEdit(false);
      }
    },
    [hydrateWhenReady, reset, setProveedor, setNumeroFactura, setTipoPago, setFechaVenc, setComentarios, updateLinea]
  );

  // ── Reset or load edit on mount ───────────────────────────────────────────

  useEffect(() => {
    ++loadSeqRef.current;
    if (isEdit && editId) {
      loadEdit(editId).catch(() => {});
    } else {
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── tipoPago → auto fecha vencimiento ─────────────────────────────────────

  useEffect(() => {
    if (tipoPago === "CREDITO") {
      if (!draft.fechaVenc) setFechaVenc(toYMD(addDays(new Date(), 30)));
    } else {
      setFechaVenc(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoPago]);

  // ── Proveedor inline dropdown ─────────────────────────────────────────────

  const [provDropOpen, setProvDropOpen] = useState(false);
  const [provQ, setProvQ] = useState("");
  const [provResults, setProvResults] = useState<any[]>([]);
  const [provLoading, setProvLoading] = useState(false);

  // New proveedor creation state
  const [provCreateMode, setProvCreateMode] = useState(false);
  const provCreateModeRef = useRef(false); // sync ref so search onBlur setTimeout skips close
  const [newProvNombre, setNewProvNombre] = useState("");
  const [newProvNit, setNewProvNit] = useState("");
  const [newProvTel, setNewProvTel] = useState("");
  const [savingProv, setSavingProv] = useState(false);

  const resetProvCreateMode = useCallback(() => {
    provCreateModeRef.current = false;
    setProvCreateMode(false);
    setNewProvNombre("");
    setNewProvNit("");
    setNewProvTel("");
    setSavingProv(false);
  }, []);

  const guardarNuevoProveedor = useCallback(async () => {
    if (!isAdmin) {
      window.alert("Solo un administrador puede crear proveedores.");
      return;
    }
    const nombre = newProvNombre.trim();
    const nit = newProvNit.trim();
    if (!nombre || !nit) return;
    setSavingProv(true);
    try {
      const { data: existing } = await supabase
        .from("proveedores")
        .select("id, nombre, nit")
        .eq("nit", nit)
        .maybeSingle();
      if (existing) {
        window.alert(`Ya existe un proveedor con NIT ${existing.nit}: "${existing.nombre}". Selecciónalo de la lista.`);
        return;
      }
      const { data, error } = await supabase
        .from("proveedores")
        .insert({ nombre, nit, telefono: newProvTel.trim() || null, activo: true })
        .select("id,nombre,nit,telefono,activo")
        .single();
      if (error) throw error;
      setProveedor({
        id: Number((data as any).id),
        nombre: String((data as any).nombre ?? ""),
        nit: (data as any).nit ?? null,
        telefono: (data as any).telefono ?? null,
        activo: true,
      });
      setProvDropOpen(false);
      setProvQ("");
      setProvResults([]);
      resetProvCreateMode();
    } catch (e: any) {
      window.alert(`Error al crear proveedor: ${e?.message ?? "No se pudo crear el proveedor"}`);
    } finally {
      setSavingProv(false);
    }
  }, [isAdmin, newProvNombre, newProvNit, newProvTel, setProveedor, resetProvCreateMode]);

  const searchProveedores = useCallback(async (term: string) => {
    if (term.trim().length < 2) {
      setProvResults([]);
      setProvLoading(false);
      return;
    }
    setProvLoading(true);
    try {
      const { data } = await supabase
        .from("proveedores")
        .select("id,nombre,telefono")
        .ilike("nombre", `%${term.trim()}%`)
        .eq("activo", true)
        .limit(20);
      setProvResults(data ?? []);
    } catch {
      setProvResults([]);
    } finally {
      setProvLoading(false);
    }
  }, []);

  // ── Product inline dropdown (per line) ───────────────────────────────────

  const [openProdKey, setOpenProdKey] = useState<string | null>(null);
  const [prodQByKey, setProdQByKey] = useState<Record<string, string>>({});
  const [prodResultsByKey, setProdResultsByKey] = useState<Record<string, any[]>>({});
  const [prodLoadingByKey, setProdLoadingByKey] = useState<Record<string, boolean>>({});

  const searchProductos = useCallback(async (term: string, lineKey: string) => {
    if (term.trim().length < 2) {
      setProdResultsByKey((prev) => ({ ...prev, [lineKey]: [] }));
      setProdLoadingByKey((prev) => ({ ...prev, [lineKey]: false }));
      return;
    }
    setProdLoadingByKey((prev) => ({ ...prev, [lineKey]: true }));
    try {
      const { data } = await supabase
        .from("productos")
        .select("id,nombre,marca_id,marcas(nombre)")
        .eq("activo", true)
        .ilike("nombre", `%${term.trim()}%`)
        .limit(20);
      setProdResultsByKey((prev) => ({ ...prev, [lineKey]: data ?? [] }));
    } catch {
      setProdResultsByKey((prev) => ({ ...prev, [lineKey]: [] }));
    } finally {
      setProdLoadingByKey((prev) => ({ ...prev, [lineKey]: false }));
    }
  }, []);

  // ── Marcas list (for new product form) ───────────────────────────────────

  const [marcas, setMarcas] = useState<Marca[]>([]);

  useEffect(() => {
    supabase
      .from("marcas")
      .select("id,nombre")
      .order("nombre")
      .then(({ data }) => setMarcas((data ?? []) as Marca[]));
  }, []);

  // ── New product creation state ────────────────────────────────────────────

  const [prodCreateMode, setProdCreateMode] = useState(false);
  // Sync ref so the product-search onBlur setTimeout sees the latest value
  const prodCreateModeRef = useRef(false);

  const [newProdNombre, setNewProdNombre] = useState("");
  const [newProdReceta, setNewProdReceta] = useState(false);
  const [newProdIva, setNewProdIva] = useState(false);
  const [newProdMarcaId, setNewProdMarcaId] = useState<number | null>(null);
  const [savingProd, setSavingProd] = useState(false);

  // Brand sub-picker within the new product form
  const [brandPickerOpen, setBrandPickerOpen] = useState(false);
  const [brandQ, setBrandQ] = useState("");
  const [newBrandName, setNewBrandName] = useState("");
  // Sync ref so the brand-search onBlur setTimeout doesn't close mid-save
  const brandSavingRef = useRef(false);
  // Sync ref so the brand-search onBlur doesn't close the picker when focus moves to "Nueva marca" input
  const brandNewNameFocusRef = useRef(false);

  const resetCreateMode = useCallback(() => {
    prodCreateModeRef.current = false;
    setProdCreateMode(false);
    setNewProdNombre("");
    setNewProdReceta(false);
    setNewProdIva(false);
    setNewProdMarcaId(null);
    setSavingProd(false);
    setBrandPickerOpen(false);
    setBrandQ("");
    setNewBrandName("");
    brandSavingRef.current = false;
    brandNewNameFocusRef.current = false;
  }, []);

  const guardarNuevoProducto = useCallback(
    async (lineKey: string) => {
      const nombre = newProdNombre.trim();
      if (!nombre || newProdMarcaId == null) return;
      setSavingProd(true);
      try {
        const { data, error } = await supabase
          .from("productos")
          .insert({
            nombre,
            marca_id: newProdMarcaId,
            requiere_receta: newProdReceta,
            tiene_iva: newProdIva,
            activo: true,
          })
          .select("id,nombre,marca_id")
          .single();
        if (error) throw error;
        const marcaNombre = marcas.find((m) => m.id === newProdMarcaId)?.nombre ?? "";
        const label = marcaNombre ? `${nombre} • ${marcaNombre}` : nombre;
        setProductoEnLinea(lineKey, Number((data as any).id), label);
        setOpenProdKey(null);
        resetCreateMode();
      } catch (e: any) {
        window.alert(`Error al crear producto: ${e?.message ?? "No se pudo crear el producto"}`);
      } finally {
        setSavingProd(false);
      }
    },
    [newProdNombre, newProdMarcaId, newProdReceta, newProdIva, marcas, setProductoEnLinea, resetCreateMode]
  );

  // ── File input refs for photos (web only) ─────────────────────────────────

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const handleFileChange = useCallback(
    async (lineKey: string, file: File | null) => {
      if (!file) return;
      const previewUri = URL.createObjectURL(file);
      updateLinea(lineKey, { image_uri: previewUri });
      try {
        const extMatch = file.name.match(/\.([a-zA-Z0-9]+)$/);
        const rawExt = extMatch ? extMatch[1].toLowerCase() : "jpg";
        const ext = rawExt === "jpeg" ? "jpg" : rawExt;
        const contentType = ext === "png" ? "image/png" : ext === "heic" ? "image/heic" : "image/jpeg";
        const path = `compras/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;
        const ab = await file.arrayBuffer();
        const { error } = await supabase.storage.from(BUCKET).upload(path, ab, { contentType, upsert: true });
        if (error) throw error;
        updateLinea(lineKey, { image_path: path });
      } catch (e: any) {
        window.alert(`Error al subir imagen: ${e?.message ?? ""}`);
        updateLinea(lineKey, { image_uri: null, image_path: null });
      }
    },
    [updateLinea]
  );

  // ── Validation ────────────────────────────────────────────────────────────

  const total = useMemo(() => {
    return lineas.reduce((acc, l) => {
      const cant = Math.max(0, Math.floor(parseNumberSafe(l.cantidad)));
      const precio = Math.max(0, parseNumberSafe(l.precio));
      return acc + cant * precio;
    }, 0);
  }, [lineas]);

  const isFormValid = useMemo(() => {
    if (!canCreate) return false;
    if (!proveedor?.id) return false;
    if (!String(numeroFactura ?? "").trim()) return false;
    if (tipoPago === "CREDITO" && !fechaVenc) return false;
    if (!lineas?.length) return false;
    const invalid = lineas.some((l) => {
      const cant = Math.floor(parseNumberSafe(l.cantidad));
      const precio = parseNumberSafe(l.precio);
      return !l.producto_id || !String(l.lote ?? "").trim() || !l.fecha_exp || cant <= 0 || precio < 0;
    });
    return !invalid;
  }, [canCreate, proveedor?.id, numeroFactura, tipoPago, fechaVenc, lineas]);

  // ── Save ──────────────────────────────────────────────────────────────────

  const guardar = async () => {
    if (saving || loadingEdit) return;

    const factura = numeroFactura.trim();
    if (!proveedor?.id) return void window.alert("Falta proveedor: Selecciona un proveedor");
    if (!factura) return void window.alert("Ingresa el número de factura");
    if (tipoPago === "CREDITO" && !fechaVenc) return void window.alert("Falta fecha de vencimiento (crédito)");

    const detalles = lineas.map((l) => ({
      producto_id: l.producto_id,
      lote: (l.lote ?? "").trim(),
      fecha_exp: l.fecha_exp,
      cantidad: Math.max(0, Math.floor(parseNumberSafe(l.cantidad))),
      precio_compra_unit: Math.max(0, parseNumberSafe(l.precio)),
      image_path: (l as any).image_path ?? null,
    }));

    const invalid = detalles.some(
      (d) => !d.producto_id || !d.lote || !d.fecha_exp || d.cantidad <= 0 || d.precio_compra_unit < 0
    );
    if (invalid) {
      return void window.alert("Revisa productos: cada línea necesita producto, lote, expiración, cantidad (>0) y precio");
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
      } else {
        const { error } = await supabase.rpc("rpc_crear_compra", {
          p_compra,
          p_detalles: detalles,
        });
        if (error) throw error;
      }

      void dispatchNotifs(20).catch((e: any) =>
        console.warn("[notif] dispatch failed", e?.message ?? e)
      );

      reset();
      onDone();
    } catch (e: any) {
      window.alert(`Error al guardar: ${e?.message ?? "No se pudo guardar la compra"}`);
    } finally {
      setSaving(false);
    }
  };

  const saveLabel =
    loadingEdit ? "Cargando..." :
    saving ? "Guardando..." :
    isEdit ? "Guardar cambios" : "Guardar compra";

  // Shared style for HTML date inputs
  const dateInputStyle = {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    width: "100%",
    backgroundColor: "transparent",
    color: C.text,
    fontFamily: "inherit",
    cursor: "pointer",
    colorScheme: isDark ? "dark" : "light",
    boxSizing: "border-box",
  } as any;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: C.bg }]}
      contentContainerStyle={{ paddingTop: 12, paddingBottom: 20 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {loadingEdit ? (
        <View style={{ paddingVertical: 10 }}>
          <Text style={{ color: C.sub, fontWeight: "700" }}>Cargando...</Text>
        </View>
      ) : null}

      {/* ── Proveedor ── */}
      <Text style={[styles.label, { color: C.text }]}>Proveedor</Text>
      <View>
        <Pressable
          onPress={() => { if (!provDropOpen) setProvDropOpen(true); }}
          style={[
            styles.select,
            { borderColor: provDropOpen ? C.blueText : C.border, backgroundColor: C.card },
          ]}
        >
          <Text style={[styles.selectText, { color: proveedor ? C.text : C.sub }]} numberOfLines={1}>
            {proveedor ? proveedor.nombre : "Seleccionar proveedor..."}
          </Text>
        </Pressable>
        {provDropOpen ? (
          <View style={[styles.dropdown, { borderColor: provCreateMode ? C.blueText : C.border, backgroundColor: C.card }]}>

            {!provCreateMode ? (
              // ─── Branch A: search mode ─────────────────────────────────────
              <>
                <TextInput
                  autoFocus
                  value={provQ}
                  onChangeText={(t) => { setProvQ(t); searchProveedores(t); }}
                  placeholder="Buscar proveedor..."
                  placeholderTextColor={C.sub}
                  style={[styles.dropdownInput, { borderColor: C.border, color: C.text, backgroundColor: C.bg }]}
                  onBlur={() =>
                    setTimeout(() => {
                      if (provCreateModeRef.current) return;
                      setProvDropOpen(false);
                    }, 150)
                  }
                />
                <ScrollView style={styles.dropdownScroll} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                  {provQ.trim().length < 2 ? (
                    <Text style={[styles.dropdownMsg, { color: C.sub }]}>Escribe para buscar...</Text>
                  ) : provLoading ? (
                    <Text style={[styles.dropdownMsg, { color: C.sub }]}>Buscando...</Text>
                  ) : provResults.length === 0 ? (
                    <Text style={[styles.dropdownMsg, { color: C.sub }]}>Sin resultados</Text>
                  ) : (
                    provResults.map((p: any) => (
                      <Pressable
                        key={String(p.id)}
                        onPressIn={() => {
                          setProveedor({ id: Number(p.id), nombre: String(p.nombre ?? ""), telefono: p.telefono ?? null });
                          setProvDropOpen(false);
                          setProvQ("");
                          setProvResults([]);
                        }}
                        style={({ pressed }) => [
                          styles.dropdownItem,
                          { borderBottomColor: C.border },
                          pressed ? { backgroundColor: C.blue } : null,
                        ]}
                      >
                        <Text style={[styles.dropdownItemText, { color: C.text }]} numberOfLines={1}>{p.nombre}</Text>
                        {p.telefono ? (
                          <Text style={[styles.dropdownItemSub, { color: C.sub }]}>Tel: {p.telefono}</Text>
                        ) : null}
                      </Pressable>
                    ))
                  )}

                  {/* Only ADMIN can create proveedores (matches RLS proveedores_insert_admin) */}
                  {isAdmin ? (
                    <Pressable
                      onPressIn={() => {
                        provCreateModeRef.current = true;
                        setProvCreateMode(true);
                        setNewProvNombre(provQ.trim());
                        setProvQ("");
                        setProvResults([]);
                      }}
                      style={({ pressed }) => [
                        styles.dropdownItem,
                        { borderBottomColor: "transparent" },
                        pressed ? { backgroundColor: C.blue } : null,
                      ]}
                    >
                      <Text style={[styles.dropdownItemText, { color: C.blueText }]}>
                        + Agregar nuevo proveedor
                      </Text>
                    </Pressable>
                  ) : null}
                </ScrollView>
              </>
            ) : (
              // ─── Branch B: new proveedor form ──────────────────────────────
              <ScrollView
                style={{ maxHeight: 320 }}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {/* Header */}
                <View style={[styles.rowBetween, { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 }]}>
                  <Text style={[styles.createTitle, { color: C.text }]}>Nuevo proveedor</Text>
                  <Pressable onPress={resetProvCreateMode} hitSlop={8}>
                    <Text style={{ color: C.blueText, fontSize: 13, fontWeight: "700" }}>← Cancelar</Text>
                  </Pressable>
                </View>

                <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                  {/* Nombre */}
                  <Text style={[styles.label, { color: C.text }]}>Nombre</Text>
                  <TextInput
                    autoFocus
                    value={newProvNombre}
                    onChangeText={setNewProvNombre}
                    placeholder="Ej: Distribuidora demo"
                    placeholderTextColor={C.sub}
                    style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.bg }]}
                  />

                  {/* NIT */}
                  <Text style={[styles.label, { color: C.text }]}>NIT</Text>
                  <TextInput
                    value={newProvNit}
                    onChangeText={setNewProvNit}
                    placeholder="Ej: 1234567-8"
                    placeholderTextColor={C.sub}
                    style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.bg }]}
                  />

                  {/* Teléfono */}
                  <Text style={[styles.label, { color: C.text }]}>Teléfono (opcional)</Text>
                  <TextInput
                    value={newProvTel}
                    onChangeText={setNewProvTel}
                    placeholder="Ej: 5555-5555"
                    placeholderTextColor={C.sub}
                    keyboardType="phone-pad"
                    style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.bg }]}
                  />

                  <AppButton
                    title={savingProv ? "Guardando..." : "Guardar proveedor"}
                    onPress={guardarNuevoProveedor}
                    loading={savingProv}
                    disabled={!newProvNombre.trim() || !newProvNit.trim() || savingProv}
                    variant="primary"
                    style={[{ marginTop: 12 }] as any}
                  />
                </View>
              </ScrollView>
            )}

          </View>
        ) : null}
      </View>

      {/* ── Número de factura ── */}
      <Text style={[styles.label, { color: C.text }]}>Número de factura</Text>
      <TextInput
        value={numeroFactura}
        onChangeText={setNumeroFactura}
        placeholder="Ej: F-001"
        placeholderTextColor={C.sub}
        style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.card }]}
        autoCapitalize="characters"
      />

      {/* ── Tipo de pago ── */}
      <Text style={[styles.label, { color: C.text }]}>Tipo de pago</Text>
      <View style={styles.row2}>
        <Pressable
          onPress={() => setTipoPago("CONTADO")}
          style={[
            styles.chip,
            { borderColor: C.border, backgroundColor: C.card },
            tipoPago === "CONTADO" && { borderColor: C.blueText, backgroundColor: "rgba(64,156,255,0.12)" },
          ]}
        >
          <Text style={[styles.chipText, { color: tipoPago === "CONTADO" ? C.blueText : C.text }]}>
            CONTADO
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTipoPago("CREDITO")}
          style={[
            styles.chip,
            { borderColor: C.border, backgroundColor: C.card },
            tipoPago === "CREDITO" && { borderColor: C.blueText, backgroundColor: "rgba(64,156,255,0.12)" },
          ]}
        >
          <Text style={[styles.chipText, { color: tipoPago === "CREDITO" ? C.blueText : C.text }]}>
            CRÉDITO
          </Text>
        </Pressable>
      </View>

      {tipoPago === "CREDITO" ? (
        <>
          <Text style={[styles.label, { color: C.text }]}>Vencimiento (crédito)</Text>
          <input
            type="date"
            value={fechaVenc ?? ""}
            onChange={(e) => {
              const val = (e.target as HTMLInputElement).value;
              setFechaVenc(val || null);
            }}
            style={dateInputStyle}
          />
          <Text style={[styles.help, { color: C.sub }]}>
            Se asigna automáticamente a 30 días. Puedes cambiarlo.
          </Text>
        </>
      ) : null}

      {/* ── Comentarios ── */}
      <Text style={[styles.label, { color: C.text }]}>Comentarios (opcional)</Text>
      <TextInput
        value={comentarios}
        onChangeText={setComentarios}
        placeholder="Notas..."
        placeholderTextColor={C.sub}
        style={[
          styles.input,
          { height: 80, textAlignVertical: "top", borderColor: C.border, color: C.text, backgroundColor: C.card },
        ]}
        multiline
      />

      {/* ── Products ── */}
      <View style={[styles.divider, { backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "#eee" }]} />
      <Text style={[styles.h2, { color: C.text }]}>Productos</Text>

      {lineas.map((l: any, idx) => {
        const cant = Math.max(0, Math.floor(parseNumberSafe(l.cantidad)));
        const precio = Math.max(0, parseNumberSafe(l.precio));
        const sub = cant * precio;

        return (
          <View key={l.key} style={[styles.card, { borderColor: C.border, backgroundColor: C.card }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.cardTitle, { color: C.text }]}>Línea {idx + 1}</Text>
              <Pressable onPress={() => removeLinea(l.key)}>
                <Text style={[styles.linkDanger, { color: C.danger }]}>Eliminar</Text>
              </Pressable>
            </View>

            {/* Product inline dropdown */}
            <Text style={[styles.label, { color: C.text }]}>Producto</Text>
            <View>
              <Pressable
                onPress={() => {
                  if (openProdKey !== l.key) {
                    resetCreateMode();
                    setOpenProdKey(l.key);
                  }
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
                <View style={[styles.dropdown, { borderColor: prodCreateMode ? C.blueText : C.border, backgroundColor: C.card }]}>

                  {!prodCreateMode ? (
                    // ─── Branch A: search mode ───────────────────────────────
                    <>
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
                        onBlur={() =>
                          setTimeout(() => {
                            // Do not close if user just tapped "+ Agregar nuevo producto"
                            if (prodCreateModeRef.current) return;
                            setOpenProdKey((k) => (k === l.key ? null : k));
                          }, 150)
                        }
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
                            const marcaNombre = p.marcas?.nombre ?? "";
                            const pLabel = `${p.nombre ?? ""}${marcaNombre ? ` • ${marcaNombre}` : ""}`.trim();
                            return (
                              <Pressable
                                key={String(p.id)}
                                onPressIn={() => {
                                  setProductoEnLinea(l.key, Number(p.id), pLabel);
                                  setOpenProdKey(null);
                                  setProdQByKey((prev) => ({ ...prev, [l.key]: "" }));
                                  setProdResultsByKey((prev) => ({ ...prev, [l.key]: [] }));
                                }}
                                style={({ pressed }) => [
                                  styles.dropdownItem,
                                  { borderBottomColor: C.border },
                                  pressed ? { backgroundColor: C.blue } : null,
                                ]}
                              >
                                <Text style={[styles.dropdownItemText, { color: C.text }]} numberOfLines={1}>
                                  {pLabel}
                                </Text>
                              </Pressable>
                            );
                          })
                        )}

                        {/* Always visible: "+ Agregar nuevo producto" */}
                        <Pressable
                          onPressIn={() => {
                            // Set ref synchronously so the search onBlur setTimeout skips the close
                            prodCreateModeRef.current = true;
                            setProdCreateMode(true);
                            setProdQByKey((prev) => ({ ...prev, [l.key]: "" }));
                            setProdResultsByKey((prev) => ({ ...prev, [l.key]: [] }));
                          }}
                          style={({ pressed }) => [
                            styles.dropdownItem,
                            { borderBottomColor: "transparent" },
                            pressed ? { backgroundColor: C.blue } : null,
                          ]}
                        >
                          <Text style={[styles.dropdownItemText, { color: C.blueText }]}>
                            + Agregar nuevo producto
                          </Text>
                        </Pressable>
                      </ScrollView>
                    </>
                  ) : (
                    // ─── Branch B: new product form ──────────────────────────
                    <ScrollView
                      style={{ maxHeight: 420 }}
                      keyboardShouldPersistTaps="handled"
                      nestedScrollEnabled
                    >
                      {/* Header */}
                      <View style={[styles.rowBetween, { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 }]}>
                        <Text style={[styles.createTitle, { color: C.text }]}>Nuevo producto</Text>
                        <Pressable onPress={resetCreateMode} hitSlop={8}>
                          <Text style={[{ color: C.blueText, fontSize: 13, fontWeight: "700" }]}>← Cancelar</Text>
                        </Pressable>
                      </View>

                      <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>

                        {/* Nombre */}
                        <Text style={[styles.label, { color: C.text }]}>Nombre</Text>
                        <TextInput
                          autoFocus
                          value={newProdNombre}
                          onChangeText={setNewProdNombre}
                          placeholder="Ej: Acetaminofén 500mg"
                          placeholderTextColor={C.sub}
                          style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.bg }]}
                        />

                        {/* Marca */}
                        <Text style={[styles.label, { color: C.text }]}>Marca</Text>
                        <Pressable
                          onPress={() => setBrandPickerOpen((v) => !v)}
                          style={[
                            styles.select,
                            {
                              borderColor: brandPickerOpen ? C.blueText : C.border,
                              backgroundColor: C.bg,
                            },
                          ]}
                        >
                          <Text
                            style={[styles.selectText, { color: newProdMarcaId != null ? C.text : C.sub }]}
                            numberOfLines={1}
                          >
                            {newProdMarcaId != null
                              ? (marcas.find((m) => m.id === newProdMarcaId)?.nombre ?? "Seleccionar marca...")
                              : "Seleccionar marca..."}
                          </Text>
                        </Pressable>

                        {/* Brand sub-picker (inline, pushes content down) */}
                        {brandPickerOpen ? (
                          <View style={[styles.dropdown, { borderColor: C.border, backgroundColor: C.bg, marginTop: 4 }]}>
                            <TextInput
                              autoFocus
                              value={brandQ}
                              onChangeText={setBrandQ}
                              placeholder="Buscar marca..."
                              placeholderTextColor={C.sub}
                              style={[styles.dropdownInput, { borderColor: C.border, color: C.text, backgroundColor: C.card }]}
                              onBlur={() =>
                                setTimeout(() => {
                                  // Do not close if user is tapping "Crear" button or focusing "Nueva marca" input
                                  if (brandSavingRef.current || brandNewNameFocusRef.current) return;
                                  setBrandPickerOpen(false);
                                  setBrandQ("");
                                }, 150)
                              }
                            />
                            <ScrollView style={{ maxHeight: 150 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                              {brandQ.trim().length < 2 ? (
                                <Text style={[styles.dropdownMsg, { color: C.sub }]}>Escribe para buscar...</Text>
                              ) : marcas.filter((m) => m.nombre.toLowerCase().includes(brandQ.trim().toLowerCase())).length === 0 ? (
                                <Text style={[styles.dropdownMsg, { color: C.sub }]}>Sin resultados</Text>
                              ) : (
                                marcas
                                  .filter((m) => m.nombre.toLowerCase().includes(brandQ.trim().toLowerCase()))
                                  .map((m) => (
                                    <Pressable
                                      key={String(m.id)}
                                      onPressIn={() => {
                                        setNewProdMarcaId(m.id);
                                        setBrandPickerOpen(false);
                                        setBrandQ("");
                                      }}
                                      style={({ pressed }) => [
                                        styles.dropdownItem,
                                        { borderBottomColor: C.border },
                                        pressed ? { backgroundColor: C.blue } : null,
                                      ]}
                                    >
                                      <Text style={[styles.dropdownItemText, { color: C.text }]}>{m.nombre}</Text>
                                    </Pressable>
                                  ))
                              )}
                            </ScrollView>

                            {/* Nueva marca row */}
                            <View style={[styles.newBrandRow, { borderTopColor: C.border }]}>
                              <TextInput
                                value={newBrandName}
                                onChangeText={setNewBrandName}
                                placeholder="Nueva marca..."
                                placeholderTextColor={C.sub}
                                style={[styles.newBrandInput, { borderColor: C.border, color: C.text, backgroundColor: C.card }]}
                                onFocus={() => { brandNewNameFocusRef.current = true; }}
                                onBlur={() => { brandNewNameFocusRef.current = false; }}
                              />
                              <Pressable
                                {...(Platform.OS === "web" ? { onMouseDown: (e: any) => e.preventDefault() } : {})}
                                onPressIn={async () => {
                                  const nm = newBrandName.trim();
                                  if (!nm) return;
                                  // Set sync ref before any await so onBlur timeout skips close
                                  brandSavingRef.current = true;
                                  try {
                                    const { data: existing } = await supabase
                                      .from("marcas")
                                      .select("id, nombre")
                                      .ilike("nombre", nm)
                                      .maybeSingle();
                                    if (existing) {
                                      setNewProdMarcaId(Number(existing.id));
                                      setNewBrandName("");
                                      setBrandPickerOpen(false);
                                      setBrandQ("");
                                      window.alert(`La marca "${existing.nombre}" ya existe y fue seleccionada automáticamente.`);
                                      return;
                                    }
                                    const { data, error } = await supabase
                                      .from("marcas")
                                      .insert({ nombre: nm, activo: true })
                                      .select("id,nombre")
                                      .single();
                                    if (error) throw error;
                                    const newM: Marca = { id: Number((data as any).id), nombre: nm };
                                    setMarcas((prev) =>
                                      [...prev, newM].sort((a, b) => a.nombre.localeCompare(b.nombre))
                                    );
                                    setNewProdMarcaId(newM.id);
                                    setNewBrandName("");
                                    setBrandPickerOpen(false);
                                    setBrandQ("");
                                  } catch (e: any) {
                                    window.alert(`Error al crear marca: ${e?.message ?? ""}`);
                                  } finally {
                                    brandSavingRef.current = false;
                                  }
                                }}
                                disabled={!newBrandName.trim()}
                                style={[
                                  styles.newBrandBtn,
                                  { backgroundColor: newBrandName.trim() ? C.blueText : C.border },
                                ]}
                              >
                                <Text style={styles.newBrandBtnText}>Crear</Text>
                              </Pressable>
                            </View>
                          </View>
                        ) : null}

                        {/* Opciones: Requiere receta / Tiene IVA — chip toggles */}
                        <Text style={[styles.label, { color: C.text }]}>Opciones</Text>
                        <View style={styles.row2}>
                          <Pressable
                            onPress={() => setNewProdReceta((v) => !v)}
                            style={[
                              styles.chip,
                              { borderColor: C.border, backgroundColor: C.card },
                              newProdReceta && { borderColor: C.blueText, backgroundColor: "rgba(64,156,255,0.12)" },
                            ]}
                          >
                            <Text style={[styles.chipText, { color: newProdReceta ? C.blueText : C.text }]}>
                              Receta
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() => setNewProdIva((v) => !v)}
                            style={[
                              styles.chip,
                              { borderColor: C.border, backgroundColor: C.card },
                              newProdIva && { borderColor: C.blueText, backgroundColor: "rgba(64,156,255,0.12)" },
                            ]}
                          >
                            <Text style={[styles.chipText, { color: newProdIva ? C.blueText : C.text }]}>
                              IVA
                            </Text>
                          </Pressable>
                        </View>

                        <AppButton
                          title={savingProd ? "Guardando..." : "Guardar producto"}
                          onPress={() => guardarNuevoProducto(l.key)}
                          loading={savingProd}
                          disabled={!newProdNombre.trim() || newProdMarcaId == null || savingProd}
                          variant="primary"
                          style={[{ marginTop: 12 }] as any}
                        />

                      </View>
                    </ScrollView>
                  )}

                </View>
              ) : null}
            </View>

            {/* Photo — web file input */}
            <View style={{ marginTop: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                {/* Hidden file input */}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" } as any}
                  ref={(el: HTMLInputElement | null) => { fileInputRefs.current[l.key] = el; }}
                  onChange={(e: any) => {
                    const file = e.target?.files?.[0] ?? null;
                    handleFileChange(l.key, file);
                    if (e.target) e.target.value = "";
                  }}
                />
                <Pressable
                  onPress={() => fileInputRefs.current[l.key]?.click()}
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
                  <Pressable onPress={() => updateLinea(l.key, { image_uri: null, image_path: null })}>
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

            {/* Lote + Expiración */}
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
                <input
                  type="date"
                  value={l.fecha_exp ?? ""}
                  onChange={(e: any) => {
                    const val = (e.target as HTMLInputElement).value;
                    updateLinea(l.key, { fecha_exp: val || null });
                  }}
                  style={dateInputStyle}
                />
              </View>
            </View>

            {/* Cantidad + Precio */}
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

      <AppButton
        title="+ Agregar otro producto"
        variant="ghost"
        onPress={addLinea}
        style={[styles.btnAddBottom, { borderColor: C.border, backgroundColor: C.card }] as any}
      />

      <View style={[styles.totalCard, { borderColor: C.border, backgroundColor: C.card }]}>
        <Text style={[styles.totalLabel, { color: C.text }]}>Total</Text>
        <Text style={[styles.totalValue, { color: C.text }]}>Q {total.toFixed(2)}</Text>
      </View>

      <AppButton
        title={saveLabel}
        onPress={guardar}
        loading={saving || loadingEdit}
        disabled={!isFormValid}
        variant="primary"
        style={[styles.saveBtn, { marginBottom: 10 }] as any}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
    paddingVertical: 10,
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
  photoPreview: { width: 120, height: 120, borderRadius: 14 },

  // Inline dropdown
  dropdown: { marginTop: 4, borderWidth: 1, borderRadius: 12, overflow: "hidden" },
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

  // New product form
  createTitle: { fontSize: 15, fontWeight: "700" },

  // Nueva marca row inside brand picker
  newBrandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  newBrandInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 14,
  },
  newBrandBtn: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  newBrandBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
