import { createDefaultSessionMemory, type AgentSlice, type AppSliceCreator } from "@/state/storeTypes";

export const createAgentSlice: AppSliceCreator<AgentSlice> = (set, get) => ({
  pendingChanges: [],
  appliedPatchHistory: [],
  agentPhase: "understand",
  agentMode: "manual",
  taskGraph: [],
  recoveryAttempt: 0,
  sessionMemory: createDefaultSessionMemory(),
  timeline: [],
  setPendingChanges: (pendingChanges) => set({ pendingChanges }),
  clearPendingChanges: () => set({ pendingChanges: [] }),
  pushAppliedPatchSet: (patchSet) =>
    set((state) => ({
      appliedPatchHistory: [...state.appliedPatchHistory.slice(-29), patchSet]
    })),
  popAppliedPatchSet: () => {
    const state = get();
    if (!state.appliedPatchHistory.length) return null;
    const next = [...state.appliedPatchHistory];
    const patchSet = next.pop() || null;
    set({ appliedPatchHistory: next });
    return patchSet;
  },
  clearAppliedPatchHistory: () => set({ appliedPatchHistory: [] }),
  setAgentPhase: (agentPhase) => set({ agentPhase }),
  setAgentMode: (agentMode) => set({ agentMode }),
  setTaskGraph: (taskGraph) => set({ taskGraph }),
  patchTaskNode: (id, patch) =>
    set((state) => ({
      taskGraph: state.taskGraph.map((node) => (node.id === id ? { ...node, ...patch } : node))
    })),
  incrementRecoveryAttempt: () => set((state) => ({ recoveryAttempt: state.recoveryAttempt + 1 })),
  resetRecoveryAttempt: () => set({ recoveryAttempt: 0 }),
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
      sessionMemory: { ...createDefaultSessionMemory(), terminalSessionIds: state.sessionMemory.terminalSessionIds }
    })),
  replaceTimeline: (entries) =>
    set((state) => ({
      timeline: entries.slice(-(state.settings.lowResourceMode ? 120 : 300))
    })),
  appendTimeline: (entry) =>
    set((state) => ({
      timeline: [...state.timeline.slice(-(state.settings.lowResourceMode ? 119 : 299)), entry]
    })),
  clearTimeline: () => set({ timeline: [] })
});
