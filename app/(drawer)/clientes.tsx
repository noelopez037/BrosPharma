import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack, router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useGoHomeOnBack } from "../../lib/useGoHomeOnBack";
import { useRole } from "../../lib/useRole";

type Role = "ADMIN" | "BODEGA" | "VENTAS" | "FACTURACION" | "";

type ClienteRow = {
  id: number;
  nombre: string;
  nit: string | null;
  telefono: string | null;
  direccion: string | null;
  activo: boolean;
  vendedor_id: string | null;
  vendedor?: {
    id: string;
    full_name: string | null;
    role: string;
  } | null;
};

function normalizeUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function displayNit(nit: string | null | undefined) {
  const t = String(nit ?? "").trim();
  return t ? t : "CF";
}

function makeSafeIlikePattern(input: string) {
  return String(input ?? "")
    .replace(/[%_]/g, "\\$&")
    .replace(/[(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function logClientesError(tag: string, error: any) {
  if (!error) return;
  console.warn(
    `[clientes] ${tag}:`,
    error.message ?? "",
    error.details ?? "",
    error.hint ?? "",
    error.code ?? ""
  );
}

export default function ClientesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomRail = insets.bottom;

  const s = useMemo(() => styles(colors), [colors]);

  const { role, uid, isReady, refreshRole } = useRole();
  const roleUp = normalizeUpper(role) as Role;
  const isAdmin = roleUp === "ADMIN";
  const isVentas = roleUp === "VENTAS";
  const isBodega = roleUp === "BODEGA";
  const readOnly = isBodega;
  const canCreate = isAdmin;

  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q.trim(), 250);

  const [showInactive, setShowInactive] = useState(false);

  const [rows, setRows] = useState<ClienteRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const hasLoadedOnceRef = useRef(false);
  const hasAnyRowsRef = useRef(false);
  useEffect(() => {
    hasAnyRowsRef.current = rows.length > 0;
  }, [rows.length]);

  useEffect(() => {
    if (!isAdmin && showInactive) setShowInactive(false);
  }, [isAdmin, showInactive]);

  const fetchClientes = useCallback(async (roleOverride?: Role) => {
    if (!isReady) return;
    setErrorMsg(null);
    const effectiveRoleUp = (roleOverride ?? roleUp) as Role;
    if (!effectiveRoleUp) return;

    const isAdminNow = effectiveRoleUp === "ADMIN";
    const isVentasNow = effectiveRoleUp === "VENTAS";

    const safeSearch = dq ? makeSafeIlikePattern(dq) : "";

    const buildQuery = (includeSearch: boolean) => {
      let req = supabase
        .from("clientes")
        .select(
          "id,nombre,nit,telefono,direccion,activo,vendedor_id,vendedor:profiles!clientes_vendedor_id_fkey(id,full_name,role)"
        )
        .order("nombre", { ascending: true })
        .limit(500);

      if (!isAdminNow || !showInactive) req = req.eq("activo", true);

      if (isVentasNow) {
        if (!uid) {
          setRows([]);
          return null;
        }
        req = req.eq("vendedor_id", uid);
      }

      if (includeSearch && safeSearch) {
        req = req.or(
          `nombre.ilike.%${safeSearch}%,nit.ilike.%${safeSearch}%,telefono.ilike.%${safeSearch}%`
        );
      }

      return req;
    };

    const execute = async (includeSearch: boolean) => {
      const query = buildQuery(includeSearch);
      if (!query) return null;
      return query;
    };

    const initialResult = await execute(Boolean(safeSearch));
    if (!initialResult) return;

    let { data, error } = initialResult;
    let searchError: any = null;

    if (error && safeSearch) {
      searchError = error;
      logClientesError("search error", error);
      const fallbackResult = await execute(false);
      if (!fallbackResult) return;
      data = fallbackResult.data;
      error = fallbackResult.error;
      if (!error) {
        setErrorMsg(
          `Error al filtrar: ${searchError?.message ?? "desconocido"}. Mostrando todos los clientes.`
        );
      }
    }

    if (error) {
      logClientesError("fetch error", error);
      setErrorMsg(error.message ?? "Error al cargar clientes.");
      setRows([]);
      return;
    }

    setRows((data ?? []) as any);
  }, [dq, isReady, roleUp, showInactive, uid]);

  // UX: swipe-back / back siempre regresa a Inicio.
  useGoHomeOnBack(true, "/(drawer)/(tabs)");

  useFocusEffect(
    useCallback(() => {
      if (!isReady) return;
      let alive = true;
      (async () => {
        const showLoading = !hasLoadedOnceRef.current && !hasAnyRowsRef.current;
        try {
          if (showLoading && alive) setInitialLoading(true);
          const freshRoleUp = normalizeUpper(await refreshRole("focus:clientes")) as Role;
          await fetchClientes(freshRoleUp);
          hasLoadedOnceRef.current = true;
        } finally {
          if (showLoading && alive) setInitialLoading(false);
        }
      })();

      return () => {
        alive = false;
      };
    }, [fetchClientes, isReady, refreshRole])
  );

  const renderItem = ({ item }: { item: ClienteRow }) => {
    const vendedorNombre = (item.vendedor?.full_name ?? "").trim();
    const vendedorChipLabel = vendedorNombre || (item.vendedor_id ? item.vendedor_id : "Sin asignar");

    return (
      <Pressable
        style={({ pressed }) => [s.card, pressed && Platform.OS === "ios" ? { opacity: 0.85 } : null]}
        onPress={() =>
          router.push({
            pathname: "/cliente-detalle" as any,
            params: { id: String(item.id), readOnly: readOnly ? "1" : "0" },
          })
        }
      >
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>
              {item.nombre}
            </Text>

            <Text style={s.sub} numberOfLines={1}>
              NIT: {displayNit(item.nit)}
            </Text>

            <Text style={s.sub} numberOfLines={1}>
              Tel: {item.telefono ?? "—"}
            </Text>

            <Text style={s.sub} numberOfLines={1}>
              Dir: {item.direccion ?? "—"}
            </Text>
          </View>

          <View style={s.rightCol}>
            <View style={s.vendedorPill}>
              <Text style={s.vendedorPillText} numberOfLines={1}>
                {vendedorChipLabel}
              </Text>
            </View>
            {!item.activo ? <Text style={s.badgeOff}>INACTIVO</Text> : null}
          </View>
        </View>
      </Pressable>
    );
  };

  const fabBg = String(colors.primary ?? "#153c9e");

  return (
    <>
      <Stack.Screen
        options={{
          title: "Clientes",
        }}
      />

      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["bottom"]}>
        <FlatList
          style={{ backgroundColor: colors.background }}
          data={rows}
          keyExtractor={(it) => String(it.id)}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingTop: 12,
            paddingBottom: 16 + bottomRail,
          }}
          ListHeaderComponent={
            <>
              <View style={s.searchWrap}>
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder="Buscar por nombre, NIT o teléfono..."
                  placeholderTextColor={colors.text + "66"}
                  style={s.searchInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {q.trim().length > 0 ? (
                  <Pressable
                    onPress={() => setQ("")}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Borrar búsqueda"
                    style={s.clearBtn}
                  >
                    <Text style={s.clearTxt}>×</Text>
                  </Pressable>
                ) : null}
              </View>

               {isAdmin ? (
                 <View style={s.inactiveRow}>
                   <Text style={s.inactiveLabel}>Mostrar inactivos</Text>
                   <Switch
                     value={showInactive}
                    onValueChange={setShowInactive}
                    trackColor={{ false: colors.border, true: "#34C759" }}
                    thumbColor={Platform.OS === "android" ? "#FFFFFF" : undefined}
                    style={Platform.OS === "android" ? { transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] } : undefined}
                  />
                </View>
              ) : null}

              {errorMsg ? (
                <View style={{ paddingVertical: 8 }}>
                  <Text style={[s.empty, { color: colors.notification ?? "#ff3b30" }]}>
                    {errorMsg}
                  </Text>
                </View>
              ) : null}

              {initialLoading ? (
                <View style={{ paddingVertical: 10 }}>
                  <Text style={[s.empty, { paddingTop: 0 }]}>Cargando...</Text>
                </View>
              ) : null}

              {!initialLoading && rows.length === 0 ? (
                <View style={{ paddingVertical: 8 }}>
                  <Text style={s.empty}>Sin clientes</Text>
                </View>
              ) : null}
            </>
          }
        />

        {canCreate ? (
          <Pressable
            style={[s.fab, { backgroundColor: fabBg, bottom: 18 + bottomRail }]}
            onPress={() => router.push("/cliente-form" as any)}
            accessibilityRole="button"
            accessibilityLabel="Nuevo cliente"
          >
            <Text style={s.fabText}>＋</Text>
          </Pressable>
        ) : null}
      </SafeAreaView>
    </>
  );
}

const styles = (colors: any) =>
  StyleSheet.create({
    searchWrap: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 12,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 10,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      paddingVertical: 10,
      fontSize: 16,
    },
    clearBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    clearTxt: {
      color: colors.text + "88",
      fontSize: 22,
      fontWeight: "900",
      lineHeight: 22,
      marginTop: -1,
    },

    inactiveRow: {
      marginBottom: 10,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === "android" ? 8 : 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    inactiveLabel: {
      color: colors.text,
      fontWeight: "700",
      fontSize: Platform.OS === "android" ? 15 : 16,
    },

    empty: { color: colors.text + "AA", fontWeight: "700" },

    card: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: 12,
      borderRadius: 14,
      marginBottom: 10,
    },
    row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
    title: { color: colors.text, fontSize: 16, fontWeight: "800" },
    sub: { color: colors.text + "AA", marginTop: 6, fontSize: 12 },
    rightCol: { alignItems: "flex-end", gap: 8, maxWidth: 160 },
    vendedorPill: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      overflow: "hidden",
    },
    vendedorPillText: { color: colors.text, fontSize: 12, fontWeight: "800" },
    badgeOff: {
      color: colors.text + "AA",
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      fontSize: 12,
      fontWeight: "900",
      overflow: "hidden",
    },

    fab: {
      position: "absolute",
      right: 18,
      bottom: 18,
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000",
      shadowOpacity: 0.25,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 6,
    },
    fabText: { color: "#fff", fontSize: 30, fontWeight: "900", marginTop: -2 },
  });
