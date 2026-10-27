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
      include: ['shared/**', 'src/store/**', 'src/persistence.ts', 'src/model.ts', 'src/data.ts', 'src/notes.ts', 'src/feed-parse.ts'],
      exclude: ['**/*.test.*', 'shared/types.ts', 'shared/library.ts'],
      reporter: ['text-summary', 'text'],
      // Measured when added (93.7% of statements and lines, 85.3% of branches, 86.9% of functions), less two points.
      thresholds: { statements: 91, lines: 91, branches: 83, functions: 84 },
    },
  },
});
