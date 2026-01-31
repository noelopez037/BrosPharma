import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { HeaderBackButton } from "@react-navigation/elements";
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { AppButton } from "../components/ui/app-button";

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

function displayNit(nit: string | null | undefined) {
  const t = String(nit ?? "").trim();
  return t ? t : "CF";
}

export default function ClienteDetalle() {
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);

  const navigatingRef = useRef(false);
  const goBackSafe = useCallback(() => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    setTimeout(() => {
      navigatingRef.current = false;
    }, 800);
    try {
      const can = typeof (router as any)?.canGoBack === "function" ? (router as any).canGoBack() : false;
      if (can) router.back();
      else router.replace("/(drawer)/clientes" as any);
    } catch {
      router.replace("/(drawer)/clientes" as any);
    }
  }, []);

  const { id } = useLocalSearchParams<{ id: string }>();
  const clienteId = Number(id);

  const [role, setRole] = useState<Role>("");
  const canEdit = role === "ADMIN" || role === "VENTAS";
  const canDelete = role === "ADMIN";

  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<ClienteRow | null>(null);

  const loadRole = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) {
      setRole("");
      return;
    }

    const { data } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
    setRole(normalizeUpper(data?.role) as Role);
  }, []);

  const loadCliente = useCallback(async () => {
    if (!Number.isFinite(clienteId) || clienteId <= 0) {
      setRow(null);
      return;
    }

    const { data, error } = await supabase
      .from("clientes")
      .select(
        "id,nombre,nit,telefono,direccion,activo,vendedor_id,vendedor:profiles!clientes_vendedor_id_fkey(id,full_name,role)"
      )
      .eq("id", clienteId)
      .maybeSingle();

    if (error) throw error;
    setRow((data ?? null) as any);
  }, [clienteId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadRole(), loadCliente()]);
    } finally {
      setLoading(false);
    }
  }, [loadCliente, loadRole]);

  useFocusEffect(
    useCallback(() => {
      loadAll().catch(() => {
        setLoading(false);
        setRow(null);
      });
    }, [loadAll])
  );

  const onDelete = useCallback(() => {
    if (!canDelete || !row) return;

    Alert.alert(
      "Eliminar cliente",
      `Se eliminará definitivamente "${row.nombre}". ¿Continuar?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
               const { error } = await supabase.from("clientes").delete().eq("id", row.id);
               if (error) throw error;
               Alert.alert("Listo", "Cliente eliminado");
               goBackSafe();
             } catch (e: any) {
               Alert.alert("Error", e?.message ?? "No se pudo eliminar");
             }
           },
         },
       ]
     );
  }, [canDelete, row, goBackSafe]);

  const vendedorNombre = (row?.vendedor?.full_name ?? "").trim();
  const vendedorRole = normalizeUpper(row?.vendedor?.role);
  const vendedorLabel = vendedorNombre || (row?.vendedor_id ? row?.vendedor_id : "Sin asignar");

  return (
    <>
      <Stack.Screen
        options={{
          title: "Cliente",
          headerShown: true,
          headerBackTitle: "Atrás",
          headerBackVisible: false,
          headerBackButtonMenuEnabled: false,
          headerLeft: () => <HeaderBackButton onPress={goBackSafe} />,
        }}
      />

      <SafeAreaView style={[s.safe, { backgroundColor: colors.background }]} edges={["bottom"]}>
        {loading ? (
          <View style={s.center}>
            <Text style={[s.text, { opacity: 0.7 }]}>Cargando...</Text>
          </View>
        ) : !row ? (
          <View style={s.center}>
            <Text style={s.text}>Cliente no encontrado</Text>
          </View>
        ) : (
          <View style={s.container}>
            <View style={s.card}>
              <View style={s.headerRow}>
                <Text style={s.title}>{row.nombre}</Text>
                {!row.activo ? <Text style={s.badgeOff}>INACTIVO</Text> : null}
              </View>

              <KV k="NIT" v={displayNit(row.nit)} s={s} />
              <KV k="Teléfono" v={row.telefono ?? "—"} s={s} />
              <KV k="Dirección" v={row.direccion ?? "—"} s={s} />
              <KV k="Vendedor" v={`${vendedorLabel}${vendedorRole ? ` • ${vendedorRole}` : ""}`} s={s} />
            </View>

            {canEdit ? (
              <AppButton
                title="Editar"
                onPress={() =>
                  router.push({
                    pathname: "/cliente-form" as any,
                    params: { id: String(row.id) },
                  })
                }
              />
            ) : null}

            {canDelete ? (
              <AppButton title="Eliminar" variant="danger" onPress={onDelete} />
            ) : null}
          </View>
        )}
      </SafeAreaView>
    </>
  );
}

function KV({ k, v, s }: { k: string; v: string; s: ReturnType<typeof styles> }) {
  return (
    <View style={s.kvRow}>
      <Text style={s.k}>{k}</Text>
      <Text style={s.v}>{v}</Text>
    </View>
  );
}

const styles = (colors: any) =>
  StyleSheet.create({
    safe: { flex: 1 },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    text: { color: colors.text },

    container: { paddingHorizontal: 12, paddingTop: 12, gap: 10 },

    card: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 12,
    },

    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    title: { color: colors.text, fontSize: 18, fontWeight: Platform.OS === "ios" ? "700" : "800", flex: 1 },

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

    kvRow: { marginTop: 12 },
    k: { color: colors.text + "AA", fontSize: 12, fontWeight: "800" },
    v: { color: colors.text, fontSize: 16, fontWeight: "600", marginTop: 6 },

    // Buttons handled by AppButton
  });
