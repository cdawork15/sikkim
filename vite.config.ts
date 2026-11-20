import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173, proxy: { '/v1': 'http://127.0.0.1:3000' } },
  esbuild: { jsx: 'automatic' },
  test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'node' },
});
