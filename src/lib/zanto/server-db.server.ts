import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { assertSupabasePublicEnv } from "@/integrations/supabase/env";

/**
 * Layer: Storage-API (server side). Uses the publishable key; the guest-open RLS
 * policies apply. Never used for privileged operations.
 */
export function createServerSupabase() {
  const { url, key } = assertSupabasePublicEnv();
  return createClient<Database>(url, key, {
    auth: { persistSession: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}
