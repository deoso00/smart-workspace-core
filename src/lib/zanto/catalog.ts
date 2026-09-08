/**
 * Provider / Model / Runtime / Mode catalog.
 *
 * Layer: Provider-Model-Runtime. Pure data + capability declarations, no I/O.
 * The UI must never claim a provider is usable unless `builtInKey` is true or
 * the user supplied a key (see lib/zanto/providers.ts).
 */

export type RuntimeId = "cloud" | "local";
export type ModeId = "AUTO" | "ONLINE" | "LOCAL";

export type ModelInfo = {
  id: string;
  label: string;
  note: string;
};

export type ProviderInfo = {
  id: string;
  label: string;
  /** True only for providers Lovable AI already authenticates server-side. */
  builtInKey: boolean;
  runtime: RuntimeId;
  docs?: string;
  keyLabel?: string;
  models: ModelInfo[];
  description: string;
};

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "lovable",
    label: "Lovable AI",
    builtInKey: true,
    runtime: "cloud",
    description: "Gateway integrato: nessuna chiave richiesta, fatturato sui crediti del progetto.",
    models: [
      { id: "google/gemini-3.7-flash", label: "Gemini 3.7 Flash", note: "Veloce, ottimo default" },
      { id: "google/gemini-3.6-flash", label: "Gemini 3.6 Flash", note: "Efficiente" },
      {
        id: "google/gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro",
        note: "Ragionamento più forte",
      },
      {
        id: "google/gemini-3.1-flash-lite",
        label: "Gemini 3.1 Flash Lite",
        note: "Alto volume, economico",
      },
      { id: "openai/gpt-5.4", label: "GPT-5.4", note: "Frontier reasoning" },
      { id: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini", note: "Bilanciato" },
      { id: "openai/gpt-5.4-nano", label: "GPT-5.4 Nano", note: "Il più rapido" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI (chiave personale)",
    builtInKey: false,
    runtime: "cloud",
    keyLabel: "OpenAI API key (sk-...)",
    docs: "https://platform.openai.com/api-keys",
    description: "Endpoint OpenAI diretto con la tua chiave.",
    models: [
      { id: "gpt-4.1", label: "gpt-4.1", note: "Generalista" },
      { id: "gpt-4.1-mini", label: "gpt-4.1-mini", note: "Economico" },
    ],
  },
  {
    id: "groq",
    label: "Groq (chiave personale)",
    builtInKey: false,
    runtime: "cloud",
    keyLabel: "Groq API key (gsk_...)",
    docs: "https://console.groq.com/keys",
    description: "Inferenza a bassissima latenza.",
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", note: "Versatile" },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B", note: "Istantaneo" },
    ],
  },
  {
    id: "ollama",
    label: "Ollama (locale)",
    builtInKey: false,
    runtime: "local",
    keyLabel: "Endpoint (default http://localhost:11434)",
    docs: "https://ollama.com",
    description:
      "Runtime locale sulla tua macchina. Nessuna simulazione: se non risponde, ZAnto.AI dichiara il runtime non rilevato.",
    models: [
      { id: "llama3.2", label: "llama3.2", note: "Locale" },
      { id: "qwen2.5-coder", label: "qwen2.5-coder", note: "Locale, codice" },
    ],
  },
];

export function getProvider(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export const MODES: { id: ModeId; label: string; help: string }[] = [
  { id: "AUTO", label: "AUTO", help: "Usa il primo provider realmente configurato." },
  { id: "ONLINE", label: "ONLINE", help: "Forza un provider cloud." },
  { id: "LOCAL", label: "LOCAL", help: "Forza un runtime locale rilevato." },
];

export const RUNTIMES: { id: RuntimeId; label: string; help: string }[] = [
  { id: "cloud", label: "Cloud", help: "Esecuzione sui server del provider." },
  { id: "local", label: "Local", help: "Esecuzione su runtime locale (Ollama)." },
];

/** Tool registry (Tools layer). Every tool the agent may call is declared here. */
export type ToolInfo = {
  name: string;
  label: string;
  description: string;
  mutating: boolean;
};

export const TOOLS: ToolInfo[] = [
  {
    name: "vfs_list",
    label: "Elenca file",
    description: "Legge l'albero del filesystem virtuale del workspace.",
    mutating: false,
  },
  {
    name: "vfs_read",
    label: "Leggi file",
    description: "Legge il contenuto di un file virtuale.",
    mutating: false,
  },
  {
    name: "vfs_write",
    label: "Scrivi file",
    description: "Crea o sovrascrive un file virtuale.",
    mutating: true,
  },
  {
    name: "memory_save",
    label: "Salva memoria",
    description: "Registra una nota persistente nel workspace.",
    mutating: true,
  },
  {
    name: "memory_list",
    label: "Leggi memoria",
    description: "Elenca le note di memoria del workspace.",
    mutating: false,
  },
];

/** Modules that are declared but intentionally NOT simulated. */
export const UNAVAILABLE_MODULES = [
  {
    id: "terminal",
    label: "Terminale di sistema",
    reason: "Nessuna shell reale disponibile in ambiente browser/edge.",
  },
  {
    id: "desktop-fs",
    label: "Filesystem del desktop",
    reason: "Accesso al disco locale non disponibile; usa il filesystem virtuale.",
  },
  {
    id: "android-sdk",
    label: "Android SDK / ADB",
    reason: "Runtime non rilevato: richiede una macchina con SDK installato.",
  },
  {
    id: "apk-build",
    label: "Build APK",
    reason: "Runtime non rilevato: nessun toolchain Gradle collegato.",
  },
];
