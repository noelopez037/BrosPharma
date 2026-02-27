import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import { router } from "expo-router";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  ColorValue,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import ImageViewer from "react-native-image-zoom-viewer";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { supabase } from "../../lib/supabase";
import { useThemePref } from "../../lib/themePreference";
import { getCached, setCached, LoteDetalle, ProductoDetalle, ProductoHead } from "../../lib/productoCache";
import { useRole } from "../../lib/useRole";
import { AppButton } from "../ui/app-button";
import { HEADER_BG } from "../../src/theme/headerColors";

const BUCKET = "productos";

type Props = {
  productoId: number;
  onClose: () => void;
};

function fmtDate(iso: string | null) {
  return iso ? iso.slice(0, 10) : "—";
}

function extFromUrl(url: string) {
  const clean = String(url).split("?")[0];
  const m = clean.match(/\.([a-zA-Z0-9]+)$/);
  const ext = (m?.[1] ?? "jpg").toLowerCase();
  if (ext === "jpeg") return "jpg";
  if (ext === "png") return "png";
  if (ext === "heic") return "heic";
  return "jpg";
}

type SysColors = {
  BG: ColorValue;
  CARD: ColorValue;
  LABEL: ColorValue;
  SECONDARY: ColorValue;
  SEPARATOR: ColorValue;
  BLUE: ColorValue;
  BACKDROP: string;
  VIEWER_TOPBAR: string;
};

function getSysColors(isDark: boolean): SysColors {
  if (isDark) {
    return {
      BG: "#000000",
      CARD: "#1C1C1E",
      LABEL: "#FFFFFF",
      SECONDARY: "rgba(255,255,255,0.72)",
      SEPARATOR: "rgba(255,255,255,0.16)",
      BLUE: HEADER_BG,
      BACKDROP: "rgba(0,0,0,0.45)",
      VIEWER_TOPBAR: "rgba(0,0,0,0.35)",
    };
  }

  return {
    BG: "#FFFFFF",
    CARD: "#F2F2F7",
    LABEL: "#000000",
    SECONDARY: "rgba(0,0,0,0.60)",
    SEPARATOR: "rgba(0,0,0,0.14)",
    BLUE: HEADER_BG,
    BACKDROP: Platform.OS === "android" ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.18)",
    VIEWER_TOPBAR: "rgba(0,0,0,0.35)",
  };
}

async function saveImageToPhotos(imageUrl: string) {
  if (!imageUrl) throw new Error("URL de imagen inválida");
  if (Platform.OS === "web") throw new Error("Guardar a Fotos no está disponible en Web");

  const perm = await MediaLibrary.requestPermissionsAsync();
  if (!perm.granted) throw new Error("Permiso de Fotos denegado");

  const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!baseDir) throw new Error("No hay directorio local disponible");

  const downloadDir = baseDir + "downloads/";
  await FileSystem.makeDirectoryAsync(downloadDir, { intermediates: true }).catch(() => {});

  const ext = extFromUrl(imageUrl);
  const localUri = `${downloadDir}producto-${Date.now()}.${ext}`;

  const dl = await FileSystem.downloadAsync(imageUrl, localUri);
  if (!dl?.uri) throw new Error("No se pudo descargar la imagen");

  const asset = await MediaLibrary.createAssetAsync(dl.uri);
  try {
    await MediaLibrary.createAlbumAsync("BrosPharma", asset, false);
  } catch {}

  try {
    await FileSystem.deleteAsync(dl.uri, { idempotent: true });
  } catch {}
}

const LoteItem = memo(function LoteItem({ item, s }: { item: LoteDetalle; s: ReturnType<typeof styles> }) {
  return (
    <View style={s.loteCard}>
      <View style={{ flex: 1 }}>
        <Text style={s.loteTitle}>{item.lote ?? "—"}</Text>
        <Text style={s.loteSub}>Exp: {fmtDate(item.fecha_exp)}</Text>
      </View>

      <View style={{ alignItems: "flex-end" }}>
        <Text style={s.loteNum}>{item.stock_disponible}</Text>
        <Text style={s.loteSub}>
          Total {item.stock_total} • Res {item.stock_reservado}
        </Text>
      </View>
    </View>
  );
});

export function ProductoModalContent({ productoId, onClose }: Props) {
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";
  const C = useMemo(() => getSysColors(isDark), [isDark]);
  const s = useMemo(() => styles(C), [C]);
  const insets = useSafeAreaInsets();

  const { isAdmin } = useRole();

  const aliveRef = useRef(true);
  const requestIdRef = useRef(0);
  const closingRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<LoteDetalle[]>([]);
  const [headProd, setHeadProd] = useState<ProductoHead | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    closingRef.current = closing;
  }, [closing]);

  const translateY = useRef(new Animated.Value(0)).current;

  const closeWithAnim = useCallback(() => {
    if (viewerOpen) {
      setViewerOpen(false);
      return;
    }
    if (closing) return;
    setClosing(true);
    closingRef.current = true;
    Animated.timing(translateY, {
      toValue: 800,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  }, [closing, onClose, translateY, viewerOpen]);

  const resetWithAnim = useCallback(() => {
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start();
  }, [translateY]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
        onPanResponderMove: (_, g) => {
          if (g.dy > 0) translateY.setValue(g.dy);
        },
        onPanResponderRelease: (_, g) => {
          if (g.dy > 120 || g.vy > 1.2) closeWithAnim();
          else resetWithAnim();
        },
        onPanResponderTerminate: () => resetWithAnim(),
      }),
    [closeWithAnim, resetWithAnim, translateY]
  );

  const fetchAll = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!aliveRef.current) return;
    if (closingRef.current) return;

    const cached = getCached(productoId);
    if (cached) {
      if (requestId !== requestIdRef.current) return;
      setHeadProd(cached.head);
      setRows(cached.lotes);
      if (cached.head.image_path) {
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(cached.head.image_path);
        setImageUrl(pub.publicUrl ?? null);
      }
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('rpc_producto_detalle', { p_producto_id: productoId });

      if (!aliveRef.current) return;
      if (closingRef.current) return;
      if (requestId !== requestIdRef.current) return;

      if (error) throw error;

      const det = data as ProductoDetalle;
      setCached(productoId, det);
      setHeadProd(det.head);
      setRows(det.lotes);

      if (det.head.image_path) {
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(det.head.image_path);
        setImageUrl(pub.publicUrl ?? null);
      }
    } finally {
      if (!aliveRef.current) return;
      if (closingRef.current) return;
      if (requestId !== requestIdRef.current) return;
      setLoading(false);
    }
  }, [productoId]);

  useEffect(() => {
    translateY.setValue(0);
    setClosing(false);
    closingRef.current = false;
    setViewerOpen(false);
    setSavingPhoto(false);
    setRows([]);
    setHeadProd(null);
    setImageUrl(null);

    let raf = 0;
    raf = requestAnimationFrame(() => {
      fetchAll().catch(() => {
        if (!aliveRef.current) return;
        if (closingRef.current) return;
        setRows([]);
        setHeadProd(null);
        setImageUrl(null);
        setLoading(false);
      });
    });
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [fetchAll, productoId, translateY]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      setViewerOpen(false);
      setClosing(false);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const { displayNombre, displayMarca, precioMin, lotes, totalDisponible } = useMemo(() => {
    const nombre = headProd?.nombre ?? "";
    const marca = headProd?.marca ?? null;
    const min = headProd?.precio_min_venta ?? null;
    const lotesDisponibles: LoteDetalle[] = [];
    let total = 0;

    for (const r of rows) {
      const disp = Number(r.stock_disponible ?? 0);
      if (disp > 0) {
        lotesDisponibles.push(r);
        total += disp;
      }
    }

    return {
      displayNombre: nombre,
      displayMarca: marca,
      precioMin: min as number | null,
      lotes: lotesDisponibles,
      totalDisponible: total,
    };
  }, [headProd, rows]);

  const listContentStyle = useMemo(() => ({ paddingBottom: 8 }), []);
  const keyExtractor = useCallback(
    (it: LoteDetalle) => String(it.lote_id ?? it.lote ?? "?"),
    []
  );
  const renderItem = useCallback(({ item }: { item: LoteDetalle }) => <LoteItem item={item} s={s} />, [s]);
  const listEmpty = useMemo(
    () => (
      <View style={{ paddingVertical: 12 }}>
        <Text style={s.loteSub}>No hay lotes disponibles.</Text>
      </View>
    ),
    [s]
  );

  const openViewer = useCallback(() => setViewerOpen(true), []);

  const onSavePhoto = useCallback(async () => {
    if (!imageUrl || savingPhoto) return;
    setSavingPhoto(true);
    try {
      await saveImageToPhotos(imageUrl);
      alert("Imagen guardada en Fotos");
    } catch (e: any) {
      alert(e?.message ?? "No se pudo guardar la imagen");
    } finally {
      setSavingPhoto(false);
    }
  }, [imageUrl, savingPhoto]);

  const onEditProducto = useCallback(() => {
    if (!isAdmin) return;
    onClose();
    setTimeout(() => {
      router.push({ pathname: "/producto-edit", params: { id: String(productoId) } } as any);
    }, 0);
  }, [isAdmin, onClose, productoId]);

  return (
    <View style={s.modalRoot}>
      <Pressable pointerEvents={closing ? "none" : "auto"} style={s.backdrop} onPress={closeWithAnim} />

      <Animated.View
        style={[
          s.sheet,
          {
            paddingBottom: insets.bottom + 12,
            transform: [{ translateY }],
          },
        ]}
      >
        <View style={s.handleArea} {...pan.panHandlers}>
          <View style={s.handle} />
        </View>

        {loading ? (
          <View style={s.center}>
            <Text style={[s.text, { opacity: 0.7 }]}>Cargando...</Text>
          </View>
        ) : !headProd ? (
          <View style={s.center}>
            <Text style={s.text}>Producto no encontrado</Text>
          </View>
        ) : (
          <>
            <View style={s.headerCard}>
              <View style={{ flex: 1 }}>
                <Text style={s.title} numberOfLines={2}>
                  {displayNombre}
                  {displayMarca ? ` • ${displayMarca}` : ""}
                </Text>

                <View style={s.metaRow}>
                  <Text style={s.metaKey}>Disponibles</Text>
                  <Text style={s.metaVal}>{totalDisponible}</Text>
                </View>

                <View style={s.metaRow}>
                  <Text style={s.metaKey}>Mín. venta</Text>
                  <Text style={s.metaVal}>
                    {precioMin == null ? "—" : `Q ${Number(precioMin).toFixed(2)}`}
                  </Text>
                </View>

                {isAdmin ? (
                  <AppButton
                    title="Editar producto"
                    variant="outline"
                    size="sm"
                    onPress={onEditProducto}
                    style={s.editBtn}
                  />
                ) : null}
              </View>

              <View style={s.imageBox}>
                {imageUrl ? (
                  <Pressable
                    onPress={openViewer}
                    style={({ pressed }) => [pressed && { opacity: 0.9 }]}
                  >
                    <Image source={{ uri: imageUrl }} style={s.image} />
                  </Pressable>
                ) : (
                  <View style={s.imagePlaceholder}>
                    <Text style={s.placeholderText}>SIN FOTO</Text>
                  </View>
                )}
              </View>
            </View>

            <Text style={s.section}>Lotes disponibles</Text>

            <FlatList
              data={lotes}
              keyExtractor={keyExtractor}
              contentContainerStyle={listContentStyle}
              automaticallyAdjustKeyboardInsets
              renderItem={renderItem}
              ListEmptyComponent={listEmpty}
              initialNumToRender={8}
              maxToRenderPerBatch={10}
              updateCellsBatchingPeriod={40}
              windowSize={7}
              removeClippedSubviews={Platform.OS === "android"}
            />
          </>
        )}
      </Animated.View>

      {viewerOpen ? (
        <Modal
          visible={viewerOpen}
          transparent
          presentationStyle="overFullScreen"
          onRequestClose={() => setViewerOpen(false)}
        >
          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <View style={s.viewerTopBar}>
              <Pressable
                onPress={() => setViewerOpen(false)}
                style={({ pressed }) => [s.viewerBtn, pressed && { opacity: 0.8 }]}
              >
                <Text style={s.viewerBtnText}>Cerrar</Text>
              </Pressable>

              <Pressable
                onPress={onSavePhoto}
                disabled={!imageUrl || savingPhoto}
                style={({ pressed }) => [
                  s.viewerBtn,
                  (!imageUrl || savingPhoto) && { opacity: 0.5 },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={s.viewerBtnText}>{savingPhoto ? "Guardando..." : "Guardar"}</Text>
              </Pressable>
            </View>

            <ImageViewer
              imageUrls={imageUrl ? [{ url: imageUrl }] : []}
              enableSwipeDown
              onSwipeDown={() => setViewerOpen(false)}
              backgroundColor="rgba(0,0,0,0.95)"
              renderIndicator={() => <View />}
              saveToLocalByLongPress={false}
            />
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = (C: SysColors) =>
  StyleSheet.create({
    modalRoot: { flex: 1, justifyContent: "flex-end" },

    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: C.BACKDROP,
    },

    sheet: {
      backgroundColor: C.BG,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 16,
      paddingTop: 0,
      maxHeight: "78%",
      shadowColor: "#000",
      shadowOpacity: 0.12,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: -6 },
      elevation: Platform.OS === "android" ? 18 : 10,
    },

    handleArea: { paddingTop: 10, paddingBottom: 10, alignItems: "center" },
    handle: {
      width: 38,
      height: 5,
      borderRadius: 999,
      backgroundColor: C.SEPARATOR as any,
      opacity: 0.9,
    },

    center: { alignItems: "center", justifyContent: "center", paddingVertical: 18 },
    text: { color: C.LABEL as any },

    headerCard: {
      borderWidth: 1,
      borderColor: C.SEPARATOR as any,
      backgroundColor: C.CARD,
      borderRadius: 16,
      padding: 14,
      flexDirection: "row",
      gap: 12,
    },

    title: {
      color: C.LABEL as any,
      fontSize: 18,
      fontWeight: Platform.OS === "ios" ? "600" : "700",
    },

    metaRow: {
      flexDirection: "row",
      alignItems: "baseline",
      marginTop: 8,
      gap: 8,
      flexWrap: "wrap",
    },
    metaKey: { color: C.SECONDARY as any, fontSize: 13 },
    metaVal: {
      color: C.LABEL as any,
      fontSize: 14,
      fontWeight: Platform.OS === "ios" ? "600" : "700",
    },

    editBtn: {
      alignSelf: "flex-start",
      marginTop: 12,
    },

    imageBox: { width: 96, height: 96 },
    image: { width: 96, height: 96, borderRadius: 14 },
    imagePlaceholder: {
      width: 96,
      height: 96,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.SEPARATOR as any,
      backgroundColor: C.BG,
      alignItems: "center",
      justifyContent: "center",
    },
    placeholderText: { color: C.SECONDARY as any, fontSize: 12 },

    section: {
      color: C.LABEL as any,
      fontWeight: Platform.OS === "ios" ? "600" : "700",
      marginTop: 14,
      marginBottom: 10,
      fontSize: 15,
    },

    loteCard: {
      borderWidth: 1,
      borderColor: C.SEPARATOR as any,
      backgroundColor: C.CARD,
      borderRadius: 16,
      padding: 14,
      marginBottom: 10,
      flexDirection: "row",
      gap: 10,
    },
    loteTitle: {
      color: C.LABEL as any,
      fontWeight: Platform.OS === "ios" ? "600" : "700",
      fontSize: 16,
    },
    loteSub: { color: C.SECONDARY as any, marginTop: 4, fontSize: 12 },
    loteNum: {
      color: C.LABEL as any,
      fontWeight: Platform.OS === "ios" ? "700" : "800",
      fontSize: 20,
    },

    viewerTopBar: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10,
      paddingTop: Platform.OS === "ios" ? 54 : 18,
      paddingHorizontal: 12,
      paddingBottom: 10,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: C.VIEWER_TOPBAR,
    },
    viewerBtn: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: "rgba(255,255,255,0.12)",
    },
    viewerBtnText: { color: "#fff", fontWeight: "700" },
  });
