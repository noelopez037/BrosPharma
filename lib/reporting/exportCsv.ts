import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import type { ReportColumn } from "./types";
import { fmtDateYmd, fmtInt, fmtMonthKey, safeFileName } from "./share";

function getCellValue<Row>(row: Row, col: ReportColumn<Row>) {
  if (typeof col.value === "function") return col.value(row);
  return (row as any)?.[col.key];
}

function fmtCellDefault(kind: string, value: any) {
  if (value == null) return "";
  if (kind === "int") return fmtInt(value);
  if (kind === "money") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? String(n) : "0";
  }
  if (kind === "date") return fmtDateYmd(value);
  if (kind === "month") return fmtMonthKey(value);
  return String(value);
}

function escapeCsvCell(cell: string, sep: string) {
  const s = String(cell ?? "");
  const needsQuotes = s.includes("\"") || s.includes("\n") || s.includes("\r") || s.includes(sep);
  if (!needsQuotes) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function exportReportCsv<Row>(opts: {
  title: string;
  fileName: string;
  columns: ReportColumn<Row>[];
  rows: Row[];
  separator?: string;
}) {
  const sep = opts.separator ?? ";";
  const fileName = safeFileName(opts.fileName || "reporte") || "reporte";
  const header = opts.columns.map((c) => escapeCsvCell(String(c.label ?? ""), sep)).join(sep);

  const lines = (opts.rows ?? []).map((r) => {
    const cells = opts.columns.map((c) => {
      const raw = getCellValue(r, c);
      const kind = (c.kind ?? "text") as any;
      const val = c.formatCsv ? c.formatCsv(raw, r) : fmtCellDefault(kind, raw);
      return escapeCsvCell(String(val ?? ""), sep);
    });
    return cells.join(sep);
  });

  // UTF-8 BOM for Excel
  const csv = "\uFEFF" + [header, ...lines].join("\r\n");

  if (Platform.OS === "web") {
    try {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName}.csv`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      try {
        URL.revokeObjectURL(url);
      } catch {}
      return { uri: url };
    } catch {
      return { uri: null };
    }
  }

  const baseDir = ((FileSystem as any).cacheDirectory ?? (FileSystem as any).documentDirectory) as string | undefined;
  if (!baseDir) throw new Error("No hay directorio disponible para guardar");
  const uri = `${baseDir}${fileName}.csv`;

  try {
    await (FileSystem as any).deleteAsync(uri, { idempotent: true });
  } catch {}
  await (FileSystem as any).writeAsStringAsync(uri, csv, { encoding: (FileSystem as any).EncodingType.UTF8 });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: "text/csv",
      dialogTitle: opts.title,
    } as any);
  }

  return { uri };
}
