import { supabase } from "./supabase";

export async function dispatchNotifs(limit = 20) {
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
