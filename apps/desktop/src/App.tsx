import { useCallback, useEffect, useMemo } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import { CommandPalette } from "@/components/CommandPalette";
import { Button } from "@/components/ui/button";
import logo from "@/assets/logo-ui.png";
import { EditorPanel } from "@/panels/EditorPanel";
import { ExplorerPanel } from "@/panels/ExplorerPanel";
import { RightPanel } from "@/panels/RightPanel";
import { TerminalPanel } from "@/panels/TerminalPanel";
import { basename } from "@/lib/utils";
import { useAppStore } from "@/state/useAppStore";

function makeId() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export default function App() {
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const activeTabId = useAppStore((state) => state.activeTabId);
  const tabs = useAppStore((state) => state.tabs);
  const settings = useAppStore((state) => state.settings);
  const explorerVisible = useAppStore((state) => state.explorerVisible);
  const terminalVisible = useAppStore((state) => state.terminalVisible);
  const commandPaletteOpen = useAppStore((state) => state.commandPaletteOpen);
  const setWorkspace = useAppStore((state) => state.setWorkspace);
  const setTree = useAppStore((state) => state.setTree);
  const setSettings = useAppStore((state) => state.setSettings);
  const replaceAudit = useAppStore((state) => state.replaceAudit);
  const appendAudit = useAppStore((state) => state.appendAudit);
  const addTab = useAppStore((state) => state.addTab);
  const updateTab = useAppStore((state) => state.updateTab);
  const toggleExplorer = useAppStore((state) => state.toggleExplorer);
  const toggleTerminal = useAppStore((state) => state.toggleTerminal);
  const toggleCommandPalette = useAppStore((state) => state.toggleCommandPalette);
  const setTerminalTabs = useAppStore((state) => state.setTerminalTabs);
  const addTerminalTab = useAppStore((state) => state.addTerminalTab);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null;

  const refreshTree = useCallback(async () => {
    const [rootResult, treeResult] = await Promise.all([window.lumen.workspace.getRoot(), window.lumen.workspace.list()]);
    setWorkspace(rootResult.root, treeResult.tree);
  }, [setWorkspace]);

  const openFile = useCallback(
    async (path: string) => {
      const existing = tabs.find((tab) => tab.path === path);
      if (existing) {
        useAppStore.getState().setActiveTab(existing.id);
        return;
      }
      const file = await window.lumen.workspace.read({ path });
      addTab({
        id: makeId(),
        path: file.path,
        name: basename(file.path),
        content: file.content,
        dirty: false
      });
    },
    [addTab, tabs]
  );

  const saveActiveTab = useCallback(async () => {
    const current = useAppStore.getState().tabs.find((tab) => tab.id === useAppStore.getState().activeTabId);
    if (!current) return;
    await window.lumen.workspace.write({ path: current.path, content: current.content });
    updateTab(current.id, current.content, false);
    await refreshTree();
  }, [refreshTree, updateTab]);

  const openFolder = useCallback(async () => {
    await window.lumen.workspace.openFolder();
    useAppStore.setState({ tabs: [], activeTabId: null, pendingChanges: [] });
    await refreshTree();
  }, [refreshTree]);

  const ensureTerminal = useCallback(async () => {
    const list = await window.lumen.terminal.list();
    if (list.terminals.length === 0) {
      const created = await window.lumen.terminal.create({ cols: 120, rows: 30 });
      setTerminalTabs([{ id: created.id, title: created.id }], created.id);
      return;
    }
    setTerminalTabs(
      list.terminals.map((terminal) => ({ id: terminal.id, title: terminal.id })),
      list.terminals[0].id
    );
  }, [setTerminalTabs]);

  useEffect(() => {
    const bootstrap = async () => {
      const [savedSettings, auditEntries] = await Promise.all([window.lumen.settings.load(), window.lumen.audit.list()]);
      setSettings(savedSettings);
      replaceAudit(auditEntries.entries);
      await refreshTree();
      await ensureTerminal();
    };

    void bootstrap();

    const offAudit = window.lumen.audit.onEntry((entry) => appendAudit(entry));
    return () => offAudit();
  }, [appendAudit, ensureTerminal, refreshTree, replaceAudit, setSettings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.ctrlKey && key === "p") {
        event.preventDefault();
        toggleCommandPalette(true);
      }
      if (event.ctrlKey && event.shiftKey && event.key === "`") {
        event.preventDefault();
        toggleTerminal();
      }
      if (event.ctrlKey && key === "b") {
        event.preventDefault();
        toggleExplorer();
      }
      if (event.ctrlKey && key === "l") {
        event.preventDefault();
        const prompt = document.getElementById("agent-prompt") as HTMLTextAreaElement | null;
        prompt?.focus();
      }
      if (event.ctrlKey && key === "s") {
        event.preventDefault();
        void saveActiveTab();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveActiveTab, toggleCommandPalette, toggleExplorer, toggleTerminal]);

  const commands = useMemo(
    () => [
      { id: "open-folder", label: "Open Folder", run: () => void openFolder() },
      { id: "save-file", label: "Save Active File", run: () => void saveActiveTab() },
      { id: "new-terminal", label: "New Terminal", run: () => void ensureTerminal().then(() => {}) },
      { id: "toggle-terminal", label: "Toggle Terminal", run: () => toggleTerminal() },
      { id: "toggle-explorer", label: "Toggle Explorer", run: () => toggleExplorer() }
    ],
    [ensureTerminal, openFolder, saveActiveTab, toggleExplorer, toggleTerminal]
  );

  return (
    <div className={`app-shell ${settings.compactMode ? "compact" : "normal"}`}>
      <div className="flex h-9 items-center justify-between border-b border-border bg-[#0f1623]/90 px-2 text-xs">
        <div className="flex items-center gap-2">
          <img src={logo} alt="Lumen IDE logo" className="h-5 w-5 object-contain" />
          <span className="font-semibold text-accent">Lumen IDE</span>
          <Button onClick={() => void openFolder()}>Open Folder</Button>
          <Button onClick={() => void saveActiveTab()} disabled={!activeTab || !activeTab.dirty}>
            Save
          </Button>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span>{workspaceRoot || "No workspace"}</span>
          <span className={settings.onlineMode ? "text-warn" : "text-good"}>
            Online: {settings.onlineMode ? "ON" : "OFF"}
          </span>
          <span>{settings.model}</span>
        </div>
      </div>

      <div className="h-[calc(100%-36px)]">
        <PanelGroup direction="vertical">
          <Panel defaultSize={terminalVisible ? 72 : 100} minSize={45}>
            <PanelGroup direction="horizontal">
              {explorerVisible && (
                <>
                  <Panel defaultSize={18} minSize={12}>
                    <ExplorerPanel refreshTree={refreshTree} openFile={openFile} />
                  </Panel>
                  <PanelResizeHandle className="w-1 bg-border/70 hover:bg-accent/40" />
                </>
              )}

              <Panel defaultSize={57} minSize={35}>
                <EditorPanel saveActiveTab={saveActiveTab} />
              </Panel>

              <PanelResizeHandle className="w-1 bg-border/70 hover:bg-accent/40" />

              <Panel defaultSize={25} minSize={20}>
                <RightPanel refreshTree={refreshTree} openFile={openFile} />
              </Panel>
            </PanelGroup>
          </Panel>

          {terminalVisible && (
            <>
              <PanelResizeHandle className="h-1 bg-border/70 hover:bg-accent/40" />
              <Panel defaultSize={28} minSize={12}>
                <TerminalPanel />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>

      <CommandPalette open={commandPaletteOpen} commands={commands} onClose={() => toggleCommandPalette(false)} />
    </div>
  );
}
