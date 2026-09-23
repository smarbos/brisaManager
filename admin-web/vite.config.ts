/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Baked in at build time so the running app can show exactly which version is deployed
  // (see AppFooter) without an extra API round-trip for something that never changes at runtime.
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    host: true,
    port: 5180,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  },
});
