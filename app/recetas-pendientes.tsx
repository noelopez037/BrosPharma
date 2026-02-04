import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useFocusEffect, useTheme } from "@react-navigation/native";
import { HeaderBackButton } from "@react-navigation/elements";
import { Stack, router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { useThemePref } from "../lib/themePreference";
import { AppButton } from "../components/ui/app-button";
import { useGoHomeOnBack } from "../lib/useGoHomeOnBack";
import { goHome } from "../lib/goHome";

type VentaRow = {
  id: number;
  fecha: string | null;
  cliente_nombre: string | null;
  vendedor_id: string | null;
  vendedor_codigo: string | null;
  requiere_receta: boolean;
  receta_cargada: boolean;
};

function shortUid(u: string | null | undefined) {
  const s = String(u ?? "").trim();
  if (!s) return "—";
  return s.slice(0, 8);
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return String(iso).slice(0, 10);
}

function normalizeUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function monthsBetween(start: Date, end: Date) {
  const out: { year: number; month: number }[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur <= last) {
    out.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
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

export default function RecetasPendientesScreen() {
  const { colors } = useTheme();
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  // UX: back / swipe-back siempre regresa a Inicio.
  useGoHomeOnBack(true, "/(drawer)/(tabs)");

  const C = useMemo(
    () => ({
      bg: colors.background ?? (isDark ? "#000" : "#fff"),
      card: colors.card ?? (isDark ? "#121214" : "#fff"),
      text: colors.text ?? (isDark ? "#fff" : "#111"),
      sub: colors.text ? colors.text + "66" : isDark ? "rgba(255,255,255,0.65)" : "#666",
      border: colors.border ?? (isDark ? "rgba(255,255,255,0.14)" : "#e5e5e5"),
      tint: String(colors.primary ?? "#153c9e"),
      chipBg: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
      chipAmberBg: isDark ? "rgba(255,201,107,0.18)" : "rgba(255,170,0,0.12)",
      chipAmberText: isDark ? "rgba(255,201,107,0.92)" : "#b25a00",
    }),
    [colors, isDark]
  );

  const [desde, setDesde] = useState<Date | null>(startOfMonth(new Date()));
  const [hasta, setHasta] = useState<Date | null>(endOfMonth(new Date()));

  const [showDesdeIOS, setShowDesdeIOS] = useState(false);
  const [showHastaIOS, setShowHastaIOS] = useState(false);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tmpDesde, setTmpDesde] = useState<Date | null>(desde);
  const [tmpHasta, setTmpHasta] = useState<Date | null>(hasta);
  const [tmpVendedorId, setTmpVendedorId] = useState<string | null>(null);

  const [role, setRole] = useState<string>("");
  const [uid, setUid] = useState<string | null>(null);
  const [selfVendedorLabel, setSelfVendedorLabel] = useState<string>("");

  const [rows, setRows] = useState<VentaRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Admin: vendedores
  type VendedorRow = { vendedor_id: string; vendedor_codigo: string };
  const [vendedores, setVendedores] = useState<VendedorRow[]>([]);
  const [vendedorOpen, setVendedorOpen] = useState(false);
  const [selectedVendedorId, setSelectedVendedorId] = useState<string | null>(null);

  const vendedoresMap = useMemo(() => {
    const m = new Map<string, string>();
    (vendedores ?? []).forEach((v) => {
      const id = String(v?.vendedor_id ?? "").trim();
      const label = String(v?.vendedor_codigo ?? "").trim();
      if (id && label) m.set(id, label);
    });
    return m;
  }, [vendedores]);

  // load role + uid
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const user = auth.user;
        if (!user) return;
        if (mounted) setUid(user.id);
        const { data } = await supabase.from("profiles").select("role,full_name,codigo").eq("id", user.id).maybeSingle();
        const r = normalizeUpper(data?.role);
        const label = String(data?.codigo ?? "").trim() || String(data?.full_name ?? "").trim() || String(user.id).slice(0, 8);
        if (mounted) {
          setRole(r);
          setSelfVendedorLabel(label);
        }
      } catch {
        if (mounted) setRole("");
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // load vendedores for admin
  useEffect(() => {
    if (!role) return;
    if (normalizeUpper(role) !== "ADMIN") {
      setVendedores([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        let out: VendedorRow[] = [];
        try {
          const { data: p, error: pe } = await supabase
            .from("profiles")
            .select("id,codigo,full_name,role")
            .not("role", "is", null)
            .order("codigo", { ascending: true });
          if (!pe && p) {
            out = (p ?? [])
              .filter((x: any) => {
                const r = normalizeUpper(x?.role);
                return r === "ADMIN" || r === "VENTAS";
              })
              .map((x: any) => {
                const id = String(x.id ?? "").trim();
                const codigo = String(x.codigo ?? "").trim();
                const nombre = String(x.full_name ?? "").trim();
                const label = codigo || nombre || id.slice(0, 8);
                return id ? { vendedor_id: id, vendedor_codigo: label } : null;
              })
              .filter(Boolean) as any;
          }
        } catch {}

        if (out.length === 0) {
          try {
            const { data: vdata } = await supabase.from("vw_cxc_ventas").select("vendedor_id,vendedor_codigo");
            const map = new Map<string, string>();
            (vdata ?? []).forEach((r: any) => {
              const id = String(r.vendedor_id ?? "").trim();
              if (!id) return;
              const label = String(r.vendedor_codigo ?? "").trim() || id.slice(0, 8);
              if (!map.has(id)) map.set(id, label);
            });
            out = Array.from(map.entries()).map(([vendedor_id, vendedor_codigo]) => ({ vendedor_id, vendedor_codigo }));
          } catch {}
        }

        out.sort((a, b) => String(a.vendedor_codigo).localeCompare(String(b.vendedor_codigo)));
        if (alive) setVendedores(out);
      } catch {
        if (alive) setVendedores([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [role]);

  const fetchRange = useCallback(
    async (d: Date | null, h: Date | null, vendedorIdOverride?: string | null) => {
      if (!d || !h) return [] as VentaRow[];
      setErrorMsg(null);
      const months = monthsBetween(d, h);
      // safety limit
      if (months.length > 18) throw new Error("Rango demasiado grande. Reduce a 18 meses.");

      const calls = months.map(({ year, month }) =>
        supabase.rpc("rpc_ventas_receta_pendiente_por_mes", { p_year: year, p_month: month })
      );

      const results = await Promise.allSettled(calls);
      const rowsAll: any[] = [];
      let anyError = false;
      for (const r of results) {
        if (r.status === "fulfilled") {
          const val: any = r.value;
          if (val?.data && Array.isArray(val.data)) rowsAll.push(...val.data);
        } else {
          anyError = true;
        }
      }
      if (anyError) setErrorMsg("Algunas consultas fallaron. Reintenta.");

      // dedupe by id
      const map = new Map<number, any>();
      for (const row of rowsAll) {
        const id = Number(row?.id);
        if (!Number.isFinite(id) || id <= 0) continue;
        if (!map.has(id)) map.set(id, row);
      }
      let out = Array.from(map.values()) as VentaRow[];

      // Filter exact date range (inclusive) client-side
      const d0 = startOfDay(d).getTime();
      const h1 = endOfDay(h).getTime();
      out = out.filter((r: any) => {
        const f = String(r?.fecha ?? "").trim();
        if (!f) return false;
        const ms = new Date(f).getTime();
        if (!Number.isFinite(ms)) return false;
        return ms >= d0 && ms <= h1;
      });

      // order by fecha desc, id desc
      out.sort((a: any, b: any) => {
        const fa = a?.fecha ? new Date(a.fecha).getTime() : 0;
        const fb = b?.fecha ? new Date(b.fecha).getTime() : 0;
        if (fb !== fa) return fb - fa;
        return Number(b.id ?? 0) - Number(a.id ?? 0);
      });

      // role-based filters
      const roleUp = normalizeUpper(role);
      if (roleUp === "VENTAS" && uid) {
        out = out.filter((r) => String(r.vendedor_id ?? "") === uid);
      }
      if (roleUp === "ADMIN") {
        const vid = vendedorIdOverride !== undefined ? vendedorIdOverride : selectedVendedorId;
        if (vid) out = out.filter((r) => String(r.vendedor_id ?? "") === vid);
      }

      return out;
    },
    [role, uid, selectedVendedorId]
  );

  const openFilters = useCallback(() => {
    setVendedorOpen(false);
    setShowDesdeIOS(false);
    setShowHastaIOS(false);
    setTmpDesde(desde);
    setTmpHasta(hasta);
    setTmpVendedorId(selectedVendedorId);
    setFiltersOpen(true);
  }, [desde, hasta, selectedVendedorId]);

  const openDesdePicker = useCallback(() => {
    setVendedorOpen(false);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: tmpDesde ?? new Date(),
        mode: "date",
        onChange: (_ev, date) => {
          if (date) setTmpDesde(new Date(date));
        },
      });
    } else {
      setShowDesdeIOS(true);
      setShowHastaIOS(false);
    }
  }, [tmpDesde]);

  const openHastaPicker = useCallback(() => {
    setVendedorOpen(false);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: tmpHasta ?? new Date(),
        mode: "date",
        onChange: (_ev, date) => {
          if (date) setTmpHasta(new Date(date));
        },
      });
    } else {
      setShowHastaIOS(true);
      setShowDesdeIOS(false);
    }
  }, [tmpHasta]);

  const limpiarFiltros = useCallback(() => {
    const now = new Date();
    setTmpDesde(startOfMonth(now));
    setTmpHasta(endOfMonth(now));
    setTmpVendedorId(null);
    setShowDesdeIOS(false);
    setShowHastaIOS(false);
    setVendedorOpen(false);
  }, []);

  const aplicarFiltros = useCallback(() => {
    if (!tmpDesde || !tmpHasta) return;
    if (tmpDesde.getTime() > tmpHasta.getTime()) return;

    setDesde(tmpDesde);
    setHasta(tmpHasta);
    if (normalizeUpper(role) === "ADMIN") {
      setSelectedVendedorId(tmpVendedorId);
    } else {
      setSelectedVendedorId(null);
    }

    setFiltersOpen(false);
    setShowDesdeIOS(false);
    setShowHastaIOS(false);
    setVendedorOpen(false);
    // fetch immediately with the chosen values
    setListLoading(true);
    (async () => {
      try {
        const data = await fetchRange(tmpDesde, tmpHasta, normalizeUpper(role) === "ADMIN" ? tmpVendedorId : null);
        setRows(data);
      } catch (e: any) {
        setErrorMsg(e?.message ?? "Error");
        setRows([]);
      } finally {
        setListLoading(false);
      }
    })();
  }, [fetchRange, role, tmpDesde, tmpHasta, tmpVendedorId]);

  const loadAll = useCallback(async () => {
    if (!desde || !hasta) return;
    setListLoading(true);
    try {
      const data = await fetchRange(desde, hasta);
      setRows(data);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Error");
      setRows([]);
    } finally {
      setListLoading(false);
    }
  }, [desde, hasta, fetchRange]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (alive) setInitialLoading(true);
        try {
          await loadAll();
        } finally {
          if (alive) setInitialLoading(false);
        }
      })();
      return () => {
        alive = false;
      };
    }, [loadAll])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await fetchRange(desde, hasta);
      setRows(data);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Error");
    } finally {
      setRefreshing(false);
    }
  }, [desde, hasta, fetchRange]);

  // navigation to detail
  const openDetail = useCallback((id: number) => {
    router.push({ pathname: "/venta-detalle", params: { ventaId: String(id), returnTo: "/recetas-pendientes" } } as any);
  }, []);

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Recetas pendientes",
          headerBackTitle: "Atrás",
          gestureEnabled: false,
          headerBackVisible: false,
          headerBackButtonMenuEnabled: false,
          headerLeft: (props: any) => <HeaderBackButton {...props} label="Atrás" onPress={() => goHome("/(drawer)/(tabs)")} />,
        }}
      />

      <View style={[s.header, { backgroundColor: C.bg, borderBottomColor: C.border }]}>
        <View style={s.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={[s.rangeLabel, { color: C.sub }]} numberOfLines={1}>
              {desde ? fmtDate(desde.toISOString()) : "—"} → {hasta ? fmtDate(hasta.toISOString()) : "—"}
            </Text>
            {errorMsg ? (
              <Text style={[s.errorText, { color: C.sub }]} numberOfLines={2}>
                {errorMsg}
              </Text>
            ) : null}
          </View>

          {normalizeUpper(role) === "ADMIN" ? (
            <Pressable
              onPress={openFilters}
              style={({ pressed }) => [
                s.filterBtn,
                { borderColor: C.border, backgroundColor: C.card },
                pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null,
              ]}
            >
              <Text style={[s.filterTxt, { color: C.text }]}>Filtros</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {filtersOpen ? (
        <Modal visible={filtersOpen} transparent animationType="fade" onRequestClose={() => setFiltersOpen(false)}>
          <Pressable
            style={[s.modalBackdrop, { backgroundColor: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)" }]}
            onPress={() => {
              setFiltersOpen(false);
              setShowDesdeIOS(false);
              setShowHastaIOS(false);
              setVendedorOpen(false);
            }}
          />

          <View style={[s.modalCard, { backgroundColor: C.card, borderColor: C.border }] }>
            <View style={s.modalHeader}>
              <Text style={[s.modalTitle, { color: C.text }]}>Filtros</Text>
              <Pressable onPress={() => setFiltersOpen(false)} hitSlop={10}>
                <Text style={[s.modalClose, { color: C.sub }]}>Cerrar</Text>
              </Pressable>
            </View>

          <View style={s.twoCols}>
            <View style={{ flex: 1 }}>
              <Text style={[s.sectionLabel, { color: C.text }]}>Desde</Text>
              <Pressable onPress={openDesdePicker} style={[s.dateBox, { borderColor: C.border, backgroundColor: C.bg }] }>
                <Text style={[s.dateTxt, { color: C.text }]}>{tmpDesde ? fmtDate(tmpDesde.toISOString()) : "—"}</Text>
              </Pressable>
            </View>

            <View style={{ width: 12 }} />

            <View style={{ flex: 1 }}>
              <Text style={[s.sectionLabel, { color: C.text }]}>Hasta</Text>
              <Pressable onPress={openHastaPicker} style={[s.dateBox, { borderColor: C.border, backgroundColor: C.bg }] }>
                <Text style={[s.dateTxt, { color: C.text }]}>{tmpHasta ? fmtDate(tmpHasta.toISOString()) : "—"}</Text>
              </Pressable>
            </View>
          </View>

          {Platform.OS === "ios" && showDesdeIOS ? (
            <View style={[s.iosPickerWrap, { borderColor: C.border, backgroundColor: C.bg }] }>
              <DateTimePicker
                value={tmpDesde ?? new Date()}
                mode="date"
                display="inline"
                themeVariant={isDark ? "dark" : "light"}
                onChange={(_ev, date) => {
                  if (date) setTmpDesde(new Date(date));
                  setShowDesdeIOS(false);
                }}
              />
            </View>
          ) : null}

          {Platform.OS === "ios" && showHastaIOS ? (
            <View style={[s.iosPickerWrap, { borderColor: C.border, backgroundColor: C.bg }] }>
              <DateTimePicker
                value={tmpHasta ?? new Date()}
                mode="date"
                display="inline"
                themeVariant={isDark ? "dark" : "light"}
                onChange={(_ev, date) => {
                  if (date) setTmpHasta(new Date(date));
                  setShowHastaIOS(false);
                }}
              />
            </View>
          ) : null}

          {normalizeUpper(role) === "ADMIN" ? (
            <>
              <Text style={[s.sectionLabel, { color: C.text }]}>Vendedor</Text>
              <Pressable
                onPress={() => {
                  setVendedorOpen((v) => !v);
                  setShowDesdeIOS(false);
                  setShowHastaIOS(false);
                }}
                style={[s.dropdownInput, { borderColor: C.border, backgroundColor: C.bg }]}
              >
                <Text style={[s.dropdownText, { color: C.text }]} numberOfLines={1}>
                  {tmpVendedorId
                    ? (vendedores.find((v) => v.vendedor_id === tmpVendedorId)?.vendedor_codigo ?? "Vendedor")
                    : "Todos"}
                </Text>
                <Text style={[s.dropdownCaret, { color: C.sub }]}>{vendedorOpen ? "▲" : "▼"}</Text>
              </Pressable>

              {vendedorOpen ? (
                <View style={[s.dropdownPanel, { borderColor: C.border, backgroundColor: C.bg }] }>
                  <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled">
                    <Pressable
                      onPress={() => {
                        setTmpVendedorId(null);
                        setVendedorOpen(false);
                      }}
                      style={s.ddRow}
                    >
                      <Text style={[s.ddTxt, { color: C.text }]}>Todos</Text>
                    </Pressable>
                    {(vendedores ?? []).map((v) => (
                      <Pressable
                        key={v.vendedor_id}
                        onPress={() => {
                          setTmpVendedorId(v.vendedor_id);
                          setVendedorOpen(false);
                        }}
                        style={s.ddRow}
                      >
                        <Text style={[s.ddTxt, { color: C.text }]}>{v.vendedor_codigo}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </>
          ) : null}

          <View style={s.modalActions}>
            <AppButton title="Limpiar" variant="ghost" size="sm" onPress={limpiarFiltros} />
            <AppButton title="Aplicar" size="sm" onPress={aplicarFiltros} />
          </View>
          </View>
        </Modal>
      ) : null}

      <FlatList
        data={rows}
        extraData={vendedores}
        keyExtractor={(it) => String(it.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        refreshing={refreshing}
        onRefresh={onRefresh}
        renderItem={({ item }) => {
          const showChip = item.requiere_receta && !item.receta_cargada;
          const vendedorLabel =
            String(item.vendedor_codigo ?? "").trim() ||
            (uid && String(item.vendedor_id ?? "") === uid ? String(selfVendedorLabel || "").trim() : null) ||
            (item.vendedor_id ? vendedoresMap.get(String(item.vendedor_id)) : null) ||
            shortUid(item.vendedor_id);
          return (
            <Pressable onPress={() => openDetail(Number(item.id))} style={({ pressed }) => [s.card, { borderColor: C.border, backgroundColor: C.card }, pressed ? { opacity: 0.85 } : null]}>
              <Text style={[s.cardTitle, { color: C.text }]} numberOfLines={2}>{item.cliente_nombre ?? "—"}</Text>
              <Text style={[s.cardSub, { color: C.sub }]}>Fecha: {fmtDate(item.fecha)}</Text>
              <Text style={[s.cardSub, { color: C.sub }]}>Vendedor: {vendedorLabel}</Text>
              {showChip ? (
                <View style={s.chipsRow}><View style={[s.chip, { backgroundColor: C.chipAmberBg, borderColor: C.border }]}><Text style={[s.chipText, { color: C.chipAmberText }]}>Falta receta</Text></View></View>
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={{ padding: 16, color: C.sub, fontWeight: "700" }}>{initialLoading || listLoading ? "Cargando..." : "Sin ventas"}</Text>
        }
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  rangeLabel: { fontSize: 13, fontWeight: "800" },
  errorText: { marginTop: 4, fontSize: 12, fontWeight: "700" },
  filterBtn: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  filterTxt: { fontWeight: "800" },

  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  modalCard: { position: "absolute", left: 14, right: 14, top: 90, borderRadius: 18, padding: 16, borderWidth: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontSize: 22, fontWeight: "800" },
  modalClose: { fontSize: 15, fontWeight: "700" },
  sectionLabel: { marginTop: 12, fontSize: 15, fontWeight: "800" },
  twoCols: { flexDirection: "row", marginTop: 8 },
  dateBox: { marginTop: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
  dateTxt: { fontSize: 16, fontWeight: "700" },
  iosPickerWrap: { marginTop: 10, borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  dropdownInput: { marginTop: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dropdownText: { fontSize: 16, fontWeight: "600", flex: 1, paddingRight: 10 },
  dropdownCaret: { fontSize: 14, fontWeight: "900" },
  dropdownPanel: { marginTop: 10, borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },
  ddRow: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  ddTxt: { fontSize: 16, fontWeight: "600" },

  card: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: "900" },
  cardSub: { marginTop: 6, fontSize: 13, fontWeight: "700" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: "900" },
});
