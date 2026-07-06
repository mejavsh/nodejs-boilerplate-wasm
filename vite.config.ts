import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import vinext from 'vinext';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@/public': path.resolve(import.meta.dirname, 'public'),
      // Stub out heavy Node.js-dependent packages for Spin/WASM target
      '@sentry/nextjs': path.resolve(import.meta.dirname, 'src/stubs/sentry.ts'),
      '@arcjet/next': path.resolve(import.meta.dirname, 'src/stubs/arcjet.ts'),
    },
  },
  plugins: [tailwindcss(), vinext()],
});
