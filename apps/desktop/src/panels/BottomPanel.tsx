import { Suspense, lazy } from "react";

import { Button } from "@/components/ui/button";
import { useAppStore } from "@/state/useAppStore";

const TerminalPanel = lazy(() =>
  import("@/panels/TerminalPanel").then((module) => ({ default: module.TerminalPanel }))
);
const ProblemsPanel = lazy(() =>
  import("@/panels/ProblemsPanel").then((module) => ({ default: module.ProblemsPanel }))
);
const RunLogsPanel = lazy(() =>
  import("@/panels/RunLogsPanel").then((module) => ({ default: module.RunLogsPanel }))
);

const tabs = [
  { id: "terminal", label: "Terminal" },
  { id: "problems", label: "Problems" },
  { id: "run_logs", label: "Run Logs" }
] as const;

export function BottomPanel() {
  const bottomPanelTab = useAppStore((state) => state.bottomPanelTab);
  const setBottomPanelTab = useAppStore((state) => state.setBottomPanelTab);
  const terminalTabs = useAppStore((state) => state.terminalTabs);
  const timeline = useAppStore((state) => state.timeline);
  const problemsCount = timeline.filter((entry) => entry.status === "failed" || entry.status === "blocked").length;

  return (
    <div className="flex h-full flex-col border-t border-border bg-[#0a1018]">
      <div className="border-b border-border px-2 py-1.5">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Bottom Panel</div>
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <span className="shell-pill">{terminalTabs.length} terminals</span>
            <span className={`shell-pill ${problemsCount ? "text-warn" : "text-good"}`}>{problemsCount} problems</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              className={tab.id === bottomPanelTab ? "border-accent bg-accent/10 text-accent" : ""}
              onClick={() => setBottomPanelTab(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <Suspense fallback={<div className="p-2 text-xs text-muted">Loading panel...</div>}>
          {bottomPanelTab === "terminal" && <TerminalPanel />}
          {bottomPanelTab === "problems" && <ProblemsPanel />}
          {bottomPanelTab === "run_logs" && <RunLogsPanel />}
        </Suspense>
      </div>
    </div>
  );
}
