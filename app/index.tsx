import { Redirect } from "expo-router";
import React, { useEffect, useState } from "react";

import { supabase } from "../lib/supabase";

export default function Index() {
  const [dest, setDest] = useState<"/(drawer)/(tabs)" | "/login" | null>(null);

  useEffect(() => {
    let alive = true;

    const resolve = async () => {
      const { data } = await supabase.auth.getSession();
      const hasSession = !!data?.session;
      if (!alive) return;
      setDest(hasSession ? "/(drawer)/(tabs)" : "/login");
    };

    resolve().catch(() => {
      if (!alive) return;
      setDest("/login");
    });

    return () => {
      alive = false;
    };
  }, []);

  if (!dest) return null;
  return <Redirect href={dest as any} />;
}
