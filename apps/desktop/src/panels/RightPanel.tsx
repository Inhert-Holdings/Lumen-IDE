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
  const activeTab = tabs.find((tab) => tab.id === rightPanelTab) || tabs[0];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/8 bg-[linear-gradient(180deg,rgba(11,16,24,0.96),rgba(8,12,18,0.98))] shadow-[0_12px_40px_rgba(0,0,0,0.25)]">
      <div className="border-b border-white/8 px-3 py-2">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Workspace Tools</div>
          <div className="text-[11px] text-muted">{activeTab.label}</div>
        </div>
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              className={tab.id === rightPanelTab ? "border-accent bg-accent/10 text-accent" : "border-white/10 bg-white/5"}
              onClick={() => setRightPanelTab(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
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
