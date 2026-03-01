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
      <div className="flex h-8 items-center border-b border-border bg-black/20 px-1">
        <div className="lumen-scroll flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`group flex h-6 items-center gap-2 rounded px-2 text-[11px] ${
                tab.id === activeTabId ? "bg-accent/20 text-accent" : "text-muted hover:text-text"
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
        <Button className="ml-2" onClick={() => void saveActiveTab()}>
          Save
        </Button>
      </div>

      <div className="flex-1">
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
          <div className="flex h-full items-center justify-center text-sm text-muted">Open a file from Explorer.</div>
        )}
      </div>
    </div>
  );
}
