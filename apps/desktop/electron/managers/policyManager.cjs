function createPolicyManager(deps) {
  const { loadSettings, saveSettings, audit, agentRuntimeState, policyPresets, defaultPreset, isReadOnlyCommand } = deps;

  function normalizePolicyPreset(value) {
    const preset = String(value || "").trim();
    return policyPresets.has(preset) ? preset : defaultPreset;
  }

  function riskForActionType(actionType, command = "") {
    if (
      actionType === "git_push" ||
      actionType === "git_commit" ||
      actionType === "git_merge" ||
      actionType === "git_rebase" ||
      actionType === "git_cherry_pick"
    ) {
      return "risky";
    }
    if (actionType === "write_file" || actionType === "delete_file") return "uncertain";
    if (actionType === "run_cmd") {
      return isReadOnlyCommand(command || "") ? "likely" : "risky";
    }
    if (["preview_click", "preview_type", "preview_press", "preview_start", "preview_screenshot"].includes(actionType)) {
      return "likely";
    }
    return "obvious";
  }

  function presetAllowsActionType(preset, actionType) {
    const readActions = new Set([
      "list_dir",
      "read_file",
      "search_files",
      "git_status",
      "git_diff",
      "preview_status",
      "preview_snapshot",
      "preview_screenshot"
    ]);
    const editActions = new Set(["write_file", "delete_file"]);
    const previewActions = new Set(["preview_start", "preview_click", "preview_type", "preview_press"]);
    const gitActions = new Set([
      "git_stage",
      "git_unstage",
      "git_merge",
      "git_rebase",
      "git_cherry_pick",
      "git_commit",
      "git_push"
    ]);

    if (preset === "read_only") return readActions.has(actionType);
    if (preset === "local_edit_only") return readActions.has(actionType) || editActions.has(actionType);
    if (preset === "preview_operator") return readActions.has(actionType) || previewActions.has(actionType);
    if (preset === "git_operator") return readActions.has(actionType) || gitActions.has(actionType);
    if (preset === "local_build_mode") {
      return (
        readActions.has(actionType) ||
        editActions.has(actionType) ||
        previewActions.has(actionType) ||
        actionType === "run_cmd" ||
        actionType === "git_stage" ||
        actionType === "git_unstage"
      );
    }
    return true;
  }

  function evaluatePolicyDecision(payload = {}) {
    const settings = loadSettings();
    const preset = normalizePolicyPreset(payload.preset || settings.permissionPreset);
    const actionType = String(payload.actionType || "").trim();
    const command = String(payload.command || "");
    const risk = riskForActionType(actionType, command);
    if (actionType === "git_push" && !settings.onlineMode) {
      return {
        preset,
        actionType,
        risk,
        allowed: false,
        requiresApproval: false,
        reason: "Online mode is disabled."
      };
    }

    const allowed = presetAllowsActionType(preset, actionType);
    if (!allowed) {
      return {
        preset,
        actionType,
        risk,
        allowed: false,
        requiresApproval: false,
        reason: `Action ${actionType} blocked by ${preset} preset.`
      };
    }

    const requiresApproval = preset === "trusted_workspace_profile" ? risk === "risky" : risk === "uncertain" || risk === "risky";
    return {
      preset,
      actionType,
      risk,
      allowed: true,
      requiresApproval,
      reason: requiresApproval ? `Requires approval (${risk} risk).` : `Allowed (${risk} risk).`
    };
  }

  function enforceAgentPolicy(payload, actionType, command = "") {
    if (String(payload?.source || "").trim() !== "agent") return;
    const decision = evaluatePolicyDecision({
      actionType,
      command,
      preset: payload?.preset || ""
    });
    audit("policy.decision", {
      actionType,
      allowed: decision.allowed,
      requiresApproval: decision.requiresApproval,
      risk: decision.risk,
      preset: decision.preset,
      source: "agent",
      mode: agentRuntimeState.mode
    });
    if (!decision.allowed) {
      throw new Error(decision.reason);
    }
    if (decision.requiresApproval && !payload?.approved) {
      throw new Error(`${actionType} requires explicit approval by policy.`);
    }
  }

  function getPolicyState() {
    const settings = loadSettings();
    return {
      preset: normalizePolicyPreset(settings.permissionPreset),
      presets: Array.from(policyPresets)
    };
  }

  function setPolicyPreset(nextPreset) {
    const settings = loadSettings();
    const preset = normalizePolicyPreset(nextPreset);
    saveSettings({
      ...settings,
      permissionPreset: preset
    });
    audit("policy.set_preset", { preset });
    return getPolicyState();
  }

  return {
    normalizePolicyPreset,
    riskForActionType,
    evaluatePolicyDecision,
    enforceAgentPolicy,
    getPolicyState,
    setPolicyPreset
  };
}

module.exports = { createPolicyManager };

