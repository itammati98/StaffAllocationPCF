import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: 'dev',
  plugins: [react()],
  build: {
    outDir: '../dev-dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
  test: {
    // Vite `root` is `dev`, so test globs resolve from there; the suite lives at the project root.
    include: ['../tests/**/*.test.ts'],
    environment: 'node',
  },
});
