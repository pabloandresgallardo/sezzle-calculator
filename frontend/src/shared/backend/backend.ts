export type Backend = 'java' | 'go';

/** Java is the reference implementation: used at start-up and whenever both are healthy (unless the user chose Go). */
export const DEFAULT_BACKEND: Backend = 'java';

/** Display order in the selector. */
export const BACKENDS: readonly Backend[] = ['java', 'go'];

export const BACKEND_LABELS: Readonly<Record<Backend, string>> = { java: 'Java', go: 'Go' };

/** A health check that has not answered by then counts as down. */
export const HEALTH_TIMEOUT_MS = 2000;

/** Polling period while at least one backend is down; no polling with both healthy. */
export const RECHECK_INTERVAL_MS = 10_000;

export function otherBackend(backend: Backend): Backend {
  return backend === 'java' ? 'go' : 'java';
}
