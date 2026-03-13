import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { useAppStore } from "@/state/useAppStore";

type ProblemRow = {
  id: string;
  timestamp: string;
  source: string;
  title: string;
  detail: string;
  severity: "failed" | "blocked";
};

export function ProblemsPanel() {
  const timeline = useAppStore((state) => state.timeline);
  const clearTimeline = useAppStore((state) => state.clearTimeline);

  const problems = useMemo<ProblemRow[]>(() => {
    return timeline
      .filter((entry): entry is typeof entry & { status: "failed" | "blocked" } => entry.status === "failed" || entry.status === "blocked")
      .slice(-240)
      .reverse()
      .map((entry) => ({
        id: entry.id,
        timestamp: entry.timestamp,
        source: entry.source,
        title: entry.title,
        detail: entry.detail,
        severity: entry.status
      }));
  }, [timeline]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-2 py-1.5">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Problems</div>
          <div className="flex items-center gap-2">
            <span className="shell-pill">{problems.length}</span>
            <Button onClick={() => clearTimeline()}>Clear</Button>
          </div>
        </div>
      </div>

      <div className="lumen-scroll flex-1 overflow-auto p-2 text-[11px]">
        {problems.length === 0 && <div className="text-muted">No active problems in the current timeline.</div>}
        {problems.map((problem) => (
          <div key={problem.id} className="mb-2 rounded border border-border bg-black/20 p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="truncate text-text">{problem.title}</div>
              <span className={`text-[10px] uppercase ${problem.severity === "failed" ? "text-bad" : "text-warn"}`}>
                {problem.severity}
              </span>
            </div>
            <div className="mb-1 whitespace-pre-wrap break-words text-muted">{problem.detail || "No details."}</div>
            <div className="flex items-center justify-between text-[10px] text-muted">
              <span>{problem.source}</span>
              <span>{new Date(problem.timestamp).toLocaleTimeString()}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
