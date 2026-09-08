import type { SupabaseClient } from "@supabase/supabase-js";

/** Server-side VFS write (mirrors client writeFile folder creation). */
export async function writeVfsFileServer(
  supabase: SupabaseClient,
  workspaceId: string,
  ownerKey: string,
  path: string,
  content: string,
): Promise<{ ok: true; path: string; bytes: number } | { error: string }> {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return { error: "Percorso non valido" };

  let currentPath = "";
  let parentId: string | null = null;

  for (let i = 0; i < segments.length - 1; i++) {
    currentPath += `/${segments[i]}`;
    const found = await supabase
      .from("vfs_nodes")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("path", currentPath)
      .maybeSingle();
    if (found.data) {
      parentId = found.data.id;
    } else {
      const created: {
        data: { id: string } | null;
        error: { message: string } | null;
      } = await supabase
        .from("vfs_nodes")
        .insert({
          workspace_id: workspaceId,
          owner_key: ownerKey,
          parent_id: parentId,
          kind: "folder",
          name: segments[i]!,
          path: currentPath,
        })
        .select("id")
        .single();
      if (created.error || !created.data) {
        return { error: created.error?.message ?? "Creazione cartella fallita" };
      }
      parentId = created.data.id;
    }
  }

  const fullPath = `/${segments.join("/")}`;
  const existing = await supabase
    .from("vfs_nodes")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("path", fullPath)
    .maybeSingle();

  if (existing.data) {
    const res = await supabase.from("vfs_nodes").update({ content }).eq("id", existing.data.id);
    if (res.error) return { error: res.error.message };
  } else {
    const res = await supabase.from("vfs_nodes").insert({
      workspace_id: workspaceId,
      owner_key: ownerKey,
      parent_id: parentId,
      kind: "file",
      name: segments[segments.length - 1]!,
      path: fullPath,
      content,
    });
    if (res.error) return { error: res.error.message };
  }

  await supabase.from("activity_log").insert({
    workspace_id: workspaceId,
    owner_key: ownerKey,
    kind: "tool",
    message: `Media salvato ${fullPath}`,
  });

  return { ok: true, path: fullPath, bytes: content.length };
}
