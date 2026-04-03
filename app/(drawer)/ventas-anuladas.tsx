import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack, router } from "expo-router";
import React, { useCallback, useMemo, useState, useEffect } from "react";
import { Alert, SectionList, Platform, Pressable, StyleSheet, Text, TextInput, View, Modal, ScrollView, useWindowDimensions } from "react-native";
import { VentasAnuladasDetallePanel } from "../../components/ventas/VentasAnuladasDetallePanel";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "../../lib/supabase";
import { RoleGate } from "../../components/auth/RoleGate";
import { useThemePref } from "../../lib/themePreference";
import { alphaColor } from "../../lib/ui";
import { useGoHomeOnBack } from "../../lib/useGoHomeOnBack";
import { FB_DARK_DANGER } from "../../src/theme/headerColors";
import { useRole } from "../../lib/useRole";
import { useEmpresaActiva } from "../../lib/useEmpresaActiva";
import { useResumeLoad } from "../../lib/useResumeLoad";
import { fmtDateLongEs } from "../../lib/utils/format";
import { normalizeUpper, safeIlike } from "../../lib/utils/text";

type Role = "ADMIN" | "VENTAS" | "BODEGA" | "FACTURACION" | "MENSAJERO" | "";

type VentaRow = {
  id: number;
  fecha: string;
  estado: string | null;
  cliente_nombre: string | null;
  vendedor_id: string | null;
  vendedor_codigo: string | null;
};

type AnuladaSection = { title: string; data: VentaRow[] };

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

const AnuladaItem = React.memo(function AnuladaItem({
  item,
  C,
  selected,
  onPress,
}: {
  item: VentaRow;
  C: { border: string; card: string; text: string; sub: string; dangerBg: string; dangerText: string; primary: string };
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { borderColor: C.border, backgroundColor: C.card },
        selected && { borderColor: C.primary, borderWidth: 2 },
        pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
      ]}
    >
      <View style={styles.rowBetween}>
        <Text style={[styles.title, { color: C.text }]} numberOfLines={1} ellipsizeMode="tail">
          {item.cliente_nombre ?? "—"}
        </Text>
        <View style={[styles.pill, { backgroundColor: C.dangerBg, borderColor: C.border }]}>
          <Text style={[styles.pillText, { color: C.dangerText }]} numberOfLines={1}>
            ANULADA
          </Text>
        </View>
      </View>
      <Text style={[styles.sub, { color: C.sub }]} numberOfLines={1}>
        Venta #{item.id} • Fecha: {fmtDateLongEs(item.fecha)}
      </Text>
      <Text style={[styles.sub, { color: C.sub }]} numberOfLines={1}>
        Vendedor: {item.vendedor_codigo ? String(item.vendedor_codigo) : shortUid(item.vendedor_id)}
      </Text>
    </Pressable>
  );
});

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
      primary: String(colors.primary ?? "#153c9e"),
    }),
    [colors.background, colors.border, colors.card, colors.text, colors.primary, isDark]
  );

  const { role, uid, isReady, refreshRole } = useRole();
  const { empresaActivaId } = useEmpresaActiva();

  const { width } = useWindowDimensions();
  const canSplit = Platform.OS === "web" && width >= 1100;
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (!canSplit) setSelectedId(null);
  }, [canSplit]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const style = document.createElement("style");
    style.textContent = "input:focus { outline: none !important; }";
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  const [q, setQ] = useState("");
  // filtros
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fClienteId, setFClienteId] = useState<number | null>(null);
  const [fClienteNombre, setFClienteNombre] = useState<string>("");
  const [clienteSearchQ, setClienteSearchQ] = useState("");
  const [clienteSearchResults, setClienteSearchResults] = useState<{ id: number; nombre: string }[]>([]);
  const [clienteSearchLoading, setClienteSearchLoading] = useState(false);
  const [fDesde, setFDesde] = useState<Date | null>(null);
  const [fHasta, setFHasta] = useState<Date | null>(null);
  const [showDesdeIOS, setShowDesdeIOS] = useState(false);
  const [showHastaIOS, setShowHastaIOS] = useState(false);
  const [rowsRaw, setRowsRaw] = useState<VentaRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);

  const fetchAnuladas = useCallback(async () => {
    if (!empresaActivaId) return;
    const { data, error } = await supabase
      .from("ventas_tags")
      .select("created_at, ventas:venta_id ( id, fecha, estado, cliente_nombre, vendedor_id, vendedor_codigo )")
      .eq("empresa_id", empresaActivaId)
      .eq("tag", "ANULADO")
      .is("removed_at", null)
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) throw error;

    const rows = (data ?? [])
      .map((r: any) => r.ventas)
      .filter(Boolean) as VentaRow[];

    setRowsRaw(rows);
  }, [empresaActivaId]);

  const searchClientes = useCallback(async (term: string) => {
    if (term.trim().length < 2) {
      setClienteSearchResults([]);
      setClienteSearchLoading(false);
      return;
    }
    setClienteSearchLoading(true);
    try {
      if (!empresaActivaId) { setClienteSearchResults([]); return; }
      let req = supabase
        .from("clientes")
        .select("id,nombre")
        .eq("empresa_id", empresaActivaId)
        .eq("activo", true)
        .ilike("nombre", `%${safeIlike(term)}%`)
        .limit(20);
      if ((normalizeUpper(role) === "VENTAS" || normalizeUpper(role) === "MENSAJERO") && uid) {
        req = req.eq("vendedor_id", uid);
      }
      const { data } = await req;
      setClienteSearchResults(data ?? []);
    } catch {
      setClienteSearchResults([]);
    } finally {
      setClienteSearchLoading(false);
    }
  }, [empresaActivaId, role, uid]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          await refreshRole("focus:ventas-anuladas");
          if (!alive) return;
          if (!isReady) return;

          const currentRole = normalizeUpper(role) as Role;

          const allowed =
            currentRole === "ADMIN" ||
            currentRole === "BODEGA" ||
            currentRole === "FACTURACION" ||
            currentRole === "VENTAS" ||
            currentRole === "MENSAJERO";

          if (!allowed) return;
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
    }, [fetchAnuladas, isReady, refreshRole, role])
  );

  useResumeLoad(empresaActivaId, () => { void fetchAnuladas(); });


  const openDesdePicker = () => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({ value: fDesde ?? new Date(), mode: "date", onChange: (_ev, date) => { if (date) setFDesde(date); } });
    } else {
      setShowDesdeIOS(true);
      setShowHastaIOS(false);
    }
  };

  const openHastaPicker = () => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({ value: fHasta ?? new Date(), mode: "date", onChange: (_ev, date) => { if (date) setFHasta(date); } });
    } else {
      setShowHastaIOS(true);
      setShowDesdeIOS(false);
    }
  };

  const limpiarFiltros = () => {
    setFClienteId(null);
    setFClienteNombre("");
    setClienteSearchQ("");
    setClienteSearchResults([]);
    setFDesde(null);
    setFHasta(null);
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

      // cliente filter
      if (fClienteId && fClienteNombre) {
        if (!String(r.cliente_nombre ?? "").toLowerCase().includes(fClienteNombre.toLowerCase())) return false;
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
  }, [q, rowsRaw, fClienteId, fClienteNombre, fDesde, fHasta]);

  const sections = useMemo<AnuladaSection[]>(() => {
    const out: AnuladaSection[] = [];
    let lastKey: string | null = null;

    rows.forEach((r) => {
      const ymd = r.fecha ? String(r.fecha).slice(0, 10) : "SIN_FECHA";
      if (ymd !== lastKey) {
        out.push({ title: ymd, data: [] });
        lastKey = ymd;
      }
      out[out.length - 1].data.push(r);
    });

    return out;
  }, [rows]);

  const hasActiveFilters = !!(fClienteId || fDesde || fHasta);

  const renderAnuladaItem = useCallback(
    ({ item }: { item: VentaRow }) => (
      <AnuladaItem
        item={item}
        C={C}
        selected={canSplit && selectedId === item.id}
        onPress={() => {
          if (canSplit) {
            setSelectedId(item.id);
          } else {
            router.push({ pathname: "/venta-detalle", params: { ventaId: String(item.id) } } as any);
          }
        }}
      />
    ),
    [C, canSplit, selectedId]
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Anuladas",
          headerBackTitle: "Atrás",
          gestureEnabled: false,
        }}
      />

      <RoleGate
        allow={["ADMIN", "BODEGA", "FACTURACION", "VENTAS", "MENSAJERO"]}
        deniedText="No tienes permiso para ver anuladas."
        backHref="/(drawer)/(tabs)"
      >
      <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
        {canSplit ? (
          <View style={[styles.splitWrap, { backgroundColor: C.bg }]}>
            <View style={[styles.splitListPane, { borderRightColor: C.border, backgroundColor: C.bg }]}>
              <View style={[styles.content, { backgroundColor: C.bg }]}>
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
                      { borderColor: hasActiveFilters ? FB_DARK_DANGER : C.border, backgroundColor: C.card },
                      pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
                    ]}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={[styles.filterTxt, { color: hasActiveFilters ? FB_DARK_DANGER : C.text }]}>Filtros</Text>
                      {hasActiveFilters ? (
                        <View style={[styles.filterDot, { backgroundColor: FB_DARK_DANGER }]} />
                      ) : null}
                    </View>
                  </Pressable>
                </View>
              </View>
              <SectionList<VentaRow, AnuladaSection>
                sections={sections}
                keyExtractor={(item) => String(item.id)}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                automaticallyAdjustKeyboardInsets
                stickySectionHeadersEnabled={true}
                contentContainerStyle={{ paddingBottom: 24, paddingTop: 6 }}
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                updateCellsBatchingPeriod={50}
                windowSize={7}
                removeClippedSubviews={Platform.OS === "android"}
                renderSectionHeader={({ section }) => (
                  <View style={[styles.sectionHeader, { backgroundColor: C.bg, alignItems: "flex-end" }]}>
                    <Text style={[styles.sectionHeaderText, { color: C.sub, textAlign: "right" }]}>
                      {section.title === "SIN_FECHA" ? "Sin fecha" : fmtDateLongEs(section.title)}
                    </Text>
                  </View>
                )}
                renderItem={renderAnuladaItem}
                ListEmptyComponent={
                  <Text style={{ padding: 16, color: C.sub, fontWeight: "700" }}>
                    {initialLoading ? "Cargando..." : "Sin anuladas"}
                  </Text>
                }
              />
            </View>
            <View style={styles.splitDetailPane}>
              {selectedId ? (
                <VentasAnuladasDetallePanel ventaId={selectedId} embedded />
              ) : (
                <View style={[styles.splitPlaceholder, { borderColor: C.border }]}>
                  <Text style={[styles.splitPlaceholderText, { color: C.sub }]}>
                    Select a sale to view details
                  </Text>
                </View>
              )}
            </View>
          </View>
        ) : (
          <>
            <View style={[styles.content, { backgroundColor: C.bg }]}>
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
                    { borderColor: hasActiveFilters ? FB_DARK_DANGER : C.border, backgroundColor: C.card },
                    pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
                  ]}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={[styles.filterTxt, { color: hasActiveFilters ? FB_DARK_DANGER : C.text }]}>Filtros</Text>
                    {hasActiveFilters ? (
                      <View style={[styles.filterDot, { backgroundColor: FB_DARK_DANGER }]} />
                    ) : null}
                  </View>
                </Pressable>
              </View>
            </View>
            <SectionList<VentaRow, AnuladaSection>
              sections={sections}
              keyExtractor={(item) => String(item.id)}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets
              stickySectionHeadersEnabled={true}
              contentContainerStyle={{ paddingBottom: 24, paddingTop: 6 }}
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              updateCellsBatchingPeriod={50}
              windowSize={7}
              removeClippedSubviews={Platform.OS === "android"}
              renderSectionHeader={({ section }) => (
                <View style={[styles.sectionHeader, { backgroundColor: C.bg, alignItems: "flex-end" }]}>
                  <Text style={[styles.sectionHeaderText, { color: C.sub, textAlign: "right" }]}>
                    {section.title === "SIN_FECHA" ? "Sin fecha" : fmtDateLongEs(section.title)}
                  </Text>
                </View>
              )}
              renderItem={renderAnuladaItem}
              ListEmptyComponent={
                <Text style={{ padding: 16, color: C.sub, fontWeight: "700" }}>
                  {initialLoading ? "Cargando..." : "Sin anuladas"}
                </Text>
              }
            />
          </>
        )}

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

            <View
              pointerEvents="box-none"
              style={
                Platform.OS === "web"
                  ? {
                      position: "absolute",
                      top: 0, left: 0, right: 0, bottom: 0,
                      alignItems: "center",
                      justifyContent: "center",
                    }
                  : {
                      position: "absolute",
                      top: 0, left: 0, right: 0, bottom: 0,
                      justifyContent: "flex-start",
                      paddingTop: 90,
                    }
              }
            >
            <View
              style={[
                styles.modalCard,
                { backgroundColor: C.card, borderColor: C.border },
                Platform.OS === "web"
                  ? { width: "100%", maxWidth: 480, marginHorizontal: 0 }
                  : null,
              ]}
            >
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: C.text }]}>Filtros</Text>
                <Pressable onPress={() => setFiltersOpen(false)} hitSlop={10}><Text style={[styles.modalClose, { color: C.sub }]}>Cerrar</Text></Pressable>
              </View>

            <Text style={[styles.sectionLabel, { color: C.text }]}>Cliente</Text>
            {fClienteId ? (
              <View style={[styles.dropdownInput, { borderColor: C.border, backgroundColor: C.card }]}>
                <Text style={[styles.dropdownText, { color: C.text }]} numberOfLines={1}>{fClienteNombre}</Text>
                <Pressable
                  onPress={() => { setFClienteId(null); setFClienteNombre(""); setClienteSearchQ(""); setClienteSearchResults([]); }}
                  hitSlop={8}
                >
                  <Text style={{ color: C.sub, fontSize: 22, fontWeight: "900", lineHeight: 22 }}>×</Text>
                </Pressable>
              </View>
            ) : (
              <View style={[styles.dropdownPanel, { borderColor: C.border, backgroundColor: C.card, marginTop: 8 }]}>
                <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 }}>
                  <TextInput
                    value={clienteSearchQ}
                    onChangeText={(t) => { setClienteSearchQ(t); void searchClientes(t); }}
                    placeholder="Buscar cliente..."
                    placeholderTextColor={C.sub}
                    style={[styles.clientSearchInput, { color: C.text, borderColor: C.border, backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }]}
                    autoCapitalize="none"
                    returnKeyType="search"
                  />
                </View>
                {clienteSearchQ.trim().length >= 2 ? (
                  <ScrollView style={{ maxHeight: 160 }} keyboardShouldPersistTaps="handled">
                    {clienteSearchLoading ? (
                      <Text style={{ padding: 12, color: C.sub, fontWeight: "600" }}>Buscando...</Text>
                    ) : clienteSearchResults.length === 0 ? (
                      <Text style={{ padding: 12, color: C.sub, fontWeight: "600" }}>Sin resultados</Text>
                    ) : (
                      clienteSearchResults.map((c) => (
                        <Pressable
                          key={String(c.id)}
                          onPress={() => { setFClienteId(c.id); setFClienteNombre(c.nombre); setClienteSearchQ(""); setClienteSearchResults([]); }}
                          style={[styles.ddRow, { borderBottomColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)" }]}
                        >
                          <Text style={{ fontSize: 16, fontWeight: "600", color: C.text }}>{c.nombre}</Text>
                        </Pressable>
                      ))
                    )}
                  </ScrollView>
                ) : clienteSearchQ.trim().length > 0 ? (
                  <Text style={{ padding: 12, color: C.sub, fontWeight: "600" }}>Escribe 2+ letras para buscar...</Text>
                ) : null}
              </View>
            )}

            <View style={{ height: 10 }} />

            <View style={styles.twoCols}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sectionLabel, { color: C.text }]}>Desde</Text>
                {Platform.OS === "web" ? (
                  <input
                    type="date"
                    value={fDesde ? fDesde.toISOString().slice(0, 10) : ""}
                    onChange={(e) => {
                      const val = (e.target as HTMLInputElement).value;
                      setFDesde(val ? new Date(`${val}T12:00:00`) : null);
                    }}
                    style={{
                      marginTop: 8,
                      borderWidth: 1,
                      borderStyle: "solid",
                      borderColor: C.border,
                      borderRadius: 12,
                      padding: 12,
                      fontSize: 16,
                      fontWeight: "700",
                      width: "100%",
                      boxSizing: "border-box",
                      backgroundColor: C.card,
                      color: C.text,
                      fontFamily: "inherit",
                      cursor: "pointer",
                      outline: "none",
                      colorScheme: isDark ? "dark" : "light",
                    } as any}
                  />
                ) : (
                  <Pressable onPress={openDesdePicker} style={[styles.dateBox, { borderColor: C.border, backgroundColor: C.card }]}>
                    <Text style={[styles.dateTxt, { color: C.text }]}>{fDesde ? fmtDateLongEs(fDesde.toISOString()) : "—"}</Text>
                  </Pressable>
                )}
              </View>

              <View style={{ width: 12 }} />

              <View style={{ flex: 1 }}>
                <Text style={[styles.sectionLabel, { color: C.text }]}>Hasta</Text>
                {Platform.OS === "web" ? (
                  <input
                    type="date"
                    value={fHasta ? fHasta.toISOString().slice(0, 10) : ""}
                    onChange={(e) => {
                      const val = (e.target as HTMLInputElement).value;
                      setFHasta(val ? new Date(`${val}T12:00:00`) : null);
                    }}
                    style={{
                      marginTop: 8,
                      borderWidth: 1,
                      borderStyle: "solid",
                      borderColor: C.border,
                      borderRadius: 12,
                      padding: 12,
                      fontSize: 16,
                      fontWeight: "700",
                      width: "100%",
                      boxSizing: "border-box",
                      backgroundColor: C.card,
                      color: C.text,
                      fontFamily: "inherit",
                      cursor: "pointer",
                      outline: "none",
                      colorScheme: isDark ? "dark" : "light",
                    } as any}
                  />
                ) : (
                  <Pressable onPress={openHastaPicker} style={[styles.dateBox, { borderColor: C.border, backgroundColor: C.card }]}>
                    <Text style={[styles.dateTxt, { color: C.text }]}>{fHasta ? fmtDateLongEs(fHasta.toISOString()) : "—"}</Text>
                  </Pressable>
                )}
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
                  setShowDesdeIOS(false);
                  setShowHastaIOS(false);
                }}
                style={[styles.actionBtn, { borderColor: C.border, backgroundColor: C.card }]}
              >
                <Text style={[styles.actionBtnText, { color: C.text }]}>Aplicar</Text>
              </Pressable>
            </View>
            </View>
            </View>
          </Modal>
        ) : null}
      </SafeAreaView>
      </RoleGate>
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
  filterDot: { width: 8, height: 8, borderRadius: 99 },
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
  modalCard: { marginHorizontal: 14, borderRadius: 18, padding: 16, borderWidth: 1 },
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
  title: { fontSize: 13, fontWeight: "700", flex: 1, flexShrink: 1, minWidth: 0 },
  sub: { marginTop: 6, fontSize: 11, fontWeight: "700" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, flexShrink: 0 },
  pillText: { fontSize: 12, fontWeight: "900" },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    zIndex: 10,
    ...(Platform.OS === "android" ? { elevation: 10 } : {}),
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: "900",
    textAlign: "right",
  },
  splitWrap: { flex: 1, flexDirection: "row" },
  splitListPane: { width: 420, maxWidth: 420, borderRightWidth: StyleSheet.hairlineWidth },
  splitDetailPane: { flex: 1 },
  splitPlaceholder: { flex: 1, margin: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, alignItems: "center", justifyContent: "center", padding: 24 },
  splitPlaceholderText: { fontSize: 15, fontWeight: "800", textAlign: "center" },
});
