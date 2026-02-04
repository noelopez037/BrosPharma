import { Platform } from "react-native";

const MONTHS_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function safeFileName(raw: string) {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 160);
}

export function makeStamp() {
  const iso = new Date().toISOString();
  return iso.slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}

export function nowGtDate() {
  // Force reference to Guatemala (-06) without relying on device timezone.
  return new Date(Date.now() - 6 * 60 * 60 * 1000);
}

export function nowGtYmd() {
  const gt = nowGtDate();
  const y = gt.getUTCFullYear();
  const m = pad2(gt.getUTCMonth() + 1);
  const d = pad2(gt.getUTCDate());
  return `${y}-${m}-${d}`;
}

export function fmtDateYmd(value: any) {
  if (!value) return "-";
  if (typeof value === "string") {
    const s = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  }
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return "-";
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  return `${y}-${m}-${dd}`;
}

export function fmtMonthKey(value: any) {
  if (!value) return "-";
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = pad2(value.getMonth() + 1);
    return `${y}-${m}`;
  }
  const s = String(value).trim();
  // Accept YYYY-MM or ISO date.
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (s.length >= 7) return s.slice(0, 7);
  return s;
}

export function fmtMonthLabelEs(value: any) {
  const key = fmtMonthKey(value);
  const m = Number(key.slice(5, 7));
  const y = key.slice(0, 4);
  if (!Number.isFinite(m) || m < 1 || m > 12) return key;
  return `${MONTHS_ES[m - 1]} ${y}`;
}

export function fmtInt(value: any) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "0";
  return String(Math.trunc(n));
}

export function fmtNumber(value: any, digits = 2) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(digits);
}

export function fmtMoneyPdf(value: any) {
  const n = typeof value === "number" ? value : Number(value);
  const v = Number.isFinite(n) ? n : 0;
  try {
    const body = new Intl.NumberFormat("es-GT", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);
    return `Q ${body}`;
  } catch {
    return `Q ${v.toFixed(2)}`;
  }
}

export function pickShareDir() {
  // Keep same behavior as estadoCuentaClientePdf: documentDirectory for friendly files.
  // On web, we don't use filesystem.
  return Platform.OS === "web" ? null : "document";
}
