import React, { useEffect, useState } from "react";
import styled, { keyframes } from "styled-components";
import TopBar from "./components/TopBar";
import SettingsModal from "./components/SettingsModal";
import ExplorerPanel from "./panels/ExplorerPanel";
import NyxConsole from "./panels/NyxConsole";
import MonacoEditor from "./editor/MonacoEditor";
import { sendToNyx, receiveSuggestions } from "./services/nyxService";

const fadeIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const panelRise = keyframes`
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const AppShell = styled.div`
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: radial-gradient(circle at 15% 15%, #1b2431 0%, #0b0f14 50%, #07090d 100%);
  color: var(--text-primary);
  font-family: var(--font-ui);
  position: relative;
  overflow: hidden;
  animation: ${fadeIn} 500ms ease both;

  &::before {
    content: "";
    position: absolute;
    inset: -20%;
    background:
      radial-gradient(circle at 80% 10%, rgba(121, 241, 214, 0.12), transparent 45%),
      radial-gradient(circle at 12% 80%, rgba(216, 179, 106, 0.12), transparent 42%);
    opacity: 0.7;
    pointer-events: none;
  }
`;

const Body = styled.div`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(220px, 260px) minmax(0, 1fr) minmax(280px, 320px);
  grid-template-areas: "explorer editor nyx";
  gap: 12px;
  padding: 14px;
  transition: all 200ms ease;
  position: relative;
  z-index: 1;

  @media (max-width: 1200px) {
    grid-template-columns: 1fr;
    grid-template-areas:
      "editor"
      "nyx"
      "explorer";
    grid-template-rows: minmax(320px, 1fr) minmax(220px, 0.45fr) minmax(180px, 0.35fr);
  }
`;

const Panel = styled.section`
  background: linear-gradient(180deg, rgba(15, 19, 26, 0.92), rgba(11, 14, 19, 0.94));
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
  animation: ${panelRise} 420ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
  animation-delay: var(--panel-delay, 0ms);

  &::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 16px;
    border: 1px solid rgba(121, 241, 214, 0.08);
    pointer-events: none;
  }
`;

const EditorPanel = styled(Panel)`
  padding: 8px;
  gap: 8px;
`;

const EditorHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  background: rgba(7, 9, 13, 0.7);
  color: var(--text-muted);
  font-size: 12px;
`;

const FilePath = styled.span`
  color: var(--text-primary);
  font-size: 12px;
`;

export default function App() {
  const [code, setCode] = useState(
    "// Welcome to Lumen IDE\n// Nyx will offer AI suggestions here.\n"
  );
  const [nyxStatus, setNyxStatus] = useState("idle");
  const [nyxPayload, setNyxPayload] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(null);
  const [activeFile, setActiveFile] = useState("");

  useEffect(() => {
    // Load persisted settings via the Electron main process (placeholder storage).
    let mounted = true;
    if (window?.lumen?.settings?.load) {
      window.lumen.settings.load().then((data) => {
        if (mounted) {
          setSettings(data || {});
        }
      });
    }
    return () => {
      mounted = false;
    };
  }, []);

  const handleSendNyx = async ({ prompt, model, reasoningEffort, allowWrite, mode }) => {
    setNyxStatus("thinking");
    const response = await sendToNyx(code, prompt, {
      model,
      reasoningEffort,
      filePath: activeFile,
      allowWrite,
      mode
    });
    const suggestions = await receiveSuggestions();
    setNyxPayload({ response, suggestions });
    setNyxStatus("ready");
  };

  const handleOpenFile = ({ path, content }) => {
    if (!path || typeof content !== "string") return;
    setActiveFile(path);
    setCode(content);
  };

  const handleSaveSettings = async (nextSettings) => {
    setSettings(nextSettings);
    if (window?.lumen?.settings?.save) {
      await window.lumen.settings.save(nextSettings);
    }
    setSettingsOpen(false);
  };

  return (
    <AppShell>
      <TopBar onOpenSettings={() => setSettingsOpen(true)} />
      <Body>
        <Panel style={{ gridArea: "explorer", "--panel-delay": "60ms" }}>
          <ExplorerPanel activeFile={activeFile} onOpenFile={handleOpenFile} />
        </Panel>
        <EditorPanel style={{ gridArea: "editor", "--panel-delay": "120ms" }}>
          <EditorHeader>
            <span>Editor</span>
            <FilePath>{activeFile || "No file loaded"}</FilePath>
          </EditorHeader>
          <MonacoEditor value={code} onChange={setCode} />
        </EditorPanel>
        <Panel style={{ gridArea: "nyx", "--panel-delay": "180ms" }}>
          <NyxConsole
            status={nyxStatus}
            payload={nyxPayload}
            activeFile={activeFile}
            onSend={handleSendNyx}
          />
        </Panel>
      </Body>
      {settingsOpen && (
        <SettingsModal
          initialSettings={settings || {}}
          onClose={() => setSettingsOpen(false)}
          onSave={handleSaveSettings}
        />
      )}
    </AppShell>
  );
}
