/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.10.0?target=deno";

const BUCKET = "Ventas-Docs";

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: new Headers({
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    }),
  });
}

function normalizePath(p: string): string {
  let path = p.trim();
  path = path.replace(/^\/+/, "");
  if (path.startsWith("Ventas-Docs/")) path = path.slice("Ventas-Docs/".length);
  path = path.replace(/^\/+/, "");
  return path;
}

function normalizePdfText(rawText: string): string {
  let t = rawText;

  // Remove non-printable/control chars (keep whitespace for later collapsing).
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");

  // Normalize odd PDF whitespace (NBSP/various unicode spaces/zero-width).
  t = t.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ");
  t = t.replace(/[\u200B-\u200D\uFEFF]/g, "");

  // Normalize common invoice markers / variants while staying ASCII in source.
  // - Normalize N° / Nº into N° (so step 1 can match the strong regex).
  t = t.replace(/N[\u00BA\u00B0]/g, "N\u00B0");

  // Join fragmented tokens seen in extracted PDF text.
  t = t.replace(/\bN\s+O\b/g, "No");
  t = t.replace(/\bF\s*A\s*C\s*T\s*U\s*R\s*A\b/gi, "Factura");

  // Normalize NUMERO/N\u00DAMERO into N\u00FAmero so step 1 can match literal "N\u00FAmero".
  t = t.replace(/\bNUMERO\b/gi, "N\u00FAmero");
  t = t.replace(/\bN\u00DAMERO\b/g, "N\u00FAmero");

  // Collapse whitespace.
  t = t.replace(/[\t\r\n]+/g, " ");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

async function extractTextFromPdf(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  try {
    const result = await extractText(pdf, { mergePages: true });
    const text = (result as { text?: unknown })?.text;
    if (Array.isArray(text)) return text.join("\n");
    if (typeof text === "string") return text;
    return "";
  } finally {
    try {
      // pdf.js proxy supports destroy() in most builds.
      (pdf as { destroy?: () => void })?.destroy?.();
    } catch {
      // ignore
    }
  }
}

async function extractNumeroFromPdfBytes(bytes: Uint8Array): Promise<string | null> {
  try {
    const rawText = await extractTextFromPdf(bytes);
    console.log("[invoice_extract] rawText_length", rawText.length);

    // Normalizar y luego eliminar timestamps largos tipo 20XXXXXXXXXXXX (14 digitos)
    // antes de cualquier regex de extraccion.
    let t = normalizePdfText(rawText);
    t = t.replace(/\b20\d{12}\b/g, " ");

    // Prioridad 1
    // - Forma fuerte original: "No: 12345678"
    // - Fallback: "Factura No 12345678" (a veces el ':' desaparece en extracción)
    const m1a = t.match(/\bNo\s*:\s*([0-9]{8,12})\b/i);
    if (m1a?.[1]) return m1a[1];
    const m1b = t.match(/\bFactura\s*No\s*[:#\-]?\s*([0-9]{8,12})\b/i);
    if (m1b?.[1]) return m1b[1];

    // Prioridad 2
    const m2a = t.match(/\b(?:Numero|Número|N[°ºo])\s*:\s*([0-9]{8,12})\b/i);
    if (m2a?.[1]) return m2a[1];
    const m2b = t.match(/\bFactura\s*(?:Numero|Número|N[°ºo])\s*[:#\-]?\s*([0-9]{8,12})\b/i);
    if (m2b?.[1]) return m2b[1];

    // Prioridad 3
    const m3 = t.match(/\b([0-9]{10})\b/);
    return m3?.[1] ?? null;
  } catch (e) {
    console.error("[invoice_extract] pdf_text_extract_failed", (e as Error)?.stack ?? e);
    return null;
  }
}

function buildObjectUrl(baseUrl: string, bucket: string, objectPath: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const b = encodeURIComponent(bucket);
  const p = objectPath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/${b}/${p}`;
}

async function downloadPdfBytes(storagePath: string): Promise<Uint8Array> {
  // @ts-ignore - Deno env
  const url = String(Deno.env.get("SUPABASE_URL") ?? "").trim();
  // @ts-ignore - Deno env
  const serviceKey = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!url || !serviceKey) throw new Error("UNEXPECTED");

  const objectUrl = buildObjectUrl(url, BUCKET, storagePath);
  const res = await fetch(objectUrl, {
    method: "GET",
    headers: {
      authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
  });

  if (!res.ok) throw new Error("DOWNLOAD_FAILED");
  const ab = await res.arrayBuffer();
  return new Uint8Array(ab);
}

// @ts-ignore - Deno global
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true, numero: null });
  if (req.method !== "POST") return json({ ok: true, numero: null });

  const body = (await req.json().catch(() => ({}))) as { path?: unknown };
  if (typeof body?.path !== "string") return json({ ok: true, numero: null });
  const storagePath = normalizePath(body.path);
  if (!storagePath) return json({ ok: true, numero: null });

  console.log("[invoice_extract] path", storagePath);

  /*
  Local quick test (no secrets):
    supabase functions serve invoice_extract --no-verify-jwt

    curl -i -X POST 'http://localhost:54321/functions/v1/invoice_extract' \
      -H 'Content-Type: application/json' \
      -d '{"path":"carpeta/mi_factura.pdf"}'
  */

  try {
    const bytes = await downloadPdfBytes(storagePath);
    console.log("[invoice_extract] bytes", bytes.length);

    const numero = await extractNumeroFromPdfBytes(bytes);
    console.log("[invoice_extract] numero_final", numero);

    return json({ ok: true, numero });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg === "DOWNLOAD_FAILED") return json({ ok: true, numero: null });
    console.error("[invoice_extract] unexpected", (e as Error)?.stack ?? e);
    return json({ ok: true, numero: null });
  }
});
