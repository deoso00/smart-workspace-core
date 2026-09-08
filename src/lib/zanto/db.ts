/**
 * Layer: Storage-API. All persistence goes through this module.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { getGuestKey } from "./guest";

export type Workspace = Tables<"workspaces">;
export type Project = Tables<"projects">;
export type Conversation = Tables<"conversations">;
export type Message = Tables<"messages">;
export type VfsNode = Tables<"vfs_nodes">;
export type Activity = Tables<"activity_log">;
export type ToolPermission = Tables<"tool_permissions">;
export type MemoryNote = Tables<"memory_notes">;

function unwrap<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message);
  return res.data as NonNullable<T>;
}

/* ---------------------------------- workspaces --------------------------------- */

export async function listWorkspaces(): Promise<Workspace[]> {
  return unwrap(
    await supabase
      .from("workspaces")
      .select("*")
      .eq("owner_key", getGuestKey())
      .order("created_at", { ascending: true }),
  );
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const ws = unwrap(
    await supabase
      .from("workspaces")
      .insert({ name, owner_key: getGuestKey() })
      .select()
      .single(),
  );
  await logActivity(ws.id, "workspace", `Workspace "${name}" creato`);
  return ws;
}

export async function renameWorkspace(id: string, name: string) {
  unwrap(await supabase.from("workspaces").update({ name }).eq("id", id).select().single());
}

export async function deleteWorkspace(id: string) {
  const res = await supabase.from("workspaces").delete().eq("id", id);
  if (res.error) throw new Error(res.error.message);
}

/** Returns the first workspace, creating a default one on first run. */
export async function ensureWorkspace(): Promise<Workspace> {
  const existing = await listWorkspaces();
  if (existing.length > 0) return existing[0]!;
  const ws = await createWorkspace("Workspace personale");
  await seedWorkspace(ws.id);
  return ws;
}

async function seedWorkspace(workspaceId: string) {
  await writeFile(workspaceId, "/README.md", "# Benvenuto in ZAnto.AI\n\nQuesto è il filesystem virtuale isolato del workspace.\n");
  await createFolder(workspaceId, "/src");
  await writeFile(workspaceId, "/src/main.ts", 'export const hello = () => "ZAnto.AI";\n');
}

/* ----------------------------------- projects --------------------------------- */

export async function listProjects(workspaceId: string): Promise<Project[]> {
  return unwrap(
    await supabase
      .from("projects")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
  );
}

export async function createProject(
  workspaceId: string,
  name: string,
  description = "",
): Promise<Project> {
  const project = unwrap(
    await supabase
      .from("projects")
      .insert({ workspace_id: workspaceId, name, description, owner_key: getGuestKey() })
      .select()
      .single(),
  );
  await logActivity(workspaceId, "project", `Progetto "${name}" creato`);
  return project;
}

export async function updateProject(id: string, patch: Partial<Pick<Project, "name" | "description">>) {
  unwrap(await supabase.from("projects").update(patch).eq("id", id).select().single());
}

export async function deleteProject(id: string) {
  const res = await supabase.from("projects").delete().eq("id", id);
  if (res.error) throw new Error(res.error.message);
}

/* --------------------------------- conversations ------------------------------- */

export async function listConversations(workspaceId: string): Promise<Conversation[]> {
  return unwrap(
    await supabase
      .from("conversations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }),
  );
}

export async function createConversation(
  workspaceId: string,
  init: Partial<Pick<Conversation, "title" | "provider" | "model" | "runtime" | "mode" | "project_id">> = {},
): Promise<Conversation> {
  const convo = unwrap(
    await supabase
      .from("conversations")
      .insert({ workspace_id: workspaceId, owner_key: getGuestKey(), ...init })
      .select()
      .single(),
  );
  await logActivity(workspaceId, "conversation", `Conversazione creata`);
  return convo;
}

export async function updateConversation(
  id: string,
  patch: Partial<
    Pick<Conversation, "title" | "provider" | "model" | "runtime" | "mode" | "agent_enabled" | "project_id">
  >,
) {
  unwrap(await supabase.from("conversations").update(patch).eq("id", id).select().single());
}

export async function touchConversation(id: string) {
  await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id);
}

export async function deleteConversation(id: string) {
  const res = await supabase.from("conversations").delete().eq("id", id);
  if (res.error) throw new Error(res.error.message);
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const res = await supabase.from("conversations").select("*").eq("id", id).maybeSingle();
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/* ----------------------------------- messages --------------------------------- */

export async function listMessages(conversationId: string): Promise<Message[]> {
  return unwrap(
    await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }),
  );
}

export async function addMessage(
  conversationId: string,
  role: "user" | "assistant" | "system",
  content: string,
  parts: unknown[] = [],
): Promise<Message> {
  const msg = unwrap(
    await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role,
        content,
        parts: parts as never,
        owner_key: getGuestKey(),
      })
      .select()
      .single(),
  );
  await touchConversation(conversationId);
  return msg;
}

export async function updateMessage(id: string, content: string, parts: unknown[] = []) {
  await supabase.from("messages").update({ content, parts: parts as never }).eq("id", id);
}

/* ------------------------------------- VFS ------------------------------------ */

export async function listNodes(workspaceId: string): Promise<VfsNode[]> {
  return unwrap(
    await supabase
      .from("vfs_nodes")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("path", { ascending: true }),
  );
}

function parentPath(path: string): string | null {
  const idx = path.lastIndexOf("/");
  if (idx <= 0) return null;
  return path.slice(0, idx);
}

async function findByPath(workspaceId: string, path: string): Promise<VfsNode | null> {
  const res = await supabase
    .from("vfs_nodes")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("path", path)
    .maybeSingle();
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

async function resolveParentId(workspaceId: string, path: string): Promise<string | null> {
  const parent = parentPath(path);
  if (!parent) return null;
  const node = await findByPath(workspaceId, parent);
  if (node) return node.id;
  const created = await createFolder(workspaceId, parent);
  return created.id;
}

export async function createFolder(workspaceId: string, path: string): Promise<VfsNode> {
  const existing = await findByPath(workspaceId, path);
  if (existing) return existing;
  const parent_id = await resolveParentId(workspaceId, path);
  const node = unwrap(
    await supabase
      .from("vfs_nodes")
      .insert({
        workspace_id: workspaceId,
        owner_key: getGuestKey(),
        parent_id,
        kind: "folder",
        name: path.split("/").pop() ?? path,
        path,
      })
      .select()
      .single(),
  );
  await logActivity(workspaceId, "vfs", `Cartella creata ${path}`);
  return node;
}

export async function writeFile(
  workspaceId: string,
  path: string,
  content: string,
): Promise<VfsNode> {
  const existing = await findByPath(workspaceId, path);
  if (existing) {
    const updated = unwrap(
      await supabase.from("vfs_nodes").update({ content }).eq("id", existing.id).select().single(),
    );
    await logActivity(workspaceId, "vfs", `File salvato ${path}`);
    return updated;
  }
  const parent_id = await resolveParentId(workspaceId, path);
  const node = unwrap(
    await supabase
      .from("vfs_nodes")
      .insert({
        workspace_id: workspaceId,
        owner_key: getGuestKey(),
        parent_id,
        kind: "file",
        name: path.split("/").pop() ?? path,
        path,
        content,
      })
      .select()
      .single(),
  );
  await logActivity(workspaceId, "vfs", `File creato ${path}`);
  return node;
}

export async function renameNode(workspaceId: string, node: VfsNode, newName: string) {
  const parent = parentPath(node.path) ?? "";
  const newPath = `${parent}/${newName}`;
  const descendants = (await listNodes(workspaceId)).filter((n) =>
    n.path.startsWith(`${node.path}/`),
  );
  unwrap(
    await supabase
      .from("vfs_nodes")
      .update({ name: newName, path: newPath })
      .eq("id", node.id)
      .select()
      .single(),
  );
  for (const child of descendants) {
    await supabase
      .from("vfs_nodes")
      .update({ path: newPath + child.path.slice(node.path.length) })
      .eq("id", child.id);
  }
  await logActivity(workspaceId, "vfs", `Rinominato ${node.path} → ${newPath}`);
}

export async function deleteNode(workspaceId: string, node: VfsNode) {
  const res = await supabase.from("vfs_nodes").delete().eq("id", node.id);
  if (res.error) throw new Error(res.error.message);
  await logActivity(workspaceId, "vfs", `Eliminato ${node.path}`);
}

/* ----------------------------------- activity --------------------------------- */

export async function logActivity(
  workspaceId: string | null,
  kind: string,
  message: string,
  meta: Record<string, unknown> = {},
) {
  await supabase.from("activity_log").insert({
    workspace_id: workspaceId,
    owner_key: getGuestKey(),
    kind,
    message,
    meta: meta as never,
  });
}

export async function listActivity(workspaceId: string, limit = 100): Promise<Activity[]> {
  return unwrap(
    await supabase
      .from("activity_log")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit),
  );
}

/* -------------------------------- tool permissions ---------------------------- */

export async function listToolPermissions(workspaceId: string): Promise<ToolPermission[]> {
  return unwrap(
    await supabase.from("tool_permissions").select("*").eq("workspace_id", workspaceId),
  );
}

export async function setToolPermission(workspaceId: string, toolName: string, allowed: boolean) {
  unwrap(
    await supabase
      .from("tool_permissions")
      .upsert(
        { workspace_id: workspaceId, owner_key: getGuestKey(), tool_name: toolName, allowed },
        { onConflict: "workspace_id,tool_name" },
      )
      .select()
      .single(),
  );
  await logActivity(workspaceId, "permission", `Tool ${toolName} ${allowed ? "abilitato" : "disabilitato"}`);
}

/* ------------------------------------ memory ---------------------------------- */

export async function listMemory(workspaceId: string): Promise<MemoryNote[]> {
  return unwrap(
    await supabase
      .from("memory_notes")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
  );
}

export async function saveMemory(workspaceId: string, label: string, body: string) {
  unwrap(
    await supabase
      .from("memory_notes")
      .insert({ workspace_id: workspaceId, owner_key: getGuestKey(), label, body })
      .select()
      .single(),
  );
  await logActivity(workspaceId, "memory", `Nota "${label}" salvata`);
}

export async function deleteMemory(id: string) {
  const res = await supabase.from("memory_notes").delete().eq("id", id);
  if (res.error) throw new Error(res.error.message);
}
