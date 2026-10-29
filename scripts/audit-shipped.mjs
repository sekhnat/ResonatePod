// Fails when a package the app ships has a high or critical advisory.
// The window's packages (react, zustand and so on) are devDependencies, because Vite bundles them into dist/ and they
// must not be copied into app.asar a second time. `npm audit --omit=dev` would therefore skip them, and plain
// `npm audit` would fail on test and build tools that never ship. This audits the shipped set and what it depends on.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SHIPPED = ['better-sqlite3', 'react', 'react-dom', 'zustand', '@tanstack/react-virtual', 'fast-xml-parser', '@fontsource/inter', '@phosphor-icons/web'];
const FAIL = new Set(['high', 'critical']);

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages;

/** The lockfile entry `from` resolves `name` to: the nearest node_modules/<name> going up the tree. */
function resolve(name, from) {
  for (let dir = from; ; ) {
    const key = `${dir}${dir ? '/' : ''}node_modules/${name}`;
    if (lock[key]) return key;
    if (!dir) return null;
    const i = dir.lastIndexOf('/node_modules/');
    dir = i < 0 ? '' : dir.slice(0, i);
  }
}

const names = new Set();
const seen = new Set();
const walk = (key) => {
  if (seen.has(key)) return;
  seen.add(key);
  names.add(key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length));
  const e = lock[key];
  for (const dep of Object.keys({ ...e.dependencies, ...e.optionalDependencies })) {
    const k = resolve(dep, key);
    if (k) walk(k);
  }
};
for (const name of SHIPPED) {
  const key = resolve(name, '');
  if (!key) throw new Error(`${name} is not in package-lock.json`);
  walk(key);
}

let report;
try {
  report = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (err) {
  report = err.stdout; // npm audit exits 1 when it finds anything
  if (!report) throw err;
}
const vulnerable = Object.values(JSON.parse(report).vulnerabilities ?? {}).filter((v) => names.has(v.name) && FAIL.has(v.severity));
for (const v of vulnerable) console.error(`${v.severity}: ${v.name} ${v.range}`);
console.log(`Audited ${names.size} shipped packages: ${vulnerable.length} high or critical`);
process.exit(vulnerable.length ? 1 : 0);
