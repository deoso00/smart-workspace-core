import { Link, useRouterState } from "@tanstack/react-router";
import { Keyboard, Moon, Settings2, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NAV_ITEMS } from "@/lib/zanto/nav";
import { useTheme } from "@/lib/zanto/theme";
import { useWorkspace } from "@/lib/zanto/workspace-context";
import { CommandPalette } from "./CommandPalette";

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
    <div className="zanto-grid-bg flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="zanto-glass flex h-12 shrink-0 items-center gap-3 border-b border-border/80 px-3 md:px-4">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="zanto-glow-sm grid size-7 place-items-center rounded-md bg-primary font-display text-xs font-bold text-primary-foreground">
            Z
          </span>
          <span className="font-display text-sm font-semibold tracking-tight md:text-base">
            ZANTO<span className="text-primary">.AI</span>
          </span>
        </Link>

        <div className="ml-1 hidden items-center gap-2 sm:flex">
          <span className="zanto-online-dot" aria-hidden />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
            Online
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5 md:gap-2">
          <Select value={activeId ?? ""} onValueChange={setActiveId}>
            <SelectTrigger className="h-8 w-[140px] border-border/70 bg-background/35 text-xs md:w-[190px]">
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
            className="hidden h-8 gap-2 border-border/70 bg-background/25 px-2 md:inline-flex"
            onClick={() => setPaletteOpen(true)}
          >
            <Keyboard className="size-3.5" />
            <span className="font-mono text-[10px] text-muted-foreground">⌘K</span>
          </Button>

          <Button variant="ghost" size="icon" className="size-8" aria-label="Cambia tema" onClick={toggle}>
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>

          <Button variant="ghost" size="icon" className="size-8" aria-label="Impostazioni" asChild>
            <Link to="/settings">
              <Settings2 className="size-4" />
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="zanto-glass hidden w-[12.75rem] shrink-0 flex-col border-r border-border/80 py-3 lg:flex">
          <p className="mb-2 px-4 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Workspace
          </p>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-150 ${
                    active
                      ? "zanto-glow-sm bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/45 hover:text-foreground"
                  }`}
                >
                  <Icon
                    className={`size-3.5 shrink-0 ${active ? "text-primary" : "group-hover:text-primary"}`}
                  />
                  <span className="truncate">{item.label}</span>
                  {active && (
                    <span className="ml-auto size-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--zanto-glow)]" />
                  )}
                </Link>
              );
            })}
          </div>
        </nav>

        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>

      <nav className="zanto-glass flex shrink-0 gap-1 overflow-x-auto border-t border-border/80 px-2 py-1.5 lg:hidden">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground"
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
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3 zanto-enter">
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
              ZAnto.AI
            </p>
            <h1 className="font-display text-2xl font-semibold">{title}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
          </div>
          {actions}
        </div>
        <div className="zanto-enter">{children}</div>
      </div>
    </div>
  );
}
