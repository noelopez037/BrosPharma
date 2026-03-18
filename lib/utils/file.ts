/** Extrae extensión de un URI (sin query string). */
export function extFromUri(uri: string): string {
  const clean = String(uri ?? "").split("?")[0];
  const parts = clean.split(".");
  if (parts.length < 2) return "jpg";
  return parts[parts.length - 1].toLowerCase();
}

/** Mapea extensión a MIME type para imágenes y PDFs. */
export function mimeFromExt(ext: string): string {
  switch (ext) {
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    default:
      return "image/jpeg";
  }
}

/** Lee un URI local y lo convierte a ArrayBuffer (para uploads a Supabase Storage). */
export async function uriToArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error("No se pudo leer la imagen");
  return await res.arrayBuffer();
}
