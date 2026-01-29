import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack, router } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { HeaderBackButton } from "@react-navigation/elements";
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "../lib/supabase";
import { useThemePref } from "../lib/themePreference";
import { alphaColor } from "../lib/ui";
import { useGoHomeOnBack } from "../lib/useGoHomeOnBack";

type Role = "ADMIN" | "VENTAS" | "BODEGA" | "FACTURADOR" | "";

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
      dangerText: isDark ? "rgba(255,120,120,0.95)" : "#d00",
    }),
    [colors.background, colors.border, colors.card, colors.text, isDark]
  );

  const [role, setRole] = useState<Role>("");
  const [q, setQ] = useState("");
  const [rowsRaw, setRowsRaw] = useState<VentaRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);

  const canView = role === "ADMIN" || role === "BODEGA" || role === "FACTURADOR" || role === "VENTAS";

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
    Alert.alert("Sin permiso", "Tu rol no puede ver anuladas.", [{ text: "OK", onPress: () => router.back() }]);
  }, [canView, role]);

  const rows = useMemo(() => {
    const search = q.trim().toLowerCase();
    if (!search) return rowsRaw;
    return rowsRaw.filter((r) => {
      const id = String(r.id);
      const cliente = String(r.cliente_nombre ?? "").toLowerCase();
      const vcode = String(r.vendedor_codigo ?? "").toLowerCase();
      return id.includes(search) || cliente.includes(search) || vcode.includes(search);
    });
  }, [q, rowsRaw]);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Anuladas",
          headerBackTitle: "Atras",
          gestureEnabled: false,
          headerBackVisible: false,
          headerBackButtonMenuEnabled: false,
          headerLeft: () => <HeaderBackButton onPress={() => router.replace("/(drawer)/(tabs)" as any)} />,
        }}
      />

      <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
        <View style={[styles.content, { backgroundColor: C.bg }]}
        >
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Buscar (cliente, id, vendedor)..."
            placeholderTextColor={C.sub}
            style={[styles.search, { borderColor: C.border, backgroundColor: C.card, color: C.text }]}
            autoCapitalize="none"
            autoCorrect={false}
          />
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
  card: { marginHorizontal: 16, marginTop: 10, borderWidth: 1, borderRadius: 16, padding: 14 },
  title: { fontSize: 16, fontWeight: "900" },
  sub: { marginTop: 6, fontSize: 13, fontWeight: "700" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  pillText: { fontSize: 12, fontWeight: "900" },
});
