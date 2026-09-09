/**
 * Local VFS overlay: when Supabase is slow/unavailable, keep files in the browser
 * so Anteprima and FileExplorer still work on desktop.
 */
const PREFIX = "zanto.localvfs.";

type LocalFile = { path: string; content: string; updatedAt: string };

function key(workspaceId: string) {
  return PREFIX + workspaceId;
}

function readAll(workspaceId: string): Record<string, LocalFile> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key(workspaceId));
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, LocalFile>;
  } catch {
    return {};
  }
}

function writeAll(workspaceId: string, map: Record<string, LocalFile>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key(workspaceId), JSON.stringify(map));
}

export function localVfsWrite(workspaceId: string, path: string, content: string): LocalFile {
  const map = readAll(workspaceId);
  const row: LocalFile = {
    path,
    content,
    updatedAt: new Date().toISOString(),
  };
  map[path] = row;
  writeAll(workspaceId, map);
  return row;
}

export function localVfsList(workspaceId: string): LocalFile[] {
  return Object.values(readAll(workspaceId)).sort((a, b) => a.path.localeCompare(b.path));
}

export function localVfsRead(workspaceId: string, path: string): string | null {
  return readAll(workspaceId)[path]?.content ?? null;
}

export function mergeLocalOverRemote(
  workspaceId: string,
  remote: { path: string; kind: string; content?: string | null }[],
): { path: string; kind: string; content?: string | null }[] {
  const local = readAll(workspaceId);
  const byPath = new Map(remote.map((n) => [n.path, { ...n }]));
  for (const file of Object.values(local)) {
    byPath.set(file.path, {
      path: file.path,
      kind: "file",
      content: file.content,
    });
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}
