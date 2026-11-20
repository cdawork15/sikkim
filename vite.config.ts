import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // Dev-only: where `npm run dev` forwards /v1. Not bundled into the app.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    server: {
      port: 5173,
      proxy: { '/v1': env.DEV_API_PROXY_TARGET || 'http://127.0.0.1:3000' },
    },
    esbuild: { jsx: 'automatic' },
    test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'node' },
  };
});
