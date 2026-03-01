import { Button } from "@/components/ui/button";
import { AgentPanel } from "@/panels/AgentPanel";
import { AuditPanel } from "@/panels/AuditPanel";
import { GitPanel } from "@/panels/GitPanel";
import { PreviewPanel } from "@/panels/PreviewPanel";
import { SettingsPanel } from "@/panels/SettingsPanel";
import { useAppStore } from "@/state/useAppStore";

type RightPanelProps = {
  refreshTree: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
};

const tabs = [
  { id: "agent", label: "Agent" },
  { id: "preview", label: "Preview" },
  { id: "git", label: "Git" },
  { id: "settings", label: "Settings" },
  { id: "audit", label: "Audit" }
] as const;

export function RightPanel({ refreshTree, openFile }: RightPanelProps) {
  const rightPanelTab = useAppStore((state) => state.rightPanelTab);
  const setRightPanelTab = useAppStore((state) => state.setRightPanelTab);

  return (
    <div className="flex h-full flex-col border-l border-border bg-panel/80">
      <div className="flex items-center gap-1 border-b border-border p-1">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            className={tab.id === rightPanelTab ? "border-accent text-accent" : ""}
            onClick={() => setRightPanelTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {rightPanelTab === "agent" && <AgentPanel refreshTree={refreshTree} openFile={openFile} />}
        {rightPanelTab === "preview" && <PreviewPanel />}
        {rightPanelTab === "git" && <GitPanel />}
        {rightPanelTab === "settings" && <SettingsPanel />}
        {rightPanelTab === "audit" && <AuditPanel />}
      </div>
    </div>
  );
}
