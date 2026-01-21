// app/(drawer)/_layout.tsx
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Ionicons } from "@expo/vector-icons";
import {
  DrawerContentScrollView,
  DrawerItem,
  DrawerItemList,
} from "@react-navigation/drawer";
import { router } from "expo-router";
import { Drawer } from "expo-router/drawer";
import React from "react";
import { Platform, StyleSheet, Switch, Text, View } from "react-native";

import { useThemePref } from "../../lib/themePreference";

const IOS_BLUE = "#007AFF";

export default function DrawerLayout() {
  // puedes dejarlo si lo usas en otro lado; el drawer se pinta con resolved
  useColorScheme();

  const { mode, setMode, resolved } = useThemePref();
  const isDark = resolved === "dark";

  const background = isDark ? "#000000" : "#FFFFFF";
  const text = isDark ? "#FFFFFF" : "#000000";
  const muted = "#8E8E93";
  const activeBg = isDark ? "#2C2C2E" : "#F2F2F7";

  const labelStyle = {
    color: muted,
    fontSize: 16,
    fontWeight: Platform.OS === "ios" ? "500" : "400",
  } as const;

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
        <DrawerContentScrollView {...props} contentContainerStyle={{ paddingBottom: 12 }}>
          <DrawerItemList {...props} />

          <DrawerItem
            label="Compras"
            labelStyle={labelStyle}
            onPress={() => {
              props.navigation.closeDrawer();
              router.push("/compras");
            }}
          />

          {/* Toggle Tema */}
          <View style={[styles.themeRow, { borderTopColor: isDark ? "#2C2C2E" : "#E5E5EA" }]}>
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
                trackColor={{ false: "#D1D1D6", true: IOS_BLUE }}
                thumbColor={Platform.OS === "android" ? "#FFFFFF" : undefined}
              />

              <Ionicons
                name="moon-outline"
                size={18}
                color={isDark ? IOS_BLUE : muted}
                style={{ marginLeft: 8 }}
              />
            </View>
          </View>
        </DrawerContentScrollView>
      )}
    >
      <Drawer.Screen
        name="(tabs)"
        options={{
          title: "Inicio",
          headerShown: false,
        }}
      />
    </Drawer>
  );
}

const styles = StyleSheet.create({
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
});
