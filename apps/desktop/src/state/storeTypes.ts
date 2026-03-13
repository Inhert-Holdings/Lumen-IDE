import type { StateCreator } from "zustand";

import type { LlmConfig } from "@lumen/llm-client";
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
  previousContent: string;
  nextContent: string;
  existedBefore: boolean;
};

export type AppliedPatchSet = {
  id: string;
  timestamp: string;
  changes: PendingAgentChange[];
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

export type AgentPhase =
  | "understand"
  | "scope"
  | "plan"
  | "execute"
  | "verify"
  | "recover"
  | "propose"
  | "apply"
  | "summarize";

export type ActionConfidence = "obvious" | "likely" | "uncertain" | "risky";

export type TaskNode = {
  id: string;
  title: string;
  phase: AgentPhase;
  status: "pending" | "running" | "done" | "failed" | "blocked";
  confidence: ActionConfidence;
  dependsOn: string[];
  detail?: string;
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

export type RightPanelTab =
  | "agent"
  | "timeline"
  | "preview"
  | "git"
  | "permissions"
  | "settings"
  | "audit"
  | "diagnostics";

export type AgentMode = "manual" | "live_build";

export function createDefaultSessionMemory(): SessionMemory {
  return {
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
  };
}

export type UiSlice = {
  explorerVisible: boolean;
  terminalVisible: boolean;
  commandPaletteOpen: boolean;
  rightPanelTab: RightPanelTab;
  toggleExplorer: () => void;
  toggleTerminal: () => void;
  toggleCommandPalette: (open?: boolean) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
};

export type WorkspaceSlice = {
  workspaceRoot: string;
  tree: WorkspaceNode | null;
  selectedPath: string;
  setWorkspace: (root: string, tree: WorkspaceNode | null) => void;
  setTree: (tree: WorkspaceNode) => void;
  setSelectedPath: (path: string) => void;
};

export type EditorSlice = {
  tabs: EditorTab[];
  activeTabId: string | null;
  addTab: (tab: EditorTab) => void;
  updateTab: (id: string, content: string, dirty: boolean) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string | null) => void;
};

export type TerminalSlice = {
  terminalTabs: TerminalTab[];
  activeTerminalId: string | null;
  setTerminalTabs: (tabs: TerminalTab[], activeId?: string | null) => void;
  addTerminalTab: (tab: TerminalTab) => void;
  closeTerminalTab: (id: string) => void;
  setActiveTerminal: (id: string | null) => void;
};

export type PreviewSlice = {
  projectInspection: ProjectInspection | null;
  setProjectInspection: (inspection: ProjectInspection | null) => void;
};

export type GitSlice = {
  gitPanelFilter: "all" | "staged";
  setGitPanelFilter: (filter: "all" | "staged") => void;
};

export type AgentSlice = {
  pendingChanges: PendingAgentChange[];
  appliedPatchHistory: AppliedPatchSet[];
  agentPhase: AgentPhase;
  agentMode: AgentMode;
  taskGraph: TaskNode[];
  recoveryAttempt: number;
  sessionMemory: SessionMemory;
  timeline: TimelineEntry[];
  setPendingChanges: (changes: PendingAgentChange[]) => void;
  clearPendingChanges: () => void;
  pushAppliedPatchSet: (patchSet: AppliedPatchSet) => void;
  popAppliedPatchSet: () => AppliedPatchSet | null;
  clearAppliedPatchHistory: () => void;
  setAgentPhase: (phase: AgentPhase) => void;
  setAgentMode: (mode: AgentMode) => void;
  setTaskGraph: (nodes: TaskNode[]) => void;
  patchTaskNode: (id: string, patch: Partial<TaskNode>) => void;
  incrementRecoveryAttempt: () => void;
  resetRecoveryAttempt: () => void;
  patchSessionMemory: (patch: Partial<SessionMemory>) => void;
  resetSessionMemory: () => void;
  replaceTimeline: (entries: TimelineEntry[]) => void;
  appendTimeline: (entry: TimelineEntry) => void;
  clearTimeline: () => void;
};

export type PolicySlice = {
  settings: LlmConfig;
  audit: AuditEntry[];
  setSettings: (settings: LlmConfig) => void;
  appendAudit: (entry: AuditEntry) => void;
  replaceAudit: (entries: AuditEntry[]) => void;
};

export type AppState = UiSlice & WorkspaceSlice & EditorSlice & TerminalSlice & PreviewSlice & GitSlice & AgentSlice & PolicySlice;

export type AppSliceCreator<T> = StateCreator<AppState, [], [], T>;
