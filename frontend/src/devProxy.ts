/**
 * Resolves the Vite dev proxy targets from the environment.
 * `VITE_API_PROXY_TARGET` is a deprecated alias for `VITE_JAVA_TARGET`.
 */
export function resolveProxyTargets(env: Record<string, string | undefined>): {
  java: string;
  go: string;
} {
  return {
    java: env.VITE_JAVA_TARGET ?? env.VITE_API_PROXY_TARGET ?? 'http://localhost:8090',
    go: env.VITE_GO_TARGET ?? 'http://localhost:8091',
  };
}
