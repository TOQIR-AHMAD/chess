/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * `credentialless` COEP keeps the page cross-origin isolated (so the engine may use
 * SharedArrayBuffer / multiple threads) while still allowing no-cors subresources
 * such as Chess.com avatars to load. Browsers without `credentialless` support simply
 * stay non-isolated, and the engine layer falls back to the single-threaded build.
 */
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  build: {
    rollupOptions: {
      output: {
        // Keep the chess libraries and the React runtime in their own chunks so a
        // change to app code does not invalidate them in the browser cache.
        manualChunks(id: string) {
          if (id.includes('node_modules/chess.js') || id.includes('node_modules/react-chessboard')) {
            return 'chess';
          }
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router')
          ) {
            return 'react';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
