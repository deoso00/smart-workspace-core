import { zipSync, strToU8 } from "fflate";
import type { VfsNode } from "./db";

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadFile(node: VfsNode) {
  triggerDownload(new Blob([node.content], { type: "text/plain;charset=utf-8" }), node.name);
}

export function downloadZip(nodes: VfsNode[], filename: string) {
  const entries: Record<string, Uint8Array> = {};
  for (const node of nodes) {
    if (node.kind !== "file") continue;
    entries[node.path.replace(/^\//, "")] = strToU8(node.content);
  }
  if (Object.keys(entries).length === 0) {
    entries["EMPTY.txt"] = strToU8("Nessun file nel workspace.");
  }
  const zipped = zipSync(entries, { level: 6 });
  triggerDownload(new Blob([zipped as unknown as BlobPart], { type: "application/zip" }), filename);
}

export function downloadText(text: string, filename: string) {
  triggerDownload(new Blob([text], { type: "text/plain;charset=utf-8" }), filename);
}
