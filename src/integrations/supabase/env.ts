/**
 * Resolve Supabase URL + publishable key from either naming scheme.
 * Lovable / Vite often inject VITE_*; servers and Vercel often use SUPABASE_*.
 */
export function resolveSupabasePublicEnv(): { url: string; key: string } {
  const viteUrl =
    typeof import.meta !== "undefined"
      ? String(import.meta.env?.["VITE_SUPABASE_URL"] ?? "")
      : "";
  const viteKey =
    typeof import.meta !== "undefined"
      ? String(import.meta.env?.["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "")
      : "";

  const url =
    viteUrl ||
    process.env["VITE_SUPABASE_URL"] ||
    process.env["SUPABASE_URL"] ||
    "";
  const key =
    viteKey ||
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["SUPABASE_PUBLISHABLE_KEY"] ||
    "";

  return { url: url.trim(), key: key.trim() };
}

export function assertSupabasePublicEnv(): { url: string; key: string } {
  const { url, key } = resolveSupabasePublicEnv();
  if (!url || !key) {
    const missing = [
      ...(!url ? ["VITE_SUPABASE_URL / SUPABASE_URL"] : []),
      ...(!key ? ["VITE_SUPABASE_PUBLISHABLE_KEY / SUPABASE_PUBLISHABLE_KEY"] : []),
    ];
    throw new Error(
      `Missing Supabase environment variable(s): ${missing.join(", ")}. ` +
        `Su Lovable: Connect Supabase / Cloud, oppure imposta le variabili e fai Publish.`,
    );
  }
  return { url, key };
}
