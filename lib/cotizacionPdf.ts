import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

export type CotizacionLinea = {
  producto_label: string;
  cantidad: number;
  precio_unit: number;
  tiene_iva: boolean | null;
};

export type CotizacionPdfData = {
  empresa: {
    nombre: string;
    logo_url?: string | null;
  };
  cliente: {
    nombre: string;
    nit?: string | null;
    telefono?: string | null;
    direccion?: string | null;
  };
  lineas: CotizacionLinea[];
  comentarios?: string | null;
};

function escapeHtml(input: any) {
  const s = String(input ?? "");
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fmtQ(n: number) {
  const body = new Intl.NumberFormat("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
  return `Q ${body}`;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function fmtDate(d: Date) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

async function readLocalLogoAsBase64(): Promise<string> {
  const asset = Asset.fromModule(require("../assets/images/logo.png"));
  await asset.downloadAsync();
  if (Platform.OS !== "web") {
    const uri = asset.localUri ?? asset.uri;
    return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  }
  const res = await fetch(asset.uri);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function fetchRemoteLogoAsBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  } catch {
    return null;
  }
}

function buildCotizacionHtml(
  data: CotizacionPdfData,
  logoBase64: string,
  logoMime: string,
) {
  const fecha = fmtDate(new Date());
  const cotNum = Date.now().toString().slice(-8);
  const { empresa, cliente, lineas, comentarios } = data;

  const total = lineas.reduce((acc, l) => acc + l.cantidad * l.precio_unit, 0);

  const rowsHtml = lineas
    .map((l) => {
      const sub = l.cantidad * l.precio_unit;
      return `
        <tr>
          <td class="td-prod">${escapeHtml(l.producto_label)}</td>
          <td class="num">${escapeHtml(String(l.cantidad))}</td>
          <td class="num">${escapeHtml(fmtQ(l.precio_unit))}</td>
          <td class="num">${escapeHtml(fmtQ(sub))}</td>
        </tr>`;
    })
    .join("");

  const comentariosHtml = comentarios?.trim()
    ? `<div class="comments-box">
        <div class="cb-label">Observaciones</div>
        <div>${escapeHtml(comentarios.trim())}</div>
      </div>`
    : "";

  const clienteRows = [
    cliente.nit ? `<div class="kv">NIT: <span>${escapeHtml(cliente.nit)}</span></div>` : "",
    cliente.telefono ? `<div class="kv">Telefono: <span>${escapeHtml(cliente.telefono)}</span></div>` : "",
    cliente.direccion ? `<div class="kv full">Direccion: <span>${escapeHtml(cliente.direccion)}</span></div>` : "",
  ].join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    @page { size: A4; margin: 26px; }
    :root {
      --ink: #101828; --muted: #475467; --line: #EAECF0; --soft: #F2F4F7;
      --paper: #FFFFFF; --brand: #0B4A6F;
      --success: #067647; --success-bg: #ECFDF3;
    }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; color: var(--ink); background: var(--paper); }
    .doc { border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
    .header { padding: 18px; border-bottom: 1px solid var(--line); }
    .header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; }
    .brand { display: flex; align-items: center; gap: 14px; }
    .logo { width: 80px; height: auto; }
    .doc-title { font-size: 22px; font-weight: 900; color: var(--brand); margin: 0; letter-spacing: 0.5px; }
    .doc-sub { margin-top: 4px; font-size: 12px; color: var(--muted); }
    .company { text-align: right; font-size: 11px; color: var(--muted); line-height: 1.5; }
    .company .name { color: var(--ink); font-weight: 900; font-size: 13px; }
    .validity { display: inline-block; margin-top: 8px; padding: 5px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--soft); font-size: 11px; }
    .validity strong { color: var(--ink); font-weight: 900; }
    .content { padding: 16px 18px 18px; }
    .client-bar { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; border: 1px solid var(--line); border-radius: 12px; padding: 12px; }
    .kv { font-size: 12px; color: var(--muted); }
    .kv span { color: var(--ink); font-weight: 800; }
    .kv.full { grid-column: 1 / -1; }
    .section { margin-top: 16px; }
    .section-title { font-size: 11px; font-weight: 900; letter-spacing: 0.6px; text-transform: uppercase; color: var(--muted); margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
    .section-title:before { content: ""; width: 8px; height: 8px; border-radius: 2px; background: var(--brand); display: inline-block; }
    .table-wrap { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
    @media print { .table-wrap { overflow: visible !important; } }
    table { width: 100%; border-collapse: separate; border-spacing: 0; }
    thead th { background: var(--soft); color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; padding: 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
    thead th.left { text-align: left; }
    thead th.num { text-align: right; }
    tbody td { font-size: 12px; padding: 10px; border-bottom: 1px solid var(--soft); vertical-align: middle; text-align: right; }
    tbody td.td-prod { text-align: left; font-weight: 600; }
    tbody tr:last-child td { border-bottom: none; }
    .num { text-align: right; white-space: nowrap; }
    .badge-iva { background: var(--success-bg); color: var(--success); border: 1px solid rgba(6,118,71,0.25); border-radius: 999px; font-size: 10px; font-weight: 900; padding: 2px 7px; white-space: nowrap; }
    .sub-row td { font-size: 12px; color: var(--muted); border-top: 1px dashed var(--line); }
    .grand-total td { background: var(--soft); font-weight: 900; font-size: 14px; border-top: 2px solid var(--line); }
    .total-label { text-align: right; padding-right: 12px; }
    .total-val { color: var(--brand); }
    .muted { color: var(--muted) !important; font-weight: normal !important; font-size: 12px !important; }
    .comments-box { margin-top: 14px; border: 1px solid var(--line); border-radius: 10px; padding: 12px; background: var(--soft); font-size: 12px; color: var(--muted); }
    .cb-label { font-weight: 900; color: var(--ink); margin-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
    .footer { margin-top: 16px; padding-top: 10px; border-top: 1px solid var(--line); font-size: 11px; color: var(--muted); display: flex; justify-content: space-between; gap: 12px; }
    .footer strong { color: var(--ink); font-weight: 900; }
  </style>
</head>
<body>
  <div class="doc">
    <div class="header">
      <div class="header-row">
        <div class="brand">
          <img class="logo" src="data:${logoMime};base64,${logoBase64}" />
          <div>
            <div class="doc-title">COTIZACIÓN</div>
            <div class="doc-sub">No. ${escapeHtml(cotNum)} &nbsp;·&nbsp; ${escapeHtml(fecha)}</div>
          </div>
        </div>
        <div class="company">
          <div class="name">${escapeHtml(empresa.nombre)}</div>
          <div class="validity">Válida por <strong>30 días</strong></div>
        </div>
      </div>
    </div>
    <div class="content">
      <div class="client-bar">
        <div class="kv full">Cliente: <span>${escapeHtml(cliente.nombre || "-")}</span></div>
        ${clienteRows}
      </div>
      <div class="section">
        <div class="section-title">Detalle de productos</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th class="left">Producto</th>
                <th class="num">Cant.</th>
                <th class="num">Precio unit.</th>
                <th class="num">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
              <tr class="grand-total">
                <td colspan="3" class="total-label">TOTAL</td>
                <td class="num total-val">${escapeHtml(fmtQ(total))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      ${comentariosHtml}
      <div class="footer">
        <div>Cotización informativa. No constituye factura.</div>
        <div>Generado: <strong>${escapeHtml(fecha)}</strong></div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export async function generarCotizacionPdf(
  data: CotizacionPdfData,
  opts?: { fileName?: string },
): Promise<void> {
  let logoBase64: string;
  let logoMime = "image/png";

  if (data.empresa.logo_url) {
    const remote = await fetchRemoteLogoAsBase64(data.empresa.logo_url);
    if (remote) {
      logoBase64 = remote;
      const u = data.empresa.logo_url.toLowerCase();
      if (u.includes(".jpg") || u.includes(".jpeg")) logoMime = "image/jpeg";
      else if (u.includes(".webp")) logoMime = "image/webp";
    } else {
      logoBase64 = await readLocalLogoAsBase64();
    }
  } else {
    logoBase64 = await readLocalLogoAsBase64();
  }

  const html = buildCotizacionHtml(data, logoBase64, logoMime);
  const fileName = (opts?.fileName ?? "cotizacion").replace(/[^a-zA-Z0-9._-]+/g, "-");

  if (Platform.OS === "web") {
    if (typeof document !== "undefined") {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      document.body.appendChild(iframe);
      iframe.contentDocument!.open();
      iframe.contentDocument!.write(html);
      iframe.contentDocument!.close();
      iframe.onload = () => {
        iframe.contentWindow!.print();
        document.body.removeChild(iframe);
      };
    }
    return;
  }

  const out = await Print.printToFileAsync({ html });
  let uri = out.uri;
  try {
    const baseDir = (FileSystem as any).documentDirectory as string | undefined;
    if (baseDir) {
      const target = `${baseDir}${fileName}.pdf`;
      try { await (FileSystem as any).deleteAsync(target, { idempotent: true }); } catch {}
      await (FileSystem as any).copyAsync({ from: uri, to: target });
      uri = target;
    }
  } catch {}

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
      dialogTitle: "Cotización (PDF)",
    } as any);
  }
}
