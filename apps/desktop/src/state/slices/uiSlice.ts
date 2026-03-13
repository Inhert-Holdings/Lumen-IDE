import type { AppSliceCreator, UiSlice } from "@/state/storeTypes";

export const createUiSlice: AppSliceCreator<UiSlice> = (set) => ({
  explorerVisible: true,
  terminalVisible: true,
  commandPaletteOpen: false,
  rightPanelTab: "agent",
  toggleExplorer: () => set((state) => ({ explorerVisible: !state.explorerVisible })),
  toggleTerminal: () => set((state) => ({ terminalVisible: !state.terminalVisible })),
  toggleCommandPalette: (open) =>
    set((state) => ({ commandPaletteOpen: typeof open === "boolean" ? open : !state.commandPaletteOpen })),
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab })
});
