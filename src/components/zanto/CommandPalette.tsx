import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { NAV_ITEMS } from "@/lib/zanto/nav";
import { useWorkspace } from "@/lib/zanto/workspace-context";
import { useTheme } from "@/lib/zanto/theme";

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { workspaces, setActiveId } = useWorkspace();
  const { toggle } = useTheme();

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Cerca pagine, workspace, azioni…" />
      <CommandList>
        <CommandEmpty>Nessun risultato.</CommandEmpty>
        <CommandGroup heading="Vai a">
          {NAV_ITEMS.map((item) => (
            <CommandItem
              key={item.to}
              value={`vai ${item.label}`}
              onSelect={() => {
                onOpenChange(false);
                void navigate({ to: item.to });
              }}
            >
              <item.icon className="size-4" />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Workspace">
          {workspaces.map((ws) => (
            <CommandItem
              key={ws.id}
              value={`workspace ${ws.name}`}
              onSelect={() => {
                setActiveId(ws.id);
                onOpenChange(false);
              }}
            >
              {ws.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Azioni">
          <CommandItem
            value="cambia tema"
            onSelect={() => {
              toggle();
              onOpenChange(false);
            }}
          >
            Cambia tema chiaro/scuro
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
