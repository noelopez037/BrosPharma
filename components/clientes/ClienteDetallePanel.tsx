// components/clientes/ClienteDetallePanel.tsx
// Embeddable panel version of app/cliente-detalle.tsx for the split master-detail layout.

import { useFocusEffect, useTheme } from "@react-navigation/native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../ui/app-button";
import { generarEstadoCuentaClientePdf } from "../../lib/estadoCuentaClientePdf";
import { supabase } from "../../lib/supabase";
import { useRole } from "../../lib/useRole";
import { useEmpresaActiva } from "../../lib/useEmpresaActiva";
import { useResumeLoad } from "../../lib/useResumeLoad";
import { normalizeUpper } from "../../lib/utils/text";

type Role = "ADMIN" | "BODEGA" | "VENTAS" | "FACTURACION" | "MENSAJERO" | "";

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

type ClienteDetallePanelProps = {
  clienteId: number;
  readOnly?: boolean;
  embedded?: boolean;
  onEditWeb?: (id: number) => void;
  onDeleted?: () => void;
};

type ClienteDetallePanelContentProps = {
  embedded: boolean;
  clienteIdProp: number;
  readOnly: boolean;
  onEditWeb?: (id: number) => void;
  onDeleted?: () => void;
};

function displayNit(nit: string | null | undefined) {
  const t = String(nit ?? "").trim();
  return t ? t : "CF";
}

export function ClienteDetallePanel({
  clienteId,
  readOnly = false,
  embedded = false,
  onEditWeb,
  onDeleted,
}: ClienteDetallePanelProps) {
  if (embedded) {
    return <ClienteDetallePanelContent embedded clienteIdProp={clienteId} readOnly={readOnly} onEditWeb={onEditWeb} onDeleted={onDeleted} />;
  }
  return <ClienteDetallePanelWithParams fallbackClienteId={clienteId} />;
}

function ClienteDetallePanelWithParams({ fallbackClienteId }: { fallbackClienteId: number }) {
  const { id, readOnly: readOnlyParam } = useLocalSearchParams<{ id?: string; readOnly?: string }>();
  const idFromParams = id ? Number(id) : NaN;
  const resolvedId = Number.isFinite(idFromParams) && idFromParams > 0 ? idFromParams : fallbackClienteId;
  const resolvedReadOnly = readOnlyParam === "1";
  return <ClienteDetallePanelContent embedded={false} clienteIdProp={resolvedId} readOnly={resolvedReadOnly} />;
}

function ClienteDetallePanelContent({
  embedded,
  clienteIdProp,
  readOnly,
  onEditWeb,
  onDeleted,
}: ClienteDetallePanelContentProps) {
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const clienteId = clienteIdProp;

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

  const { role, uid, isReady, refreshRole } = useRole();
  const { empresaActivaId } = useEmpresaActiva();
  const roleUp = String(role ?? "").trim().toUpperCase() as Role;
  const canEdit = isReady && roleUp === "ADMIN" && !readOnly;
  const canDelete = isReady && roleUp === "ADMIN" && !readOnly;
  const canGenerarEstadoCuentaPdf =
    isReady &&
    (roleUp === "ADMIN" ||
      roleUp === "VENTAS" ||
      (roleUp === "MENSAJERO" && !!row && row.vendedor_id === uid));

  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<ClienteRow | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const loadCliente = useCallback(async () => {
    if (!Number.isFinite(clienteId) || clienteId <= 0) {
      setRow(null);
      return;
    }

    if (!empresaActivaId) return;
    const { data, error } = await supabase
      .from("clientes")
      .select(
        "id,nombre,nit,telefono,direccion,activo,vendedor_id,vendedor:profiles!clientes_vendedor_id_fkey(id,full_name,role)"
      )
      .eq("empresa_id", empresaActivaId)
      .eq("id", clienteId)
      .maybeSingle();

    if (error) throw error;
    setRow((data ?? null) as any);
  }, [clienteId, empresaActivaId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await loadCliente();
    } finally {
      setLoading(false);
    }
  }, [loadCliente]);

  useFocusEffect(
    useCallback(() => {
      void refreshRole("focus:cliente-detalle");
    }, [refreshRole])
  );

  useFocusEffect(
    useCallback(() => {
      loadAll().catch(() => {
        setLoading(false);
        setRow(null);
      });
    }, [loadAll])
  );

  useResumeLoad(empresaActivaId, () => {
    void refreshRole("resume:cliente-detalle-panel");
  }, () => {
    void loadAll().catch(() => {});
  });

  const onDelete = useCallback(() => {
    if (!canDelete || !row) return;

    const doDelete = async () => {
      try {
        const { error } = await supabase.from("clientes").delete().eq("empresa_id", empresaActivaId).eq("id", row.id);
        if (error) throw error;
        if (Platform.OS === "web") {
          if (embedded) {
            onDeleted?.();
          } else {
            goBackSafe();
          }
        } else {
          if (embedded) {
            Alert.alert("Listo", "Cliente eliminado");
            onDeleted?.();
          } else {
            Alert.alert("Listo", "Cliente eliminado");
            goBackSafe();
          }
        }
      } catch (e: any) {
        if (Platform.OS === "web") {
          window.alert(e?.message ?? "No se pudo eliminar");
        } else {
          Alert.alert("Error", e?.message ?? "No se pudo eliminar");
        }
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm(`Se eliminará definitivamente "${row.nombre}". ¿Continuar?`)) {
        void doDelete();
      }
    } else {
      Alert.alert(
        "Eliminar cliente",
        `Se eliminará definitivamente "${row.nombre}". ¿Continuar?`,
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Eliminar", style: "destructive", onPress: () => void doDelete() },
        ]
      );
    }
  }, [canDelete, row, embedded, goBackSafe, onDeleted, empresaActivaId]);

  const onGenerarEstadoCuentaPdf = useCallback(async () => {
    if (!canGenerarEstadoCuentaPdf) return;
    if (!row || pdfLoading) return;
    setPdfLoading(true);
    try {
      const { data, error } = await supabase.rpc("rpc_estado_cuenta_cliente_pdf", { p_empresa_id: empresaActivaId, p_cliente_id: row.id });
      if (error) throw error;
      if (!data || typeof data !== "object") throw new Error("Respuesta invalida del RPC");

      const _d = new Date(); const _meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"]; const fecha = `${String(_d.getDate()).padStart(2,"0")}-${_meses[_d.getMonth()]}-${_d.getFullYear()}`;
      const clienteSlug = row.nombre.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      const fileName = `Estado-de-cuenta-${clienteSlug}-${fecha}`;
      await generarEstadoCuentaClientePdf(data as any, { fileName });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo generar el PDF");
    } finally {
      setPdfLoading(false);
    }
  }, [canGenerarEstadoCuentaPdf, empresaActivaId, row, pdfLoading]);

  const vendedorNombre = (row?.vendedor?.full_name ?? "").trim();
  const vendedorRole = normalizeUpper(row?.vendedor?.role);
  const vendedorLabel = vendedorNombre || (row?.vendedor_id ? row?.vendedor_id : "Sin asignar");

  return (
    <>
      {!embedded && (
        <Stack.Screen
          options={{
            title: "Cliente",
            headerShown: true,
            headerBackTitle: "Atrás",
          }}
        />
      )}

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

            {canGenerarEstadoCuentaPdf ? (
              <AppButton
                title="Generar estado de cuenta (PDF)"
                variant="outline"
                onPress={onGenerarEstadoCuentaPdf}
                loading={pdfLoading}
                accessibilityLabel="Generar estado de cuenta en PDF"
              />
            ) : null}

            {canEdit ? (
              <AppButton
                title="Editar"
                onPress={() => {
                  if (embedded && Platform.OS === "web" && onEditWeb) {
                    onEditWeb(row.id);
                  } else {
                    router.push({
                      pathname: "/cliente-form" as any,
                      params: { id: String(row.id) },
                    });
                  }
                }}
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
    title: { color: colors.text, fontSize: Platform.OS === "web" ? 18 : 15, fontWeight: Platform.OS === "ios" ? "700" : "800", flex: 1 },

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
    v: { color: colors.text, fontSize: Platform.OS === "web" ? 16 : 14, fontWeight: "600", marginTop: 6 },
  });
