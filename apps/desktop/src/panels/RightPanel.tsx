import { Suspense, lazy } from "react";

import { Button } from "@/components/ui/button";
import { useAppStore } from "@/state/useAppStore";

const AgentPanel = lazy(() => import("@/panels/AgentPanel").then((module) => ({ default: module.AgentPanel })));
const TimelinePanel = lazy(() => import("@/panels/TimelinePanel").then((module) => ({ default: module.TimelinePanel })));
const PreviewPanel = lazy(() => import("@/panels/PreviewPanel").then((module) => ({ default: module.PreviewPanel })));
const GitPanel = lazy(() => import("@/panels/GitPanel").then((module) => ({ default: module.GitPanel })));
const PermissionsPanel = lazy(() =>
  import("@/panels/PermissionsPanel").then((module) => ({ default: module.PermissionsPanel }))
);
const SettingsPanel = lazy(() => import("@/panels/SettingsPanel").then((module) => ({ default: module.SettingsPanel })));
const AuditPanel = lazy(() => import("@/panels/AuditPanel").then((module) => ({ default: module.AuditPanel })));
const DiagnosticsPanel = lazy(() =>
  import("@/panels/DiagnosticsPanel").then((module) => ({ default: module.DiagnosticsPanel }))
);

type RightPanelProps = {
  refreshTree: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
};

const tabs = [
  { id: "agent", label: "Agent" },
  { id: "timeline", label: "Timeline" },
  { id: "preview", label: "Preview" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "git", label: "Git" },
  { id: "permissions", label: "Permissions" },
  { id: "settings", label: "Settings" },
  { id: "audit", label: "Audit" }
] as const;

export function RightPanel({ refreshTree, openFile }: RightPanelProps) {
  const rightPanelTab = useAppStore((state) => state.rightPanelTab);
  const setRightPanelTab = useAppStore((state) => state.setRightPanelTab);
  const activeTab = tabs.find((tab) => tab.id === rightPanelTab) || tabs[0];

  return (
    <div className="flex h-full flex-col border-l border-border bg-panel/80">
      <div className="border-b border-border px-2 py-1.5">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Workspace Tools</div>
          <div className="text-[11px] text-muted">{activeTab.label}</div>
        </div>
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              className={tab.id === rightPanelTab ? "border-accent bg-accent/10 text-accent" : ""}
              onClick={() => setRightPanelTab(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <Suspense fallback={<div className="p-2 text-xs text-muted">Loading panel...</div>}>
          {rightPanelTab === "agent" && <AgentPanel refreshTree={refreshTree} openFile={openFile} />}
          {rightPanelTab === "timeline" && <TimelinePanel />}
          {rightPanelTab === "preview" && <PreviewPanel />}
          {rightPanelTab === "diagnostics" && <DiagnosticsPanel />}
          {rightPanelTab === "git" && <GitPanel />}
          {rightPanelTab === "permissions" && <PermissionsPanel />}
          {rightPanelTab === "settings" && <SettingsPanel />}
          {rightPanelTab === "audit" && <AuditPanel />}
        </Suspense>
      </div>
    </div>
  );
}
