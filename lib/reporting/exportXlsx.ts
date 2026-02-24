import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as XLSX from "xlsx";

import { safeFileName } from "./share";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type SimpleXlsxColumn<Row> = {
  key: string;
  header: string;
  value?: (row: Row) => any;
};

export async function exportSimpleXlsx<Row>({
  title = "Reporte",
  fileName,
  sheetName = "Reporte",
  columns,
  rows,
}: {
  title?: string;
  fileName: string;
  sheetName?: string;
  columns: SimpleXlsxColumn<Row>[];
  rows: Row[];
}) {
  const safeName = safeFileName(fileName || "reporte") || "reporte";
  const headers = columns.map((col) => col.header || col.key || "");
  const aoa = [headers];

  for (const row of rows ?? []) {
    const line = columns.map((col) => {
      const raw = typeof col.value === "function" ? col.value(row) : (row as any)?.[col.key];
      if (raw == null) return "";
      if (raw instanceof Date) return raw;
      return raw;
    });
    aoa.push(line);
  }

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));

  if (Platform.OS === "web") {
    try {
      const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      const BlobCtor = (globalThis as any)?.Blob;
      const URLCtor = (globalThis as any)?.URL;
      const doc = (globalThis as any)?.document;
      if (!BlobCtor || !URLCtor || !doc) return { uri: null };
      const blob = new BlobCtor([buffer], { type: XLSX_MIME });
      const url = URLCtor.createObjectURL(blob);
      const anchor = doc.createElement("a");
      anchor.href = url;
      anchor.download = `${safeName}.xlsx`;
      anchor.rel = "noopener";
      doc.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => {
        try {
          URLCtor.revokeObjectURL(url);
        } catch {}
      }, 2000);
      return { uri: url };
    } catch {
      return { uri: null };
    }
  }

  const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "base64" });
  const baseDir = (FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory;
  if (!baseDir) throw new Error("No hay directorio disponible para guardar");
  const uri = `${baseDir}${safeName}.xlsx`;

  try {
    await (FileSystem as any).deleteAsync(uri, { idempotent: true });
  } catch {}

  await (FileSystem as any).writeAsStringAsync(uri, wbout, {
    encoding: (FileSystem as any).EncodingType.Base64,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      dialogTitle: title,
      mimeType: XLSX_MIME,
    } as any);
  }

  return { uri };
}
