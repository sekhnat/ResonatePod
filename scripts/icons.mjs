// Renders assets/*.svg to the PNGs Electron and electron-builder need.
import { createRequire } from 'node:module';

// Uses the project's playwright devDependency, or one on NODE_PATH.
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';

const jobs = [['assets/icon.svg', 'assets/icon-512.png', 512], ['assets/tray.svg', 'assets/tray-22.png', 22], ['assets/tray.svg', 'assets/tray-22@2x.png', 44]];
const browser = await chromium.launch();
for (const [src, out, size] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const svg = readFileSync(src, 'utf8').replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}
await browser.close();
