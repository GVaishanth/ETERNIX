import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Dev/preview servers bind to 0.0.0.0 so the sandbox live-preview proxy can reach them.
// allowedHosts must include the preview domain, or Vite rejects the proxied Host header.
const PREVIEW_ALLOWED_HOSTS = ['.e2b.app', 'localhost', '127.0.0.1'];

// Static hosting (Part 11). The production build uses a relative base, so the same `dist/` works at a domain root
// (https://host/) and at a project subpath such as GitHub Pages (https://user.github.io/<repo>/). Root-absolute asset
// URLs (/assets/...) would break on a subpath. The dev server keeps the root base.
//
// Two pages. index.html is the ETERNIX front page (landing, GARAGE showroom, loading steps). Its ENTER GAME action
// opens play.html, which is the game with its loading screen and React entry (src/main.tsx). The front page's loader
// imports the game's own modules to check readiness, so the front page bundle includes them. It does not mount the game.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        home: 'index.html',
        play: 'play.html',
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: PREVIEW_ALLOWED_HOSTS,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: PREVIEW_ALLOWED_HOSTS,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
