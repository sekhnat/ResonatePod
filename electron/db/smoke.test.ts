import Database from 'better-sqlite3';
import { expect, it } from 'vitest';

it('opens a database in the build Electron will run', () => {
  const db = new Database(':memory:');
  db.exec('create table t(a)');
  db.prepare('insert into t values (?)').run(42);
  expect(db.prepare('select a from t').get()).toEqual({ a: 42 });
  expect(process.versions.electron).toBeTruthy();
});
