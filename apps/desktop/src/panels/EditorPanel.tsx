import MonacoEditor from "@monaco-editor/react";

import { Button } from "@/components/ui/button";
import { useAppStore } from "@/state/useAppStore";

function languageForPath(filePath: string) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx")) return "javascript";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html")) return "html";
  return "plaintext";
}

type EditorPanelProps = {
  saveActiveTab: () => Promise<void>;
};

export function EditorPanel({ saveActiveTab }: EditorPanelProps) {
  const tabs = useAppStore((state) => state.tabs);
  const activeTabId = useAppStore((state) => state.activeTabId);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const closeTab = useAppStore((state) => state.closeTab);
  const updateTab = useAppStore((state) => state.updateTab);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null;

  return (
    <div className="flex h-full flex-col bg-[#0f1520]/70">
      <div className="border-b border-border px-2 py-1.5">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Editor</div>
            <div className="truncate text-[12px] text-text">{activeTab?.path || "Open a file from Explorer"}</div>
          </div>
          <div className="flex items-center gap-2">
            {activeTab && (
              <span className={`shell-pill ${activeTab.dirty ? "text-warn" : "text-muted"}`}>
                {activeTab.dirty ? "Unsaved" : "Saved"}
              </span>
            )}
            <Button className="ml-0" onClick={() => void saveActiveTab()}>
              Save
            </Button>
          </div>
        </div>
        <div className="lumen-scroll flex min-w-0 gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`group flex h-7 items-center gap-2 rounded border px-2 text-[11px] transition ${
                tab.id === activeTabId
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-transparent bg-black/20 text-muted hover:text-text"
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="truncate max-w-[180px]">{tab.name}</span>
              <span className={`${tab.dirty ? "text-warn" : "text-muted"}`}>{tab.dirty ? "●" : ""}</span>
              <span
                className="hidden text-[10px] text-muted group-hover:inline"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                ✕
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab ? (
          <MonacoEditor
            height="100%"
            language={languageForPath(activeTab.path)}
            value={activeTab.content}
            theme="vs-dark"
            options={{
              fontSize: 12,
              minimap: { enabled: false },
              wordWrap: "on",
              automaticLayout: true,
              tabSize: 2
            }}
            onChange={(next) => updateTab(activeTab.id, next ?? "", true)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted">
            <div className="text-[13px] text-text">No file selected</div>
            <div className="text-[11px]">Use the Explorer on the left to open a file.</div>
          </div>
        )}
      </div>
    </div>
  );
}
