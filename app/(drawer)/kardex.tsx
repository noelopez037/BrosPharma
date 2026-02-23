import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useFocusEffect, useTheme } from "@react-navigation/native";
import * as FileSystem from "expo-file-system/legacy";
import { Stack } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { RoleGate } from "../../components/auth/RoleGate";
import { AppButton } from "../../components/ui/app-button";
import { supabase } from "../../lib/supabase";
import { useThemePref } from "../../lib/themePreference";
import { useGoHomeOnBack } from "../../lib/useGoHomeOnBack";
import { useRole } from "../../lib/useRole";

type Role = "ADMIN" | "VENTAS" | "BODEGA" | "FACTURACION" | "";

type ProductoPick = {
  id: number;
  nombre: string;
  activo: boolean;
  marca: string | null;
};

type KardexRow = {
  fecha: string;
  tipo: "COMPRA" | "VENTA" | "DEVOLUCION" | "RESERVA" | "LIBERACION";
  compra_id: number | null;
  venta_id: number | null;
  estado: string | null;
  proveedor: string | null;
  cliente: string | null;
  factura_numero: string | null;
  lote_id: number | null;
  lote: string | null;
  entrada: number;
  salida: number;
  saldo: number;
};

type TotalesSimple = {
  entradas: number;
  salidas: number;
  reservado: number;
  saldo: number;
};

function normalizeKardexRows(rows: KardexRow[]): KardexRow[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const reservaVentaIds = new Set<number>();
  for (const row of rows) {
    if (row.tipo === "RESERVA") {
      const ventaId = row.venta_id;
      if (typeof ventaId === "number" && Number.isFinite(ventaId)) {
        reservaVentaIds.add(ventaId);
      }
    }
  }

  if (reservaVentaIds.size === 0) return rows;

  return rows.filter((row) => {
    if (row.tipo !== "VENTA") return true;
    const ventaId = row.venta_id;
    if (typeof ventaId !== "number" || !Number.isFinite(ventaId)) return true;
    return !reservaVentaIds.has(ventaId);
  });
}

function normalizeUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
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

function fmtYmd(d: Date | null) {
  if (!d) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtFechaHora(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return String(iso);

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default function KardexScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";
  const s = useMemo(() => styles(colors, isDark), [colors, isDark]);

  // UX: swipe-back / back siempre regresa a Inicio.
  useGoHomeOnBack(true, "/(drawer)/(tabs)");

  const { role, isReady, refreshRole } = useRole();
  const roleUp = normalizeUpper(role) as Role;
  const isAdmin = isReady && roleUp === "ADMIN";

  // filtros
  const [producto, setProducto] = useState<ProductoPick | null>(null);
  const [desde, setDesde] = useState<Date>(() => {
    const now = new Date();
    const d = new Date(now);
    d.setDate(d.getDate() - 90);
    return startOfDay(d);
  });
  const [hasta, setHasta] = useState<Date>(() => endOfDay(new Date()));

  // pickers iOS
  const [showDesdeIOS, setShowDesdeIOS] = useState(false);
  const [showHastaIOS, setShowHastaIOS] = useState(false);

  // modal productos
  const [prodModalOpen, setProdModalOpen] = useState(false);
  const [prodQ, setProdQ] = useState("");
  const dProdQ = useDebouncedValue(prodQ.trim(), 250);
  const [soloActivos, setSoloActivos] = useState(true);
  const [prodLoading, setProdLoading] = useState(false);
  const [prodRows, setProdRows] = useState<ProductoPick[]>([]);
  const [prodError, setProdError] = useState<string | null>(null);
  const prodReqSeq = useRef(0);

  // resultados
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<KardexRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busquedaEjecutada, setBusquedaEjecutada] = useState(false);
  const viewRows = useMemo(() => normalizeKardexRows(rows), [rows]);
  const [totalesLoading, setTotalesLoading] = useState(false);
  const [totalesError, setTotalesError] = useState<string | null>(null);
  const [totalesSimple, setTotalesSimple] = useState<TotalesSimple | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refreshRole("focus:kardex");
    }, [refreshRole])
  );

  // Limpia la búsqueda al salir de la pantalla (resultados + estados UI de búsqueda/modales)
  useFocusEffect(
    useCallback(() => {
      return () => {
        // filtros
        setProducto(null);

        // resultados
        setRows([]);
        setErrorMsg(null);
        setLoading(false);

        // UI/inputs de búsqueda
        setProdModalOpen(false);
        setProdQ("");
        setProdRows([]);
        setProdError(null);
        setProdLoading(false);
        prodReqSeq.current += 1; // invalida requests en vuelo

        setTotalesSimple(null);
        setTotalesError(null);
        setTotalesLoading(false);

        // pickers iOS
        setShowDesdeIOS(false);
        setShowHastaIOS(false);
      };
    }, [])
  );


  const fetchProductos = useCallback(async () => {
    const seq = ++prodReqSeq.current;
    setProdLoading(true);
    setProdError(null);
    try {
      let req = supabase
        // Usamos la vista que ya se usa en Reportes (y suele tener permisos/RLS correctos)
        .from("vw_inventario_productos_v2")
        .select("id,nombre,activo,marca")
        .order("nombre", { ascending: true })
        .limit(250);

      if (soloActivos) req = req.eq("activo", true);
      if (dProdQ) {
        // intenta por nombre o marca
        const q = dProdQ.replace(/,/g, " ").trim();
        if (q) req = req.or(`nombre.ilike.%${q}%,marca.ilike.%${q}%`);
      }

      const { data, error } = await req;
      if (seq !== prodReqSeq.current) return;
      if (error) throw error;

      const list = (data ?? []).map((r: any) => {
        const marca = String(r?.marca ?? "").trim() || null;
        return {
          id: Number(r?.id ?? 0),
          nombre: String(r?.nombre ?? ""),
          activo: !!r?.activo,
          marca: marca ? String(marca) : null,
        } satisfies ProductoPick;
      });

      setProdRows(list.filter((x) => Number.isFinite(x.id) && x.id > 0 && !!x.nombre));
    } catch (e: any) {
      if (seq !== prodReqSeq.current) return;
      setProdRows([]);
      setProdError(e?.message ?? "No se pudieron cargar productos");
    } finally {
      if (seq === prodReqSeq.current) setProdLoading(false);
    }
  }, [dProdQ, soloActivos]);

  useEffect(() => {
    if (!prodModalOpen) return;
    fetchProductos();
  }, [fetchProductos, prodModalOpen]);

  const fetchTotalesSimple = useCallback(async () => {
    const productoId = producto?.id;
    if (!productoId) {
      setTotalesSimple(null);
      setTotalesError(null);
      setTotalesLoading(false);
      return;
    }

    setTotalesLoading(true);
    setTotalesError(null);
    try {
      const { data, error } = await supabase.rpc("rpc_inventario_totales_simple_v2", {
        p_producto_id: productoId,
      });
      if (error) throw error;

      const row = Array.isArray(data) ? (data?.[0] as any) : (data as any);
      const toInt = (v: any) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.trunc(n) : 0;
      };

      setTotalesSimple({
        entradas: toInt(row?.entradas),
        salidas: toInt(row?.salidas),
        reservado: toInt(row?.reservado),
        saldo: toInt(row?.saldo),
      });
    } catch (e: any) {
      setTotalesSimple(null);
      setTotalesError(e?.message ?? "No se pudieron cargar totales");
    } finally {
      setTotalesLoading(false);
    }
  }, [producto?.id]);

  useEffect(() => {
    void fetchTotalesSimple();
  }, [fetchTotalesSimple]);

  useFocusEffect(
    useCallback(() => {
      if (!producto?.id) return;
      void fetchTotalesSimple();
    }, [fetchTotalesSimple, producto?.id])
  );

  const openDesdePicker = () => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: desde ?? new Date(),
        mode: "date",
        onChange: (_ev, date) => {
          if (date) setDesde(startOfDay(date));
        },
      });
    } else {
      setShowDesdeIOS(true);
      setShowHastaIOS(false);
    }
  };

  const openHastaPicker = () => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: hasta ?? new Date(),
        mode: "date",
        onChange: (_ev, date) => {
          if (date) setHasta(endOfDay(date));
        },
      });
    } else {
      setShowHastaIOS(true);
      setShowDesdeIOS(false);
    }
  };

  const canSearch = isAdmin && !!producto && !!desde && !!hasta;

  const onBuscar = useCallback(async () => {
    if (!canSearch || !producto) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const p_desde = startOfDay(desde).toISOString();
      const p_hasta = endOfDay(hasta).toISOString();

      const { data, error } = await supabase.rpc("rpc_kardex_producto_detallado", {
        p_producto_id: producto.id,
        p_desde,
        p_hasta,
      });
      if (error) throw error;

      const safeNum = (v: any) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };

      const normalizeTipo = (v: any): KardexRow["tipo"] => {
        const t = String(v ?? "").trim().toUpperCase();
        if (
          t === "COMPRA" ||
          t === "VENTA" ||
          t === "DEVOLUCION" ||
          t === "RESERVA" ||
          t === "LIBERACION"
        )
          return t;
        // fallback seguro para no reventar la UI
        return "VENTA";
      };

      const list = ((data ?? []) as any[])
        .map((r: any) => {
          const fecha = String(r?.fecha ?? "");
          const tipo = normalizeTipo(r?.tipo);
          const proveedor = r?.proveedor == null ? null : String(r.proveedor).trim();
          const cliente = r?.cliente == null ? null : String(r.cliente).trim();
          const estado = r?.estado == null ? null : String(r.estado).trim();
          const lote = r?.lote == null ? null : String(r.lote).trim();

          return {
            fecha,
            tipo,
            compra_id: r?.compra_id == null ? null : Number(r.compra_id),
            venta_id: r?.venta_id == null ? null : Number(r.venta_id),
            estado: estado || null,
            proveedor: proveedor || null,
            cliente: cliente || null,
            factura_numero:
              r?.factura_numero == null ? null : String(r.factura_numero).trim() || null,
            lote_id: r?.lote_id == null ? null : Number(r.lote_id),
            lote: lote || null,
            entrada: safeNum(r?.entrada ?? 0),
            salida: safeNum(r?.salida ?? 0),
            saldo: safeNum(r?.saldo ?? 0),
          } satisfies KardexRow;
        })
        .filter((x) => !!x.fecha);

      // El RPC ya viene ordenado (fecha + sort_grp + sort_id). No es necesario reordenar aquí.
      setRows(list);
    } catch (e: any) {
      setRows([]);
      setErrorMsg(e?.message ?? "No se pudo consultar el kardex");
    } finally {
      setLoading(false);
    }
    setBusquedaEjecutada(true);
  }, [canSearch, desde, hasta, producto]);

  const exportarCSV = async () => {
    try {
      if (!viewRows?.length) {
        Alert.alert("Sin datos", "No hay movimientos para exportar.");
        return;
      }

      const fmtFechaLocal = (iso: any) => {
        const raw = String(iso ?? "").trim();
        if (!raw) return "";
        const d = new Date(raw);
        if (!Number.isFinite(d.getTime())) return raw;

        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yyyy = String(d.getFullYear());
        const hh = String(d.getHours()).padStart(2, "0"); // hora LOCAL del dispositivo
        const mi = String(d.getMinutes()).padStart(2, "0"); // minutos LOCAL del dispositivo

        return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
      };

      const tipoParaCSV = (tipo: KardexRow["tipo"] | null | undefined) => {
        const normalized = String(tipo ?? "").trim().toUpperCase();
        if (!normalized) return "";
        return normalized === "RESERVA" ? "VENTA" : normalized;
      };

      const slug = (value: string | null | undefined) => {
        const base = String(value ?? "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        return base
          .replace(/\s+/g, "-")
          .replace(/[^A-Za-z0-9-]/g, "")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "")
          .toLowerCase();
      };

      const headers = [
        "Fecha",
        "Tipo",
        "Compra ID",
        "Venta ID",
        "Estado",
        "Proveedor",
        "Cliente",
        "Lote",
        "Entrada",
        "Salida",
        "Saldo",
        "Factura",
      ];

      const lines = viewRows.map((r) => [
        fmtFechaLocal(r.fecha),
        tipoParaCSV(r.tipo),
        r.compra_id ?? "",
        r.venta_id ?? "",
        r.estado ?? "",
        r.proveedor ?? "",
        r.cliente ?? "",
        r.lote ?? "",
        r.entrada ?? 0,
        r.salida ?? 0,
        r.saldo ?? 0,
        r.factura_numero ?? "",
      ]);

      const csvBody = [headers, ...lines]
        .map((row) =>
          row
            .map((field) => `"${String(field ?? "").replace(/"/g, '""')}"`)
            .join(",")
        )
        .join("\r\n");
      const csvContent = "\ufeff" + csvBody;

      const prod = producto?.nombre ?? "producto";
      const marca = producto?.marca ?? "";
      const base = marca ? `${slug(prod)}-${slug(marca)}` : slug(prod);
      const fileName = `kardex-${base || "producto"}-${fmtYmd(desde)}-a-${fmtYmd(hasta)}.csv`;

      const fileUri = (FileSystem.cacheDirectory ?? FileSystem.documentDirectory) + fileName;

      await FileSystem.writeAsStringAsync(fileUri, csvContent, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      await Share.share({
        url: fileUri,
      });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo exportar el CSV");
    }
  };

  const productoLabel = useMemo(() => {
    if (!producto) return "—";
    const marca = producto.marca ? ` • ${producto.marca}` : "";
    return `${producto.nombre}${marca}`;
  }, [producto]);

  const headerTitle = useMemo(() => {
    const prod = producto ? productoLabel : "—";
    return `Kardex • ${prod} • ${fmtYmd(desde)}-${fmtYmd(hasta)}`;
  }, [producto, productoLabel, desde, hasta]);

  const totalesEntradasValue = totalesLoading ? "Cargando..." : totalesSimple?.entradas ?? "—";
  const totalesSalidasValue = totalesLoading ? "Cargando..." : totalesSimple?.salidas ?? "—";
  const totalesReservadoValue = totalesLoading ? "Cargando..." : totalesSimple?.reservado ?? "—";
  const saldoRaw = totalesSimple?.saldo;
  const totalesSaldoValue = totalesLoading ? "Cargando..." : saldoRaw ?? "—";
  const saldoNegativo = !totalesLoading && typeof saldoRaw === "number" && saldoRaw < 0;

  const renderRow = ({ item }: { item: KardexRow }) => {
    const tipo = normalizeUpper(item?.tipo);
    const isCompra = tipo === "COMPRA";
    const isVenta = tipo === "VENTA";
    const isDev = tipo === "DEVOLUCION";
    const isReserva = tipo === "RESERVA";
    const isLiberacion = tipo === "LIBERACION";

    const entrada = Number(item?.entrada ?? 0);
    const salida = Number(item?.salida ?? 0);
    const safeEntrada = Number.isFinite(entrada) ? entrada : 0;
    const safeSalida = Number.isFinite(salida) ? salida : 0;
    const isEntrada = isCompra || isDev || isLiberacion;
    const qtyValue = Math.abs(isEntrada ? safeEntrada : safeSalida);
    const qtyText = `${isEntrada ? "+" : "-"}${qtyValue}`;

    let title = item?.cliente ?? item?.proveedor ?? "Movimiento";
    if (isCompra) title = item?.proveedor ?? "Compra";
    else if (isVenta) title = item?.cliente ?? "Venta";
    else if (isReserva) title = item?.cliente ?? "Venta";
    else if (isLiberacion) title = item?.cliente ?? "Liberación";
    else if (isDev) title = item?.cliente ?? "Devolución";

    const estado = String(item?.estado ?? "").trim();
    const estadoUpper = normalizeUpper(estado);

    const tipoLabel = isCompra
      ? "COMPRA"
      : isVenta
        ? "VENTA"
        : isDev
          ? "DEVOLUCION"
          : isReserva
            ? "VENTA"
            : isLiberacion
              ? "LIBERACION"
              : tipo || "MOV";

    const metaParts: string[] = [];
    metaParts.push(fmtFechaHora(item?.fecha));
    metaParts.push(tipoLabel);
    if (item.factura_numero) metaParts.push(`FAC ${item.factura_numero}`);
    if (isVenta && estado) metaParts.push(estado);
    if (isReserva && estado) metaParts.push(estado);
    if (isLiberacion) metaParts.push(estado || "ANULADA");
    if (isDev && estadoUpper === "ANULADA") metaParts.push("ANULADA");

    const meta = metaParts.filter(Boolean).join(" • ");

    return (
      <View style={s.card}>
        <View style={s.rowMid}>
          <Text style={s.who} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[s.qty, isEntrada ? s.qtyIn : s.qtyOut]}>{qtyText}</Text>
        </View>

        <Text style={s.meta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
    );
  };

  return (
    <>
      <Stack.Screen
  options={{
    headerShown: true,
    title: "Kardex",
  }}
/>

      <RoleGate allow={["ADMIN"]} deniedText="Solo ADMIN puede usar esta pantalla." backHref="/(drawer)/(tabs)">
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["bottom"]}>
          <FlatList
            data={viewRows}
            keyExtractor={(it, idx) =>
              `${String((it as any)?.tipo ?? "")}::${String((it as any)?.fecha ?? "")}::${String(
                (it as any)?.compra_id ?? ""
              )}::${String((it as any)?.venta_id ?? "")}::${String((it as any)?.lote_id ?? "")}::${idx}`
            }
            renderItem={renderRow}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={{
              paddingHorizontal: 12,
              paddingTop: 12,
              paddingBottom: 16 + insets.bottom,
            }}
            ListHeaderComponent={
              <>
                <View style={s.filtersCard}>
                  <Text style={s.label}>Producto</Text>
                  <Pressable
                    onPress={() => {
                      setProdModalOpen(true);
                      setProdQ("");
                      setShowDesdeIOS(false);
                      setShowHastaIOS(false);
                    }}
                    style={({ pressed }) => [s.selectBox, pressed && Platform.OS === "ios" ? { opacity: 0.9 } : null]}
                  >
                    <Text style={s.selectTxt} numberOfLines={1}>
                      {producto ? productoLabel : "Seleccionar producto"}
                    </Text>
                    <Text style={s.caret}>▼</Text>
                  </Pressable>

                  <View style={{ height: 8 }} />

                  <View style={s.twoCols}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.label}>Desde</Text>
                      <Pressable
                        onPress={openDesdePicker}
                        style={({ pressed }) => [s.dateBox, pressed && Platform.OS === "ios" ? { opacity: 0.9 } : null]}
                      >
                        <Text style={s.dateTxt}>{fmtYmd(desde)}</Text>
                      </Pressable>
                    </View>

                    <View style={{ width: 12 }} />

                    <View style={{ flex: 1 }}>
                      <Text style={s.label}>Hasta</Text>
                      <Pressable
                        onPress={openHastaPicker}
                        style={({ pressed }) => [s.dateBox, pressed && Platform.OS === "ios" ? { opacity: 0.9 } : null]}
                      >
                        <Text style={s.dateTxt}>{fmtYmd(hasta)}</Text>
                      </Pressable>
                    </View>
                  </View>

                  {Platform.OS === "ios" && showDesdeIOS ? (
                    <View style={[s.iosPickerWrap, { borderColor: colors.border }]}>
                      <DateTimePicker
                        value={desde ?? new Date()}
                        mode="date"
                        display="inline"
                        themeVariant={isDark ? "dark" : "light"}
                        onChange={(_ev, date) => {
                          if (date) {
                            setDesde(startOfDay(date));
                            setShowDesdeIOS(false);
                          }
                        }}
                      />
                    </View>
                  ) : null}

                  {Platform.OS === "ios" && showHastaIOS ? (
                    <View style={[s.iosPickerWrap, { borderColor: colors.border }]}>
                      <DateTimePicker
                        value={hasta ?? new Date()}
                        mode="date"
                        display="inline"
                        themeVariant={isDark ? "dark" : "light"}
                        onChange={(_ev, date) => {
                          if (date) {
                            setHasta(endOfDay(date));
                            setShowHastaIOS(false);
                          }
                        }}
                      />
                    </View>
                  ) : null}

                  <View style={{ height: 10 }} />

                  <AppButton
                    title={loading ? "Buscando..." : "Buscar"}
                    variant="primary"
                    size="sm"
                    onPress={onBuscar}
                    disabled={!canSearch}
                    loading={loading}
                  />

                  {busquedaEjecutada && viewRows?.length > 0 ? (
                    <View style={{ marginTop: 10 }}>
                      <AppButton title="Exportar CSV" variant="outline" onPress={exportarCSV} />
                    </View>
                  ) : null}

                  {errorMsg ? <Text style={[s.sub, { marginTop: 10 }]}>{errorMsg}</Text> : null}
                </View>

                <View style={s.totalsCard}>
                  <Text style={s.totalsTitle}>Totales</Text>
                  <View style={s.totalsRow}>
                    <Text style={s.totalsK}>Entradas</Text>
                    <Text style={[s.totalsV, s.qtyIn]}>{totalesEntradasValue}</Text>
                  </View>
                  <View style={s.totalsRow}>
                    <Text style={s.totalsK}>Salidas</Text>
                    <Text style={[s.totalsV, s.qtyOut]}>{totalesSalidasValue}</Text>
                  </View>
                  <View style={s.totalsRow}>
                    <Text style={s.totalsK}>Reservado</Text>
                    <Text style={[s.totalsV, s.qtyOut]}>{totalesReservadoValue}</Text>
                  </View>
                  <View style={[s.totalsRow, { marginTop: 6 }]}>
                    <Text style={s.totalsK}>Saldo (disponible)</Text>
                    <Text style={[s.totalsV, saldoNegativo ? s.qtyOut : null]}>{totalesSaldoValue}</Text>
                  </View>
                  {totalesError ? <Text style={s.sub}>{totalesError}</Text> : null}
                </View>

                {loading ? (
                  <View style={{ paddingVertical: 10 }}>
                    <Text style={s.empty}>Cargando...</Text>
                  </View>
                ) : null}
              </>
            }
            ListEmptyComponent={!loading ? <Text style={s.empty}>Sin movimientos en ese rango</Text> : null}
          />

          {prodModalOpen ? (
            <Modal
              visible={prodModalOpen}
              transparent
              animationType="fade"
              onRequestClose={() => setProdModalOpen(false)}
            >
              <Pressable
                style={[s.modalBackdrop, { backgroundColor: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)" }]}
                onPress={() => setProdModalOpen(false)}
              />

              <View style={s.modalCard}>
                <View style={s.modalHeader}>
                  <Text style={s.modalTitle}>Seleccionar producto</Text>
                  <Pressable onPress={() => setProdModalOpen(false)} hitSlop={10}>
                    <Text style={s.modalClose}>Cerrar</Text>
                  </Pressable>
                </View>

                <View style={s.searchWrap}>
                  <TextInput
                    value={prodQ}
                    onChangeText={setProdQ}
                    placeholder="Buscar por nombre..."
                    placeholderTextColor={colors.text + "66"}
                    style={s.searchInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                  {prodQ.trim().length > 0 ? (
                    <Pressable onPress={() => setProdQ("")} hitSlop={10} style={s.clearBtn}>
                      <Text style={s.clearTxt}>×</Text>
                    </Pressable>
                  ) : null}
                </View>

                <View style={s.switchRow}>
                  <Text style={s.switchLabel}>Solo activos</Text>
                  <Switch
                    value={soloActivos}
                    onValueChange={setSoloActivos}
                    trackColor={{ false: colors.border, true: "#34C759" }}
                    thumbColor={Platform.OS === "android" ? "#FFFFFF" : undefined}
                    style={Platform.OS === "android" ? { transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] } : undefined}
                  />
                </View>

                <FlatList
                  data={prodRows}
                  keyExtractor={(it) => String(it.id)}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                      <Pressable
                        onPress={() => {
                          setProducto(item);
                          setProdModalOpen(false);
                          // opcional: al elegir producto, limpia resultados anteriores para evitar confusión
                          setRows([]);
                          setErrorMsg(null);
                          setTotalesSimple(null);
                          setTotalesError(null);
                        }}
                      style={({ pressed }) => [s.prodRow, pressed && Platform.OS === "ios" ? { opacity: 0.9 } : null]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.prodTitle} numberOfLines={1}>
                          {item.nombre}
                          {item.marca ? ` • ${item.marca}` : ""}
                        </Text>
                        {!item.activo ? <Text style={s.prodSub}>INACTIVO</Text> : null}
                      </View>
                    </Pressable>
                  )}
                  ListEmptyComponent={
                    prodLoading ? (
                      <View style={{ paddingVertical: 14 }}>
                        <Text style={s.empty}>Buscando...</Text>
                      </View>
                    ) : prodError ? (
                      <View style={{ paddingVertical: 14 }}>
                        <Text style={s.empty}>{prodError}</Text>
                      </View>
                    ) : (
                      <View style={{ paddingVertical: 14 }}>
                        <Text style={s.empty}>Sin resultados</Text>
                      </View>
                    )
                  }
                  style={{ marginTop: 10 }}
                />
              </View>
            </Modal>
          ) : null}
        </SafeAreaView>
      </RoleGate>
    </>
  );
}

const styles = (colors: any, isDark: boolean) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
    deniedTitle: { color: colors.text, fontSize: 20, fontWeight: "900" },
    deniedSub: { color: colors.text + "AA", marginTop: 10, textAlign: "center", fontWeight: "700" },

    label: { color: colors.text, marginTop: 8, fontSize: 13, fontWeight: "800" },
    sub: { color: colors.text + "AA", marginTop: 6, fontSize: 12, fontWeight: "700" },

    filtersCard: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 10,
      marginBottom: 8,
    },

    selectBox: {
      marginTop: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    selectTxt: { color: colors.text, fontSize: 15, fontWeight: "800", flex: 1 },
    caret: { color: colors.text + "88", fontSize: 12, fontWeight: "900" },

    twoCols: { flexDirection: "row", marginTop: 6 },
    dateBox: {
      marginTop: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    dateTxt: { color: colors.text, fontSize: 15, fontWeight: "800" },
    iosPickerWrap: { marginTop: 10, borderWidth: 1, borderRadius: 12, overflow: "hidden" },

    totalsCard: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 12,
      marginBottom: 10,
    },
    totalsTitle: { color: colors.text, fontWeight: "900", marginBottom: 8 },
    totalsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
    totalsK: { color: colors.text + "AA", fontWeight: "800" },
    totalsV: { color: colors.text, fontWeight: "900", fontSize: 16 },

    empty: { color: colors.text + "AA", fontWeight: "800", textAlign: "center", paddingVertical: 12 },

    card: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 10,
      marginBottom: 8,
    },

    rowMid: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    who: { color: colors.text, fontSize: 15, fontWeight: "900", flex: 1 },
    qty: { fontSize: 15, fontWeight: "900" },
    qtyIn: { color: isDark ? "#34D399" : "#0a7a3b" },
    qtyOut: { color: isDark ? "#FB7185" : "#7a0a0a" },
    meta: { color: colors.text + "AA", fontSize: 11, fontWeight: "800", marginTop: 4 },

    // modal
    modalBackdrop: { ...StyleSheet.absoluteFillObject },
    modalCard: {
      position: "absolute",
      left: 14,
      right: 14,
      top: 90,
      bottom: 80,
      borderRadius: 18,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    modalTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
    modalClose: { color: colors.text + "AA", fontSize: 14, fontWeight: "800" },

    searchWrap: {
      marginTop: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      borderRadius: 12,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
    },
    searchInput: { flex: 1, color: colors.text, paddingVertical: 10, fontSize: 16 },
    clearBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
    clearTxt: {
      color: colors.text + "88",
      fontSize: 22,
      fontWeight: "900",
      lineHeight: 22,
      marginTop: -1,
    },

    switchRow: {
      marginTop: 12,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === "android" ? 8 : 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      borderRadius: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    switchLabel: { color: colors.text, fontWeight: "800" },

    prodRow: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      marginBottom: 8,
    },
    prodTitle: { color: colors.text, fontWeight: "900" },
    prodSub: { color: colors.text + "AA", fontSize: 12, fontWeight: "900", marginTop: 6 },
  });
