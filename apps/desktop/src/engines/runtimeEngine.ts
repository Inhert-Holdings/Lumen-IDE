export function statusPollIntervalMs(lowResourceMode: boolean) {
  return lowResourceMode ? 8000 : 2500;
}

export function diagnosticsPollIntervalMs(lowResourceMode: boolean) {
  return lowResourceMode ? 12000 : 5000;
}

export function liveBuildLoopIntervalMs(lowResourceMode: boolean) {
  return lowResourceMode ? 9000 : 5000;
}
