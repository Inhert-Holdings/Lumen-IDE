import { createDefaultSessionMemory, type AppSliceCreator, type WorkspaceSlice } from "@/state/storeTypes";

export const createWorkspaceSlice: AppSliceCreator<WorkspaceSlice> = (set) => ({
  workspaceRoot: "",
  tree: null,
  selectedPath: "",
  setWorkspace: (root, tree) =>
    set((state) => {
      const changed = state.workspaceRoot !== root;
      return {
        workspaceRoot: root,
        tree,
        selectedPath: root,
        projectInspection: changed ? null : state.projectInspection,
        appliedPatchHistory: changed ? [] : state.appliedPatchHistory,
        taskGraph: changed ? [] : state.taskGraph,
        recoveryAttempt: changed ? 0 : state.recoveryAttempt,
        sessionMemory: changed
          ? { ...createDefaultSessionMemory(), terminalSessionIds: state.sessionMemory.terminalSessionIds }
          : state.sessionMemory,
        timeline: changed ? [] : state.timeline
      };
    }),
  setTree: (tree) => set({ tree }),
  setSelectedPath: (selectedPath) => set({ selectedPath })
});
