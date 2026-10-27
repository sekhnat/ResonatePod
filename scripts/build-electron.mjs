// Bundles the Electron main and preload scripts into dist-electron/.
import { build, context } from 'esbuild';

const options = {
  entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // better-sqlite3 is a native module: it is loaded from node_modules (unpacked from the asar), not bundled.
  external: ['electron', 'better-sqlite3'],
  sourcemap: true,
  logLevel: 'info',
};

export async function watchElectron(onRebuild) {
  const ctx = await context({ ...options, plugins: [{ name: 'notify', setup: (b) => b.onEnd((r) => { if (!r.errors.length) onRebuild(); }) }] });
  await ctx.watch();
  return ctx;
}

if (import.meta.url === `file://${process.argv[1]}`) await build(options);
