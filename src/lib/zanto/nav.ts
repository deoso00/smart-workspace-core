import {
  Activity as ActivityIcon,
  Boxes,
  Brain,
  Cpu,
  Files,
  FolderKanban,
  Layers,
  MessagesSquare,
  Plug,
  Server,
  Settings as SettingsIcon,
  Wrench,
} from "lucide-react";

export const NAV_ITEMS = [
  { to: "/", label: "Chat", icon: MessagesSquare },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/workspaces", label: "Workspaces", icon: Layers },
  { to: "/files", label: "Files", icon: Files },
  { to: "/models", label: "Models", icon: Cpu },
  { to: "/providers", label: "Providers", icon: Server },
  { to: "/memory", label: "Memory", icon: Brain },
  { to: "/plugins", label: "Plugins", icon: Plug },
  { to: "/mcp", label: "MCP", icon: Boxes },
  { to: "/tools", label: "Tools", icon: Wrench },
  { to: "/activity", label: "Activity", icon: ActivityIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;
