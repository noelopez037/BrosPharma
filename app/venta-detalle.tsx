import { useLocalSearchParams } from "expo-router";
import React from "react";

import { VentaDetallePanel } from "../components/ventas/VentaDetallePanel";

type Params = {
  ventaId?: string;
};

export default function VentaDetalleScreen() {
  const params = useLocalSearchParams<Params>();
  const ventaId = Number(params?.ventaId ?? "");

  return <VentaDetallePanel ventaId={ventaId} embedded={false} />;
}
