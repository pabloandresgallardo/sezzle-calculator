import { HEALTH_TIMEOUT_MS, type Backend } from './backend';

/**
 * `GET /api/{backend}/health` (proxied to the backend's `/actuator/health`). Healthy means HTTP 200
 * with `status: "UP"`; anything else — 5xx, network error, bad body, timeout or abort — is down.
 */
export async function checkHealth(backend: Backend, signal?: AbortSignal): Promise<boolean> {
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };
  const timeout = setTimeout(abort, HEALTH_TIMEOUT_MS);
  if (signal?.aborted === true) abort();
  signal?.addEventListener('abort', abort);
  try {
    const response = await fetch(`/api/${backend}/health`, { signal: controller.signal });
    if (response.status !== 200) return false;
    const body: unknown = await response.json();
    return (
      typeof body === 'object' && body !== null && (body as Record<string, unknown>).status === 'UP'
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
