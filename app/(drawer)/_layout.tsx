import { useColorScheme } from "@/hooks/use-color-scheme";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  DrawerContentScrollView
} from "@react-navigation/drawer";
import { Drawer } from "expo-router/drawer";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { DrawerActions, getFocusedRouteNameFromRoute } from "@react-navigation/native";
import { router, useNavigation, usePathname } from "expo-router";
import {
  beginPushLogoutGuard,
  disablePushForThisDevice,
  endPushLogoutGuard,
} from "../../lib/pushNotifications";
import { onSolicitudesChanged } from "../../lib/solicitudesEvents";
import { supabase } from "../../lib/supabase";
import { useThemePref } from "../../lib/themePreference";
import { alphaColor } from "../../lib/ui";
import { useRole } from "../../lib/useRole";
import {
  FB_DARK_BORDER,
  FB_DARK_DANGER,
  FB_DARK_MUTED,
  getDrawerColors,
  getHeaderColors,
} from "../../src/theme/headerColors";

export default function DrawerLayout() {
  // puedes dejarlo si lo usas en otro lado; el drawer se pinta con resolved
  useColorScheme();

  const { mode, setMode } = useThemePref();
  const pathname = usePathname();
  const navigation = useNavigation();
  const isDark = mode === "dark";

  const isWeb = Platform.OS === "web";
  const isIOS = Platform.OS === "ios";
  const WEB_DRAWER_WIDTH = 300;

  // Close the overlay drawer when navigating via custom items.
  // This prevents returning to Tabs with the drawer still open.
  const drawerNavRef = useRef<any>(null);
  const didMountRef = useRef(false);

  // Fix para iOS: forzar drawer cerrado al montar
  useEffect(() => {
    if (Platform.OS === "ios") {
      // Pequeno delay para asegurar que el drawer esta montado
      const timer = setTimeout(() => {
        try {
          const parent = (navigation as any)?.getParent?.();
          const parentType = parent?.getState?.()?.type;
          if (parentType === "drawer") {
            parent.dispatch(DrawerActions.closeDrawer());
          }
        } catch {
          // ignore
        }
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [navigation]);

  const [userName, setUserName] = useState<string>("");
  const { role, isAdmin, refreshRole } = useRole();
  const [solicitudesCount, setSolicitudesCount] = useState<number>(0);

  const header = getHeaderColors(isDark);
  const drawer = getDrawerColors(isDark);

  const drawerBg = drawer.bg;
  const drawerText = drawer.fg;

  const drawerActiveTint = isDark ? drawerText : header.bg;
  const drawerMuted =
    isDark ? FB_DARK_MUTED : (alphaColor(drawerText, 0.62) as any);
  const drawerBorder =
    isDark ? FB_DARK_BORDER : (alphaColor(drawerText, 0.10) as any);
  const drawerActiveBg =
    isDark ? FB_DARK_BORDER : (alphaColor(header.bg, 0.10) as any);
  const sectionLabelColor =
    isDark ? drawerMuted : (alphaColor(header.bg, 0.70) as any);

  const switchTrackOn =
    Platform.OS === "android"
      ? (isDark ? (alphaColor(drawerText, 0.32) as any) : (alphaColor(header.bg, 0.35) as any))
      : undefined;
  const switchTrackOff =
    Platform.OS === "android" ? (alphaColor(drawerText, isDark ? 0.16 : 0.14) as any) : undefined;
  const switchThumbOn =
    Platform.OS === "android" ? ((isDark ? drawerText : header.bg) as any) : undefined;
  const switchThumbOff =
    Platform.OS === "android" ? (alphaColor(drawerText, 0.82) as any) : undefined;

  const isTabsRoute = pathname === "/" || pathname === "/ventas" || pathname === "/inventario";
  const isFacturacion = role === "FACTURACION";
  const isFactMainRoute = pathname === "/" || pathname === "/ventas";
  const isComprasRoute = pathname === "/compras" || pathname.startsWith("/compras/");
  const isClientesRoute = pathname.startsWith("/cliente");
  const isSolicitudesRoute = pathname === "/ventas-solicitudes" || pathname.startsWith("/ventas-solicitudes");
  const isAnuladasRoute = pathname === "/ventas-anuladas" || pathname.startsWith("/ventas-anuladas");
  const isRecetasRoute = pathname === "/recetas-pendientes" || pathname.startsWith("/recetas-pendientes");
  const isComisionesRoute = pathname === "/comisiones" || pathname.startsWith("/comisiones");
  const isKardexRoute = pathname === "/kardex" || pathname.startsWith("/kardex");

  useEffect(() => {
    let alive = true;

    const guessNameFromEmail = (email: string | null | undefined) => {
      const e = (email ?? "").trim();
      if (!e) return "";
      return e.split("@")[0] ?? "";
    };

    const pickNameFromProfile = (p: any) => {
      const raw =
        p?.full_name ??
        p?.nombre ??
        p?.name ??
        p?.display_name ??
        p?.username ??
        "";
      return String(raw ?? "").trim();
    };

    const pickNameFromUser = (u: any) => {
      const raw =
        u?.user_metadata?.nombre ??
        u?.user_metadata?.name ??
        u?.user_metadata?.full_name ??
        u?.user_metadata?.display_name ??
        "";
      const fromMeta = String(raw ?? "").trim();
      return fromMeta || guessNameFromEmail(u?.email);
    };

    const load = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const u = data?.session?.user;
        const uid = u?.id;
        if (!uid) {
          if (alive) setUserName("");
          return;
        }

        // Preferir nombre de profiles si existe
        const { data: prof } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", uid)
          .maybeSingle();
        const n = pickNameFromProfile(prof) || pickNameFromUser(u);
        if (alive) setUserName(n);

        // Ensure role refresh when drawer mounts (non-blocking)
        void refreshRole();
      } catch {
        if (!alive) return;
        try {
          const { data } = await supabase.auth.getSession();
          setUserName(pickNameFromUser(data?.session?.user));
          // role is managed centrally; never wipe it here.
          if (data?.session?.user?.id) void refreshRole();
        } catch {
          setUserName("");
        }
      }
    };

    load().catch(() => {});

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (__DEV__) console.log("[drawer] auth", { event });
      load().catch(() => {});
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, [refreshRole]);

  // Mostrar "Solicitudes" solo a administradores.
  // Antes se mostraba también a VENTAS; cambiar para que solo ADMIN lo vea.
  const showSolicitudes = role === "ADMIN";
  const showAnuladas = role === "ADMIN" || role === "BODEGA" || role === "FACTURACION" || role === "VENTAS";
  const showCuentasPorCobrar = role === "ADMIN" || role === "VENTAS";
  const showComisiones = role === "ADMIN" || role === "VENTAS";

  useEffect(() => {
    let alive = true;
    let timer: any = null;

    const loadCount = async () => {
      if (!showSolicitudes) {
        if (alive) setSolicitudesCount(0);
        return;
      }

      try {
        const { count, error } = await supabase
          .from("vw_ventas_solicitudes_pendientes_admin")
          .select("venta_id", { head: true, count: "exact" });
        if (error) throw error;
        if (alive) setSolicitudesCount(Number(count ?? 0));
      } catch {
        if (alive) setSolicitudesCount(0);
      }
    };

    loadCount().catch(() => {});

    const unsub = onSolicitudesChanged(() => {
      loadCount().catch(() => {});
    });

    // refresco liviano para que el badge no se quede stale
    timer = setInterval(() => {
      loadCount().catch(() => {});
    }, 30000);

    return () => {
      alive = false;
      unsub();
      if (timer) clearInterval(timer);
    };
  }, [showSolicitudes, pathname]);

  useEffect(() => {
    if (isWeb) return;

    // Avoid calling closeDrawer on the very first mount after login.
    // On iOS this can leave the drawer backdrop in a bad state where it becomes
    // invisible but still intercepts touches near the bottom until a subsequent navigation.
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    try {
      const st = drawerNavRef.current?.getState?.();
      const hist = (st as any)?.history;
      const lastDrawerHist = Array.isArray(hist) ? [...hist].reverse().find((h: any) => h?.type === "drawer") : null;
      const isOpen = lastDrawerHist?.status === "open";
      if (!isOpen) return;

      drawerNavRef.current?.closeDrawer?.();
    } catch {
      // ignore
    }
  }, [isWeb, pathname]);

  const headerSub = useMemo(() => {
    const n = (userName ?? "").trim();
    if (!n) return "Hola";
    const first = n.split(/\s+/)[0] ?? n;
    
  }, [userName]);

  const handleLogout = async () => {
    beginPushLogoutGuard();
    try {
      try {
        // Must complete before signOut to keep RLS/auth valid.
        await disablePushForThisDevice();
      } catch {
        // never block logout
      }

      await supabase.auth.signOut();
      router.replace("/login");
    } catch {
      // ignore logout errors for now
    } finally {
      endPushLogoutGuard();
    }
  };

  return (
    <>
      <StatusBar style="light" />
        <Drawer
         detachInactiveScreens={false}
        screenOptions={({ navigation: drawerNavigation }) => {
          const showBack = !isTabsRoute;
          const homePath = isFacturacion ? "/ventas" : "/";

          return {
            headerShown: true,
            headerTitle: undefined,
            headerStyle: { backgroundColor: header.bg },
            headerTitleStyle: {
              color: header.fg,
              fontWeight: Platform.OS === "ios" ? "600" : "500",
            },
            headerTintColor: header.fg,
            headerLeft: () => {
              if (!showBack && isWeb) return null;

              return (
                <Pressable
                  onPress={() => {
                    if (showBack) {
                      router.replace(homePath as any);
                      return;
                    }
                    try {
                      (drawerNavigation as any)?.openDrawer?.();
                    } catch {
                      // ignore
                    }
                  }}
                  hitSlop={12}
                  style={({ pressed }) => [
                    {
                      marginLeft: 10,
                      padding: 8,
                      borderRadius: 999,
                    },
                    pressed && { opacity: 0.85 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={showBack ? "Volver al inicio" : "Abrir menu"}
                >
                  <Ionicons
                    name={showBack ? "arrow-back" : "menu"}
                    size={22}
                    color={header.fg}
                  />
                </Pressable>
              );
            },

            // WEB only: permanent sidebar drawer (no overlay)
            ...(isWeb
              ? {
                  drawerType: "permanent" as const,
                  swipeEnabled: false,
                  overlayColor: "transparent",
                  drawerStyle: { backgroundColor: drawerBg, width: WEB_DRAWER_WIDTH },
                  sceneContainerStyle: {
                    maxWidth: 1400,
                    paddingHorizontal: 24,
                    marginLeft: "auto",
                    marginRight: "auto",
                  },
                }
              : {
                  ...(isIOS
                    ? {
                        drawerType: "front" as const,
                        swipeEdgeWidth: 50,
                        overlayColor: "rgba(0,0,0,0.5)",
                      }
                    : {}),
                  drawerStyle: { backgroundColor: drawerBg },
                }),

            drawerActiveTintColor: drawerActiveTint,
            drawerInactiveTintColor: drawerMuted,
            drawerActiveBackgroundColor: drawerActiveBg,
            drawerLabelStyle: {
              fontSize: 16,
              fontWeight: Platform.OS === "ios" ? "500" : "400",
            },
          };
        }}
        drawerContent={(props) => (
          (() => {
            drawerNavRef.current = props.navigation;

            const closeDrawer = () => {
              if (isWeb) return;
              try {
                (props.navigation as any)?.closeDrawer?.();
              } catch {
                // ignore
              }
            };

            return (
          <DrawerContentScrollView
            {...props}
            contentContainerStyle={{ paddingBottom: 24, flexGrow: 1, justifyContent: "space-between", minHeight: "100%" }}
          >
            <View>
            <View style={[styles.drawerHeader, { backgroundColor: drawerBg, borderBottomColor: drawerBorder }]}>
              <View
                style={[
                  styles.brandMark,
                  {
                    backgroundColor: isDark ? drawerActiveBg : (alphaColor(header.bg, 0.10) as any),
                    borderColor: isDark ? drawerBorder : (alphaColor(header.bg, 0.22) as any),
                  },
                ]}
              >
                <MaterialCommunityIcons name="needle" size={26} color={drawerActiveTint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.drawerHeaderText, { color: drawerText }]}>Bros Pharma</Text>
                <Text style={[styles.drawerHeaderSub, { color: drawerMuted }]} numberOfLines={1}>
                  {headerSub}
                </Text>
              </View>
            </View>
            {/* Custom Drawer Items with Icons (Option A) */}
            <View style={styles.menuList}>
              <Text style={[styles.sectionLabel, { color: sectionLabelColor }]}>Navegacion</Text>

              {isFacturacion ? (
                <Pressable
                  onPress={() => {
                    closeDrawer();
                    props.navigation.navigate("(tabs)", { screen: "ventas" });
                  }}
                  style={({ pressed }) => [
                    styles.menuItem,
                    { backgroundColor: isFactMainRoute ? drawerActiveBg : "transparent" },
                    pressed && { opacity: 0.85 },
                  ]}
                  accessibilityRole="button"
                >
                  <Ionicons name="cart-outline" size={22} color={isFactMainRoute ? drawerActiveTint : drawerMuted} />
                  <Text style={[styles.menuLabel, { color: isFactMainRoute ? drawerActiveTint : drawerMuted }]}>Ventas</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => {
                    closeDrawer();
                    props.navigation.navigate("(tabs)", { screen: "index" });
                  }}
                  style={({ pressed }) => [
                    styles.menuItem,
                    { backgroundColor: isTabsRoute ? drawerActiveBg : "transparent" },
                    pressed && { opacity: 0.85 },
                  ]}
                  accessibilityRole="button"
                >
                  <Ionicons name="home-outline" size={22} color={isTabsRoute ? drawerActiveTint : drawerMuted} />
                  <Text style={[styles.menuLabel, { color: isTabsRoute ? drawerActiveTint : drawerMuted }]}>Inicio</Text>
                </Pressable>
              )}

               {!isAdmin ? null : (
                 <Pressable
                  onPress={() => {
                    closeDrawer();
                    router.push("/compras");
                  }}
                    style={({ pressed }) => [
                      styles.menuItem,
                      { backgroundColor: isComprasRoute ? drawerActiveBg : "transparent" },
                      pressed && { opacity: 0.85 },
                    ]}
                    accessibilityRole="button"
                  >
                     <Ionicons name="cart-outline" size={22} color={isComprasRoute ? drawerActiveTint : drawerMuted} />
                     <Text style={[styles.menuLabel, { color: isComprasRoute ? drawerActiveTint : drawerMuted }]}>Compras</Text>
                  </Pressable>
                )}

              <Pressable
                onPress={() => {
                  closeDrawer();
                  router.push("/clientes" as any);
                }}
                style={({ pressed }) => [
                  styles.menuItem,
                  { backgroundColor: isClientesRoute ? drawerActiveBg : "transparent" },
                  pressed && { opacity: 0.85 },
                ]}
                accessibilityRole="button"
              >
                <Ionicons name="people-outline" size={22} color={isClientesRoute ? drawerActiveTint : drawerMuted} />
                <Text style={[styles.menuLabel, { color: isClientesRoute ? drawerActiveTint : drawerMuted }]}>Clientes</Text>
              </Pressable>

              {!showSolicitudes ? null : (
                <Pressable
                  onPress={() => {
                    closeDrawer();
                    router.push("/ventas-solicitudes" as any);
                  }}
                    style={({ pressed }) => [
                      styles.menuItem,
                      { backgroundColor: isSolicitudesRoute ? drawerActiveBg : "transparent" },
                      pressed && { opacity: 0.85 },
                    ]}
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name="alert-circle-outline"
                      size={22}
                      color={isSolicitudesRoute ? drawerActiveTint : drawerMuted}
                    />
                    <Text
                      style={[styles.menuLabel, { color: isSolicitudesRoute ? drawerActiveTint : drawerMuted, flexShrink: 1 }]}
                      numberOfLines={1}
                    >
                      Solicitudes
                    </Text>
                  <View style={{ flex: 1 }} />
                  {solicitudesCount > 0 ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText} numberOfLines={1}>
                        {solicitudesCount > 99 ? "99+" : String(solicitudesCount)}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              )}

                {!showAnuladas ? null : (
                 <Pressable
                  onPress={() => {
                    closeDrawer();
                    router.push("/ventas-anuladas" as any);
                  }}
                   style={({ pressed }) => [
                     styles.menuItem,
                     { backgroundColor: isAnuladasRoute ? drawerActiveBg : "transparent" },
                     pressed && { opacity: 0.85 },
                   ]}
                   accessibilityRole="button"
                  >
                   <Ionicons name="ban-outline" size={22} color={isAnuladasRoute ? drawerActiveTint : drawerMuted} />
                   <Text style={[styles.menuLabel, { color: isAnuladasRoute ? drawerActiveTint : drawerMuted }]}>Anuladas</Text>
                  </Pressable>
               )}

                {!showCuentasPorCobrar ? null : (
                  <Pressable
                    onPress={() => {
                      closeDrawer();
                      router.push("/cxc" as any);
                    }}
                    style={({ pressed }) => [
                      styles.menuItem,
                      { backgroundColor: pathname === "/cxc" ? drawerActiveBg : "transparent" },
                      pressed && { opacity: 0.85 },
                    ]}
                   accessibilityRole="button"
                 >
                   <Ionicons name="receipt-outline" size={22} color={pathname === "/cxc" ? drawerActiveTint : drawerMuted} />
                   <Text style={[styles.menuLabel, { color: pathname === "/cxc" ? drawerActiveTint : drawerMuted }]}>Cuentas por cobrar</Text>
                 </Pressable>
               )}

                {!showComisiones ? null : (
                   <Pressable
                     onPress={() => {
                       closeDrawer();
                       router.push("/comisiones" as any);
                     }}
                     style={({ pressed }) => [
                       styles.menuItem,
                       { backgroundColor: isComisionesRoute ? drawerActiveBg : "transparent" },
                       pressed && { opacity: 0.85 },
                     ]}
                    accessibilityRole="button"
                  >
                    <Ionicons name="cash-outline" size={22} color={isComisionesRoute ? drawerActiveTint : drawerMuted} />
                    <Text style={[styles.menuLabel, { color: isComisionesRoute ? drawerActiveTint : drawerMuted }]}>Comisiones</Text>
                  </Pressable>
                )}

                {role === "ADMIN" ? (
                  <Pressable
                    onPress={() => {
                      closeDrawer();
                      router.push("/kardex" as any);
                    }}
                    style={({ pressed }) => [
                      styles.menuItem,
                      { backgroundColor: isKardexRoute ? drawerActiveBg : "transparent" },
                      pressed && { opacity: 0.85 },
                    ]}
                   accessibilityRole="button"
                 >
                   <Ionicons name="list-outline" size={22} color={isKardexRoute ? drawerActiveTint : drawerMuted} />
                   <Text style={[styles.menuLabel, { color: isKardexRoute ? drawerActiveTint : drawerMuted }]}>Kardex</Text>
                 </Pressable>
               ) : null}

               {(role === "ADMIN" || role === "VENTAS") ? (
                 <Pressable
                   onPress={() => {
                     closeDrawer();
                     router.push("/recetas-pendientes" as any);
                   }}
                    style={({ pressed }) => [
                      styles.menuItem,
                      { backgroundColor: isRecetasRoute ? drawerActiveBg : "transparent" },
                      pressed && { opacity: 0.85 },
                    ]}
                   accessibilityRole="button"
                  >
                    <Ionicons name="document-text-outline" size={22} color={isRecetasRoute ? drawerActiveTint : drawerMuted} />
                    <Text style={[styles.menuLabel, { color: isRecetasRoute ? drawerActiveTint : drawerMuted }]}>Recetas pendientes</Text>
                  </Pressable>
               ) : null}
                 
           </View>

            {/* Toggle Tema */}
            <View style={[styles.themeRow, { borderTopColor: drawerBorder }]}>
              <Text style={[styles.themeLabel, { color: drawerText }]}>Tema</Text>

              <View style={styles.themeControls}>
                <Ionicons
                  name="sunny-outline"
                  size={18}
                  color={drawerMuted}
                  style={{ marginRight: 8 }}
                />

                <Switch
                  value={mode === "dark"}
                  onValueChange={(v) => setMode(v ? "dark" : "light")}
                  trackColor={Platform.OS === "android" ? { false: switchTrackOff, true: switchTrackOn } : undefined}
                  thumbColor={Platform.OS === "android" ? (mode === "dark" ? switchThumbOn : switchThumbOff) : undefined}
                />

                <Ionicons
                  name="moon-outline"
                  size={18}
                  color={drawerMuted}
                  style={{ marginLeft: 8 }}
                />
              </View>
            </View>
          </View>

          <Pressable
            onPress={handleLogout}
            style={({ pressed }) => [
              styles.logout,
              { borderTopColor: drawerBorder },
              pressed && { opacity: 0.85 },
            ]}
            accessibilityLabel="Cerrar sesión"
            accessibilityRole="button"
          >
            <Ionicons name="log-out-outline" size={18} color={FB_DARK_DANGER} style={{ marginRight: 8 }} />
            <Text style={styles.logoutText}>Cerrar sesión</Text>
           </Pressable>
           </DrawerContentScrollView>
            );
          })()
        )}
      >
      <Drawer.Screen
        name="(tabs)"
        options={({ route }: any) => {
          // Determinar el tab activo dentro de (tabs) y ajustar el título del header
          const focused = getFocusedRouteNameFromRoute(route) ?? (isFacturacion ? "ventas" : "index");
          const title = focused === "ventas" ? "Ventas" : focused === "inventario" ? "Inventario" : "Inicio";
          return {
            title,
            drawerIcon: ({ color, size }: any) => <Ionicons name="home-outline" size={size} color={color} />,
          };
        }}
      />

      <Drawer.Screen
        name="clientes"
        options={{
          title: "Clientes",
          drawerIcon: ({ color, size }: any) => <Ionicons name="people-outline" size={size} color={color} />,
        }}
      />
      </Drawer>
    </>
  );
}

const styles = StyleSheet.create({
  drawerHeader: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
  },
  brandMark: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  drawerHeaderText: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: Platform.OS === "ios" ? -0.2 : 0,
  },
  drawerHeaderSub: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: Platform.OS === "ios" ? "600" : "500",
  },
  themeRow: {
    marginTop: 8,
    paddingTop: 12,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  themeLabel: {
    fontSize: 16,
    fontWeight: Platform.OS === "ios" ? "600" : "500",
  },
  themeControls: {
    flexDirection: "row",
    alignItems: "center",
  },
  logout: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  logoutText: {
    color: FB_DARK_DANGER,
    fontWeight: "700",
  },
  // New icon-enabled menu items
  menuList: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: Platform.OS === "ios" ? "700" : "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: 10,
    marginBottom: 8,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  menuLabel: {
    fontSize: 16,
    marginLeft: 12,
    fontWeight: Platform.OS === "ios" ? "600" : "500",
  },

  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: FB_DARK_DANGER,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
    includeFontPadding: false,
  },
});
