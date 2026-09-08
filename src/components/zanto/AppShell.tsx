import { Link, useRouterState } from "@tanstack/react-router";
import {
  Boxes,
  Cpu,
  Files,
  FolderKanban,
  Keyboard,
  Layers,
  MessagesSquare,
  Moon,
  Plug,
  Server,
  Settings as SettingsIcon,
  Sun,
  Wrench,
  Brain,
  Activity as ActivityIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/lib/zanto/theme";
import { useWorkspace } from "@/lib/zanto/workspace-context";
import { CommandPalette } from "./CommandPalette";

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

export function AppShell({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();
  const { workspaces, activeId, setActiveId } = useWorkspace();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-sidebar px-3 md:px-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
            Z
          </span>
          <span className="font-display text-base font-semibold tracking-tight">
            ZAnto<span className="text-primary">.AI</span>
          </span>
        </Link>

        <Badge variant="outline" className="hidden sm:inline-flex">
          guest locale
        </Badge>

        <div className="ml-auto flex items-center gap-2">
          <Select value={activeId ?? undefined} onValueChange={setActiveId}>
            <SelectTrigger className="h-9 w-[170px] text-xs md:w-[210px]">
              <SelectValue placeholder="Workspace" />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((ws) => (
                <SelectItem key={ws.id} value={ws.id}>
                  {ws.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            className="hidden gap-2 md:inline-flex"
            onClick={() => setPaletteOpen(true)}
          >
            <Keyboard className="size-4" />
            <span className="text-xs text-muted-foreground">⌘K</span>
          </Button>

          <Button variant="ghost" size="icon" aria-label="Cambia tema" onClick={toggle}>
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-sidebar py-3 lg:flex">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                title={item.label}
                className={`grid size-10 place-items-center rounded-md transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                }`}
              >
                <Icon className="size-4" />
              </Link>
            );
          })}
        </nav>

        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>

      <nav className="flex shrink-0 gap-1 overflow-x-auto border-t border-border bg-sidebar px-2 py-1.5 lg:hidden">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs ${
                active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground"
              }`}
            >
              <Icon className="size-3.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

/** Standard page wrapper for the non-chat routes: independent scrolling. */
export function PageShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold">{title}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
          </div>
          {actions}
        </div>
        {children}
      </div>
    </div>
  );
}
