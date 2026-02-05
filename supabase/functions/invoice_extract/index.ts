// @ts-nocheck
// Supabase Edge Function: invoice_extract
//
// Input:  { path: string }
// Output: { ok: true, numero: string | null }
//
// Extracts invoice number from a DIGITAL PDF (no OCR) by looking for:
//   /\bNo:\s*([0-9]{4,})\b/i

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getDocument } from "https://esm.sh/pdfjs-dist@4.10.38/legacy/build/pdf.mjs";

const BUCKET = "Ventas-Docs";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-headers", "authorization, x-client-info, apikey, content-type");
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function extractPdfText(pdfBytes: Uint8Array): Promise<string> {
  // pdfjs in Edge Functions: disable worker.
  const loadingTask = getDocument({ data: pdfBytes, disableWorker: true } as any);
  const pdf = await loadingTask.promise;
  let out = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = (content as any)?.items ?? [];
    const pageText = items
      .map((it: any) => String(it?.str ?? ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (pageText) out += (out ? "\n" : "") + pageText;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, { status: 200 });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, { status: 405 });

  try {
    const { path } = (await req.json().catch(() => ({}))) as { path?: string };
    const cleanPath = String(path ?? "").trim().replace(/^\/+/, "");
    if (!cleanPath) return json({ ok: false, error: "Missing path" }, { status: 400 });

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !serviceKey) return json({ ok: false, error: "Missing env" }, { status: 500 });

    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: blob, error } = await supabase.storage.from(BUCKET).download(cleanPath);
    if (error) throw error;
    if (!blob) return json({ ok: true, numero: null }, { status: 200 });

    const ab = await blob.arrayBuffer();
    const text = await extractPdfText(new Uint8Array(ab));

    const m = text.match(/\bNo:\s*([0-9]{4,})\b/i);
    const numero = m?.[1] ? String(m[1]).trim() : null;
    return json({ ok: true, numero }, { status: 200 });
  } catch {
    // Non-blocking for UI: treat errors as "not found".
    return json({ ok: true, numero: null }, { status: 200 });
  }
});

// Deploy:
//   supabase functions deploy invoice_extract
