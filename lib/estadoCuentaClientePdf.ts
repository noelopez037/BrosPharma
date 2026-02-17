import { Platform } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { Asset } from "expo-asset";

type RpcHeader = Record<string, any>;
type RpcTotals = Record<string, any>;
type RpcRow = Record<string, any>;

export type EstadoCuentaClientePdfPayload = {
  header: RpcHeader;
  totals: RpcTotals;
  rows: RpcRow[];
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function formatDateDMY(value: any) {
  if (!value) return "-";
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return "-";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatMoneyGTQ(value: any) {
  const n = typeof value === "number" ? value : Number(value);
  const v = Number.isFinite(n) ? n : 0;
  const body = new Intl.NumberFormat("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
  return `Q ${body}`;
}

function escapeHtml(input: any) {
  const s = String(input ?? "");
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function readAssetAsBase64Png(moduleId: any) {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();

  // Native: read from local URI.
  if (Platform.OS !== "web") {
    const uri = asset.localUri ?? asset.uri;
    return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  }

  // Web: fetch the asset URL and convert to base64.
  const res = await fetch(asset.uri);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function pick(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

function toNum(v: any) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function buildEstadoCuentaHtml({ logoBase64, header, totals, rows }: { logoBase64: string; header: RpcHeader; totals: RpcTotals; rows: RpcRow[] }) {
  const clienteNombre = String(pick(header, ["nombre", "cliente_nombre", "cliente", "clienteName"]) ?? "").trim();
  const clienteNit = String(pick(header, ["nit", "cliente_nit"]) ?? "CF").trim() || "CF";
  const clienteTel = String(pick(header, ["telefono", "tel", "cliente_telefono"]) ?? "-").trim() || "-";
  const clienteDir = String(pick(header, ["direccion", "dir", "cliente_direccion"]) ?? "-").trim() || "-";

  const empresaNombre = String(pick(header, ["empresa_nombre", "company_name", "empresa"]) ?? "Bros Pharma").trim() || "Bros Pharma";
  const empresaNit = String(pick(header, ["empresa_nit", "company_nit", "nit_empresa"]) ?? "").trim();
  const empresaTel = String(pick(header, ["empresa_telefono", "company_phone", "tel_empresa"]) ?? "").trim();
  const empresaDir = String(pick(header, ["empresa_direccion", "company_address", "direccion_empresa"]) ?? "").trim();

  const emision = formatDateDMY(new Date());
  const generado = formatDateDMY(new Date());

  const saldoTotal = formatMoneyGTQ(pick(totals, ["saldo_total", "saldoTotal"]) ?? 0);
  const saldoVencido = formatMoneyGTQ(pick(totals, ["saldo_vencido", "saldoVencido"]) ?? 0);
  const saldoPendiente = formatMoneyGTQ(pick(totals, ["saldo_pendiente", "saldoPendiente"]) ?? 0);
  const factVencidas = String(pick(totals, ["facturas_vencidas", "facturasVencidas"]) ?? 0);
  const factPendientes = String(pick(totals, ["facturas_pendientes", "facturasPendientes"]) ?? 0);

  const filtered = (rows ?? []).filter((r) => toNum(pick(r, ["saldo", "balance"]) ?? 0) > 0);

  function chunkArray<T>(arr: T[], size: number) {
    const out: T[][] = [];
    const chunkSize = Math.max(1, Math.floor(size));
    for (let i = 0; i < arr.length; i += chunkSize) {
      out.push(arr.slice(i, i + chunkSize));
    }
    return out;
  }

  function renderDetalleTable(rowsChunk: RpcRow[], isFirst: boolean) {
    const rowsHtml = rowsChunk
      .map((r) => {
        const numero = escapeHtml(pick(r, ["numero_factura", "factura", "numero", "no_factura"]) ?? "-");
        const fEmi = formatDateDMY(pick(r, ["fecha_emision", "fecha", "emision"]) ?? null);
        const fVen = formatDateDMY(pick(r, ["fecha_vencimiento", "vencimiento"]) ?? null);
        const dias = String(pick(r, ["dias_atraso", "dias"]) ?? "0");

        const rawEstado = String(pick(r, ["estado", "status"]) ?? "").trim().toUpperCase();
        const saldoNum = toNum(pick(r, ["saldo", "balance"]) ?? 0);
        const computedEstado = saldoNum <= 0 ? "PAGADA" : toNum(dias) > 0 ? "VENCIDA" : "PENDIENTE";
        const normalized = rawEstado === "VENCIDA" || rawEstado === "PENDIENTE" || rawEstado === "PAGADA" ? rawEstado : computedEstado;
        const estado = escapeHtml(normalized);
        const badgeClass = normalized === "VENCIDA" ? "badge--late" : normalized === "PAGADA" ? "badge--paid" : "badge--pending";
        const rowClass = normalized === "VENCIDA" ? "row-late" : "";

        const saldo = formatMoneyGTQ(pick(r, ["saldo", "balance"]) ?? 0);

        return `
          <tr class="${rowClass}">
            <td class="mono">${numero}</td>
            <td>${escapeHtml(fEmi)}</td>
            <td>${escapeHtml(fVen)}</td>
            <td><span class="badge ${badgeClass}">${estado}</span></td>
            <td class="num">${escapeHtml(saldo)}</td>
            <td class="num">${escapeHtml(dias)}</td>
          </tr>`;
      })
      .join("");

    const tableHtml = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Factura</th>
              <th>Emision</th>
              <th>Vencimiento</th>
              <th>Estado</th>
              <th class="num">Saldo</th>
              <th class="num">Dias atraso</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>`;

    if (isFirst) return tableHtml;
    return `<div style="page-break-before: always; break-before: page;">${tableHtml}</div>`;
  }

  const chunks = chunkArray(filtered, 20);
  const detalleHtml = chunks.map((chunk, i) => renderDetalleTable(chunk, i === 0)).join("");

  const emptyRows = filtered.length === 0;

  return `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        @page { size: A4; margin: 26px; }

        :root {
          --ink: #101828;
          --muted: #475467;
          --line: #EAECF0;
          --soft: #F2F4F7;
          --paper: #FFFFFF;

          --brand: #0B4A6F;

          --danger: #B42318;
          --danger-bg: #FEF3F2;
          --warning: #B54708;
          --warning-bg: #FFFAEB;
          --success: #067647;
          --success-bg: #ECFDF3;
          --neutral: #344054;
          --neutral-bg: #F9FAFB;
        }

        * {
          box-sizing: border-box;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        body {
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
          color: var(--ink);
          background: var(--paper);
        }

        .doc {
          border: 1px solid var(--line);
          border-radius: 14px;
          overflow: hidden;
          background: var(--paper);
        }

        .header {
          padding: 18px;
          border-bottom: 1px solid var(--line);
          background: var(--paper);
        }

        .header-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          align-items: center;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 14px;
          min-width: 0;
        }

        .logo { width: 92px; height: auto; }

        .title {
          font-size: 20px;
          font-weight: 900;
          letter-spacing: 0.2px;
          margin: 0;
        }

        .subtitle {
          margin-top: 6px;
          font-size: 12px;
          color: var(--muted);
        }

        .subtitle strong { color: var(--ink); font-weight: 900; }

        .company {
          text-align: right;
          font-size: 11px;
          color: var(--muted);
          line-height: 1.35;
        }

        .company .name {
          color: var(--ink);
          font-weight: 900;
          font-size: 12px;
        }

        .meta {
          margin-top: 10px;
          display: inline-block;
          padding: 8px 10px;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: var(--neutral-bg);
          color: var(--neutral);
          font-weight: 900;
        }

        .content { padding: 16px 18px 18px; }

        .client-bar {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px 14px;
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 12px;
          background: #FFFFFF;
        }

        .kv { font-size: 12px; color: var(--muted); }
        .kv span { color: var(--ink); font-weight: 800; }
        .kv.full { grid-column: 1 / -1; }

        .section {
          margin-top: 14px;
        }

        .section-title {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0 0 10px;
          font-size: 12px;
          font-weight: 950;
          letter-spacing: 0.6px;
          text-transform: uppercase;
          color: var(--neutral);
        }

        .section-title:before {
          content: "";
          width: 10px;
          height: 10px;
          border-radius: 3px;
          background: var(--brand);
          display: inline-block;
        }

        .summary {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 10px;
        }

        .card {
          min-width: 0;
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 12px;
          background: var(--paper);
          position: relative;
        }

        .card:before {
          content: "";
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 4px;
          border-top-left-radius: 12px;
          border-bottom-left-radius: 12px;
          background: var(--neutral);
          opacity: 0.35;
        }

        .card .label {
          font-size: 11px;
          color: var(--muted);
          letter-spacing: 0.2px;
          line-height: 1.2;
          min-height: 28px;
        }

        .card .value {
          margin-top: 8px;
          font-size: 16px;
          font-weight: 950;
          color: var(--ink);
        }

        .card .hint {
          margin-top: 6px;
          font-size: 11px;
          color: var(--muted);
        }

        .card.total:before { background: var(--brand); opacity: 1; }
        .card.late:before { background: var(--danger); opacity: 1; }
        .card.pending:before { background: var(--warning); opacity: 1; }
        .card.count:before { background: var(--neutral); opacity: 0.6; }

        .table-wrap {
          border: 1px solid var(--line);
          border-radius: 12px;
          overflow: hidden;
          background: var(--paper);
        }

        @media print {
          .table-wrap { overflow: visible !important; }
        }

        table { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
        thead { display: table-header-group; }
        tfoot { display: table-footer-group; }

        tr { break-inside: avoid; page-break-inside: avoid; }

        thead th {
          background: var(--soft);
          color: var(--muted);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          text-align: center;
          padding: 10px 10px;
          border-bottom: 1px solid var(--line);
          white-space: nowrap;
          border-right: 1px solid var(--line);
        }

        thead th:last-child { border-right: none; }

        tbody td {
          font-size: 12px;
          padding: 11px 10px;
          border-bottom: 1px solid var(--soft);
          vertical-align: middle;
          text-align: center;
          border-right: 1px solid var(--soft);
        }

        tbody td:last-child { border-right: none; }

        tbody tr:last-child td { border-bottom: none; }

        .num { text-align: center; white-space: nowrap; }

        .mono {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        }

        .badge {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 950;
          border: 1px solid var(--line);
          background: var(--neutral-bg);
          color: var(--neutral);
        }

        .badge--pending { background: var(--warning-bg); border-color: rgba(181, 71, 8, 0.25); color: var(--warning); }
        .badge--late { background: var(--danger-bg); border-color: rgba(180, 35, 24, 0.25); color: var(--danger); }
        .badge--paid { background: var(--success-bg); border-color: rgba(6, 118, 71, 0.25); color: var(--success); }

        .row-late td { background: rgba(180, 35, 24, 0.035); }

        .footer {
          margin-top: 16px;
          padding-top: 10px;
          border-top: 1px solid var(--line);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          font-size: 11px;
          color: var(--muted);
        }

        .footer strong { color: var(--ink); font-weight: 900; }

      </style>
    </head>
    <body>
      <div class="doc">
        <div class="header">
          <div class="header-row">
            <div class="brand">
              <img class="logo" src="data:image/png;base64,${logoBase64}" />
              <div style="min-width: 0;">
                <div class="title">Estado de cuenta</div>
                <div class="subtitle">Cliente: <strong>${escapeHtml(clienteNombre || "-")}</strong></div>
              </div>
            </div>

            <div class="company">
              <div class="name">${escapeHtml(empresaNombre)}</div>
              ${empresaNit ? `<div>NIT: ${escapeHtml(empresaNit)}</div>` : ``}
              ${empresaTel ? `<div>Tel: ${escapeHtml(empresaTel)}</div>` : ``}
              ${empresaDir ? `<div>${escapeHtml(empresaDir)}</div>` : ``}
              <div class="meta">Fecha de emision: ${escapeHtml(emision)}</div>
            </div>
          </div>
        </div>

        <div class="content">
          <div class="client-bar">
            <div class="kv">NIT: <span>${escapeHtml(clienteNit)}</span></div>
            <div class="kv">Telefono: <span>${escapeHtml(clienteTel)}</span></div>
            <div class="kv full">Direccion: <span>${escapeHtml(clienteDir)}</span></div>
          </div>

          <div class="section">
            <div class="section-title">Resumen</div>
            <div class="summary">
              <div class="card total">
                <div class="label">Saldo total</div>
                <div class="value">${escapeHtml(saldoTotal)}</div>
                <div class="hint">Total por cobrar</div>
              </div>
              <div class="card late">
                <div class="label">Saldo vencido</div>
                <div class="value">${escapeHtml(saldoVencido)}</div>
                <div class="hint">Atrasos</div>
              </div>
              <div class="card pending">
                <div class="label">Saldo pendiente</div>
                <div class="value">${escapeHtml(saldoPendiente)}</div>
                <div class="hint">Por vencer</div>
              </div>
              <div class="card count">
                <div class="label">Facturas vencidas</div>
                <div class="value">${escapeHtml(factVencidas)}</div>
                <div class="hint">Cantidad</div>
              </div>
              <div class="card count">
                <div class="label">Facturas pendientes</div>
                <div class="value">${escapeHtml(factPendientes)}</div>
                <div class="hint">Cantidad</div>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Detalle</div>

            ${emptyRows ? `<div style="border: 1px dashed var(--line); border-radius: 12px; padding: 12px; color: var(--muted); font-size: 12px; background: var(--neutral-bg);">Sin facturas pendientes.</div>` : `
            ${detalleHtml}
            `}

            <div class="footer">
              <div>Documento informativo. No constituye factura.</div>
              <div>Generado: <strong>${escapeHtml(generado)}</strong></div>
            </div>
          </div>
        </div>
      </div>
    </body>
  </html>`;
}

function base64ToBlobUrl(base64: string) {
  const bin = atob(base64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/pdf" });
  return URL.createObjectURL(blob);
}

export async function generarEstadoCuentaClientePdf(payload: EstadoCuentaClientePdfPayload, opts?: { fileName?: string }) {
  const logoBase64 = await readAssetAsBase64Png(require("../assets/images/logo.png"));
  const html = buildEstadoCuentaHtml({ logoBase64, header: payload.header ?? {}, totals: payload.totals ?? {}, rows: payload.rows ?? [] });

  const fileName = (opts?.fileName ?? "estado-cuenta").replace(/[^a-zA-Z0-9._-]+/g, "-");

  if (Platform.OS === "web") {
    try {
      // Prefer generating a PDF and opening/downloading it.
      const out: any = await Print.printToFileAsync({ html, base64: true } as any);
      const base64 = out?.base64 as string | undefined;
      const uri = out?.uri as string | undefined;

      if (typeof window !== "undefined") {
        const url = base64 ? base64ToBlobUrl(base64) : uri;
        if (url) {
          // Open in new tab; also try to trigger a download.
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
      // Fallback: browser print dialog (still from HTML via expo-print).
      await Print.printAsync({ html } as any);
      return { uri: null };
    }
  }

  const out = await Print.printToFileAsync({ html });
  let uri = out.uri;

  // Give the file a stable, user-friendly name for sharing.
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
      dialogTitle: "Estado de cuenta (PDF)",
    } as any);
  }

  return { uri };
}
