const { spawn } = require('child_process');
const path = require('path');

// Ensure Electron does not inherit a global Electron-as-Node setting.
delete process.env.ELECTRON_RUN_AS_NODE;

if (!process.env.ELECTRON_START_URL) {
  process.env.ELECTRON_START_URL = 'http://localhost:5173';
}

const electronBinary = require('electron');
const appRoot = path.resolve(__dirname, '..');

const child = spawn(electronBinary, [appRoot], {
  stdio: 'inherit',
  env: process.env,
  cwd: appRoot
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
