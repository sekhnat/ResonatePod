import { defineConfig } from 'vitest/config';

// The database tests load better-sqlite3, which is built for Electron, so they run under Electron's Node
// (see the test:db script) and not in the jsdom run that `npm test` starts with.
export default defineConfig({
  test: { environment: 'node', include: ['electron/db/**/*.test.ts'] },
});
