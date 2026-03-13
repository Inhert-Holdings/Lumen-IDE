import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { useAppStore } from "@/state/useAppStore";

export function RunLogsPanel() {
  const timeline = useAppStore((state) => state.timeline);
  const clearTimeline = useAppStore((state) => state.clearTimeline);

  const logs = useMemo(() => {
    return timeline.slice(-400).reverse();
  }, [timeline]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-2 py-1.5">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Agent Run Logs</div>
          <div className="flex items-center gap-2">
            <span className="shell-pill">{logs.length}</span>
            <Button onClick={() => clearTimeline()}>Clear</Button>
          </div>
        </div>
      </div>

      <div className="lumen-scroll flex-1 overflow-auto p-2 text-[11px]">
        {logs.length === 0 && <div className="text-muted">No execution logs yet.</div>}
        {logs.map((entry) => (
          <div key={entry.id} className="mb-2 rounded border border-border bg-black/20 p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="truncate">
                <span className="text-muted">{entry.phase}</span>
                <span className="mx-1 text-muted">·</span>
                <span className="text-text">{entry.title}</span>
              </div>
              <span
                className={`text-[10px] uppercase ${
                  entry.status === "failed"
                    ? "text-bad"
                    : entry.status === "blocked"
                      ? "text-warn"
                      : entry.status === "running"
                        ? "text-accent"
                        : "text-muted"
                }`}
              >
                {entry.status}
              </span>
            </div>
            <div className="whitespace-pre-wrap break-words text-muted">{entry.detail}</div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-muted">
              <span>{entry.source}</span>
              <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
