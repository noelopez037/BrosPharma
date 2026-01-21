// app/(drawer)/(tabs)/_layout.tsx
import { Ionicons } from "@expo/vector-icons";
import { DrawerToggleButton } from "@react-navigation/drawer";
import { Tabs } from "expo-router";
import { Platform } from "react-native";

import { useThemePref } from "../../../lib/themePreference";

const IOS_BLUE = "#007AFF";
const MUTED = "#8E8E93";

export default function TabLayout() {
  // ⬅️ USAR preferencia del usuario, no sistema
  const { resolved } = useThemePref();
  const isDark = resolved === "dark";

  const background = isDark ? "#000000" : "#FFFFFF";
  const border = isDark ? "#38383A" : "#C6C6C8";
  const text = isDark ? "#FFFFFF" : "#000000";

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerTitleAlign: "center",
        headerStyle: { backgroundColor: background },
        headerTitleStyle: {
          color: text,
          fontWeight: Platform.OS === "ios" ? "600" : "500",
        },
        headerTintColor: IOS_BLUE,

        // hamburguesa
        headerLeft: () => <DrawerToggleButton tintColor={IOS_BLUE} />,

        tabBarActiveTintColor: IOS_BLUE,
        tabBarInactiveTintColor: MUTED,
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
