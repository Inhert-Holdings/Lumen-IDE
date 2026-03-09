import { create } from "zustand";

import { defaultLlmConfig, type LlmConfig } from "@lumen/llm-client";
import type { AuditEntry, ProjectInspection, WorkspaceNode } from "@/types/electron";

export type EditorTab = {
  id: string;
  path: string;
  name: string;
  content: string;
  dirty: boolean;
};

export type TerminalTab = {
  id: string;
  title: string;
};

export type PendingAgentChange = {
  id: string;
  type: "write" | "delete";
  path: string;
  diff: string;
  nextContent: string;
};

export type TimelineEntry = {
  id: string;
  timestamp: string;
  phase: "understand" | "scope" | "plan" | "execute" | "verify" | "recover" | "propose" | "apply" | "runtime";
  status: "info" | "running" | "done" | "failed" | "blocked";
  title: string;
  detail: string;
  source: "agent" | "preview" | "terminal" | "git" | "workbench" | "system";
};

export type SessionMemory = {
  currentGoal: string;
  projectType: string;
  detectedScripts: string[];
  activePreviewUrl: string;
  currentBranch: string;
  terminalSessionIds: string[];
  lastFailedCommand: string;
  knownBlockers: string[];
  filesTouched: string[];
  verificationStatus: "idle" | "pending" | "passed" | "failed" | "skipped";
  previewMode: "idle" | "static" | "project";
};

export type RightPanelTab = "agent" | "timeline" | "preview" | "git" | "settings" | "audit";

const defaultSessionMemory = (): SessionMemory => ({
  currentGoal: "",
  projectType: "",
  detectedScripts: [],
  activePreviewUrl: "",
  currentBranch: "",
  terminalSessionIds: [],
  lastFailedCommand: "",
  knownBlockers: [],
  filesTouched: [],
  verificationStatus: "idle",
  previewMode: "idle"
});

type AppState = {
  workspaceRoot: string;
  tree: WorkspaceNode | null;
  tabs: EditorTab[];
  activeTabId: string | null;
  selectedPath: string;
  terminalTabs: TerminalTab[];
  activeTerminalId: string | null;
  explorerVisible: boolean;
  terminalVisible: boolean;
  commandPaletteOpen: boolean;
  rightPanelTab: RightPanelTab;
  settings: LlmConfig;
  audit: AuditEntry[];
  pendingChanges: PendingAgentChange[];
  projectInspection: ProjectInspection | null;
  sessionMemory: SessionMemory;
  timeline: TimelineEntry[];
  setWorkspace: (root: string, tree: WorkspaceNode | null) => void;
  setTree: (tree: WorkspaceNode) => void;
  setSelectedPath: (path: string) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setSettings: (settings: LlmConfig) => void;
  appendAudit: (entry: AuditEntry) => void;
  replaceAudit: (entries: AuditEntry[]) => void;
  addTab: (tab: EditorTab) => void;
  updateTab: (id: string, content: string, dirty: boolean) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string | null) => void;
  setTerminalTabs: (tabs: TerminalTab[], activeId?: string | null) => void;
  addTerminalTab: (tab: TerminalTab) => void;
  closeTerminalTab: (id: string) => void;
  setActiveTerminal: (id: string | null) => void;
  setPendingChanges: (changes: PendingAgentChange[]) => void;
  clearPendingChanges: () => void;
  setProjectInspection: (inspection: ProjectInspection | null) => void;
  patchSessionMemory: (patch: Partial<SessionMemory>) => void;
  resetSessionMemory: () => void;
  replaceTimeline: (entries: TimelineEntry[]) => void;
  appendTimeline: (entry: TimelineEntry) => void;
  clearTimeline: () => void;
  toggleExplorer: () => void;
  toggleTerminal: () => void;
  toggleCommandPalette: (open?: boolean) => void;
};

export const useAppStore = create<AppState>((set, get) => ({
  workspaceRoot: "",
  tree: null,
  tabs: [],
  activeTabId: null,
  selectedPath: "",
  terminalTabs: [],
  activeTerminalId: null,
  explorerVisible: true,
  terminalVisible: true,
  commandPaletteOpen: false,
  rightPanelTab: "agent",
  settings: defaultLlmConfig(),
  audit: [],
  pendingChanges: [],
  projectInspection: null,
  sessionMemory: defaultSessionMemory(),
  timeline: [],
  setWorkspace: (root, tree) =>
    set((state) => {
      const changed = state.workspaceRoot !== root;
      return {
        workspaceRoot: root,
        tree,
        selectedPath: root,
        projectInspection: changed ? null : state.projectInspection,
        sessionMemory: changed
          ? { ...defaultSessionMemory(), terminalSessionIds: state.sessionMemory.terminalSessionIds }
          : state.sessionMemory,
        timeline: changed ? [] : state.timeline
      };
    }),
  setTree: (tree) => set({ tree }),
  setSelectedPath: (path) => set({ selectedPath: path }),
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  setSettings: (settings) => set({ settings }),
  appendAudit: (entry) =>
    set((state) => ({
      audit: [...state.audit.slice(-499), entry]
    })),
  replaceAudit: (entries) => set({ audit: entries.slice(-500) }),
  addTab: (tab) =>
    set((state) => {
      const existing = state.tabs.find((item) => item.path === tab.path);
      if (existing) {
        return { activeTabId: existing.id };
      }
      return { tabs: [...state.tabs, tab], activeTabId: tab.id };
    }),
  updateTab: (id, content, dirty) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, content, dirty } : tab))
    })),
  closeTab: (id) =>
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      return {
        tabs,
        activeTabId: state.activeTabId === id ? tabs.at(-1)?.id || null : state.activeTabId
      };
    }),
  setActiveTab: (activeTabId) => set({ activeTabId }),
  setTerminalTabs: (terminalTabs, activeId = null) => set({ terminalTabs, activeTerminalId: activeId }),
  addTerminalTab: (tab) =>
    set((state) => ({
      terminalTabs: [...state.terminalTabs, tab],
      activeTerminalId: tab.id
    })),
  closeTerminalTab: (id) =>
    set((state) => {
      const terminalTabs = state.terminalTabs.filter((item) => item.id !== id);
      const nextActive = state.activeTerminalId === id ? terminalTabs.at(-1)?.id || null : state.activeTerminalId;
      return { terminalTabs, activeTerminalId: nextActive };
    }),
  setActiveTerminal: (activeTerminalId) => set({ activeTerminalId }),
  setPendingChanges: (pendingChanges) => set({ pendingChanges }),
  clearPendingChanges: () => set({ pendingChanges: [] }),
  setProjectInspection: (projectInspection) => set({ projectInspection }),
  patchSessionMemory: (patch) =>
    set((state) => ({
      sessionMemory: {
        ...state.sessionMemory,
        ...patch,
        detectedScripts: patch.detectedScripts ? Array.from(new Set(patch.detectedScripts)).slice(0, 12) : state.sessionMemory.detectedScripts,
        terminalSessionIds: patch.terminalSessionIds
          ? Array.from(new Set(patch.terminalSessionIds)).slice(0, 12)
          : state.sessionMemory.terminalSessionIds,
        knownBlockers: patch.knownBlockers ? Array.from(new Set(patch.knownBlockers)).slice(0, 12) : state.sessionMemory.knownBlockers,
        filesTouched: patch.filesTouched ? Array.from(new Set(patch.filesTouched)).slice(0, 40) : state.sessionMemory.filesTouched
      }
    })),
  resetSessionMemory: () =>
    set((state) => ({
      sessionMemory: { ...defaultSessionMemory(), terminalSessionIds: state.sessionMemory.terminalSessionIds }
    })),
  replaceTimeline: (entries) => set({ timeline: entries.slice(-300) }),
  appendTimeline: (entry) =>
    set((state) => ({
      timeline: [...state.timeline.slice(-299), entry]
    })),
  clearTimeline: () => set({ timeline: [] }),
  toggleExplorer: () => set((state) => ({ explorerVisible: !state.explorerVisible })),
  toggleTerminal: () => set((state) => ({ terminalVisible: !state.terminalVisible })),
  toggleCommandPalette: (open) =>
    set((state) => ({ commandPaletteOpen: typeof open === "boolean" ? open : !state.commandPaletteOpen }))
}));

export function getActiveTab() {
  const state = useAppStore.getState();
  return state.tabs.find((tab) => tab.id === state.activeTabId) || null;
}
