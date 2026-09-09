/**
 * Live preview for VFS HTML/CSS/JS sites.
 * Desktop: real http://127.0.0.1:PORT via Electron.
 * Web/Lovable: blob URL tree (same UX, no separate host).
 */

export type PreviewFileMap = Record<string, string>;

export type PreviewSession = {
  url: string;
  displayUrl: string;
  entryPath: string;
  dispose: () => void;
};

type DesktopPreviewApi = {
  startPreview: (files: PreviewFileMap) => Promise<{ url: string; port: number }>;
  stopPreview: () => Promise<void>;
  openExternal?: (url: string) => Promise<void>;
};

function desktopApi(): DesktopPreviewApi | null {
  if (typeof window === "undefined") return null;
  const api = (window as { zantoDesktop?: DesktopPreviewApi & { isDesktop?: boolean } }).zantoDesktop;
  if (!api?.startPreview) return null;
  return api;
}

export function normalizeVfsPath(path: string): string {
  let p = path.trim().replace(/\\/g, "/");
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/+/g, "/");
  return p;
}

export function guessMime(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export function pickPreviewEntry(files: PreviewFileMap): string | null {
  const paths = Object.keys(files).map(normalizeVfsPath);
  if (paths.includes("/index.html")) return "/index.html";
  if (paths.includes("/index.htm")) return "/index.htm";
  const html = paths.find((p) => p.endsWith(".html") || p.endsWith(".htm"));
  return html ?? null;
}

export function filesFromVfsNodes(
  nodes: { path: string; kind: string; content?: string | null }[],
): PreviewFileMap {
  const out: PreviewFileMap = {};
  for (const node of nodes) {
    if (node.kind !== "file") continue;
    const path = normalizeVfsPath(node.path);
    out[path] = node.content ?? "";
  }
  return out;
}

function resolveRelative(fromPath: string, rel: string): string {
  if (/^(https?:|data:|blob:|mailto:|#)/i.test(rel)) return rel;
  if (rel.startsWith("/")) return normalizeVfsPath(rel);
  const dir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
  const parts = `${dir}/${rel}`.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return `/${stack.join("/")}`;
}

function rewriteHtml(html: string, entryPath: string, blobByPath: Map<string, string>): string {
  return html.replace(
    /(\b(?:src|href)\s*=\s*)(["'])([^"']+)\2/gi,
    (full, prefix: string, quote: string, raw: string) => {
      const resolved = resolveRelative(entryPath, raw);
      if (!resolved.startsWith("/")) return full;
      const blob = blobByPath.get(resolved);
      if (!blob) return full;
      return `${prefix}${quote}${blob}${quote}`;
    },
  );
}

function createBlobPreview(files: PreviewFileMap, entryPath: string): PreviewSession {
  const blobByPath = new Map<string, string>();
  const toRevoke: string[] = [];

  for (const [path, content] of Object.entries(files)) {
    const norm = normalizeVfsPath(path);
    if (norm === entryPath) continue;
    const url = URL.createObjectURL(new Blob([content], { type: guessMime(norm) }));
    blobByPath.set(norm, url);
    toRevoke.push(url);
  }

  let html = files[entryPath] ?? "";
  html = rewriteHtml(html, entryPath, blobByPath);
  const entryUrl = URL.createObjectURL(new Blob([html], { type: "text/html; charset=utf-8" }));
  toRevoke.push(entryUrl);

  return {
    url: entryUrl,
    displayUrl: `blob://anteprima${entryPath}`,
    entryPath,
    dispose: () => {
      for (const u of toRevoke) URL.revokeObjectURL(u);
    },
  };
}

/** Prefer Electron localhost URL; fall back to blob preview on web/Lovable. */
export async function startPreviewSession(files: PreviewFileMap): Promise<PreviewSession> {
  const entryPath = pickPreviewEntry(files);
  if (!entryPath) {
    throw new Error("Nessun file HTML nel progetto. Chiedi all'Agent di creare /index.html");
  }

  const desktop = desktopApi();
  if (desktop) {
    const normalized: PreviewFileMap = {};
    for (const [path, content] of Object.entries(files)) {
      normalized[normalizeVfsPath(path)] = content;
    }
    const { url } = await desktop.startPreview(normalized);
    const pageUrl = url.endsWith("/") ? `${url.replace(/\/$/, "")}${entryPath}` : `${url}${entryPath}`;
    return {
      url: pageUrl,
      displayUrl: pageUrl,
      entryPath,
      dispose: () => {
        void desktop.stopPreview();
      },
    };
  }

  return createBlobPreview(files, entryPath);
}

export function previewApiUrl(workspaceId: string, filePath: string): string {
  const path = normalizeVfsPath(filePath);
  const qs = new URLSearchParams({ workspaceId, path });
  return `/api/preview?${qs.toString()}`;
}
