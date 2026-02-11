type JsonRecord = Record<string, unknown>;

// Minimal Deno typing to keep TS/IDE happy in non-Deno workspaces.
declare const Deno: {
  env: { get: (name: string) => string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-dispatch-secret",
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

function getEnv(name: string): string {
  return String(Deno.env.get(name) ?? "").trim();
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function safeErrorMessage(e: unknown): string {
  const err = e as { message?: unknown; stack?: unknown };
  const msg = typeof err?.message === "string" ? err.message : String(e);
  return msg.slice(0, 1000);
}

function shortErrorMessage(e: unknown): string {
  return safeErrorMessage(e).slice(0, 200);
}

type OutboxRow = {
  id: number | string;
  type: string;
  ref_id?: unknown;
  payload: unknown;
};

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound: "default";
  badge: number;
  data: unknown;
};

type ExpoTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: unknown;
};

async function expoSend(messages: ExpoPushMessage[]): Promise<{ ok: true } | { ok: false; error: string } > {
  if (messages.length === 0) return { ok: true };

  const expoAccessToken = getEnv("EXPO_ACCESS_TOKEN");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (expoAccessToken) headers.authorization = `Bearer ${expoAccessToken}`;

  const batches = chunk(messages, 100);
  const bad: Array<{ message: string }> = [];

  for (const batch of batches) {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers,
      body: JSON.stringify(batch),
    });

    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, error: `EXPO_HTTP_${res.status}: ${raw.slice(0, 500)}` };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: `EXPO_BAD_JSON: ${raw.slice(0, 500)}` };
    }

    const data = (parsed as { data?: unknown })?.data;
    if (!Array.isArray(data)) {
      return { ok: false, error: `EXPO_BAD_RESPONSE: ${raw.slice(0, 500)}` };
    }

    if (data.length !== batch.length) {
      return { ok: false, error: `EXPO_LENGTH_MISMATCH: expected=${batch.length} got=${data.length}` };
    }

    for (let i = 0; i < data.length; i++) {
      const t = data[i] as ExpoTicket;
      if (!t || (t.status !== "ok" && t.status !== "error")) {
        bad.push({ message: "INVALID_TICKET" });
        continue;
      }
      if (t.status !== "ok") {
        bad.push({ message: t.message ?? "EXPO_ERROR" });
      }
    }
  }

  if (bad.length > 0) {
    const sample = bad.slice(0, 5).map((b) => b.message).join(", ");
    return { ok: false, error: `EXPO_TICKET_ERROR count=${bad.length} sample=[${sample}]` };
  }

  return { ok: true };
}

function baseUrl(u: string): string {
  return u.replace(/\/+$/, "");
}

type SupabaseCtx = {
  url: string;
  serviceKey: string;
};

async function sbFetch(ctx: SupabaseCtx, path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers ?? undefined);
  headers.set("apikey", ctx.serviceKey);
  headers.set("authorization", `Bearer ${ctx.serviceKey}`);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  headers.set("accept", "application/json");

  return await fetch(`${baseUrl(ctx.url)}${path}`, { ...init, headers });
}

async function sbJson<T>(res: Response): Promise<T> {
  const raw = await res.text();
  if (!res.ok) {
    let msg = raw;
    try {
      const j = JSON.parse(raw) as { message?: unknown; details?: unknown; hint?: unknown };
      msg = String(j?.message ?? raw);
      const details = j?.details ? ` details=${String(j.details).slice(0, 200)}` : "";
      const hint = j?.hint ? ` hint=${String(j.hint).slice(0, 200)}` : "";
      msg = `${msg}${details}${hint}`;
    } catch {
      // ignore
    }
    throw new Error(`SUPABASE_HTTP_${res.status}: ${msg.slice(0, 1000)}`);
  }

  if (!raw) return [] as unknown as T;
  return JSON.parse(raw) as T;
}

async function sbRpc<T>(ctx: SupabaseCtx, fn: string, args: unknown): Promise<T> {
  const res = await sbFetch(ctx, `/rest/v1/rpc/${encodeURIComponent(fn)}`, {
    method: "POST",
    body: JSON.stringify(args ?? {}),
  });
  return await sbJson<T>(res);
}

async function fetchExpoTokensForUsers(ctx: SupabaseCtx, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const tokens: string[] = [];

  for (const idBatch of chunk(userIds, 500)) {
    const qs = new URLSearchParams();
    qs.set("select", "expo_token");
    qs.append("user_id", `in.(${idBatch.join(",")})`);
    qs.append("enabled", "eq.true");
    qs.append("expo_token", "not.is.null");
    qs.append("expo_token", "neq.");

    const res = await sbFetch(ctx, `/rest/v1/user_push_tokens?${qs.toString()}`, { method: "GET" });
    const rows = await sbJson<Array<{ expo_token: string }>>(res);
    for (const r of rows) {
      const tok = typeof r?.expo_token === "string" ? r.expo_token.trim() : "";
      if (tok) tokens.push(tok);
    }
  }

  return Array.from(new Set(tokens));
}

async function fetchExpoTokensForUsersDedupeDevice(ctx: SupabaseCtx, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];

  // Dedupe by (user_id, device_id). Also avoid sending to rows missing device_id.
  const pickedByDevice = new Map<string, string>();

  for (const idBatch of chunk(userIds, 500)) {
    const qs = new URLSearchParams();
    qs.set("select", "expo_token,user_id,device_id");
    qs.append("user_id", `in.(${idBatch.join(",")})`);
    qs.append("enabled", "eq.true");
    qs.append("device_id", "not.is.null");
    qs.append("expo_token", "not.is.null");
    qs.append("expo_token", "neq.");

    const res = await sbFetch(ctx, `/rest/v1/user_push_tokens?${qs.toString()}`, { method: "GET" });
    const rows = await sbJson<Array<{ expo_token: string; user_id: string; device_id: string }>>(res);
    for (const r of rows) {
      const uid = typeof r?.user_id === "string" ? r.user_id.trim() : "";
      const did = typeof r?.device_id === "string" ? r.device_id.trim() : "";
      const tok = typeof r?.expo_token === "string" ? r.expo_token.trim() : "";
      if (!uid || !did || !tok) continue;

      const key = `${uid}:${did}`;
      if (!pickedByDevice.has(key)) pickedByDevice.set(key, tok);
    }
  }

  return Array.from(new Set(Array.from(pickedByDevice.values())));
}

async function fetchAdminUserIds(ctx: SupabaseCtx): Promise<string[]> {
  const out: string[] = [];
  const pageSize = 1000;
  let offset = 0;

  for (;;) {
    const qs = new URLSearchParams();
    qs.set("select", "id");
    qs.append("role", "eq.ADMIN");
    qs.set("limit", String(pageSize));
    qs.set("offset", String(offset));

    const res = await sbFetch(ctx, `/rest/v1/profiles?${qs.toString()}`, { method: "GET" });
    const rows = await sbJson<Array<{ id?: unknown }>>(res);
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const r of rows) {
      const id = typeof r?.id === "string" ? r.id.trim() : "";
      if (id) out.push(id);
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
    if (offset > 20_000) break;
  }

  return Array.from(new Set(out));
}

async function fetchUserIdsByRoles(ctx: SupabaseCtx, roles: string[]): Promise<string[]> {
  const wanted = Array.from(new Set(roles.map((r) => String(r ?? "").trim()).filter(Boolean)));
  if (wanted.length === 0) return [];

  const out: string[] = [];
  const pageSize = 1000;
  let offset = 0;

  for (;;) {
    const qs = new URLSearchParams();
    qs.set("select", "id");
  qs.append(
    "role",
    `in.(${wanted
      .map((r) => `"${r.replace(/"/g, '\\"')}"`)
      .join(",")})`
  );
    qs.set("limit", String(pageSize));
    qs.set("offset", String(offset));

    const res = await sbFetch(ctx, `/rest/v1/profiles?${qs.toString()}`, { method: "GET" });
    const rows = await sbJson<Array<{ id?: unknown }>>(res);
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const r of rows) {
      const id = typeof r?.id === "string" ? r.id.trim() : "";
      if (id) out.push(id);
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
    if (offset > 20_000) break;
  }

  return Array.from(new Set(out));
}

function coerceVentaId(row: OutboxRow): string {
  const ref = (row as { ref_id?: unknown })?.ref_id;
  if (typeof ref === "number" && Number.isFinite(ref)) return String(Math.trunc(ref));
  if (typeof ref === "string" && ref.trim()) return ref.trim();

  const payload = (row as { payload?: unknown })?.payload;
  const p = (payload && typeof payload === "object") ? (payload as JsonRecord) : {};
  const v = p.venta_id;
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));
  if (typeof v === "string" && v.trim()) return v.trim();

  throw new Error("MISSING_VENTA_ID");
}

function rpcBigintArg(ventaId: string): number | string {
  // Prefer number when safe; otherwise fall back to string (PostgREST will attempt to cast).
  const s = ventaId.trim();
  if (/^\d{1,15}$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return s;
}

// @ts-ignore - Deno global
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const secret = getEnv("DISPATCH_SECRET");
  if (secret) {
    const got = req.headers.get("x-dispatch-secret")?.trim() ?? "";
    if (got !== secret) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  }

  const url = getEnv("SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ ok: false, error: "MISSING_SUPABASE_ENV" }, 500);
  const ctx: SupabaseCtx = { url, serviceKey };

  const body = (await req.json().catch(() => ({}))) as { limit?: unknown };
  const limitRaw = typeof body.limit === "number" ? body.limit : undefined;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw!))) : 20;

  const result = {
    claimed: 0,
    processed: 0,
    errors: [] as Array<{ outbox_id: string; error: string }>,
  };

  let rows: OutboxRow[] = [];
  try {
    const claimed = await sbRpc<OutboxRow[]>(ctx, "rpc_notif_outbox_claim", { p_limit: limit });
    rows = (Array.isArray(claimed) ? claimed : []) as OutboxRow[];
  } catch (e) {
    return json({ ok: false, error: `CLAIM_FAILED: ${safeErrorMessage(e)}` }, 500);
  }
  result.claimed = rows.length;
  if (rows.length === 0) return json({ ok: true, ...result });

  let cachedDestinatarios: Array<{ user_id: string; role: string }> | null = null;
  let cachedTokens: string[] | null = null;
  let cachedAdminUserIds: string[] | null = null;
  let cachedAdminTokens: string[] | null = null;
  let cachedCompraRolesTokens: string[] | null = null;

  const getTokensForVentaNuevos = async (): Promise<string[]> => {
    if (cachedTokens) return cachedTokens;

    const dest = await sbRpc<Array<{ user_id: string; role: string }>>(ctx, "rpc_notif_destinatarios_venta_nuevos", {});
    cachedDestinatarios = (Array.isArray(dest) ? dest : []) as Array<{ user_id: string; role: string }>;

    const userIds = cachedDestinatarios.map((d) => d.user_id).filter((x) => typeof x === "string" && x.length > 0);
    cachedTokens = await fetchExpoTokensForUsers(ctx, userIds);

    console.log("[notif-dispatch] venta_nuevos", "destinatarios", userIds.length, "tokens", cachedTokens.length);
    return cachedTokens;
  };

  const getTokensForAdmins = async (): Promise<string[]> => {
    if (cachedAdminTokens) return cachedAdminTokens;

    cachedAdminUserIds = await fetchAdminUserIds(ctx);
    cachedAdminTokens = await fetchExpoTokensForUsersDedupeDevice(ctx, cachedAdminUserIds);

    console.log("[notif-dispatch] admins", "users", cachedAdminUserIds.length, "tokens", cachedAdminTokens.length);
    return cachedAdminTokens;
  };

  const getTokensForCompraLineaIngresada = async (): Promise<string[]> => {
    if (cachedCompraRolesTokens) return cachedCompraRolesTokens;

    const userIds = await fetchUserIdsByRoles(ctx, ["VENTAS", "BODEGA", "ADMIN"]);
    cachedCompraRolesTokens = await fetchExpoTokensForUsersDedupeDevice(ctx, userIds);

    console.log("[notif-dispatch] compra_linea roles", "users", userIds.length, "tokens", cachedCompraRolesTokens.length);
    return cachedCompraRolesTokens;
  };

  for (const row of rows) {
    const rawId = (row as { id?: unknown })?.id;
    const id = typeof rawId === "string"
      ? rawId.trim()
      : (typeof rawId === "number" && Number.isFinite(rawId) ? String(rawId) : "");
    const type = String((row as { type?: unknown })?.type ?? "");
    const payload = (row as { payload?: unknown })?.payload;
    if (!id) continue;

    try {
      if (type === "VENTA_VISIBLE_NUEVOS") {
        const tokens = await getTokensForVentaNuevos();
        console.log("[notif-dispatch] dispatch", type, "outbox", id, "tokens", tokens.length);

        if (tokens.length > 0) {
          const p = (payload && typeof payload === "object") ? (payload as JsonRecord) : {};
          const clienteNombre = typeof p.cliente_nombre === "string" ? p.cliente_nombre.trim() : "";

          const messages: ExpoPushMessage[] = tokens.map((to) => ({
            to,
            title: "Nueva venta",
            body: clienteNombre || "Venta nueva",
            sound: "default",
            badge: 1,
            data: payload,
          }));

          const sendRes = await expoSend(messages);
          if (!sendRes.ok) throw new Error(sendRes.error);
        }

        await sbRpc(ctx, "rpc_notif_outbox_mark_processed", { p_id: id });
        result.processed++;
        continue;
      }

      if (type === "VENTA_FACTURADA") {
        const ventaId = coerceVentaId(row);

        const outbox: any = row as any;
        const clienteNombreFromPayload = String(outbox?.payload?.cliente_nombre ?? "").trim();
        let clienteNombreFromDb = "";

        if (!clienteNombreFromPayload) {
          try {
            const qs = new URLSearchParams();
            qs.set("select", "cliente_nombre");
            qs.append("id", `eq.${ventaId}`);
            qs.set("limit", "1");

            const res = await sbFetch(ctx, `/rest/v1/ventas?${qs.toString()}`, { method: "GET" });
            const ventaRows = await sbJson<Array<{ cliente_nombre?: unknown }>>(res);
            const ventaRow = Array.isArray(ventaRows) ? ventaRows[0] : null;
            clienteNombreFromDb = String(ventaRow?.cliente_nombre ?? "").trim();
          } catch {
            // ignore; fall back to generic copy
          }
        }

        const clienteNombre = clienteNombreFromPayload || clienteNombreFromDb;
        const body = clienteNombre ? `La factura para ${clienteNombre} está lista.` : "La factura está lista.";

        const dest = await sbRpc<Array<{ user_id: string; role: string }>>(ctx, "rpc_notif_destinatarios_venta_facturada", {
          p_venta_id: rpcBigintArg(ventaId),
        });
        const destinatarios = (Array.isArray(dest) ? dest : []) as Array<{ user_id: string; role: string }>;
        const userIds = Array.from(
          new Set(
            destinatarios
              .map((d) => d.user_id)
              .filter((x) => typeof x === "string" && x.trim().length > 0)
              .map((x) => x.trim())
          )
        );

        const tokens = await fetchExpoTokensForUsersDedupeDevice(ctx, userIds);
        console.log("[notif-dispatch] dispatch", type, "outbox", id, "tokens", tokens.length);

        if (tokens.length > 0) {
          const data = { type: "VENTA_FACTURADA", venta_id: ventaId };
          const messages: ExpoPushMessage[] = tokens.map((to) => ({
            to,
            title: "Venta facturada",
            body,
            sound: "default",
            badge: 1,
            data,
          }));

          const sendRes = await expoSend(messages);
          if (!sendRes.ok) throw new Error(sendRes.error);
        }

        await sbRpc(ctx, "rpc_notif_outbox_mark_processed", { p_id: id });
        result.processed++;
        continue;
      }

      if (type === "VENTA_SOLICITUD_ADMIN") {
        const ventaId = coerceVentaId(row);
        const tokens = await getTokensForAdmins();
        console.log("[notif-dispatch] dispatch", type, "outbox", id, "tokens", tokens.length);

        const p = (payload && typeof payload === "object") ? (payload as JsonRecord) : {};
        const accionUp = String(p.accion ?? "").trim().toUpperCase();
        const clienteNombre = typeof p.cliente_nombre === "string" ? p.cliente_nombre.trim() : "";
        const vendedorCodigo = typeof p.vendedor_codigo === "string" ? p.vendedor_codigo.trim() : "";
        const nota = typeof p.nota === "string" ? p.nota.trim() : "";
        const tag = typeof p.tag === "string" ? p.tag.trim() : "";
        const estado = typeof p.estado === "string" ? p.estado.trim() : "";

        const target = clienteNombre || `Venta #${ventaId}`;
        const body =
          accionUp === "EDICION"
            ? `Solicitud de edición: ${target}`
            : accionUp === "ANULACION"
              ? `Solicitud de anulación: ${target}`
              : accionUp === "REFACTURACION"
                ? `Solicitud de refacturación: ${target}`
                : `Solicitud pendiente: ${target}`;

        if (tokens.length > 0) {
          const data: Record<string, unknown> = {
            kind: "VENTA_SOLICITUD_ADMIN",
            to: "/(drawer)/(tabs)/ventas",
            venta_id: ventaId,
          };
          if (accionUp) data.accion = accionUp;
          if (tag) data.tag = tag;
          if (nota) data.nota = nota;
          if (estado) data.estado = estado;
          if (clienteNombre) data.cliente_nombre = clienteNombre;
          if (vendedorCodigo) data.vendedor_codigo = vendedorCodigo;

          const messages: ExpoPushMessage[] = tokens.map((to) => ({
            to,
            title: "Solicitud pendiente",
            body,
            sound: "default",
            badge: 1,
            data,
          }));

          const sendRes = await expoSend(messages);
          if (!sendRes.ok) throw new Error(sendRes.error);
        }

        await sbRpc(ctx, "rpc_notif_outbox_mark_processed", { p_id: id });
        result.processed++;
        continue;
      }

      if (type === "COMPRA_LINEA_INGRESADA") {
        const tokens = await getTokensForCompraLineaIngresada();
        console.log("[notif-dispatch] dispatch", type, "outbox", id, "tokens", tokens.length);

        const p = (payload && typeof payload === "object") ? (payload as JsonRecord) : {};
        const cantidadRaw = p.cantidad;
        const cantidad = (cantidadRaw === null || cantidadRaw === undefined)
          ? ""
          : (typeof cantidadRaw === "number" && Number.isFinite(cantidadRaw)
            ? String(cantidadRaw)
            : (typeof cantidadRaw === "string" ? cantidadRaw.trim() : ""));

        const productoNombreRaw = p.producto_nombre;
        const productoNombre = typeof productoNombreRaw === "string" ? productoNombreRaw.trim() : "";
        const productoMarcaRaw = p.producto_marca;
        const productoMarca = typeof productoMarcaRaw === "string" ? productoMarcaRaw.trim() : "";

        const title = "Nuevo ingreso:";
        const body = `${cantidad ? `${cantidad} ` : ""}${productoNombre || "Producto actualizado"}${productoMarca ? ` ${productoMarca}` : ""}`;

        if (tokens.length > 0) {
          const data: Record<string, unknown> = { type: "COMPRA_LINEA_INGRESADA", ...p };
          const messages: ExpoPushMessage[] = tokens.map((to) => ({
            to,
            title,
            body,
            sound: "default",
            badge: 1,
            data,
          }));

          const sendRes = await expoSend(messages);
          if (!sendRes.ok) throw new Error(sendRes.error);
        }

        await sbRpc(ctx, "rpc_notif_outbox_mark_processed", { p_id: id });
        result.processed++;
        continue;
      }

      // Unknown/unsupported type: mark processed to avoid stuck items.
      await sbRpc(ctx, "rpc_notif_outbox_mark_processed", { p_id: id });
      result.processed++;
    } catch (e) {
      const errMsg = safeErrorMessage(e);
      const markMsg = shortErrorMessage(e);
      console.error("[notif-dispatch] outbox_failed", type, id, errMsg);
      result.errors.push({ outbox_id: id, error: markMsg });

      try {
        await sbRpc(ctx, "rpc_notif_outbox_mark_error", { p_id: id, p_error: markMsg });
      } catch (markErr) {
        console.error("[notif-dispatch] mark_error_failed", id, safeErrorMessage(markErr));
      }
    }
  }

  return json({ ok: true, ...result });
});
