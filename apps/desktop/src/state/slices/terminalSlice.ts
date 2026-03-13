import type { AppSliceCreator, TerminalSlice } from "@/state/storeTypes";

export const createTerminalSlice: AppSliceCreator<TerminalSlice> = (set) => ({
  terminalTabs: [],
  activeTerminalId: null,
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
  setActiveTerminal: (activeTerminalId) => set({ activeTerminalId })
});
