import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // electron/db loads better-sqlite3, built for Electron: `npm run test:db` runs those under Electron's Node.
  test: { environment: 'jsdom', exclude: [...configDefaults.exclude, 'electron/db/**'] },
});
