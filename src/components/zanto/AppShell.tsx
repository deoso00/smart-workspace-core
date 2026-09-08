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

/** Bolt-inspired shell: slim icon rail always on the left (not a bottom tab bar). */
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
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-3">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded bg-primary font-display text-[11px] font-bold text-primary-foreground">
            Z
          </span>
          <span className="font-display text-sm font-semibold tracking-tight">
            ZANTO<span className="text-primary">.AI</span>
          </span>
        </Link>
        <div className="hidden items-center gap-1.5 sm:flex">
          <span className="zanto-online-dot" aria-hidden />
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Online
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Select value={activeId ?? ""} onValueChange={setActiveId}>
            <SelectTrigger className="h-8 w-[150px] text-xs md:w-[180px]">
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
            variant="ghost"
            size="icon"
            className="hidden size-8 md:inline-flex"
            onClick={() => setPaletteOpen(true)}
          >
            <Keyboard className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={toggle} aria-label="Tema">
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="size-8" asChild>
            <Link to="/settings">
              <Settings2 className="size-4" />
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Always-visible icon rail (left) — replaces bottom mobile strip */}
        <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-card/40 py-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                title={item.label}
                className={`grid size-9 place-items-center rounded-md transition-colors ${
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="size-4" />
              </Link>
            );
          })}
        </nav>

        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

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
