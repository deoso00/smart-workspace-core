import { createFileRoute } from "@tanstack/react-router";
import { FileExplorer } from "@/components/zanto/FileExplorer";
import { useWorkspace } from "@/lib/zanto/workspace-context";

export const Route = createFileRoute("/files")({
  head: () => ({
    meta: [
      { title: "File — ZAnto.AI" },
      {
        name: "description",
        content: "Filesystem virtuale isolato per workspace: crea, modifica, rinomina, esporta ZIP.",
      },
      { property: "og:title", content: "File — ZAnto.AI" },
      { property: "og:description", content: "Editor di codice e filesystem virtuale per workspace." },
    ],
  }),
  component: FilesPage,
});

function FilesPage() {
  const { activeId } = useWorkspace();
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div>
        <h1 className="font-display text-xl font-semibold">File del workspace</h1>
        <p className="text-sm text-muted-foreground">
          Filesystem virtuale isolato: ogni workspace vede solo i propri file.
        </p>
      </div>
      <div className="min-h-0 flex-1">
        {activeId ? (
          <FileExplorer workspaceId={activeId} />
        ) : (
          <p className="text-sm text-muted-foreground">Preparo il workspace…</p>
        )}
      </div>
    </div>
  );
}
