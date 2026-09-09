/**
 * Layer: Provider-Model-Runtime (client side).
 *
 * Credentials the user brings are stored ONLY in this browser (localStorage),
 * never in the database and never in the activity log. They are sent over HTTPS
 * to the app's own server route at request time and forwarded to the provider.
 */
import { getProvider, PROVIDERS } from "./catalog";

const PREFIX = "zanto.provider.";

/** Default local endpoints so Ollama works without a manual Providers save. */
const LOCAL_DEFAULT_BASE: Record<string, string> = {
  ollama: "http://localhost:11434",
};

export type ProviderCredential = { apiKey?: string; baseUrl?: string };

/** Normalize pasted secrets (env lines, quotes, Bearer prefix). */
export function cleanProviderSecret(raw: string): string {
  let key = raw.trim().replace(/^\uFEFF/, "");
  const envLine = key.match(/^[A-Z][A-Z0-9_]*=(.*)$/s);
  if (envLine) key = envLine[1].trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, "").trim();
  return key.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

export function readCredential(providerId: string): ProviderCredential {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PREFIX + providerId);
    const cred = raw ? (JSON.parse(raw) as ProviderCredential) : {};
    if (!cred.baseUrl?.trim()) {
      const fallback = LOCAL_DEFAULT_BASE[providerId];
      if (fallback) return { ...cred, baseUrl: fallback };
    }
    return cred;
  } catch {
    const fallback = LOCAL_DEFAULT_BASE[providerId];
    return fallback ? { baseUrl: fallback } : {};
  }
}

export function writeCredential(providerId: string, cred: ProviderCredential) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PREFIX + providerId, JSON.stringify(cred));
}

export function clearCredential(providerId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PREFIX + providerId);
}

export function isProviderConfigured(providerId: string): boolean {
  const provider = getProvider(providerId);
  if (!provider) return false;
  if (provider.builtInKey) return true;
  const cred = readCredential(providerId);
  if (provider.runtime === "local") return Boolean(cred.baseUrl);
  return Boolean(cred.apiKey);
}

export function configuredProviders(): string[] {
  return PROVIDERS.filter((p) => isProviderConfigured(p.id)).map((p) => p.id);
}

/** Honest local runtime probe. No simulation: a failed probe means "not detected". */
export async function probeLocalRuntime(
  baseUrl: string,
): Promise<{ detected: boolean; detail: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { detected: false, detail: `Risposta ${res.status}` };
    const data = (await res.json()) as { models?: { name: string }[] };
    return {
      detected: true,
      detail: `${data.models?.length ?? 0} modelli locali rilevati`,
    };
  } catch {
    return { detected: false, detail: "Runtime non rilevato su questo endpoint" };
  }
}
