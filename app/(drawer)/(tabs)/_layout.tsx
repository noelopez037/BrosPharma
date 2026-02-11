// app/(drawer)/(tabs)/_layout.tsx
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { InteractionManager, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useThemePref } from "../../../lib/themePreference";
import { FB_DARK_BLUE, FB_DARK_BORDER, FB_DARK_MUTED, FB_DARK_SURFACE, FB_DARK_TEXT, HEADER_BG } from "../../../src/theme/headerColors";
import { useRole } from "../../../lib/useRole";

const MUTED = "#8E8E93";

export default function TabLayout() {
  // ⬅️ USAR preferencia del usuario, no sistema
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  const { role, refreshRole } = useRole();
  const [navKey, setNavKey] = useState(0);
  const didFixRef = useRef(false);
  const insets = useSafeAreaInsets();

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "ios") return;
      if (didFixRef.current) return;
      didFixRef.current = true;

      const raf: (cb: any) => any =
        (globalThis as any)?.requestAnimationFrame ?? ((cb: any) => setTimeout(cb, 0));

      const task = InteractionManager.runAfterInteractions(() => {
        raf(() => raf(() => setNavKey((k) => k + 1)));
      });

      return () => {
        task?.cancel?.();
      };
    }, [])
  );

  useEffect(() => {
    // Non-blocking refresh so FACTURACION rules apply ASAP.
    void refreshRole();
  }, [refreshRole]);

  const background = isDark ? FB_DARK_SURFACE : "#F5F6F8";
  const border = isDark ? FB_DARK_BORDER : "#C6C6C8";
  const text = isDark ? FB_DARK_TEXT : "#000000";
  const active = isDark ? FB_DARK_BLUE : HEADER_BG;
  const inactive = isDark ? FB_DARK_MUTED : MUTED;

  const hideTabBar = role === "FACTURACION";

  return (
      <Tabs
        key={navKey}
        detachInactiveScreens={false}
        screenOptions={{
          headerShown: false,
          headerTitleAlign: "center",
          headerStyle: { backgroundColor: background },
          headerTitleStyle: {
            color: text,
            fontWeight: Platform.OS === "ios" ? "600" : "500",
          },
          headerTintColor: active,


        tabBarActiveTintColor: active,
        tabBarInactiveTintColor: inactive,
        tabBarStyle: hideTabBar
          ? ({ display: "none" } as any)
          : {
              backgroundColor: background,
              borderTopColor: border,
              paddingBottom: Math.max(insets.bottom, 6),
              height: 56 + Math.max(insets.bottom, 6),
            },
        tabBarLabelStyle: {
          fontSize: Platform.OS === "ios" ? 11 : 12,
          fontWeight: Platform.OS === "ios" ? "500" : "400",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Inicio",
          ...(role === "FACTURACION" ? { href: null } : {}),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "home" : "home-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="ventas"
        options={{
          title: "Ventas",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "cart" : "cart-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="inventario"
        options={{
          title: "Inventario",
          ...(role === "FACTURACION" ? { href: null } : {}),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "cube" : "cube-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
