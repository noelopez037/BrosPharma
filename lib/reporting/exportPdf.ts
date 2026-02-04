import { Platform } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import type { ReportColumn } from "./types";
import { fmtDateYmd, fmtInt, fmtMoneyPdf, fmtMonthLabelEs, safeFileName } from "./share";

function escapeHtml(input: any) {
  const s = String(input ?? "");
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function base64ToBlobUrl(base64: string) {
  const bin = atob(base64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/pdf" });
  return URL.createObjectURL(blob);
}

function getCellValue<Row>(row: Row, col: ReportColumn<Row>) {
  if (typeof col.value === "function") return col.value(row);
  return (row as any)?.[col.key];
}

function formatPdfCell<Row>(row: Row, col: ReportColumn<Row>) {
  const raw = getCellValue(row, col);
  if (col.formatPdf) return col.formatPdf(raw, row);
  const kind = col.kind ?? "text";
  if (raw == null) return "-";
  if (kind === "int") return fmtInt(raw);
  if (kind === "money") return fmtMoneyPdf(raw);
  if (kind === "date") return fmtDateYmd(raw);
  if (kind === "month") return fmtMonthLabelEs(raw);
  return String(raw);
}

export async function exportReportPdf<Row>(opts: {
  title: string;
  subtitle?: string;
  columns: ReportColumn<Row>[];
  rows: Row[];
  summary?: { label: string; value: string }[];
  fileName: string;
}) {
  const title = String(opts.title ?? "Reporte").trim() || "Reporte";
  const subtitle = String(opts.subtitle ?? "").trim();
  const fileName = safeFileName(opts.fileName || "reporte") || "reporte";

  const summaryHtml = (opts.summary ?? [])
    .map((s) => {
      const k = escapeHtml(String(s.label ?? ""));
      const v = escapeHtml(String(s.value ?? ""));
      return `<div class="kv"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    })
    .join("");

  const th = opts.columns
    .map((c) => {
      const isNum = (c.align ?? (c.kind === "int" || c.kind === "money" ? "right" : "left")) === "right";
      return `<th class="${isNum ? "num" : ""}">${escapeHtml(c.label)}</th>`;
    })
    .join("");

  const tr = (opts.rows ?? [])
    .map((r) => {
      const tds = opts.columns
        .map((c) => {
          const isNum = (c.align ?? (c.kind === "int" || c.kind === "money" ? "right" : "left")) === "right";
          const val = escapeHtml(formatPdfCell(r, c));
          return `<td class="${isNum ? "num" : ""}">${val}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { --fg:#111; --muted:#666; --border:#e5e5e5; --bg:#fff; --zebra:#fafafa; }
      * { box-sizing: border-box; }
      body { margin:0; background: var(--bg); color: var(--fg); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
      .page { padding: 22px; }
      .head { display:flex; align-items:flex-end; justify-content:space-between; gap: 18px; }
      h1 { font-size: 18px; margin: 0; letter-spacing: 0.2px; }
      .sub { margin-top: 6px; color: var(--muted); font-size: 12px; line-height: 1.4; }
      .meta { text-align:right; color: var(--muted); font-size: 11px; }
      .summary { margin-top: 14px; display:flex; flex-wrap: wrap; gap: 10px; }
      .kv { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; min-width: 160px; }
      .k { font-size: 11px; color: var(--muted); }
      .v { margin-top: 4px; font-size: 13px; font-weight: 700; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th, td { border: 1px solid var(--border); padding: 8px 10px; font-size: 12px; }
      th { background: #f3f4f6; text-align: left; font-weight: 800; }
      td { vertical-align: top; }
      td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
      tbody tr:nth-child(even) td { background: var(--zebra); }
      .footer { margin-top: 14px; color: var(--muted); font-size: 11px; display:flex; justify-content: space-between; gap: 12px; }
      @page { margin: 18px; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="head">
        <div>
          <h1>${escapeHtml(title)}</h1>
          ${subtitle ? `<div class="sub">${escapeHtml(subtitle)}</div>` : ""}
        </div>
        <div class="meta">Generado: ${escapeHtml(new Date().toISOString().slice(0, 19).replace("T", " "))}</div>
      </div>
      ${summaryHtml ? `<div class="summary">${summaryHtml}</div>` : ""}
      <table>
        <thead><tr>${th}</tr></thead>
        <tbody>${tr}</tbody>
      </table>
      <div class="footer">
        <div>Documento informativo.</div>
        <div>${escapeHtml(fileName)}.pdf</div>
      </div>
    </div>
  </body>
</html>`;

  if (Platform.OS === "web") {
    try {
      const out: any = await Print.printToFileAsync({ html, base64: true } as any);
      const base64 = out?.base64 as string | undefined;
      const uri = out?.uri as string | undefined;

      if (typeof window !== "undefined") {
        const url = base64 ? base64ToBlobUrl(base64) : uri;
        if (url) {
          try {
            window.open(url, "_blank", "noopener,noreferrer");
          } catch {}
          try {
            if (typeof document !== "undefined") {
              const a = document.createElement("a");
              a.href = url;
              a.download = `${fileName}.pdf`;
              a.rel = "noopener";
              document.body.appendChild(a);
              a.click();
              a.remove();
            }
          } catch {}
        }
      }

      return { uri: uri ?? null };
    } catch {
      await Print.printAsync({ html } as any);
      return { uri: null };
    }
  }

  const out = await Print.printToFileAsync({ html });
  let uri = out.uri;

  // stable user-friendly name
  try {
    const baseDir = (FileSystem as any).documentDirectory as string | undefined;
    if (baseDir) {
      const target = `${baseDir}${fileName}.pdf`;
      try {
        await (FileSystem as any).deleteAsync(target, { idempotent: true });
      } catch {}
      await (FileSystem as any).copyAsync({ from: uri, to: target });
      uri = target;
    }
  } catch {}

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
      dialogTitle: title,
    } as any);
  }

  return { uri };
}
