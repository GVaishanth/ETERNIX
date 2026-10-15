import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Dev/preview servers bind to 0.0.0.0 so the sandbox live-preview proxy can reach them.
// allowedHosts must include the preview domain, or Vite rejects the proxied Host header.
const PREVIEW_ALLOWED_HOSTS = ['.e2b.app', 'localhost', '127.0.0.1'];

export default defineConfig({
  plugins: [react()],
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
});
