// app/(drawer)/(tabs)/_layout.tsx
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Platform } from "react-native";

import { useThemePref } from "../../../lib/themePreference";
import { FB_DARK_BLUE, FB_DARK_BORDER, FB_DARK_MUTED, FB_DARK_SURFACE, FB_DARK_TEXT, HEADER_BG } from "../../../src/theme/headerColors";

const MUTED = "#8E8E93";

export default function TabLayout() {
  // ⬅️ USAR preferencia del usuario, no sistema
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  const background = isDark ? FB_DARK_SURFACE : "#F5F6F8";
  const border = isDark ? FB_DARK_BORDER : "#C6C6C8";
  const text = isDark ? FB_DARK_TEXT : "#000000";
  const active = isDark ? FB_DARK_BLUE : HEADER_BG;
  const inactive = isDark ? FB_DARK_MUTED : MUTED;

  return (
      <Tabs
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
        tabBarStyle: {
          backgroundColor: background,
          borderTopColor: border,
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
