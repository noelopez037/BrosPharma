// Formatting + date helpers for reporting.
// Keep this file small and dependency-free so it can be reused by exporters and screens.

import { nowGtDate, nowGtYmd, fmtDateYmd, fmtMonthKey, fmtMonthLabelEs, fmtMoneyPdf } from "./share";

export { nowGtDate, nowGtYmd, fmtDateYmd, fmtMonthKey, fmtMonthLabelEs, fmtMoneyPdf };

export function ymdToIsoTz(ymd: string, opts?: { endOfDay?: boolean; tzOffset?: string }) {
  const s = String(ymd ?? "").slice(0, 10);
  const tz = String(opts?.tzOffset ?? "-06:00");
  const end = !!opts?.endOfDay;
  // timestamptz-compatible ISO with explicit offset.
  return `${s}T${end ? "23:59:59" : "00:00:00"}${tz}`;
}
