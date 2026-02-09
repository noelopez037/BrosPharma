const NOTIF_DISPATCH_URL = "https://gllpbryoozumsjjzatav.functions.supabase.co/notif-dispatch";

export async function dispatchNotifs(limit = 20): Promise<void> {
  const controller = new AbortController();
  const timeoutMs = 8000;
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(NOTIF_DISPATCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ limit }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      const msg = txt ? `HTTP ${res.status}: ${txt}` : `HTTP ${res.status}`;
      throw new Error(msg);
    }
  } finally {
    clearTimeout(t);
  }
}
