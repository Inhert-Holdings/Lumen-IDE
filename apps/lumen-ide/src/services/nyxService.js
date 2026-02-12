export async function sendToNyx(
  fileContent,
  prompt = '',
  { model = 'auto', reasoningEffort = 'auto', filePath = '', allowWrite = false } = {}
) {
  if (window?.lumen?.nyx?.send) {
    return window.lumen.nyx.send({
      fileContent,
      prompt,
      model,
      reasoningEffort,
      filePath,
      allowWrite
    });
  }

  return {
    status: 'offline',
    message: 'Nyx bridge not available. Run via Electron to use live inference.'
  };
}

export async function receiveSuggestions() {
  if (window?.lumen?.nyx?.suggestions) {
    return window.lumen.nyx.suggestions();
  }

  return {
    status: 'offline',
    suggestions: ['Launch via Electron to unlock Nyx placeholders.']
  };
}
