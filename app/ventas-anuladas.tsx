import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack, router } from "expo-router";
import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { HeaderBackButton } from "@react-navigation/elements";
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View, Modal, ScrollView } from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "../lib/supabase";
import { useThemePref } from "../lib/themePreference";
import { alphaColor } from "../lib/ui";
import { useGoHomeOnBack } from "../lib/useGoHomeOnBack";
import { goHome } from "../lib/goHome";
import { FB_DARK_DANGER } from "../src/theme/headerColors";

type Role = "ADMIN" | "VENTAS" | "BODEGA" | "FACTURACION" | "";

type VentaRow = {
  id: number;
  fecha: string;
  estado: string | null;
  cliente_nombre: string | null;
  vendedor_id: string | null;
  vendedor_codigo: string | null;
};

function normalizeUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return String(iso).slice(0, 10);
}

function shortUid(u: string | null | undefined) {
  const s = String(u ?? "").trim();
  if (!s) return "—";
  return s.slice(0, 8);
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export default function VentasAnuladasScreen() {
  const { colors } = useTheme();
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  // UX: swipe-back / back siempre regresa a Inicio.
  useGoHomeOnBack(true, "/(drawer)/(tabs)");

  const C = useMemo(
    () => ({
      bg: colors.background ?? (isDark ? "#000" : "#fff"),
      card: colors.card ?? (isDark ? "#121214" : "#fff"),
      text: colors.text ?? (isDark ? "#fff" : "#111"),
      sub:
        alphaColor(String(colors.text ?? (isDark ? "#ffffff" : "#000000")), 0.65) ||
        (isDark ? "rgba(255,255,255,0.65)" : "#666"),
      border: colors.border ?? (isDark ? "rgba(255,255,255,0.14)" : "#e5e5e5"),
      dangerBg: isDark ? "rgba(255,90,90,0.18)" : "rgba(220,0,0,0.10)",
      dangerText: FB_DARK_DANGER,
    }),
    [colors.background, colors.border, colors.card, colors.text, isDark]
  );

  const [role, setRole] = useState<Role>("");
  const [q, setQ] = useState("");
  // filtros estilo CxC
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [clientes, setClientes] = useState<{ id: number; nombre: string }[]>([]);
  const [clienteOpen, setClienteOpen] = useState(false);
  const [fClienteId, setFClienteId] = useState<number | null>(null);
  const [fClienteQ, setFClienteQ] = useState("");
  const [fDesde, setFDesde] = useState<Date | null>(null);
  const [fHasta, setFHasta] = useState<Date | null>(null);
  const [showDesdeIOS, setShowDesdeIOS] = useState(false);
  const [showHastaIOS, setShowHastaIOS] = useState(false);
  const [rowsRaw, setRowsRaw] = useState<VentaRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);

  const canView = role === "ADMIN" || role === "BODEGA" || role === "FACTURACION" || role === "VENTAS";

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

  const fetchAnuladas = useCallback(async () => {
    // Primero obtener IDs por tag (RLS limita para VENTAS).
    const { data: trows, error: te } = await supabase
      .from("ventas_tags")
      .select("venta_id,created_at")
      .eq("tag", "ANULADO")
      .is("removed_at", null)
      .order("created_at", { ascending: false })
      .limit(300);
    if (te) throw te;

    const ids = Array.from(
      new Set((trows ?? []).map((r: any) => Number(r.venta_id)).filter((x) => Number.isFinite(x) && x > 0))
    );
    if (!ids.length) {
      setRowsRaw([]);
      return;
    }

    const orderMap = new Map<number, number>();
    ids.forEach((id, idx) => orderMap.set(id, idx));

    const { data, error } = await supabase
      .from("ventas")
      .select("id,fecha,estado,cliente_nombre,vendedor_id,vendedor_codigo")
      .in("id", ids);
    if (error) throw error;

    const rows = ((data ?? []) as any as VentaRow[])
      .slice()
      .sort((a, b) => (orderMap.get(Number(a.id)) ?? 999999) - (orderMap.get(Number(b.id)) ?? 999999));
    setRowsRaw(rows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          await loadRole();
          if (!alive) return;
          if (alive) setInitialLoading(true);
          await fetchAnuladas();
        } catch (e: any) {
          Alert.alert("Error", e?.message ?? "No se pudieron cargar anuladas");
          if (alive) setRowsRaw([]);
        } finally {
          if (alive) setInitialLoading(false);
        }
      })().catch(() => {
        if (alive) setInitialLoading(false);
      });
      return () => {
        alive = false;
      };
    }, [fetchAnuladas, loadRole])
  );

  React.useEffect(() => {
    if (!role) return;
    if (canView) return;
    Alert.alert("Sin permiso", "Tu rol no puede ver anuladas.", [
      { text: "OK", onPress: () => goHome("/(drawer)/(tabs)") },
    ]);
  }, [canView, role]);

  // load clientes for filter dropdown
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.from("clientes").select("id,nombre").order("nombre", { ascending: true });
        if (alive && data) setClientes((data as any) as { id: number; nombre: string }[]);
      } catch {
        if (alive) setClientes([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const filteredClientes = useMemo(() => {
    const q = (fClienteQ ?? "").trim().toLowerCase();
    if (!q) return clientes;
    return (clientes ?? []).filter((c) => String(c.nombre ?? "").toLowerCase().includes(q) || String(c.id ?? "").includes(q));
  }, [clientes, fClienteQ]);

  const openDesdePicker = () => {
    setClienteOpen(false);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({ value: fDesde ?? new Date(), mode: "date", onChange: (_ev, date) => { if (date) setFDesde(date); } });
    } else {
      setShowDesdeIOS(true);
      setShowHastaIOS(false);
    }
  };

  const openHastaPicker = () => {
    setClienteOpen(false);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({ value: fHasta ?? new Date(), mode: "date", onChange: (_ev, date) => { if (date) setFHasta(date); } });
    } else {
      setShowHastaIOS(true);
      setShowDesdeIOS(false);
    }
  };

  const limpiarFiltros = () => {
    setFClienteId(null);
    setFDesde(null);
    setFHasta(null);
    setClienteOpen(false);
    setShowDesdeIOS(false);
    setShowHastaIOS(false);
  };

  const rows = useMemo(() => {
    const search = q.trim().toLowerCase();
    const hasSearch = Boolean(search);

    return rowsRaw.filter((r) => {
      const id = String(r.id);
      const cliente = String(r.cliente_nombre ?? "").toLowerCase();
      const vcode = String(r.vendedor_codigo ?? "").toLowerCase();

      // basic text search (id, cliente, vendedor) - optional
      const textMatch = hasSearch ? id.includes(search) || cliente.includes(search) || vcode.includes(search) : true;
      if (!textMatch) return false;

      // cliente dropdown filter (compare by name)
      if (fClienteId) {
        const c = clientes.find((c) => c.id === fClienteId);
        if (c) {
          if (!String(r.cliente_nombre ?? "").toLowerCase().includes(String(c.nombre ?? "").toLowerCase())) return false;
        }
      }

      // fecha range filter using Date objects
      const fechaIso = String(r.fecha ?? "").slice(0, 10);
      const fechaMs = fechaIso ? new Date(`${fechaIso}T12:00:00`).getTime() : null;
      if (fDesde) {
        const desdeMs = startOfDay(fDesde).getTime();
        if (!fechaMs || fechaMs < desdeMs) return false;
      }
      if (fHasta) {
        const hastaMs = endOfDay(fHasta).getTime();
        if (!fechaMs || fechaMs > hastaMs) return false;
      }

      return true;
    });
  }, [q, rowsRaw, fClienteId, fDesde, fHasta, clientes]);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Anuladas",
          headerBackTitle: "Atrás",
          gestureEnabled: false,
          headerBackVisible: false,
          headerBackButtonMenuEnabled: false,
          headerLeft: (props: any) => <HeaderBackButton {...props} label="Atrás" onPress={() => goHome("/(drawer)/(tabs)")} />,
        }}
      />

      <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
        <View style={[styles.content, { backgroundColor: C.bg }]}
        >
           <View style={styles.headerRow}>
             <TextInput
               value={q}
               onChangeText={setQ}
               placeholder="Buscar (cliente, id, vendedor)..."
               placeholderTextColor={C.sub}
               style={[styles.search, { borderColor: C.border, backgroundColor: C.card, color: C.text, flex: 1 }]}
               autoCapitalize="none"
               autoCorrect={false}
             />
 
             <Pressable
               onPress={() => setFiltersOpen(true)}
               style={({ pressed }) => [
                 styles.filterBtn,
                 { borderColor: C.border, backgroundColor: C.card },
                 pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
               ]}
             >
               <Text style={[styles.filterTxt, { color: C.text }]}>Filtros</Text>
             </Pressable>
           </View>
         </View>

        <FlatList
          data={rows}
          keyExtractor={(it) => String(it.id)}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ paddingBottom: 24, paddingTop: 6 }}
          renderItem={({ item }) => {
            return (
              <Pressable
                onPress={() => router.push({ pathname: "/venta-detalle", params: { ventaId: String(item.id) } } as any)}
                style={({ pressed }) => [
                  styles.card,
                  { borderColor: C.border, backgroundColor: C.card },
                  pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
                ]}
              >
                <View style={styles.rowBetween}>
                  <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>
                    {item.cliente_nombre ?? "—"}
                  </Text>
                  <View style={[styles.pill, { backgroundColor: C.dangerBg, borderColor: C.border }]}
                  >
                    <Text style={[styles.pillText, { color: C.dangerText }]} numberOfLines={1}>
                      ANULADA
                    </Text>
                  </View>
                </View>

                <Text style={[styles.sub, { color: C.sub }]} numberOfLines={1}>
                  Venta #{item.id} • Fecha: {fmtDate(item.fecha)}
                </Text>
                <Text style={[styles.sub, { color: C.sub }]} numberOfLines={1}>
                  Vendedor: {item.vendedor_codigo ? String(item.vendedor_codigo) : shortUid(item.vendedor_id)}
                </Text>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={{ padding: 16, color: C.sub, fontWeight: "700" }}>
              {initialLoading ? "Cargando..." : "Sin anuladas"}
            </Text>
          }
        />
        
        {/* Modal filtros */}
        {filtersOpen ? (
          <Modal visible={filtersOpen} transparent animationType="fade" onRequestClose={() => setFiltersOpen(false)}>
            <Pressable
              style={[
                styles.modalBackdrop,
                { backgroundColor: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)" },
              ]}
              onPress={() => setFiltersOpen(false)}
            />

            <View style={[styles.modalCard, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: C.text }]}>Filtros</Text>
                <Pressable onPress={() => setFiltersOpen(false)} hitSlop={10}><Text style={[styles.modalClose, { color: C.sub }]}>Cerrar</Text></Pressable>
              </View>

            <Text style={[styles.sectionLabel, { color: C.text }]}>Cliente</Text>
            <Pressable
              onPress={() => { setClienteOpen((v) => !v); setShowDesdeIOS(false); setShowHastaIOS(false); }}
              style={[styles.dropdownInput, { borderColor: C.border, backgroundColor: C.card }]}
            >
              <Text style={[styles.dropdownText, { color: C.text }]} numberOfLines={1}>{fClienteId ? (clientes.find(c => c.id === fClienteId)?.nombre ?? "Todos") : "Todos"}</Text>
              <Text style={[styles.dropdownCaret, { color: C.sub }]}>{clienteOpen ? "▲" : "▼"}</Text>
            </Pressable>
            {clienteOpen ? (
              <View style={[styles.dropdownPanel, { borderColor: C.border, backgroundColor: C.card }]}>
                  <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled">
                    <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
                      <TextInput
                        value={fClienteQ}
                        onChangeText={setFClienteQ}
                        placeholder="Buscar cliente..."
                        placeholderTextColor={C.sub}
                        style={[
                          styles.clientSearchInput,
                          {
                            color: C.text,
                            borderColor: C.border,
                            backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                          },
                        ]}
                        autoCapitalize="none"
                        returnKeyType="search"
                      />
                    </View>
                    <Pressable
                      onPress={() => {
                        setFClienteId(null);
                        setClienteOpen(false);
                        setFClienteQ("");
                      }}
                      style={[styles.ddRow, { borderBottomColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)" }]}
                    >
                      <Text style={{ fontSize: 16, fontWeight: "600", color: C.text }}>Todos</Text>
                    </Pressable>
                    {filteredClientes.map((c) => (
                      <Pressable
                        key={String(c.id)}
                        onPress={() => {
                          setFClienteId(c.id);
                          setClienteOpen(false);
                          setFClienteQ("");
                        }}
                        style={[styles.ddRow, { borderBottomColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)" }]}
                      >
                        <Text style={{ fontSize: 16, fontWeight: "600", color: C.text }}>{c.nombre}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
              </View>
            ) : null}

            <View style={{ height: 10 }} />

            <View style={styles.twoCols}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sectionLabel, { color: C.text }]}>Desde</Text>
                <Pressable onPress={openDesdePicker} style={[styles.dateBox, { borderColor: C.border, backgroundColor: C.card }]}>
                  <Text style={[styles.dateTxt, { color: C.text }]}>{fDesde ? fmtDate(fDesde.toISOString()) : "—"}</Text>
                </Pressable>
              </View>

              <View style={{ width: 12 }} />

              <View style={{ flex: 1 }}>
                <Text style={[styles.sectionLabel, { color: C.text }]}>Hasta</Text>
                <Pressable onPress={openHastaPicker} style={[styles.dateBox, { borderColor: C.border, backgroundColor: C.card }]}>
                  <Text style={[styles.dateTxt, { color: C.text }]}>{fHasta ? fmtDate(fHasta.toISOString()) : "—"}</Text>
                </Pressable>
              </View>
            </View>

            {Platform.OS === "ios" && showDesdeIOS ? (
              <View style={[styles.iosPickerWrap, { borderColor: C.border, backgroundColor: C.card }]}>
                <DateTimePicker value={fDesde ?? new Date()} mode="date" display="inline" themeVariant={isDark ? "dark" : "light"} onChange={(_ev, date) => { if (date) { setFDesde(date); setShowDesdeIOS(false); } }} />
              </View>
            ) : null}

            {Platform.OS === "ios" && showHastaIOS ? (
              <View style={[styles.iosPickerWrap, { borderColor: C.border, backgroundColor: C.card }]}>
                <DateTimePicker value={fHasta ?? new Date()} mode="date" display="inline" themeVariant={isDark ? "dark" : "light"} onChange={(_ev, date) => { if (date) { setFHasta(date); setShowHastaIOS(false); } }} />
              </View>
            ) : null}

            <View style={{ height: 10 }} />
            <View style={styles.modalActions}>
              <Pressable
                onPress={limpiarFiltros}
                style={[styles.actionBtn, { borderColor: C.border, backgroundColor: C.card }]}
              >
                <Text style={[styles.actionBtnText, { color: C.text }]}>Limpiar</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setFiltersOpen(false);
                  setClienteOpen(false);
                  setShowDesdeIOS(false);
                  setShowHastaIOS(false);
                }}
                style={[styles.actionBtn, { borderColor: C.border, backgroundColor: C.card }]}
              >
                <Text style={[styles.actionBtnText, { color: C.text }]}>Aplicar</Text>
              </Pressable>
            </View>
            </View>
          </Modal>
        ) : null}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  search: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 12, android: 10, default: 10 }),
    fontSize: 16,
  },
  headerRow: { flexDirection: "row", gap: 10, alignItems: "center", marginBottom: 8 },
  filterBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 12, android: 10, default: 10 }),
    alignItems: "center",
    justifyContent: "center",
  },
  filterTxt: { fontWeight: "800" },
  smallInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: Platform.select({ ios: 10, android: 8, default: 8 }),
    fontSize: 14,
    marginTop: 8,
  },
  dateRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginTop: 8 },
  dateInput: {
    width: "48%",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: Platform.select({ ios: 10, android: 8, default: 8 }),
    fontSize: 14,
  },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  modalCard: { position: "absolute", left: 14, right: 14, top: 90, borderRadius: 18, padding: 16, borderWidth: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontSize: 20, fontWeight: "800" },
  modalClose: { fontSize: 15, fontWeight: "700" },
  sectionLabel: { marginTop: 12, fontSize: 15, fontWeight: "800" },
  dropdownInput: { marginTop: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dropdownText: { fontSize: 16, fontWeight: "600", flex: 1, paddingRight: 10 },
  dropdownCaret: { fontSize: 14, fontWeight: "900" },
  dropdownPanel: { marginTop: 10, borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  ddRow: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  twoCols: { flexDirection: "row", marginTop: 8 },
  dateBox: { marginTop: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
  dateTxt: { fontSize: 16, fontWeight: "700" },
  iosPickerWrap: { marginTop: 10, borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  clientSearchInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },
  actionBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 12, android: 10, default: 10 }),
  },
  actionBtnText: { fontWeight: "800" },
  card: { marginHorizontal: 16, marginTop: 10, borderWidth: 1, borderRadius: 16, padding: 14 },
  title: { fontSize: 16, fontWeight: "900" },
  sub: { marginTop: 6, fontSize: 13, fontWeight: "700" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  pillText: { fontSize: 12, fontWeight: "900" },
});
