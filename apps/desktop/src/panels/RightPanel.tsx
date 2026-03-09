import { Button } from "@/components/ui/button";
import { AgentPanel } from "@/panels/AgentPanel";
import { AuditPanel } from "@/panels/AuditPanel";
import { GitPanel } from "@/panels/GitPanel";
import { PreviewPanel } from "@/panels/PreviewPanel";
import { SettingsPanel } from "@/panels/SettingsPanel";
import { TimelinePanel } from "@/panels/TimelinePanel";
import { useAppStore } from "@/state/useAppStore";

type RightPanelProps = {
  refreshTree: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
};

const tabs = [
  { id: "agent", label: "Agent" },
  { id: "timeline", label: "Timeline" },
  { id: "preview", label: "Preview" },
  { id: "git", label: "Git" },
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
        {rightPanelTab === "agent" && <AgentPanel refreshTree={refreshTree} openFile={openFile} />}
        {rightPanelTab === "timeline" && <TimelinePanel />}
        {rightPanelTab === "preview" && <PreviewPanel />}
        {rightPanelTab === "git" && <GitPanel />}
        {rightPanelTab === "settings" && <SettingsPanel />}
        {rightPanelTab === "audit" && <AuditPanel />}
      </div>
    </div>
  );
}
