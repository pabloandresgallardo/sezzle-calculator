import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { resolveProxyTargets } from './src/devProxy.ts';

const { java: javaTarget, go: goTarget } = resolveProxyTargets(process.env);

/**
 * Same routes as nginx: `/api/{backend}/health` → `/actuator/health`, `/api/{backend}/…` → `/api/…`.
 */
function backendProxy(backend: 'java' | 'go', target: string) {
  const prefix = `/api/${backend}`;
  return {
    target,
    changeOrigin: true,
    rewrite: (path: string) =>
      /^\/health(\?|$)/.test(path.slice(prefix.length))
        ? `/actuator/health${path.slice(prefix.length + '/health'.length)}`
        : `/api${path.slice(prefix.length)}`,
  };
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_PORT ?? 5180),
    strictPort: true,
    proxy: {
      // Matched in order: the per-backend prefixes first, then `/api` (compatibility) → Java.
      '/api/java/': backendProxy('java', javaTarget),
      '/api/go/': backendProxy('go', goTarget),
      '/api': { target: javaTarget, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    passWithNoTests: true,
    css: { modules: { classNameStrategy: 'non-scoped' } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/test/**', 'src/**/*.test.{ts,tsx}', 'src/**/*.d.ts'],
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
