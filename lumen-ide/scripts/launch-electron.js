const { spawn } = require('child_process');

// Ensure Electron does not inherit a global Electron-as-Node setting.
delete process.env.ELECTRON_RUN_AS_NODE;

if (!process.env.ELECTRON_START_URL) {
  process.env.ELECTRON_START_URL = 'http://localhost:5173';
}

const electronBinary = require('electron');

const child = spawn(electronBinary, ['.'], {
  stdio: 'inherit',
  env: process.env
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
