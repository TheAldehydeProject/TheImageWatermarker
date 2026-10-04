import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  // Relative base so the built site works from any sub-path (e.g. GitHub Pages).
  base: './',
  plugins: [svelte()],
  // The WebAssembly codecs load their .wasm files relative to their own modules,
  // which breaks if Vite pre-bundles them.
  optimizeDeps: {
    exclude: [
      '@jsquash/avif',
      '@jsquash/jpeg',
      '@jsquash/jxl',
      '@jsquash/oxipng',
      '@jsquash/png',
      '@jsquash/webp',
      'libraw-wasm',
    ],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
