import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTheme } from "@react-navigation/native";
import { KeyboardAwareModal } from "../ui/keyboard-aware-modal";
import { AppButton } from "../ui/app-button";
import { supabase } from "../../lib/supabase";
import { useEmpresaActiva } from "../../lib/useEmpresaActiva";
import { invalidate as invalidateProductoCache } from "../../lib/productoCache";
import { safeIlike } from "../../lib/utils/text";
import { fmtDate } from "../../lib/utils/format";

type Tipo = "MERMA" | "AJUSTE_SALIDA" | "AJUSTE_ENTRADA";

type ProductoRow = {
  id: number;
  nombre: string;
  marca: string | null;
  stock_disponible: number;
};

type LoteRow = {
  lote_id: number;
  lote: string | null;
  fecha_exp: string | null;
  stock_total: number;
  stock_reservado: number;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  productoIdInicial?: number;
  productoNombreInicial?: string;
  loteIdInicial?: number;
};

function useDebouncedValue<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const TIPO_OPTIONS: { key: Tipo; label: string; color: string }[] = [
  { key: "MERMA",         label: "Merma",  color: "#D32F2F" },
  { key: "AJUSTE_SALIDA", label: "Salida", color: "#E65100" },
  { key: "AJUSTE_ENTRADA",label: "Entrada",color: "#2E7D32" },
];

export function AjusteInventarioModal({
  visible,
  onClose,
  onSuccess,
  productoIdInicial,
  productoNombreInicial,
  loteIdInicial,
}: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const { empresaActivaId } = useEmpresaActiva();

  // Step: 'producto' | 'lote' | 'ajuste'
  const [step, setStep] = useState<"producto" | "lote" | "ajuste">("producto");

  // Producto seleccionado
  const [selectedProducto, setSelectedProducto] = useState<ProductoRow | null>(null);

  // Lotes del producto seleccionado
  const [lotes, setLotes] = useState<LoteRow[]>([]);
  const [loadingLotes, setLoadingLotes] = useState(false);

  // Lote seleccionado
  const [selectedLote, setSelectedLote] = useState<LoteRow | null>(null);

  // Ajuste
  const [tipo, setTipo] = useState<Tipo>("MERMA");
  const [cantidad, setCantidad] = useState("1");
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Búsqueda de productos
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q.trim(), 300);
  const [productos, setProductos] = useState<ProductoRow[]>([]);
  const [loadingProductos, setLoadingProductos] = useState(false);

  const reqSeq = useRef(0);

  // Resetear estado al abrir/cerrar
  useEffect(() => {
    if (!visible) return;
    setSaveError(null);
    setSaving(false);
    setMotivo("");
    setCantidad("1");
    setTipo("MERMA");
    setQ("");
    setProductos([]);

    if (productoIdInicial && loteIdInicial) {
      // Ir directo al paso de ajuste — los datos del lote se cargan abajo
      setSelectedProducto(
        productoNombreInicial
          ? { id: productoIdInicial, nombre: productoNombreInicial, marca: null, stock_disponible: 0 }
          : null
      );
      setSelectedLote(null);
      setStep("ajuste");
      // Cargamos datos del lote para mostrar stock
      void loadLoteById(productoIdInicial, loteIdInicial);
    } else if (productoIdInicial) {
      setSelectedProducto(
        productoNombreInicial
          ? { id: productoIdInicial, nombre: productoNombreInicial, marca: null, stock_disponible: 0 }
          : null
      );
      setSelectedLote(null);
      setStep("lote");
      void loadLotes(productoIdInicial);
    } else {
      setSelectedProducto(null);
      setSelectedLote(null);
      setLotes([]);
      setStep("producto");
    }
  }, [visible]);

  async function loadLotes(productoId: number) {
    if (!empresaActivaId) return;
    setLoadingLotes(true);
    try {
      const { data, error } = await supabase
        .from("producto_lotes")
        .select(`
          id,
          lote,
          fecha_exp,
          stock_lotes!inner(stock_total, stock_reservado)
        `)
        .eq("producto_id", productoId)
        .eq("activo", true)
        .order("fecha_exp", { ascending: true, nullsFirst: false });

      if (error) throw error;
      const rows: LoteRow[] = (data ?? []).map((r: any) => ({
        lote_id: r.id,
        lote: r.lote ?? null,
        fecha_exp: r.fecha_exp ?? null,
        stock_total: r.stock_lotes?.stock_total ?? 0,
        stock_reservado: r.stock_lotes?.stock_reservado ?? 0,
      }));
      setLotes(rows);
    } catch {
      setLotes([]);
    } finally {
      setLoadingLotes(false);
    }
  }

  async function loadLoteById(productoId: number, loteId: number) {
    if (!empresaActivaId) return;
    try {
      const { data, error } = await supabase
        .from("producto_lotes")
        .select(`
          id,
          lote,
          fecha_exp,
          stock_lotes!inner(stock_total, stock_reservado)
        `)
        .eq("id", loteId)
        .eq("producto_id", productoId)
        .single();

      if (error) throw error;
      if (data) {
        setSelectedLote({
          lote_id: data.id,
          lote: (data as any).lote ?? null,
          fecha_exp: (data as any).fecha_exp ?? null,
          stock_total: (data as any).stock_lotes?.stock_total ?? 0,
          stock_reservado: (data as any).stock_lotes?.stock_reservado ?? 0,
        });
      }
    } catch {}
  }

  // Buscar productos
  useEffect(() => {
    if (!visible || step !== "producto") return;
    if (!empresaActivaId) return;

    const seq = ++reqSeq.current;
    setLoadingProductos(true);

    const run = async () => {
      let req = supabase
        .from("vw_inventario_productos")
        .select("id,nombre,marca,stock_disponible")
        .eq("empresa_id", empresaActivaId)
        .eq("activo", true)
        .order("nombre", { ascending: true })
        .limit(40);

      if (debouncedQ) {
        const safe = safeIlike(debouncedQ);
        req = req.or(`nombre.ilike.%${safe}%,marca.ilike.%${safe}%`);
      }

      const { data, error } = await req;
      if (seq !== reqSeq.current) return;
      if (!error) setProductos((data ?? []) as ProductoRow[]);
      setLoadingProductos(false);
    };

    run().catch(() => setLoadingProductos(false));
  }, [debouncedQ, visible, step, empresaActivaId]);

  const onSelectProducto = useCallback(
    async (p: ProductoRow) => {
      setSelectedProducto(p);
      setSelectedLote(null);
      setStep("lote");
      await loadLotes(p.id);
    },
    [empresaActivaId]
  );

  const onSelectLote = useCallback((lote: LoteRow) => {
    setSelectedLote(lote);
    setSaveError(null);
    setCantidad("1");
    setTipo("MERMA");
    setMotivo("");
    setStep("ajuste");
  }, []);

  const onBack = useCallback(() => {
    if (step === "ajuste") {
      if (loteIdInicial) {
        // vino con lote pre-seleccionado: cerrar directamente
        onClose();
      } else if (productoIdInicial) {
        setStep("lote");
      } else {
        setStep("lote");
      }
    } else if (step === "lote") {
      if (productoIdInicial) {
        onClose();
      } else {
        setStep("producto");
      }
    } else {
      onClose();
    }
  }, [step, productoIdInicial, loteIdInicial, onClose]);

  const cantidadNum = Math.max(0, parseInt(cantidad, 10) || 0);
  const isDelta = tipo === "MERMA" || tipo === "AJUSTE_SALIDA" ? -1 : 1;
  const stockActual = selectedLote?.stock_total ?? 0;
  const stockNuevo = stockActual + isDelta * cantidadNum;
  const stockInsuficiente = stockNuevo < 0;
  const canConfirm = cantidadNum > 0 && !stockInsuficiente && !saving;

  const onConfirm = useCallback(async () => {
    if (!canConfirm || !selectedLote || !selectedProducto || !empresaActivaId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { data, error } = await supabase.rpc("rpc_ajustar_stock_manual", {
        p_empresa_id: empresaActivaId,
        p_lote_id:    selectedLote.lote_id,
        p_tipo:       tipo,
        p_cantidad:   cantidadNum,
        p_motivo:     motivo.trim() || null,
      });

      if (error) throw error;
      const res = data as { ok: boolean; error?: string } | null;
      if (res && !res.ok) throw new Error(res.error ?? "Error desconocido");

      invalidateProductoCache(selectedProducto.id);
      onSuccess();
      onClose();
    } catch (e: any) {
      const msg: string = e?.message ?? "Error al guardar ajuste";
      if (msg === "STOCK_INSUFICIENTE") {
        setSaveError("No hay suficiente stock para este ajuste.");
      } else if (msg === "NO_AUTORIZADO") {
        setSaveError("Solo administradores pueden hacer ajustes.");
      } else {
        setSaveError(msg);
      }
    } finally {
      setSaving(false);
    }
  }, [
    canConfirm, selectedLote, selectedProducto, empresaActivaId,
    tipo, cantidadNum, motivo, onSuccess, onClose,
  ]);

  function adjCantidad(delta: number) {
    const next = Math.max(1, cantidadNum + delta);
    setCantidad(String(next));
  }

  const tipoColor = TIPO_OPTIONS.find((o) => o.key === tipo)?.color ?? "#000";

  const title =
    step === "producto"
      ? "Ajuste de inventario"
      : step === "lote"
      ? "Seleccionar lote"
      : "Registrar ajuste";

  return (
    <KeyboardAwareModal
      visible={visible}
      onClose={onClose}
      maxHeightRatio={0.88}
      cardStyle={s.card}
    >
      {/* Cabecera */}
      <View style={s.header}>
        <Pressable onPress={onBack} hitSlop={10} style={s.backBtn}>
          <Text style={s.backTxt}>← Atrás</Text>
        </Pressable>
        <Text style={s.title} numberOfLines={1}>{title}</Text>
      </View>

      {/* PASO 1: buscar producto */}
      {step === "producto" && (
        <View style={{ flex: 1 }}>
          <View style={s.searchWrap}>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Buscar producto..."
              placeholderTextColor={colors.text + "66"}
              style={s.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {q.length > 0 ? (
              <Pressable onPress={() => setQ("")} hitSlop={10}>
                <Text style={s.clearTxt}>×</Text>
              </Pressable>
            ) : null}
          </View>

          {loadingProductos ? (
            <View style={s.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <FlatList
              data={productos}
              keyExtractor={(r) => String(r.id)}
              style={{ flex: 1 }}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={s.center}>
                  <Text style={s.hint}>
                    {debouncedQ ? "Sin resultados" : "Escribe para buscar..."}
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [s.row, pressed && s.pressed]}
                  onPress={() => onSelectProducto(item)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle} numberOfLines={1}>{item.nombre}</Text>
                    {item.marca ? (
                      <Text style={s.rowSub} numberOfLines={1}>{item.marca}</Text>
                    ) : null}
                  </View>
                  <Text style={s.rowStock}>{item.stock_disponible}</Text>
                </Pressable>
              )}
            />
          )}
        </View>
      )}

      {/* PASO 2: seleccionar lote */}
      {step === "lote" && (
        <View style={{ flex: 1 }}>
          {selectedProducto ? (
            <Text style={s.prodName} numberOfLines={2}>{selectedProducto.nombre}</Text>
          ) : null}

          {loadingLotes ? (
            <View style={s.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : lotes.length === 0 ? (
            <View style={s.center}>
              <Text style={s.hint}>No hay lotes activos para este producto.</Text>
            </View>
          ) : (
            <FlatList
              data={lotes}
              keyExtractor={(r) => String(r.lote_id)}
              style={{ flex: 1 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [s.row, pressed && s.pressed]}
                  onPress={() => onSelectLote(item)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>{item.lote ?? "—"}</Text>
                    <Text style={s.rowSub}>Exp: {fmtDate(item.fecha_exp)}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={s.rowStock}>{item.stock_total}</Text>
                    <Text style={s.rowSub}>total</Text>
                  </View>
                </Pressable>
              )}
            />
          )}
        </View>
      )}

      {/* PASO 3: ingresar ajuste */}
      {step === "ajuste" && (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 8 }}
        >
          {/* Info producto + lote */}
          <View style={s.infoBox}>
            {selectedProducto ? (
              <Text style={s.infoTitle} numberOfLines={2}>{selectedProducto.nombre}</Text>
            ) : null}
            {selectedLote ? (
              <>
                <Text style={s.infoSub}>
                  Lote: {selectedLote.lote ?? "—"}
                  {selectedLote.fecha_exp ? `  ·  Exp: ${fmtDate(selectedLote.fecha_exp)}` : ""}
                </Text>
                <Text style={s.infoSub}>
                  Stock actual: <Text style={{ fontWeight: "700" }}>{selectedLote.stock_total}</Text>
                  {selectedLote.stock_reservado > 0
                    ? `  (reservado: ${selectedLote.stock_reservado})`
                    : ""}
                </Text>
              </>
            ) : (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 4 }} />
            )}
          </View>

          {/* Selector de tipo */}
          <Text style={s.label}>Tipo de ajuste</Text>
          <View style={s.tipoRow}>
            {TIPO_OPTIONS.map((opt) => {
              const active = tipo === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  style={[
                    s.tipoPill,
                    { borderColor: opt.color },
                    active && { backgroundColor: opt.color },
                  ]}
                  onPress={() => { setTipo(opt.key); setSaveError(null); }}
                >
                  <Text
                    style={[
                      s.tipoPillTxt,
                      { color: active ? "#fff" : opt.color },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Cantidad */}
          <Text style={s.label}>Cantidad</Text>
          <View style={s.cantRow}>
            <Pressable
              style={[s.cantBtn, { borderColor: colors.border }]}
              onPress={() => adjCantidad(-1)}
            >
              <Text style={[s.cantBtnTxt, { color: colors.text }]}>−</Text>
            </Pressable>
            <TextInput
              value={cantidad}
              onChangeText={(v) => setCantidad(v.replace(/[^0-9]/g, ""))}
              keyboardType="numeric"
              style={[s.cantInput, { color: colors.text, borderColor: colors.border }]}
              textAlign="center"
              selectTextOnFocus
            />
            <Pressable
              style={[s.cantBtn, { borderColor: colors.border }]}
              onPress={() => adjCantidad(1)}
            >
              <Text style={[s.cantBtnTxt, { color: colors.text }]}>+</Text>
            </Pressable>
          </View>

          {/* Preview stock resultante */}
          {selectedLote ? (
            <View style={[s.previewBox, stockInsuficiente && s.previewError]}>
              <Text style={[s.previewTxt, { color: stockInsuficiente ? "#D32F2F" : tipoColor }]}>
                {stockInsuficiente
                  ? `Stock insuficiente (disponible: ${selectedLote.stock_total})`
                  : `Stock actual ${selectedLote.stock_total} → Stock nuevo: ${stockNuevo}`}
              </Text>
            </View>
          ) : null}

          {/* Motivo */}
          <Text style={s.label}>Motivo <Text style={s.optional}>(opcional)</Text></Text>
          <TextInput
            value={motivo}
            onChangeText={setMotivo}
            placeholder="Ej: ampollas quebradas, vencimiento..."
            placeholderTextColor={colors.text + "55"}
            style={[s.motivoInput, { color: colors.text, borderColor: colors.border }]}
            multiline
            maxLength={200}
            returnKeyType="done"
          />

          {saveError ? (
            <Text style={s.errorTxt}>{saveError}</Text>
          ) : null}

          {/* Botones */}
          <View style={s.btnRow}>
            <AppButton
              title="Cancelar"
              variant="outline"
              size="sm"
              onPress={onClose}
              style={{ flex: 1 }}
            />
            <AppButton
              title="Confirmar ajuste"
              variant="primary"
              size="sm"
              onPress={onConfirm}
              disabled={!canConfirm}
              loading={saving}
              style={{ flex: 1 }}
            />
          </View>
        </ScrollView>
      )}
    </KeyboardAwareModal>
  );
}

const styles = (colors: any) =>
  StyleSheet.create({
    card: {
      paddingBottom: Platform.OS === "web" ? 16 : 8,
      maxHeight: Platform.OS === "web" ? 620 : undefined,
    },

    header: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 12,
      gap: 8,
    },
    backBtn: { paddingVertical: 4 },
    backTxt: { color: colors.primary, fontSize: 14, fontWeight: "600" },
    title: {
      flex: 1,
      color: colors.text,
      fontSize: Platform.OS === "web" ? 16 : 14,
      fontWeight: "700",
    },

    searchWrap: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      borderRadius: 12,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 8,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      paddingVertical: 10,
      fontSize: 15,
    },
    clearTxt: { color: colors.text + "88", fontSize: 20, fontWeight: "900" },

    center: { alignItems: "center", justifyContent: "center", paddingVertical: 24 },
    hint: { color: colors.text + "88", fontSize: 13 },

    row: {
      flexDirection: "row",
      alignItems: "center",
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      marginBottom: 8,
      backgroundColor: colors.card,
      gap: 10,
    },
    pressed: { opacity: 0.75 },
    rowTitle: { color: colors.text, fontWeight: "700", fontSize: 14 },
    rowSub: { color: colors.text + "99", fontSize: 11, marginTop: 2 },
    rowStock: { color: colors.text, fontWeight: "800", fontSize: 18 },

    prodName: {
      color: colors.text,
      fontWeight: "700",
      fontSize: 14,
      marginBottom: 10,
    },

    infoBox: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 12,
      marginBottom: 14,
    },
    infoTitle: { color: colors.text, fontWeight: "700", fontSize: 14 },
    infoSub: { color: colors.text + "AA", fontSize: 12, marginTop: 4 },

    label: {
      color: colors.text,
      fontWeight: "700",
      fontSize: 13,
      marginBottom: 6,
      marginTop: 2,
    },
    optional: { fontWeight: "400", color: colors.text + "88" },

    tipoRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
    tipoPill: {
      flex: 1,
      borderWidth: 1.5,
      borderRadius: 10,
      paddingVertical: 8,
      alignItems: "center",
    },
    tipoPillTxt: { fontWeight: "700", fontSize: 13 },

    cantRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 10,
    },
    cantBtn: {
      width: 44,
      height: 44,
      borderWidth: 1,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    cantBtnTxt: { fontSize: 22, fontWeight: "700", lineHeight: 24 },
    cantInput: {
      flex: 1,
      height: 44,
      borderWidth: 1,
      borderRadius: 12,
      fontSize: 20,
      fontWeight: "700",
    },

    previewBox: {
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: "transparent",
      marginBottom: 10,
    },
    previewError: {},
    previewTxt: { fontWeight: "700", fontSize: 13, textAlign: "center" },

    motivoInput: {
      borderWidth: 1,
      borderRadius: 12,
      padding: 10,
      fontSize: 14,
      minHeight: 64,
      textAlignVertical: "top",
      marginBottom: 14,
    },

    errorTxt: {
      color: "#D32F2F",
      fontSize: 13,
      marginBottom: 10,
      textAlign: "center",
    },

    btnRow: { flexDirection: "row", gap: 10 },
  });
