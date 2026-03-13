import { useEffect, useMemo, useState } from "react";

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
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return commands.slice(0, 140);
    }
    const tokens = needle.split(/\s+/).filter(Boolean);
    const scored = commands
      .map((command) => {
        const haystack = command.label.toLowerCase();
        let score = 0;
        if (haystack === needle) score += 200;
        if (haystack.startsWith(needle)) score += 140;
        if (haystack.includes(needle)) score += 90;
        for (const token of tokens) {
          if (haystack.startsWith(token)) score += 24;
          else if (haystack.includes(token)) score += 12;
          else score -= 10;
        }
        score += Math.max(0, 24 - command.label.length * 0.08);
        return { command, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 140);
    return scored.map((item) => item.command);
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    if (activeIndex < filtered.length) return;
    setActiveIndex(0);
  }, [activeIndex, filtered.length]);

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
              if (event.key === "ArrowDown") {
                event.preventDefault();
                if (!filtered.length) return;
                setActiveIndex((current) => (current + 1) % filtered.length);
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                if (!filtered.length) return;
                setActiveIndex((current) => (current - 1 + filtered.length) % filtered.length);
              }
              if (event.key === "Enter") {
                event.preventDefault();
                const selected = filtered[activeIndex];
                if (!selected) return;
                selected.run();
                onClose();
                setQuery("");
                setActiveIndex(0);
              }
            }}
            placeholder="Type a command..."
          />
        </div>
        <div className="lumen-scroll max-h-80 overflow-auto p-1 text-xs">
          {filtered.map((command, index) => (
            <button
              key={command.id}
              className={`flex h-8 w-full items-center rounded px-2 text-left hover:bg-white/5 ${
                index === activeIndex ? "bg-accent/12 text-accent" : ""
              }`}
              onClick={() => {
                command.run();
                onClose();
                setQuery("");
                setActiveIndex(0);
              }}
              onMouseEnter={() => setActiveIndex(index)}
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
