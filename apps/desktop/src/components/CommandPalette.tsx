import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";

type CommandItem = {
  id: string;
  label: string;
  run: () => void;
};

type CommandPaletteProps = {
  open: boolean;
  commands: CommandItem[];
  onClose: () => void;
};

export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.toLowerCase();
    return commands.filter((command) => command.label.toLowerCase().includes(needle));
  }, [commands, query]);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center bg-black/55 pt-24">
      <div className="w-[560px] rounded border border-border bg-panel shadow-xl">
        <div className="border-b border-border p-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
            }}
            placeholder="Type a command..."
          />
        </div>
        <div className="lumen-scroll max-h-80 overflow-auto p-1 text-xs">
          {filtered.map((command) => (
            <button
              key={command.id}
              className="flex h-8 w-full items-center rounded px-2 text-left hover:bg-white/5"
              onClick={() => {
                command.run();
                onClose();
                setQuery("");
              }}
            >
              {command.label}
            </button>
          ))}
          {filtered.length === 0 && <div className="p-2 text-muted">No commands</div>}
        </div>
      </div>
    </div>
  );
}
