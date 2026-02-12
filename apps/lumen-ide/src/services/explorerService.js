export async function listWorkspace(options = {}) {
  if (window?.lumen?.explorer?.list) {
    return window.lumen.explorer.list(options);
  }

  return {
    status: 'offline',
    message: 'Explorer bridge not available. Run via Electron to use workspace browsing.'
  };
}

export async function selectWorkspaceRoot() {
  if (window?.lumen?.explorer?.selectRoot) {
    return window.lumen.explorer.selectRoot();
  }

  return {
    status: 'offline',
    message: 'Explorer bridge not available. Run via Electron to pick a workspace.'
  };
}

export async function readWorkspaceFile(filePath) {
  if (window?.lumen?.explorer?.read) {
    return window.lumen.explorer.read(filePath);
  }

  return {
    status: 'offline',
    message: 'Explorer bridge not available. Run via Electron to open files.'
  };
}
