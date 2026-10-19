import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/website',
  // tsconfig.app.json's `jsx` belongs to Next, which rewrites it.
  esbuild: { jsx: 'automatic' as const },
  resolve: {
    alias: { '@': `${import.meta.dirname}/src` },
  },
  test: {
    name: 'website',
    watch: false,
    environment: 'node',
    include: ['src/**/*.spec.{ts,tsx}'],
    reporters: ['default'],
  },
}));
