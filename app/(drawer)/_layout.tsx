import { useColorScheme } from "@/hooks/use-color-scheme";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  DrawerContentScrollView
} from "@react-navigation/drawer";
import { Drawer } from "expo-router/drawer";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { router, usePathname } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useThemePref } from "../../lib/themePreference";
import { alphaColor } from "../../lib/ui";

const IOS_BLUE = "#007AFF";

export default function DrawerLayout() {
  // puedes dejarlo si lo usas en otro lado; el drawer se pinta con resolved
  useColorScheme();

  const { mode, setMode, resolved } = useThemePref();
  const isDark = resolved === "dark";
  const pathname = usePathname();

  const [userName, setUserName] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const background = isDark ? "#000000" : "#FFFFFF";
  const text = isDark ? "#FFFFFF" : "#000000";
  const muted = "#8E8E93";
  const border = isDark ? "#2C2C2E" : "#E5E5EA";
  const activeBg = isDark ? "#2C2C2E" : "#F2F2F7";

  const switchTrackOn = Platform.OS === "android" ? (alphaColor(IOS_BLUE, 0.35) as any) : undefined;
  const switchTrackOff =
    Platform.OS === "android" ? (alphaColor(isDark ? "#FFFFFF" : "#000000", 0.15) as any) : undefined;
  const switchThumbOn = Platform.OS === "android" ? (IOS_BLUE as any) : undefined;
  const switchThumbOff = Platform.OS === "android" ? (border as any) : undefined;

  const isTabsRoute = pathname === "/" || pathname === "/ventas" || pathname === "/inventario";
  const isComprasRoute = pathname === "/compras" || pathname.startsWith("/compras/");

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

    const normalizeUpper = (v: any) => String(v ?? "").trim().toUpperCase();

    const load = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const u = data?.user;
        const uid = u?.id;
        if (!uid) {
          if (alive) setUserName("");
          if (alive) setIsAdmin(false);
          return;
        }

        // Preferir nombre de profiles si existe
        const { data: prof } = await supabase
          .from("profiles")
          .select("full_name, role")
          .eq("id", uid)
          .maybeSingle();
        const n = pickNameFromProfile(prof) || pickNameFromUser(u);
        if (alive) setUserName(n);
        if (alive) setIsAdmin(normalizeUpper(prof?.role) === "ADMIN");
      } catch {
        if (!alive) return;
        try {
          const { data } = await supabase.auth.getUser();
          setUserName(pickNameFromUser(data?.user));
          setIsAdmin(false);
        } catch {
          setUserName("");
          setIsAdmin(false);
        }
      }
    };

    load().catch(() => {});

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      load().catch(() => {});
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  const headerSub = useMemo(() => {
    const n = (userName ?? "").trim();
    if (!n) return "Hola";
    const first = n.split(/\s+/)[0] ?? n;
    return `Hola ${first}`;
  }, [userName]);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      router.replace("/login");
    } catch {
      // ignore logout errors for now
    }
  };

  return (
    <Drawer
      screenOptions={{
        headerShown: true,
        headerTitle: undefined,
        headerStyle: { backgroundColor: background },
        headerTitleStyle: {
          color: text,
          fontWeight: Platform.OS === "ios" ? "600" : "500",
        },
        headerTintColor: IOS_BLUE,

        drawerStyle: { backgroundColor: background },
        drawerActiveTintColor: IOS_BLUE,
        drawerInactiveTintColor: muted,
        drawerActiveBackgroundColor: activeBg,
        drawerLabelStyle: {
          fontSize: 16,
          fontWeight: Platform.OS === "ios" ? "500" : "400",
        },
      }}
      drawerContent={(props) => (
        <DrawerContentScrollView
          {...props}
          contentContainerStyle={{ paddingBottom: 12, flexGrow: 1, justifyContent: "space-between", minHeight: "100%" }}
        >
          <View>
            <View style={[styles.drawerHeader, { backgroundColor: background, borderBottomColor: border }] }>
              <View style={[styles.brandMark, { backgroundColor: activeBg, borderColor: border }] }>
                <MaterialCommunityIcons name="needle" size={26} color={IOS_BLUE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.drawerHeaderText, { color: text }]}>Bros Pharma</Text>
                <Text style={[styles.drawerHeaderSub, { color: muted }]} numberOfLines={1}>
                  {headerSub}
                </Text>
              </View>
            </View>
            {/* Custom Drawer Items with Icons (Option A) */}
            <View style={styles.menuList}>
              <Text style={[styles.sectionLabel, { color: muted }]}>Navegacion</Text>

              <Pressable
                onPress={() => props.navigation.navigate("(tabs)", { screen: "index" })}
                style={({ pressed }) => [
                  styles.menuItem,
                  { backgroundColor: isTabsRoute ? activeBg : "transparent" },
                  pressed && { opacity: 0.85 },
                ]}
                accessibilityRole="button"
              >
                <Ionicons name="home-outline" size={22} color={isTabsRoute ? IOS_BLUE : muted} />
                <Text style={[styles.menuLabel, { color: isTabsRoute ? text : muted }]}>Inicio</Text>
              </Pressable>

              {!isAdmin ? null : (
                <Pressable
                  onPress={() => router.push("/compras")}
                  style={({ pressed }) => [
                    styles.menuItem,
                    { backgroundColor: isComprasRoute ? activeBg : "transparent" },
                    pressed && { opacity: 0.85 },
                  ]}
                  accessibilityRole="button"
                >
                  <Ionicons name="cart-outline" size={22} color={isComprasRoute ? IOS_BLUE : muted} />
                  <Text style={[styles.menuLabel, { color: isComprasRoute ? text : muted }]}>Compras</Text>
                </Pressable>
              )}
               
            </View>

            {/* Toggle Tema */}
            <View style={[styles.themeRow, { borderTopColor: border }]}>
              <Text style={[styles.themeLabel, { color: text }]}>Tema</Text>

              <View style={styles.themeControls}>
                <Ionicons
                  name="sunny-outline"
                  size={18}
                  color={isDark ? muted : IOS_BLUE}
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
                  color={isDark ? IOS_BLUE : muted}
                  style={{ marginLeft: 8 }}
                />
              </View>
            </View>
          </View>

          <Pressable
            onPress={handleLogout}
            style={({ pressed }) => [
              styles.logout,
              { borderTopColor: border },
              pressed && { opacity: 0.85 },
            ]}
            accessibilityLabel="Cerrar sesión"
            accessibilityRole="button"
          >
            <Ionicons name="log-out-outline" size={18} color="#e53935" style={{ marginRight: 8 }} />
            <Text style={styles.logoutText}>Cerrar sesión</Text>
          </Pressable>
        </DrawerContentScrollView>
      )}
    >
      <Drawer.Screen
        name="(tabs)"
        options={{
          title: "Inicio",
          headerShown: false,
          drawerIcon: ({ color, size }: any) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
    </Drawer>
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
    color: "#e53935",
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
});
