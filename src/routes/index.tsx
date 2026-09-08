import { createFileRoute } from "@tanstack/react-router";
import { ChatWorkspace } from "@/components/zanto/ChatWorkspace";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ZAnto.AI — Chat AI con agent e filesystem virtuale" },
      {
        name: "description",
        content:
          "Chat AI in streaming con selezione provider, modello e modalità, agent con tool reali e filesystem virtuale per workspace.",
      },
      { property: "og:title", content: "ZAnto.AI — Chat AI con agent e filesystem virtuale" },
      {
        property: "og:description",
        content: "Piattaforma AI personale: chat in streaming, agent con tool e file persistenti.",
      },
    ],
  }),
  component: ChatWorkspace,
});
