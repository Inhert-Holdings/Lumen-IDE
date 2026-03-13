import type { AppSliceCreator, GitSlice } from "@/state/storeTypes";

export const createGitSlice: AppSliceCreator<GitSlice> = (set) => ({
  gitPanelFilter: "all",
  setGitPanelFilter: (gitPanelFilter) => set({ gitPanelFilter })
});
