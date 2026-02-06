// @ts-nocheck
// Supabase Edge Function: invoice_extract
//
// Contract: ALWAYS returns HTTP 200 + JSON.
// - 200 { ok:true, numero:string|null }
// - 200 { ok:false, error:"PDF_PARSE_FAILED"|"DOWNLOAD_FAILED"|"MISSING_PATH" }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import pdf from "https://esm.sh/pdf-parse@1.1.1?deno";

const BUCKET = "Ventas-Docs";

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

function json(obj: unknown) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    ...CORS_HEADERS,
  });
  return new Response(JSON.stringify(obj), { status: 200, headers });
}

function errorDetails(e: any) {
  if (!e) return null;
  if (typeof e === "string") return { message: e };
  return {
    name: e?.name,
    message: e?.message,
    stack: e?.stack,
    status: e?.status,
    statusCode: e?.statusCode,
    code: e?.code,
  };
}

function normalizePath(input: unknown): string {
  let path = String(input ?? "").trim();
  path = path.replace(/^\/+/, "");
  if (path.startsWith(`${BUCKET}/`)) path = path.slice(`${BUCKET}/`.length);
  if (path.startsWith("Ventas-Docs/")) path = path.slice("Ventas-Docs/".length);
  path = path.replace(/^\/+/, "");
  return path;
}

function encodePathSegments(p: string): string {
  return p
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join("/");
}

async function downloadPdfBytes(path: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; details?: any }> {
  const url = String(Deno.env.get("SUPABASE_URL") ?? "").trim();
  const serviceKey = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();

  if (!url || !serviceKey) {
    return { ok: false, details: { error: "MISSING_ENV" } };
  }

  const objUrl = `${url.replace(/\/+$/, "")}/storage/v1/object/${BUCKET}/${encodePathSegments(path)}`;
  const res = await fetch(objUrl, {
    method: "GET",
    headers: {
      authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      accept: "application/pdf",
    },
  }).catch((e) => {
    throw new Error(`FETCH_FAILED: ${e?.message ?? String(e)}`);
  });

  if (!res.ok) {
    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch {}
    return { ok: false, details: { status: res.status, statusText: res.statusText, body: bodyText } };
  }

  const ab = await res.arrayBuffer();
  return { ok: true, bytes: new Uint8Array(ab) };
}

Deno.serve(async (req) => {
  // Always return 200 JSON (even on failures).
  try {
    if (req.method === "OPTIONS") return json({ ok: true });

    let path = "";
    if (req.method === "GET") {
      const url = new URL(req.url);
      path = normalizePath(url.searchParams.get("path"));
    } else {
      const body = (await req.json().catch(() => ({}))) as { path?: string };
      path = normalizePath(body?.path);
    }
    if (!path) return json({ ok: false, error: "MISSING_PATH" });

    console.log("[invoice_extract] path", path);

    // Download PDF using service role (no client cookies).
    let pdfBytes: Uint8Array | null = null;
    try {
      const dl = await downloadPdfBytes(path);
      if (!dl.ok) {
        console.error("[invoice_extract] download failed", dl.details);
        return json({ ok: false, error: "DOWNLOAD_FAILED" });
      }
      pdfBytes = dl.bytes;
    } catch (e) {
      console.error("[invoice_extract] download error", e?.stack ?? e);
      return json({ ok: false, error: "DOWNLOAD_FAILED" });
    }

    // Parse PDF -> text (no OCR).
    let text = "";
    try {
      const parsed = await pdf(pdfBytes);
      text = String(parsed?.text ?? "");
    } catch (e) {
      console.error("[invoice_extract] pdf parse failed", e?.stack ?? e);
      return json({ ok: false, error: "PDF_PARSE_FAILED" });
    }

    console.log("[invoice_extract] text_length", text.length);

    const re = /(?:\bNo\b|N[º°o])\s*[:#.]?\s*([0-9]{4,20})\b/i;
    const m = text.match(re);
    const numero = m?.[1] ? String(m[1]).trim() : null;
    console.log("[invoice_extract] numero", numero ?? null);

    return json({ ok: true, numero });
  } catch (e) {
    console.error("[invoice_extract] unexpected", e?.stack ?? e);
    // Keep the union small for callers.
    return json({ ok: false, error: "PDF_PARSE_FAILED" });
  }
});
