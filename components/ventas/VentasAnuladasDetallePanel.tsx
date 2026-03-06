// components/ventas/VentasAnuladasDetallePanel.tsx
// Embeddable panel for the split master-detail layout in ventas-anuladas.
// Delegates to VentaDetallePanel which already supports embedded mode.

import React from "react";
import { VentaDetallePanel } from "./VentaDetallePanel";

type VentasAnuladasDetallePanelProps = {
  ventaId: number | null;
  embedded?: boolean;
};

export function VentasAnuladasDetallePanel({
  ventaId,
  embedded = false,
}: VentasAnuladasDetallePanelProps) {
  if (!ventaId) return null;
  return <VentaDetallePanel ventaId={ventaId} embedded={embedded} />;
}
