// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The window ships only the icons it uses (scripts/icons-subset.mjs). Using one that was left out would draw nothing.
const PACKAGE = 'node_modules/@phosphor-icons/web/src';
const GENERATED = 'src/styles/icons';

function usedNames(dir = 'src', found = new Set<string>()) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) usedNames(file, found);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bph-([a-z0-9]+(?:-[a-z0-9]+)*)/g)) found.add(m[1]);
    }
  }
  return found;
}

const rulesIn = (css: string) => new Set([...css.matchAll(/^\.ph(?:-fill)?\.ph-([a-z0-9-]+):before/gm)].map((m) => m[1]));

describe('the icon subset', () => {
  const real = rulesIn(readFileSync(`${PACKAGE}/regular/style.css`, 'utf8'));
  const used = [...usedNames()].filter((n) => real.has(n)); // `ph-fill` is a class, not an icon

  it('finds the icons the app draws', () => {
    expect(used.length).toBeGreaterThan(40);
    expect(used).toContain('play');
  });

  for (const weight of ['regular', 'fill']) {
    it(`has every icon the sources use, in the ${weight} weight, with its font`, () => {
      const have = rulesIn(readFileSync(`${GENERATED}/${weight}.css`, 'utf8'));
      const missing = used.filter((n) => !have.has(n));
      expect(missing, 'run `npm run icons:subset`').toEqual([]);
      expect(existsSync(`${GENERATED}/${weight === 'fill' ? 'Phosphor-Fill' : 'Phosphor'}.woff2`)).toBe(true);
    });
  }

  it('keeps each icon at the codepoint the full package gives it', () => {
    const codes = (css: string) => new Map([...css.matchAll(/^\.ph(?:-fill)?\.ph-([a-z0-9-]+):before\s*\{\s*content:\s*"\\([0-9a-f]+)"/gm)].map((m) => [m[1], m[2]]));
    for (const weight of ['regular', 'fill']) {
      const full = codes(readFileSync(`${PACKAGE}/${weight}/style.css`, 'utf8'));
      for (const [name, code] of codes(readFileSync(`${GENERATED}/${weight}.css`, 'utf8'))) expect(full.get(name), `${weight} ${name}`).toBe(code);
    }
  });
});
