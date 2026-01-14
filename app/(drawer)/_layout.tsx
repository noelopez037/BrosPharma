import { Drawer } from "expo-router/drawer";
import React from "react";
import "react-native-gesture-handler";

export default function DrawerLayout() {
  return (
    <Drawer
      screenOptions={{
        headerTitle: "Bros Pharma",
      }}
    >
      {/* Aquí va el grupo de tabs */}
      <Drawer.Screen
        name="(tabs)"
        options={{
          title: "Inicio",
        }}
      />

      {/* Ejemplos de futuras pantallas del menú (las crearás después):
      <Drawer.Screen name="perfil" options={{ title: "Perfil" }} />
      <Drawer.Screen name="reportes" options={{ title: "Reportes" }} />
      */}
    </Drawer>
  );
}
