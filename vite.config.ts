import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * What the page may load and run. Everything it executes is its own (no inline script, no eval); styles may be inline
 * because components set style attributes; pictures and audio come from the feeds' own servers (http and https) and from
 * the app's media protocol. The browser would have injected nothing of its own, so this stops a script that gets into a
 * feed's text from phoning home or pulling in more code. (The dev server needs inline scripts for hot reloading, so the
 * policy is only added to builds.)
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
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

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  base: './',
});
