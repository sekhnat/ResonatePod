// Dev runner: Vite dev server for the renderer, esbuild watch for main/preload,
// and an Electron process that restarts when the main process changes.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { watchElectron } from './build-electron.mjs';

const electronPath = createRequire(import.meta.url)('electron');
const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];

let child = null;
const launch = () => {
  if (child) { child.removeAllListeners('exit'); child.kill(); }
  child = spawn(electronPath, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
  child.on('exit', () => { server.close(); process.exit(0); });
};
await watchElectron(launch);
