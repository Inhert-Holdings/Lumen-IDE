import type { AppSliceCreator, PreviewSlice } from "@/state/storeTypes";

export const createPreviewSlice: AppSliceCreator<PreviewSlice> = (set) => ({
  projectInspection: null,
  setProjectInspection: (projectInspection) => set({ projectInspection })
});
