import { create } from "zustand";

import type { AppState } from "@/state/storeTypes";
import { createAgentSlice } from "@/state/slices/agentSlice";
import { createEditorSlice } from "@/state/slices/editorSlice";
import { createGitSlice } from "@/state/slices/gitSlice";
import { createPolicySlice } from "@/state/slices/policySlice";
import { createPreviewSlice } from "@/state/slices/previewSlice";
import { createTerminalSlice } from "@/state/slices/terminalSlice";
import { createUiSlice } from "@/state/slices/uiSlice";
import { createWorkspaceSlice } from "@/state/slices/workspaceSlice";

export const useAppStore = create<AppState>()((...args) => ({
  ...createUiSlice(...args),
  ...createWorkspaceSlice(...args),
  ...createEditorSlice(...args),
  ...createTerminalSlice(...args),
  ...createPreviewSlice(...args),
  ...createGitSlice(...args),
  ...createPolicySlice(...args),
  ...createAgentSlice(...args)
}));

export function getActiveTab() {
  const state = useAppStore.getState();
  return state.tabs.find((tab) => tab.id === state.activeTabId) || null;
}

export type {
  ActionConfidence,
  AgentMode,
  AgentPhase,
  AppState,
  AppliedPatchSet,
  BottomPanelTab,
  EditorTab,
  PendingAgentChange,
  RightPanelTab,
  SessionMemory,
  TaskNode,
  TerminalTab,
  TimelineEntry
} from "@/state/storeTypes";
