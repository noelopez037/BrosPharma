import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "../components/ui/app-button";
import { emitSolicitudesChanged } from "../lib/solicitudesEvents";
import { supabase } from "../lib/supabase";
import { useThemePref } from "../lib/themePreference";
import { alphaColor } from "../lib/ui";
import { useGoHomeOnBack } from "../lib/useGoHomeOnBack";
import { goHome } from "../lib/goHome";
import { FB_DARK_DANGER } from "../src/theme/headerColors";

type Role = "ADMIN" | "VENTAS" | "BODEGA" | "FACTURACION" | "";

type SolicitudRow = {
  venta_id: number;
  fecha: string | null;
  estado: string | null;
  cliente_nombre: string | null;
  vendedor_id: string | null;

  solicitud_tag: string | null;
  solicitud_accion: "ANULACION" | "EDICION" | null;
  solicitud_nota: string | null;
  solicitud_at: string | null;
  solicitud_by: string | null;
};

function normalizeUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  // yyyy-mm-dd hh:mm
  const s = String(iso).replace("T", " ");
  return s.slice(0, 16);
}

function actionLabel(a: SolicitudRow["solicitud_accion"]) {
  if (a === "ANULACION") return "Anulacion";
  if (a === "EDICION") return "Edicion";
  return "Solicitud";
}

function isPaymentEditRequest(row: SolicitudRow | null | undefined) {
  if (!row) return false;
  const acc = normalizeUpper(row.solicitud_accion);
  const note = String(row.solicitud_nota ?? "").toUpperCase();
  const tag = String(row.solicitud_tag ?? "").toUpperCase();

  // Prefer explicit tag/note containing PAGO
  if (tag.includes("PAGO") || note.includes("PAGO") || note.startsWith("PAGO:") || note.includes("EDITAR PAGO")) return true;
  // fallback: accion EDICION might be general; prefer note/tag-based detection
  return false;
}

function actionTone(a: SolicitudRow["solicitud_accion"]) {
  if (a === "EDICION") return "amber" as const;
  return "red" as const;
}

export default function VentasSolicitudesScreen() {
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
      danger: FB_DARK_DANGER,
      amber: isDark ? "rgba(255,201,107,0.92)" : "#b25a00",
      pillRedBg: isDark ? "rgba(255,90,90,0.18)" : "rgba(220,0,0,0.10)",
      pillAmberBg: isDark ? "rgba(255,201,107,0.18)" : "rgba(255,170,0,0.12)",
    }),
    [colors.background, colors.border, colors.card, colors.text, isDark]
  );

  const [role, setRole] = useState<Role>("");
  const [q, setQ] = useState("");

  const [rowsRaw, setRowsRaw] = useState<SolicitudRow[]>([]);
  const [vendedoresById, setVendedoresById] = useState<Record<string, { codigo: string | null; nombre: string | null }>>({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [actingVentaId, setActingVentaId] = useState<number | null>(null);

  const canView = role === "ADMIN" || role === "VENTAS";
  const canResolve = role === "ADMIN";

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

  const fetchSolicitudes = useCallback(async () => {
    const { data, error } = await supabase
      .from("vw_ventas_solicitudes_pendientes_admin")
      .select(
        "venta_id,fecha,estado,cliente_nombre,vendedor_id,solicitud_tag,solicitud_accion,solicitud_nota,solicitud_at,solicitud_by"
      )
      .order("solicitud_at", { ascending: false })
      .limit(300);
    if (error) throw error;
    setRowsRaw((data ?? []) as any);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        await loadRole();
        if (!alive) return;
      })().catch(() => {});

      return () => {
        alive = false;
      };
    }, [loadRole])
  );

  useEffect(() => {
    if (!role) return;
    if (!canView) {
      Alert.alert("Sin permiso", "Tu rol no puede ver solicitudes.", [
        { text: "OK", onPress: () => goHome("/(drawer)/(tabs)") },
      ]);
      return;
    }

    let alive = true;
    (async () => {
      try {
        if (alive) setInitialLoading(true);
        await fetchSolicitudes();
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "No se pudieron cargar solicitudes");
        if (alive) setRowsRaw([]);
      } finally {
        if (alive) setInitialLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [role, canView, fetchSolicitudes]);

  const rows = useMemo(() => {
    const search = q.trim().toLowerCase();
    if (!search) return rowsRaw;
    return rowsRaw.filter((r) => {
      const id = String(r.venta_id ?? "");
      const cliente = String(r.cliente_nombre ?? "").toLowerCase();
      const nota = String(r.solicitud_nota ?? "").toLowerCase();
      return id.includes(search) || cliente.includes(search) || nota.includes(search);
    });
  }, [q, rowsRaw]);

  useEffect(() => {
    const ids = Array.from(
      new Set(
        rowsRaw
          .map((r) => String(r.vendedor_id ?? "").trim())
          .filter((x) => x)
      )
    );
    if (!ids.length) {
      setVendedoresById({});
      return;
    }

    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id,codigo,full_name")
          .in("id", ids);
        if (error) throw error;

        const map: Record<string, { codigo: string | null; nombre: string | null }> = {};
        (data ?? []).forEach((p: any) => {
          const id = String(p.id ?? "").trim();
          if (!id) return;
          map[id] = {
            codigo: p.codigo == null ? null : String(p.codigo),
            nombre: p.full_name == null ? null : String(p.full_name),
          };
        });
        if (alive) setVendedoresById(map);
      } catch {
        if (alive) setVendedoresById({});
      }
    })();

    return () => {
      alive = false;
    };
  }, [rowsRaw]);

  const resolve = useCallback(
    async (ventaId: number, decision: "APROBAR" | "RECHAZAR") => {
      if (!canResolve) return;
      setActingVentaId(ventaId);
      try {
        const { error } = await supabase.rpc("rpc_admin_resolver_solicitud", {
          p_venta_id: Number(ventaId),
          p_decision: decision,
        });
        if (error) throw error;
        // If approved and the request is for payment edit, grant edit permission to the vendedor
        if (decision === "APROBAR") {
          try {
            const sol = rowsRaw.find((r) => Number(r.venta_id) === Number(ventaId));
            if (isPaymentEditRequest(sol) && sol?.vendedor_id) {
              const { error: grantErr } = await supabase.rpc("rpc_admin_otorgar_edicion_pago", {
                p_venta_id: Number(ventaId),
                p_otorgado_a: String(sol.vendedor_id),
                p_horas: 48,
              });
              if (grantErr) {
                // non-blocking: warn admin
                Alert.alert("Aviso", `Solicitud aprobada pero no se pudo otorgar permiso: ${grantErr.message || grantErr}`);
              }
            }
          } catch (e: any) {
            // ignore grant errors
            console.warn("grant permiso error", e?.message ?? e);
          }
        }
        await fetchSolicitudes();
        emitSolicitudesChanged();
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "No se pudo resolver la solicitud");
      } finally {
        setActingVentaId(null);
      }
    },
    [canResolve, fetchSolicitudes]
  );

  const confirmResolve = useCallback(
    (ventaId: number, decision: "APROBAR" | "RECHAZAR") => {
      if (!canResolve) return;
      const title = decision === "APROBAR" ? "Aprobar solicitud" : "Rechazar solicitud";
      const msg =
        decision === "APROBAR"
          ? "Esto enviara la accion a la cola correspondiente."
          : "Esto cerrara la solicitud sin ejecutar cambios.";
      Alert.alert(title, msg, [
        { text: "Cancelar", style: "cancel" },
        {
          text: decision === "APROBAR" ? "Aprobar" : "Rechazar",
          style: decision === "RECHAZAR" ? "destructive" : "default",
          onPress: () => {
            resolve(ventaId, decision).catch(() => {});
          },
        },
      ]);
    },
    [canResolve, resolve]
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Solicitudes",
          headerBackTitle: "Atrás",
          gestureEnabled: false,
        }}
      />

      <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]} edges={["bottom"]}>
        <View style={[styles.content, { backgroundColor: C.bg }]}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Buscar (cliente, id, nota)..."
            placeholderTextColor={C.sub}
            style={[styles.search, { borderColor: C.border, backgroundColor: C.card, color: C.text }]}
            autoCapitalize="none"
            autoCorrect={false}
          />

        </View>

        <FlatList
          data={rows}
          keyExtractor={(it) => String(it.venta_id)}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ paddingBottom: 24, paddingTop: 4 }}
          renderItem={({ item }) => {
            const tone = actionTone(item.solicitud_accion);
            const pillBg = tone === "red" ? C.pillRedBg : C.pillAmberBg;
            const pillText = tone === "red" ? C.danger : C.amber;
            const isActing = actingVentaId === Number(item.venta_id);

            return (
              <View style={[styles.cardItem, { borderColor: C.border, backgroundColor: C.card }]}
              >
                <View style={styles.rowTop}>
                  <View style={[styles.pill, { backgroundColor: pillBg, borderColor: C.border }]}>
                    <Text style={[styles.pillText, { color: pillText }]}>{actionLabel(item.solicitud_accion)}</Text>
                  </View>
                  <Text style={[styles.meta, { color: C.sub }]}>{fmtDateTime(item.solicitud_at)}</Text>
                </View>

                <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>
                  {item.cliente_nombre ?? "—"}
                </Text>
                <Text style={[styles.sub, { color: C.sub }]} numberOfLines={1}>
                  Venta #{item.venta_id} • Estado: {item.estado ?? "—"}
                </Text>

                {item.vendedor_id ? (
                  <Text style={[styles.sub, { color: C.sub }]} numberOfLines={1}>
                    Vendedor: {(() => {
                      const v = vendedoresById[String(item.vendedor_id)] ?? null;
                      const code = String(v?.codigo ?? "").trim();
                      const name = String(v?.nombre ?? "").trim();
                      if (code) return code;
                      if (name) return name;
                      return String(item.vendedor_id).slice(0, 8);
                    })()}
                  </Text>
                ) : null}

                {!!item.solicitud_nota ? (
                  <Text style={[styles.note, { color: C.text }]}>{item.solicitud_nota}</Text>
                ) : null}

                {!canResolve ? null : (
                  <View style={styles.btnRow}>
                    <AppButton
                      title={isActing ? "..." : "Aprobar"}
                      size="sm"
                      onPress={() => confirmResolve(Number(item.venta_id), "APROBAR")}
                      disabled={isActing}
                    />
                    <View style={{ width: 10 }} />
                    <AppButton
                      title={isActing ? "..." : "Rechazar"}
                      size="sm"
                      variant="outline"
                      onPress={() => confirmResolve(Number(item.venta_id), "RECHAZAR")}
                      disabled={isActing}
                    />
                  </View>
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <Text style={{ padding: 16, color: C.sub, fontWeight: "700" }}>
              {initialLoading ? "Cargando..." : "Sin solicitudes pendientes"}
            </Text>
          }
        />
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 10 },
  search: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 12, android: 10, default: 10 }),
    fontSize: 16,
  },
  cardItem: { marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderRadius: 16, padding: 14 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  pillText: { fontSize: 12, fontWeight: "800" },
  meta: { fontSize: 12, fontWeight: "700" },
  title: { marginTop: 8, fontSize: 16, fontWeight: "700" },
  sub: { marginTop: 4, fontSize: 13, fontWeight: "600" },
  note: { marginTop: 8, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  btnRow: { marginTop: 10, flexDirection: "row", alignItems: "center" },
});
