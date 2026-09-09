import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileCode2,
  FilePlus2,
  FolderPlus,
  Pencil,
  Save,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { deleteNode, listNodes, renameNode, writeFile, createFolder, type VfsNode } from "@/lib/zanto/db";
import { downloadFile, downloadZip } from "@/lib/zanto/export";
import { localVfsList, localVfsWrite } from "@/lib/zanto/local-vfs";

type TreeNode = VfsNode & { children: TreeNode[] };

function isDataImage(content: string | null | undefined): boolean {
  return Boolean(content?.startsWith("data:image/"));
}

function isDataVideo(content: string | null | undefined): boolean {
  return Boolean(content?.startsWith("data:video/"));
}

function buildTree(nodes: VfsNode[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const node of nodes) map.set(node.id, { ...node, children: [] });
  const roots: TreeNode[] = [];
  for (const node of map.values()) {
    const parent = node.parent_id ? map.get(node.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (list: TreeNode[]) => {
    list.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1,
    );
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

export function FileExplorer({
  workspaceId,
  compact = false,
}: {
  workspaceId: string;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: nodes = [] } = useQuery({
    queryKey: ["vfs", workspaceId],
    queryFn: async () => {
      const remote = await listNodes(workspaceId).catch(() => [] as VfsNode[]);
      const byPath = new Map(remote.map((n) => [n.path, n]));
      for (const file of localVfsList(workspaceId)) {
        const existing = byPath.get(file.path);
        if (existing && existing.kind === "file") {
          byPath.set(file.path, { ...existing, content: file.content });
        } else if (!existing) {
          byPath.set(file.path, {
            id: `local:${file.path}`,
            workspace_id: workspaceId,
            owner_key: "local",
            parent_id: null,
            kind: "file",
            name: file.path.split("/").pop() || file.path,
            path: file.path,
            content: file.content,
            created_at: file.updatedAt,
            updated_at: file.updatedAt,
          } as VfsNode);
        }
      }
      return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
    },
  });
  const tree = useMemo(() => buildTree(nodes), [nodes]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  useEffect(() => {
    setDraft(selected?.content ?? "");
  }, [selected?.id, selected?.content]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["vfs", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["activity", workspaceId] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      await writeFile(workspaceId, selected.path, draft);
    },
    onSuccess: () => {
      invalidate();
      toast.success("File salvato");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const promptNew = async (kind: "file" | "folder") => {
    const base =
      selected && selected.kind === "folder"
        ? selected.path
        : selected
          ? selected.path.slice(0, selected.path.lastIndexOf("/"))
          : "";
    const input = window.prompt(
      kind === "file" ? "Percorso del nuovo file" : "Percorso della nuova cartella",
      `${base}/nuovo${kind === "file" ? ".txt" : "-cartella"}`,
    );
    if (!input) return;
    const path = input.startsWith("/") ? input : `/${input}`;
    try {
      if (kind === "file") await writeFile(workspaceId, path, "");
      else await createFolder(workspaceId, path);
      invalidate();
      toast.success(kind === "file" ? "File creato" : "Cartella creata");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const doRename = async (node: VfsNode) => {
    const name = window.prompt("Nuovo nome", node.name);
    if (!name || name === node.name) return;
    try {
      await renameNode(workspaceId, node, name);
      invalidate();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const doDelete = async (node: VfsNode) => {
    if (!window.confirm(`Eliminare ${node.path}?`)) return;
    try {
      await deleteNode(workspaceId, node);
      if (selectedId === node.id) setSelectedId(null);
      invalidate();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const renderRow = (node: TreeNode, depth: number) => {
    const isFolder = node.kind === "folder";
    const open = expanded[node.id] ?? true;
    return (
      <div key={node.id}>
        <div
          className={`group flex items-center gap-1 rounded-md px-1.5 py-1 text-sm ${
            selectedId === node.id ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
          }`}
          style={{ paddingLeft: depth * 12 + 6 }}
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            onClick={() => {
              setSelectedId(node.id);
              if (isFolder) setExpanded((e) => ({ ...e, [node.id]: !open }));
            }}
          >
            {isFolder ? (
              open ? (
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              )
            ) : (
              <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{node.name}</span>
          </button>
          <span className="hidden gap-0.5 group-hover:flex">
            <button
              type="button"
              title="Rinomina"
              className="p-1 text-muted-foreground hover:text-foreground"
              onClick={() => void doRename(node)}
            >
              <Pencil className="size-3" />
            </button>
            {!isFolder && (
              <button
                type="button"
                title="Scarica"
                className="p-1 text-muted-foreground hover:text-foreground"
                onClick={() => downloadFile(node)}
              >
                <Download className="size-3" />
              </button>
            )}
            <button
              type="button"
              title="Elimina"
              className="p-1 text-muted-foreground hover:text-destructive"
              onClick={() => void doDelete(node)}
            >
              <Trash2 className="size-3" />
            </button>
          </span>
        </div>
        {isFolder && open && node.children.map((child) => renderRow(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className={`flex min-h-0 ${compact ? "flex-col" : "flex-col lg:flex-row"} h-full gap-3`}>
      <div
        className={`flex min-h-0 flex-col rounded-lg border border-border bg-card ${
          compact ? "max-h-64" : "lg:w-72"
        }`}
      >
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
          <span className="mr-auto text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Filesystem virtuale
          </span>
          <Button variant="ghost" size="icon" title="Nuovo file" onClick={() => void promptNew("file")}>
            <FilePlus2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Nuova cartella"
            onClick={() => void promptNew("folder")}
          >
            <FolderPlus className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Esporta ZIP"
            onClick={() => downloadZip(nodes, "zanto-workspace.zip")}
          >
            <Download className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {tree.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">Nessun file. Creane uno.</p>
          ) : (
            tree.map((node) => renderRow(node, 0))
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <span className="truncate font-mono text-xs text-muted-foreground">
            {selected ? selected.path : "nessun file selezionato"}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={!selected || selected.kind !== "file" || save.isPending}
              onClick={() => save.mutate()}
            >
              <Save className="size-3.5" />
              Salva
            </Button>
          </div>
        </div>
        {selected && selected.kind === "file" ? (
          isDataImage(draft) ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
              <img
                src={draft}
                alt={selected.name}
                className="mx-auto max-h-[min(60vh,420px)] max-w-full rounded-md border border-border object-contain"
              />
              <p className="text-center text-[10px] text-muted-foreground">
                Anteprima immagine (contenuto data-URL nel VFS)
              </p>
            </div>
          ) : isDataVideo(draft) ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
              <video
                src={draft}
                controls
                className="mx-auto max-h-[min(60vh,420px)] max-w-full rounded-md border border-border"
              />
            </div>
          ) : (
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent font-mono text-xs leading-relaxed focus-visible:ring-0"
            />
          )
        ) : (
          <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">
            Seleziona un file per aprirlo nell'editor.
          </div>
        )}
      </div>
    </div>
  );
}
