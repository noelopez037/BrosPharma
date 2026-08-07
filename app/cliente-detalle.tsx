import { useFocusEffect, useTheme } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import { Stack, router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/app-button";
import { generarEstadoCuentaClientePdf } from "../lib/estadoCuentaClientePdf";
import { supabase } from "../lib/supabase";
import { useRole } from "../lib/useRole";
import { useEmpresaActiva } from "../lib/useEmpresaActiva";
import { useResumeLoad } from "../lib/useResumeLoad";
import { extFromUri, mimeFromExt, uriToArrayBuffer } from "../lib/utils/file";
import { fmtDate } from "../lib/utils/format";
import { normalizeUpper } from "../lib/utils/text";
import { goBackSafe } from "../lib/goBackSafe";

type Role = "ADMIN" | "BODEGA" | "VENTAS" | "FACTURACION" | "MENSAJERO" | "";

const BUCKET_CLIENTES_DOCS = "Clientes-Docs";

type DocTipo = "licencia_sanitaria" | "patente_comercio" | "credito_apertura";

const DOC_LABELS: Record<DocTipo, string> = {
  licencia_sanitaria: "Licencia sanitaria",
  patente_comercio: "Patente de comercio",
  credito_apertura: "Crédito de apertura",
};

type ClienteRow = {
  id: number;
  nombre: string;
  nit: string | null;
  telefono: string | null;
  direccion: string | null;
  activo: boolean;
  vendedor_id: string | null;
  licencia_sanitaria_pdf_path: string | null;
  licencia_sanitaria_updated_at: string | null;
  licencia_sanitaria_estado: string | null;
  licencia_sanitaria_rechazo_motivo: string | null;
  patente_comercio_pdf_path: string | null;
  patente_comercio_updated_at: string | null;
  credito_apertura_pdf_path: string | null;
  credito_apertura_updated_at: string | null;
  vendedor?: {
    id: string;
    full_name: string | null;
    role: string;
  } | null;
};

function displayNit(nit: string | null | undefined) {
  const t = String(nit ?? "").trim();
  return t ? t : "CF";
}

async function uriToBytes(uri: string): Promise<Uint8Array> {
  const ab = await uriToArrayBuffer(uri);
  return new Uint8Array(ab);
}

async function openInBrowser(url: string) {
  if (!url) throw new Error("URL inválida");
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    await WebBrowser.openBrowserAsync(encodeURI(url));
  }
}

export default function ClienteDetalle() {
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);

  const handleGoBack = useCallback(() => {
    goBackSafe("/(drawer)/clientes");
  }, []);

  const { id } = useLocalSearchParams<{ id: string }>();
  const clienteId = Number(id);

  const { role, uid, isReady, refreshRole } = useRole();
  const { empresaActivaId } = useEmpresaActiva();
  const roleUp = String(role ?? "").trim().toUpperCase() as Role;
  const canEdit = isReady && (roleUp === "ADMIN" || roleUp === "VENTAS" || roleUp === "MENSAJERO") && uid !== "344991b7-2f18-4ad0-b387-f5242c816b5c";
  const canDelete = isReady && roleUp === "ADMIN";

  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<ClienteRow | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [docBusyTipo, setDocBusyTipo] = useState<DocTipo | null>(null);
  const canGenerarEstadoCuentaPdf =
    isReady &&
    (roleUp === "ADMIN" ||
      roleUp === "VENTAS" ||
      (roleUp === "MENSAJERO" && !!row && row.vendedor_id === uid));

  const loadCliente = useCallback(async () => {
    if (!Number.isFinite(clienteId) || clienteId <= 0) {
      setRow(null);
      return;
    }
    if (!empresaActivaId) return;

    const { data, error } = await supabase
      .from("clientes")
      .select(
        "id,nombre,nit,telefono,direccion,activo,vendedor_id,licencia_sanitaria_pdf_path,licencia_sanitaria_updated_at,licencia_sanitaria_estado,licencia_sanitaria_rechazo_motivo,patente_comercio_pdf_path,patente_comercio_updated_at,credito_apertura_pdf_path,credito_apertura_updated_at,vendedor:profiles!clientes_vendedor_id_fkey(id,full_name,role)"
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
    void refreshRole("resume:cliente-detalle");
  }, () => {
    void loadAll().catch(() => {});
  });

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
               const { error } = await supabase.from("clientes").delete().eq("empresa_id", empresaActivaId).eq("id", row.id);
               if (error) throw error;
               Alert.alert("Listo", "Cliente eliminado");
               handleGoBack();
             } catch (e: any) {
               Alert.alert("Error", e?.message ?? "No se pudo eliminar");
             }
           },
         },
       ]
     );
  }, [canDelete, row, handleGoBack]);

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

  const docPathField = useCallback((tipo: DocTipo) => `${tipo}_pdf_path` as const, []);
  const docUpdatedAtField = useCallback((tipo: DocTipo) => `${tipo}_updated_at` as const, []);

  const pickAndUploadDoc = useCallback(
    async (tipo: DocTipo) => {
      if (!canEdit || !row) return;
      if (docBusyTipo) return;
      if (!empresaActivaId) {
        Alert.alert("Sin empresa", "No tienes una empresa activa asignada. Contacta al administrador.");
        return;
      }

      try {
        const res = await DocumentPicker.getDocumentAsync({
          type: ["application/pdf", "image/*"],
          multiple: false,
          copyToCacheDirectory: true,
        });
        if (res.canceled) return;
        const asset = res.assets?.[0];
        const uri = asset?.uri;
        if (!uri) return;

        setDocBusyTipo(tipo);

        const ext = extFromUri(String(asset?.name ?? uri));
        const contentType = String(asset?.mimeType ?? "").trim() || mimeFromExt(ext);

        const stamp = Date.now();
        const rnd = Math.random().toString(16).slice(2);
        const path = `${empresaActivaId}/clientes/${row.id}/${tipo}/${stamp}-${rnd}.${ext}`;

        const bytes = await uriToBytes(uri);
        if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("El archivo excede 20 MB.");

        const { error: upErr } = await supabase.storage.from(BUCKET_CLIENTES_DOCS).upload(path, bytes, {
          contentType,
          upsert: false,
        });
        if (upErr) throw upErr;

        const prevPath = row[docPathField(tipo)];

        const { error: rpcErr } = await supabase.rpc("rpc_cliente_documento_registrar", {
          p_empresa_id: empresaActivaId,
          p_cliente_id: row.id,
          p_tipo: tipo,
          p_path: path,
        });
        if (rpcErr) throw rpcErr;

        if (prevPath) {
          await supabase.storage.from(BUCKET_CLIENTES_DOCS).remove([String(prevPath)]).catch(() => {});
        }

        await loadCliente();
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "No se pudo subir el documento");
      } finally {
        setDocBusyTipo(null);
      }
    },
    [canEdit, row, docBusyTipo, empresaActivaId, docPathField, docUpdatedAtField, loadCliente]
  );

  const openDoc = useCallback(
    async (tipo: DocTipo) => {
      if (!row) return;
      const path = row[docPathField(tipo)];
      if (!path) return;

      try {
        const { data: s, error: se } = await supabase.storage
          .from(BUCKET_CLIENTES_DOCS)
          .createSignedUrl(String(path), 60 * 15);
        if (se) throw se;
        const url = (s as any)?.signedUrl ?? null;
        if (!url) throw new Error("No se pudo abrir el documento");
        await openInBrowser(url);
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "No se pudo abrir el documento");
      }
    },
    [row, docPathField]
  );

  const deleteDoc = useCallback(
    (tipo: DocTipo) => {
      if (!canEdit || !row) return;
      const path = row[docPathField(tipo)];
      if (!path) return;

      Alert.alert(
        "Eliminar documento",
        `Se eliminará "${DOC_LABELS[tipo]}". ¿Continuar?`,
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Eliminar",
            style: "destructive",
            onPress: async () => {
              if (!empresaActivaId) return;
              setDocBusyTipo(tipo);
              try {
                const payload: Record<string, any> = {
                  [docPathField(tipo)]: null,
                  [docUpdatedAtField(tipo)]: null,
                };
                if (tipo === "licencia_sanitaria") {
                  payload.licencia_sanitaria_estado = null;
                  payload.licencia_sanitaria_revisado_por = null;
                  payload.licencia_sanitaria_revisado_at = null;
                  payload.licencia_sanitaria_rechazo_motivo = null;
                }

                const { error: updErr } = await supabase
                  .from("clientes")
                  .update(payload)
                  .eq("empresa_id", empresaActivaId)
                  .eq("id", row.id);
                if (updErr) throw updErr;

                await supabase.storage.from(BUCKET_CLIENTES_DOCS).remove([String(path)]).catch(() => {});
                await loadCliente();
              } catch (e: any) {
                Alert.alert("Error", e?.message ?? "No se pudo eliminar el documento");
              } finally {
                setDocBusyTipo(null);
              }
            },
          },
        ]
      );
    },
    [canEdit, row, docPathField, docUpdatedAtField, empresaActivaId, loadCliente]
  );

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

            <View style={s.card}>
              <Text style={s.docsTitle}>Documentos</Text>
              {(["licencia_sanitaria", "patente_comercio", "credito_apertura"] as DocTipo[]).map((tipo) => (
                <DocRow
                  key={tipo}
                  label={DOC_LABELS[tipo]}
                  path={row[docPathField(tipo)]}
                  updatedAt={row[docUpdatedAtField(tipo)]}
                  estado={tipo === "licencia_sanitaria" ? row.licencia_sanitaria_estado : null}
                  rechazoMotivo={tipo === "licencia_sanitaria" ? row.licencia_sanitaria_rechazo_motivo : null}
                  busy={docBusyTipo === tipo}
                  canEdit={canEdit}
                  onView={() => openDoc(tipo)}
                  onUpload={() => pickAndUploadDoc(tipo)}
                  onDelete={() => deleteDoc(tipo)}
                  s={s}
                />
              ))}
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

function docStatusText(hasDoc: boolean, updatedAt: string | null, estado: string | null, rechazoMotivo: string | null) {
  if (!hasDoc) return "No subido";
  if (estado === "PENDIENTE") return `Pendiente de aprobación • subido ${fmtDate(updatedAt)}`;
  if (estado === "APROBADA") return `Aprobada • ${fmtDate(updatedAt)}`;
  if (estado === "RECHAZADA") {
    const motivo = String(rechazoMotivo ?? "").trim();
    return motivo ? `Rechazada: ${motivo} — puedes volver a subirla` : "Rechazada — puedes volver a subirla";
  }
  return `Subido • ${fmtDate(updatedAt)}`;
}

function DocRow({
  label,
  path,
  updatedAt,
  estado = null,
  rechazoMotivo = null,
  busy,
  canEdit,
  onView,
  onUpload,
  onDelete,
  s,
}: {
  label: string;
  path: string | null;
  updatedAt: string | null;
  estado?: string | null;
  rechazoMotivo?: string | null;
  busy: boolean;
  canEdit: boolean;
  onView: () => void;
  onUpload: () => void;
  onDelete: () => void;
  s: ReturnType<typeof styles>;
}) {
  const hasDoc = !!path;
  return (
    <View style={s.docRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.docLabel}>{label}</Text>
        <Text style={s.docStatus}>{docStatusText(hasDoc, updatedAt, estado, rechazoMotivo)}</Text>
      </View>

      {busy ? (
        <ActivityIndicator />
      ) : (
        <View style={s.docActions}>
          {hasDoc ? (
            <Pressable onPress={onView} style={s.docActionBtn}>
              <Text style={s.docActionText}>Ver</Text>
            </Pressable>
          ) : null}
          {canEdit ? (
            <Pressable onPress={onUpload} style={s.docActionBtn}>
              <Text style={s.docActionText}>{hasDoc ? "Reemplazar" : "Subir"}</Text>
            </Pressable>
          ) : null}
          {canEdit && hasDoc ? (
            <Pressable onPress={onDelete} style={s.docActionBtn}>
              <Text style={[s.docActionText, s.docActionDanger]}>Eliminar</Text>
            </Pressable>
          ) : null}
        </View>
      )}
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
    k: { color: colors.text + "AA", fontSize: 11, fontWeight: "800" },
    v: { color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 6 },

    docsTitle: { color: colors.text, fontSize: 13, fontWeight: "800", marginBottom: 4 },
    docRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    docLabel: { color: colors.text, fontSize: 13, fontWeight: "700" },
    docStatus: { color: colors.text + "AA", fontSize: 11, fontWeight: "600", marginTop: 3 },
    docActions: { flexDirection: "row", gap: 14 },
    docActionBtn: { paddingVertical: 4, paddingHorizontal: 2 },
    docActionText: { color: colors.primary ?? "#153c9e", fontSize: 12, fontWeight: "800" },
    docActionDanger: { color: "#D92D20" },

    // Buttons handled by AppButton
  });
