import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * What the page may load and run. Everything it executes is its own (no inline script, no eval) and so is its CSS: the
 * components use classes, and the few values worked out at run time are set through the DOM's style property, which this
 * policy doesn't restrict (only style attributes in markup and <style> elements are). Pictures and audio come from the
 * feeds' own servers (http and https) and from the app's media protocol. The browser would have injected nothing of its
 * own, so this stops a script that gets into a feed's text from phoning home or pulling in more code. (The dev server
 * needs inline scripts for hot reloading, so the policy is only added to builds.)
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' https: http: data:",
  "media-src 'self' resonate-media: https: http: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: http:",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const contentSecurityPolicy = (): Plugin => ({
  name: 'resonate-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

/**
 * The text fonts list woff, ttf and svg copies as fallbacks for old browsers. The app runs in Chromium, which
 * takes the woff2 and never loads the others, but the build would still ship them.
 * Dropping them from the font-face rules keeps only what is used. (The icon fonts are cut down to woff2 already:
 * see scripts/icons-subset.mjs.)
 */
const woff2Only = (): Plugin => ({
  name: 'resonate-woff2-only',
  enforce: 'pre',
  apply: 'build',
  transform(css, id) {
    if (!/\/node_modules\/@fontsource\/inter\/.*\.css$/.test(id.split('?')[0])) return null;
    const trimmed = css.replace(/,\s*url\([^)]*\)\s*format\((['"])(?:woff|truetype|svg)\1\)/g, '');
    return trimmed === css ? null : { code: trimmed, map: null };
  },
});

export default defineConfig({
  plugins: [react(), woff2Only(), contentSecurityPolicy()],
  base: './',
});
