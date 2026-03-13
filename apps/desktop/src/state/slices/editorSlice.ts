import type { AppSliceCreator, EditorSlice } from "@/state/storeTypes";

export const createEditorSlice: AppSliceCreator<EditorSlice> = (set) => ({
  tabs: [],
  activeTabId: null,
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
  setActiveTab: (activeTabId) => set({ activeTabId })
});
