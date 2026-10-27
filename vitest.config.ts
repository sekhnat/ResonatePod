import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // electron/db loads better-sqlite3, built for Electron: `npm run test:db` runs those under Electron's Node.
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, 'electron/db/**'],
    coverage: {
      provider: 'v8',
      // The logic the app stands on: parsing, the store and what saves it, the model. (Components are exercised by the
      // render tests and the end-to-end run, which a line count doesn't describe well.)
      include: ['shared/**', 'src/store/**', 'src/services/feeds.ts', 'src/services/sync.ts', 'src/persistence.ts', 'src/model.ts', 'src/data.ts', 'src/notes.ts', 'src/feed-parse.ts'],
      exclude: ['**/*.test.*', 'shared/types.ts', 'shared/library.ts'],
      reporter: ['text-summary', 'text'],
      // Measured after the store was split and the services added (95.6% of statements and lines, 87.8% of branches, 92.3% of functions), less two points.
      thresholds: { statements: 93, lines: 93, branches: 85, functions: 90 },
    },
  },
});
