import { supabase } from "./supabase";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function dispatchOnce(limit: number) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;

  if (!token) {
    throw new Error("NO_SESSION");
  }

  const { data: out, error } = await supabase.functions.invoke(
    "notif-dispatch",
    {
      body: { limit },
      headers: {
        Authorization: `Bearer ${token}`,
        ...(process.env.EXPO_PUBLIC_DISPATCH_SECRET
          ? { "x-dispatch-secret": process.env.EXPO_PUBLIC_DISPATCH_SECRET }
          : {}),
      },
    }
  );

  if (error) {
    throw new Error(`[notif-dispatch] ${error.message}`);
  }

  if (out?.ok === false) {
    throw new Error(out.error || "DISPATCH_FAILED");
  }

  return out;
}

async function dispatchWithRetry(limit: number) {
  let lastError: unknown;
  const delays = [0, 800, 2000];

  for (const delay of delays) {
    if (delay) {
      await sleep(delay);
    }

    try {
      return await dispatchOnce(limit);
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error(String(lastError ?? "DISPATCH_FAILED"));
}

type DispatchResult = Awaited<ReturnType<typeof dispatchOnce>>;

let inFlight: Promise<DispatchResult> | null = null;

export async function dispatchNotifs(limit = 20) {
  if (!inFlight) {
    inFlight = dispatchWithRetry(limit).finally(() => {
      inFlight = null;
    });
  }

  return inFlight;
}
