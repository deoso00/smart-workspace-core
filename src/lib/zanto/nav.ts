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

/**
 * Primary left rail — order matches the ZAnto workspace chrome wireframe.
 * Chat lives at `/` as the center stage; Activity is also exposed on the chat right rail.
 */
export const NAV_ITEMS = [
  { to: "/", label: "Chat", icon: MessagesSquare },
  { to: "/workspaces", label: "Workspaces", icon: Layers },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/files", label: "Files", icon: Files },
  { to: "/models", label: "Models", icon: Cpu },
  { to: "/providers", label: "Providers", icon: Server },
  { to: "/memory", label: "Memory", icon: Brain },
  { to: "/tools", label: "Tools", icon: Wrench },
  { to: "/plugins", label: "Plugins", icon: Plug },
  { to: "/mcp", label: "MCP", icon: Boxes },
  { to: "/activity", label: "Activity", icon: ActivityIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;
