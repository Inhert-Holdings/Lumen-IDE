import type { LlmSettings } from "@/types/electron";

export function formatTrustPreset(preset: LlmSettings["permissionPreset"]) {
  return preset.replace(/_/g, " ");
}

export function isHighTrustPreset(preset: LlmSettings["permissionPreset"]) {
  return preset === "full_local_workspace" || preset === "trusted_workspace_profile";
}
