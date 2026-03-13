import { defaultLlmConfig } from "@lumen/llm-client";
import type { AppSliceCreator, PolicySlice } from "@/state/storeTypes";

export const createPolicySlice: AppSliceCreator<PolicySlice> = (set) => ({
  settings: defaultLlmConfig(),
  audit: [],
  setSettings: (settings) => set({ settings }),
  appendAudit: (entry) =>
    set((state) => ({
      audit: [...state.audit.slice(-(state.settings.lowResourceMode ? 199 : 499)), entry]
    })),
  replaceAudit: (entries) =>
    set((state) => ({
      audit: entries.slice(-(state.settings.lowResourceMode ? 200 : 500))
    }))
});
