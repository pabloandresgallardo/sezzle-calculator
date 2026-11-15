import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECHECK_INTERVAL_MS, type Backend } from './backend';
import { checkHealth } from './checkHealth';
import { useBackends } from './useBackends';

vi.mock('./checkHealth', () => ({ checkHealth: vi.fn() }));

/** What each fake `/api/{backend}/health` answers right now. */
let healthy: Record<Backend, boolean>;

function checks(backend: Backend): number {
  return vi.mocked(checkHealth).mock.calls.filter(([b]) => b === backend).length;
}

/** Lets the pending health promises settle and React apply the results. */
async function flush() {
  await act(() => vi.advanceTimersByTimeAsync(0));
}

async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

async function mount() {
  const hook = renderHook(() => useBackends());
  await flush();
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  healthy = { java: true, go: true };
  vi.mocked(checkHealth).mockImplementation((backend) => Promise.resolve(healthy[backend]));
});

afterEach(() => {
  vi.mocked(checkHealth).mockReset();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

describe('useBackends', () => {
  it('starts on java with both healthy and is selectable', async () => {
    const { result } = renderHook(() => useBackends());
    expect(result.current.active).toBe('java');
    expect(result.current.selectable).toBe(false);
    await flush();
    expect(result.current.active).toBe('java');
    expect(result.current.selectable).toBe(true);
    expect(checks('java')).toBe(1);
    expect(checks('go')).toBe(1);
  });

  it('switches silently to go when java is down', async () => {
    healthy = { java: false, go: true };
    const { result } = await mount();
    expect(result.current.active).toBe('go');
    expect(result.current.selectable).toBe(false);
  });

  it('uses java when go is down', async () => {
    healthy = { java: true, go: false };
    const { result } = await mount();
    expect(result.current.active).toBe('java');
    expect(result.current.selectable).toBe(false);
  });

  it('stays on java with both down', async () => {
    healthy = { java: false, go: false };
    const { result } = await mount();
    expect(result.current.active).toBe('java');
    expect(result.current.selectable).toBe(false);
    await expect(result.current.failover()).resolves.toBeNull();
  });

  it('rechecks every 10s while degraded and stops when both healthy', async () => {
    expect(RECHECK_INTERVAL_MS).toBe(10_000);
    healthy = { java: true, go: false };
    const { result } = await mount();
    expect(checks('go')).toBe(1);

    await advance(RECHECK_INTERVAL_MS - 1);
    expect(checks('go')).toBe(1);
    await advance(1);
    expect(checks('go')).toBe(2);
    expect(checks('java')).toBe(2);
    await advance(RECHECK_INTERVAL_MS);
    expect(checks('go')).toBe(3);

    healthy = { java: true, go: true };
    await advance(RECHECK_INTERVAL_MS);
    expect(checks('go')).toBe(4);
    expect(result.current.selectable).toBe(true);

    await advance(RECHECK_INTERVAL_MS * 5);
    expect(checks('go')).toBe(4);
    expect(checks('java')).toBe(4);
  });

  it('keeps rechecking with both down', async () => {
    healthy = { java: false, go: false };
    await mount();
    await advance(RECHECK_INTERVAL_MS * 3);
    expect(checks('java')).toBe(4);
    expect(checks('go')).toBe(4);
  });

  it('clears the recheck interval on unmount', async () => {
    healthy = { java: false, go: true };
    const { unmount } = await mount();
    unmount();
    await advance(RECHECK_INTERVAL_MS * 3);
    expect(checks('java')).toBe(1);
  });

  it('returns to java when recovered after an automatic switch', async () => {
    healthy = { java: false, go: true };
    const { result } = await mount();
    expect(result.current.active).toBe('go');

    healthy = { java: true, go: true };
    await advance(RECHECK_INTERVAL_MS);
    expect(result.current.active).toBe('java');
    expect(result.current.selectable).toBe(true);
  });

  it('returns to java when recovered after a failover', async () => {
    const { result } = await mount();
    let next: Backend | null = null;
    await act(async () => {
      next = await result.current.failover();
    });
    expect(next).toBe('go');
    expect(result.current.active).toBe('go');
    expect(result.current.selectable).toBe(false);

    await advance(RECHECK_INTERVAL_MS);
    expect(result.current.active).toBe('java');
    expect(result.current.selectable).toBe(true);
  });

  it('keeps go when the user chose it', async () => {
    const { result } = await mount();
    act(() => {
      result.current.select('go');
    });
    expect(result.current.active).toBe('go');

    await advance(RECHECK_INTERVAL_MS * 6);
    expect(result.current.active).toBe('go');
    expect(result.current.selectable).toBe(true);
    // Both healthy: no polling, so nothing can flip the user's choice back.
    expect(checks('go')).toBe(1);
  });

  it('follows the user back to java', async () => {
    const { result } = await mount();
    act(() => {
      result.current.select('go');
    });
    act(() => {
      result.current.select('java');
    });
    expect(result.current.active).toBe('java');
  });

  it('switches away from a user-chosen backend that goes down', async () => {
    const { result } = await mount();
    act(() => {
      result.current.select('go');
    });
    let next: Backend | null = 'go';
    await act(async () => {
      next = await result.current.failover();
    });
    expect(next).toBe('java');
    expect(result.current.active).toBe('java');
    expect(result.current.selectable).toBe(false);
  });

  it('failover returns the healthy alternative or null', async () => {
    const { result } = await mount();
    let next: Backend | null = null;
    await act(async () => {
      next = await result.current.failover();
    });
    expect(next).toBe('go');
    expect(result.current.active).toBe('go');

    healthy = { java: false, go: false };
    await act(async () => {
      next = await result.current.failover();
    });
    expect(next).toBeNull();
    expect(result.current.active).toBe('go');
  });

  it('blames the backend the request used even if active changed meanwhile', async () => {
    // Java's mount check hangs (until its 2 s timeout) while Go answers UP.
    let finishJavaCheck: (up: boolean) => void = () => undefined;
    vi.mocked(checkHealth).mockImplementation((backend) =>
      backend === 'java'
        ? new Promise<boolean>((resolve) => {
            finishJavaCheck = resolve;
          })
        : Promise.resolve(true),
    );
    const { result } = await mount();
    // A request goes to java here; then the timed-out check switches active to go.
    expect(result.current.active).toBe('java');
    await act(async () => {
      finishJavaCheck(false);
      await Promise.resolve();
    });
    expect(result.current.active).toBe('go');

    vi.mocked(checkHealth).mockClear();
    let next: Backend | null = null;
    await act(async () => {
      next = await result.current.failover('java');
    });
    expect(next).toBe('go');
    expect(result.current.active).toBe('go');
    expect(vi.mocked(checkHealth).mock.calls.map(([b]) => b)).toEqual(['go']);
  });

  it('does not persist the selection', async () => {
    const first = await mount();
    act(() => {
      first.result.current.select('go');
    });
    expect(first.result.current.active).toBe('go');
    first.unmount();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    const second = await mount();
    expect(second.result.current.active).toBe('java');
  });
});
