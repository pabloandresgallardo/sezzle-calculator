import { act, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { calculate, CalculatorApiError } from '../api/calculatorApi';
import type { CalculatorAction } from '../model/calculatorReducer';
import type { Backend } from '../../../shared/backend/backend';
import { useCalculator } from './useCalculator';

vi.mock('../api/calculatorApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/calculatorApi')>();
  return { ...actual, calculate: vi.fn(actual.calculate) };
});

const URL_PATH = '/api/java/v1/calculate';
const GO_URL_PATH = '/api/go/v1/calculate';

/** No alternative backend unless a test says otherwise. */
const noFailover = vi.fn((): Promise<Backend | null> => Promise.resolve(null));
const OPTIONS = { backend: 'java', failover: noFailover } as const;

function lastSignal(): AbortSignal | undefined {
  return vi.mocked(calculate).mock.lastCall?.[2].signal;
}

function hangingHandler() {
  return http.post(URL_PATH, async () => {
    await delay('infinite');
    return HttpResponse.json({ result: 'never' });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  noFailover.mockClear();
  vi.mocked(calculate).mockClear();
  document.body.innerHTML = '';
});

/** `1 + 2 =` from a fresh state. */
function equals12(dispatch: (action: CalculatorAction) => void) {
  act(() => {
    dispatch({ type: 'clear' });
    dispatch({ type: 'digit', digit: '1' });
    dispatch({ type: 'operator', operator: 'add' });
    dispatch({ type: 'digit', digit: '2' });
    dispatch({ type: 'equals' });
  });
}

describe('useCalculator', () => {
  it('derives expression and display from state', () => {
    const { result } = renderHook(() => useCalculator(OPTIONS));
    expect(result.current.expression).toBe('');
    expect(result.current.display).toBe('0');

    act(() => {
      result.current.dispatch({ type: 'digit', digit: '5' });
      result.current.dispatch({ type: 'operator', operator: 'multiply' });
    });
    expect(result.current.expression).toBe('5 ×');
    expect(result.current.display).toBe('5');

    act(() => {
      result.current.dispatch({ type: 'operator', operator: 'subtract' });
    });
    expect(result.current.expression).toBe('5 −');

    act(() => {
      result.current.dispatch({ type: 'digit', digit: '2' });
    });
    expect(result.current.display).toBe('2');
  });

  it('dispatches resolved with the result string verbatim', async () => {
    server.use(http.post(URL_PATH, () => HttpResponse.json({ result: '0.3000000000' })));
    const { result } = renderHook(() => useCalculator(OPTIONS));
    act(() => {
      result.current.dispatch({ type: 'digit', digit: '1' });
      result.current.dispatch({ type: 'operator', operator: 'add' });
      result.current.dispatch({ type: 'digit', digit: '2' });
      result.current.dispatch({ type: 'equals' });
    });
    expect(result.current.state.phase).toBe('pending');
    await waitFor(() => {
      expect(result.current.display).toBe('0.3000000000');
    });
    expect(result.current.state.phase).toBe('result');
  });

  it('maps API titles to user messages', async () => {
    server.use(
      http.post(URL_PATH, () =>
        HttpResponse.json({ title: 'Operand out of range' }, { status: 400 }),
      ),
    );
    const { result } = renderHook(() => useCalculator(OPTIONS));
    act(() => {
      result.current.dispatch({ type: 'digit', digit: '1' });
      result.current.dispatch({ type: 'operator', operator: 'add' });
      result.current.dispatch({ type: 'digit', digit: '2' });
      result.current.dispatch({ type: 'equals' });
    });
    await waitFor(() => {
      expect(result.current.state.error).toBe('Number out of range');
    });
  });

  it('maps unexpected (non API) failures to Service unavailable', async () => {
    vi.mocked(calculate).mockRejectedValueOnce(new TypeError('boom'));
    const { result } = renderHook(() => useCalculator(OPTIONS));
    act(() => {
      result.current.dispatch({ type: 'digit', digit: '1' });
      result.current.dispatch({ type: 'operator', operator: 'add' });
      result.current.dispatch({ type: 'digit', digit: '2' });
      result.current.dispatch({ type: 'equals' });
    });
    await waitFor(() => {
      expect(result.current.state.error).toBe('Service unavailable');
    });
  });

  it('does not fail over on non API failures', async () => {
    vi.mocked(calculate).mockRejectedValueOnce(new TypeError('boom'));
    const { result } = renderHook(() => useCalculator(OPTIONS));
    equals12(result.current.dispatch);
    await waitFor(() => {
      expect(result.current.state.error).toBe('Service unavailable');
    });
    expect(noFailover).not.toHaveBeenCalled();
  });

  it('retries once on the backend returned by failover', async () => {
    server.use(
      http.post(URL_PATH, () => new HttpResponse('Bad Gateway', { status: 502 })),
      http.post(GO_URL_PATH, () => HttpResponse.json({ result: '3' })),
    );
    const failover = vi.fn((): Promise<Backend | null> => Promise.resolve('go'));
    const { result } = renderHook(() => useCalculator({ backend: 'java', failover }));
    equals12(result.current.dispatch);
    await waitFor(() => {
      expect(result.current.display).toBe('3');
    });
    expect(failover).toHaveBeenCalledTimes(1);
    expect(vi.mocked(calculate).mock.calls.map((call) => call[2].backend)).toEqual(['java', 'go']);
  });

  it('does not fail over on a 4xx without JSON (e.g. 413 from the proxy)', async () => {
    server.use(
      http.post(
        URL_PATH,
        () =>
          new HttpResponse('<html>413 Request Entity Too Large</html>', {
            status: 413,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );
    const failover = vi.fn((): Promise<Backend | null> => Promise.resolve('go'));
    const { result } = renderHook(() => useCalculator({ backend: 'java', failover }));
    equals12(result.current.dispatch);
    await waitFor(() => {
      expect(result.current.state.error).toBe('Service unavailable');
    });
    expect(failover).not.toHaveBeenCalled();
    expect(calculate).toHaveBeenCalledTimes(1);
  });

  it('fails over on a network error', async () => {
    server.use(
      http.post(URL_PATH, () => HttpResponse.error()),
      http.post(GO_URL_PATH, () => HttpResponse.json({ result: '3' })),
    );
    const failover = vi.fn((): Promise<Backend | null> => Promise.resolve('go'));
    const { result } = renderHook(() => useCalculator({ backend: 'java', failover }));
    equals12(result.current.dispatch);
    await waitFor(() => {
      expect(result.current.display).toBe('3');
    });
    expect(failover).toHaveBeenCalledExactlyOnceWith('java');
  });

  it('fails over on a client timeout', async () => {
    vi.mocked(calculate).mockRejectedValueOnce(new CalculatorApiError(null, { retryable: true }));
    server.use(http.post(GO_URL_PATH, () => HttpResponse.json({ result: '3' })));
    const failover = vi.fn((): Promise<Backend | null> => Promise.resolve('go'));
    const { result } = renderHook(() => useCalculator({ backend: 'java', failover }));
    equals12(result.current.dispatch);
    await waitFor(() => {
      expect(result.current.display).toBe('3');
    });
    expect(failover).toHaveBeenCalledTimes(1);
  });

  it('shows Service unavailable when failover finds no alternative', async () => {
    server.use(http.post(URL_PATH, () => HttpResponse.error()));
    const { result } = renderHook(() => useCalculator(OPTIONS));
    equals12(result.current.dispatch);
    await waitFor(() => {
      expect(result.current.state.error).toBe('Service unavailable');
    });
    expect(noFailover).toHaveBeenCalledTimes(1);
    expect(calculate).toHaveBeenCalledTimes(1);
  });

  it('does not retry when cleared while failover is running', async () => {
    server.use(http.post(URL_PATH, () => HttpResponse.error()));
    let resolveFailover: (backend: Backend | null) => void = () => undefined;
    const failover = vi.fn(
      () =>
        new Promise<Backend | null>((resolve) => {
          resolveFailover = resolve;
        }),
    );
    const { result } = renderHook(() => useCalculator({ backend: 'java', failover }));
    equals12(result.current.dispatch);
    await waitFor(() => {
      expect(failover).toHaveBeenCalledTimes(1);
    });
    act(() => {
      result.current.dispatch({ type: 'clear' });
    });
    await act(async () => {
      resolveFailover('go');
      await delay(20);
    });
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(result.current.state.error).toBeNull();
    expect(result.current.display).toBe('0');
  });

  it('tells failover which backend failed even if the active one changed meanwhile', async () => {
    let failJava: () => void = () => undefined;
    server.use(
      http.post(
        URL_PATH,
        () =>
          new Promise<Response>((resolve) => {
            failJava = () => {
              resolve(new HttpResponse('Bad Gateway', { status: 502 }));
            };
          }),
      ),
      http.post(GO_URL_PATH, () => HttpResponse.json({ result: '3' })),
    );
    const failover = vi.fn((failed?: Backend): Promise<Backend | null> =>
      Promise.resolve(failed === 'java' ? 'go' : null),
    );
    const { result, rerender } = renderHook(
      ({ backend }: { backend: Backend }) => useCalculator({ backend, failover }),
      { initialProps: { backend: 'java' } },
    );
    equals12(result.current.dispatch);
    await waitFor(() => {
      expect(calculate).toHaveBeenCalledTimes(1);
    });
    // A health check switches the app to go while the java request is in flight.
    rerender({ backend: 'go' });
    failJava();
    await waitFor(() => {
      expect(result.current.display).toBe('3');
    });
    expect(failover).toHaveBeenCalledExactlyOnceWith('java');
    expect(vi.mocked(calculate).mock.calls.map((call) => call[2].backend)).toEqual(['java', 'go']);
  });

  it('uses the latest backend for the next request without re-sending the current one', async () => {
    server.use(
      http.post(URL_PATH, () => HttpResponse.json({ result: '3' })),
      http.post(GO_URL_PATH, () => HttpResponse.json({ result: '3' })),
    );
    const { result, rerender } = renderHook(
      ({ backend }: { backend: Backend }) => useCalculator({ backend, failover: noFailover }),
      { initialProps: { backend: 'java' } },
    );
    equals12(result.current.dispatch);
    await waitFor(() => {
      expect(result.current.display).toBe('3');
    });
    rerender({ backend: 'go' });
    expect(calculate).toHaveBeenCalledTimes(1);
    equals12(result.current.dispatch);
    await waitFor(() => {
      expect(calculate).toHaveBeenCalledTimes(2);
    });
    expect(vi.mocked(calculate).mock.lastCall?.[2].backend).toBe('go');
  });

  it('aborts the in-flight request on clear', async () => {
    server.use(hangingHandler());
    const { result } = renderHook(() => useCalculator(OPTIONS));
    act(() => {
      result.current.dispatch({ type: 'digit', digit: '1' });
      result.current.dispatch({ type: 'operator', operator: 'add' });
      result.current.dispatch({ type: 'digit', digit: '2' });
      result.current.dispatch({ type: 'equals' });
    });
    const signal = lastSignal();
    expect(signal?.aborted).toBe(false);
    act(() => {
      result.current.dispatch({ type: 'clear' });
    });
    expect(signal?.aborted).toBe(true);
    await act(() => delay(20));
    expect(result.current.state.phase).toBe('input');
    expect(result.current.state.error).toBeNull();
    expect(result.current.display).toBe('0');
  });

  it('aborts the in-flight request on unmount', () => {
    server.use(hangingHandler());
    const { result, unmount } = renderHook(() => useCalculator(OPTIONS));
    act(() => {
      result.current.dispatch({ type: 'digit', digit: '1' });
      result.current.dispatch({ type: 'operator', operator: 'add' });
      result.current.dispatch({ type: 'digit', digit: '2' });
      result.current.dispatch({ type: 'equals' });
    });
    const signal = lastSignal();
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('prevents the default action of handled keys only', () => {
    renderHook(() => useCalculator(OPTIONS));
    const slash = new KeyboardEvent('keydown', { key: '/', cancelable: true, bubbles: true });
    const letter = new KeyboardEvent('keydown', { key: 'a', cancelable: true, bubbles: true });
    act(() => {
      window.dispatchEvent(slash);
      window.dispatchEvent(letter);
    });
    expect(slash.defaultPrevented).toBe(true);
    expect(letter.defaultPrevented).toBe(false);
  });

  it('ignores keys with ctrl, meta or alt', () => {
    const { result } = renderHook(() => useCalculator(OPTIONS));
    act(() => {
      fireEvent.keyDown(window, { key: '7', ctrlKey: true });
      fireEvent.keyDown(window, { key: '7', metaKey: true });
      fireEvent.keyDown(window, { key: '7', altKey: true });
    });
    expect(result.current.display).toBe('0');
    act(() => {
      fireEvent.keyDown(window, { key: '7', shiftKey: true });
    });
    expect(result.current.display).toBe('7');
  });

  it('accepts shifted symbol keys', () => {
    server.use(hangingHandler());
    const { result } = renderHook(() => useCalculator(OPTIONS));
    act(() => {
      fireEvent.keyDown(window, { key: '2' });
      fireEvent.keyDown(window, { key: '^', shiftKey: true });
    });
    expect(result.current.expression).toBe('2 ^');
    act(() => {
      fireEvent.keyDown(window, { key: '%', shiftKey: true });
    });
    expect(result.current.expression).toBe('2 %');
    act(() => {
      fireEvent.keyDown(window, { key: '9' });
      fireEvent.keyDown(window, { key: '@', shiftKey: true });
    });
    expect(result.current.state.phase).toBe('pending');
    expect(vi.mocked(calculate).mock.lastCall?.slice(0, 2)).toEqual(['sqrt', ['9']]);
  });

  it('maps y to power', () => {
    const { result } = renderHook(() => useCalculator(OPTIONS));
    act(() => {
      fireEvent.keyDown(window, { key: '3' });
      fireEvent.keyDown(window, { key: 'y' });
    });
    expect(result.current.expression).toBe('3 ^');
  });

  it('maps uppercase Y to power but ignores Ctrl+Y and Cmd+Y', () => {
    const { result } = renderHook(() => useCalculator(OPTIONS));
    act(() => {
      fireEvent.keyDown(window, { key: '3' });
      fireEvent.keyDown(window, { key: 'Y', ctrlKey: true });
      fireEvent.keyDown(window, { key: 'Y', metaKey: true });
    });
    expect(result.current.expression).toBe('');
    act(() => {
      fireEvent.keyDown(window, { key: 'Y', shiftKey: true });
    });
    expect(result.current.expression).toBe('3 ^');
  });

  it('ignores symbol keys with ctrl (no AltGraph) or meta', () => {
    const { result } = renderHook(() => useCalculator(OPTIONS));
    const event = new KeyboardEvent('keydown', {
      key: '^',
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
      bubbles: true,
    });
    act(() => {
      fireEvent.keyDown(window, { key: '3' });
      window.dispatchEvent(event);
      fireEvent.keyDown(window, { key: '@', metaKey: true });
      fireEvent.keyDown(window, { key: '%', ctrlKey: true });
    });
    expect(event.defaultPrevented).toBe(false);
    expect(result.current.expression).toBe('');
    expect(result.current.state.phase).toBe('input');
    expect(result.current.display).toBe('3');
  });

  describe('international layouts (AltGr / Option)', () => {
    function press(init: KeyboardEventInit): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init });
      window.dispatchEvent(event);
      return event;
    }

    it('accepts AltGr+@ (Spanish Windows) as sqrt', () => {
      server.use(hangingHandler());
      const { result } = renderHook(() => useCalculator(OPTIONS));
      let event: KeyboardEvent | undefined;
      act(() => {
        press({ key: '9' });
        event = press({ key: '@', ctrlKey: true, altKey: true, modifierAltGraph: true });
      });
      expect(event?.defaultPrevented).toBe(true);
      expect(result.current.state.phase).toBe('pending');
      expect(vi.mocked(calculate).mock.lastCall?.slice(0, 2)).toEqual(['sqrt', ['9']]);
    });

    it('accepts Option+@ (Spanish macOS) as sqrt', () => {
      server.use(hangingHandler());
      const { result } = renderHook(() => useCalculator(OPTIONS));
      let event: KeyboardEvent | undefined;
      act(() => {
        press({ key: '4' });
        event = press({ key: '@', altKey: true });
      });
      expect(event?.defaultPrevented).toBe(true);
      expect(result.current.state.phase).toBe('pending');
      expect(vi.mocked(calculate).mock.lastCall?.slice(0, 2)).toEqual(['sqrt', ['4']]);
    });

    it('accepts Alt+% and AltGr+^ as operators', () => {
      const { result } = renderHook(() => useCalculator(OPTIONS));
      act(() => {
        press({ key: '5' });
        press({ key: '%', altKey: true });
      });
      expect(result.current.expression).toBe('5 %');
      act(() => {
        press({ key: '^', ctrlKey: true, altKey: true, modifierAltGraph: true });
      });
      expect(result.current.expression).toBe('5 ^');
    });

    it('ignores Ctrl+Alt+@ without AltGraph and Meta with any modifier', () => {
      const { result } = renderHook(() => useCalculator(OPTIONS));
      let events: KeyboardEvent[] = [];
      act(() => {
        press({ key: '9' });
        events = [
          press({ key: '@', ctrlKey: true, altKey: true }),
          press({ key: '@', metaKey: true }),
          press({ key: '@', metaKey: true, altKey: true }),
          press({ key: '@', metaKey: true, modifierAltGraph: true }),
        ];
      });
      expect(events.map((e) => e.defaultPrevented)).toEqual([false, false, false, false]);
      expect(result.current.state.phase).toBe('input');
      expect(result.current.display).toBe('9');
    });

    it.each(['7', 'Enter', 'Backspace', 'Escape', 'F9', '.', ',', 'y', '+'])(
      'still ignores %s with Alt, Ctrl or AltGr',
      (key) => {
        const { result } = renderHook(() => useCalculator(OPTIONS));
        let events: KeyboardEvent[] = [];
        act(() => {
          press({ key: '3' });
          events = [
            press({ key, altKey: true }),
            press({ key, ctrlKey: true }),
            press({ key, ctrlKey: true, altKey: true, modifierAltGraph: true }),
          ];
        });
        expect(events.map((e) => e.defaultPrevented)).toEqual([false, false, false]);
        expect(result.current.display).toBe('3');
        expect(result.current.expression).toBe('');
      },
    );
  });

  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    ['select', () => document.createElement('select')],
    [
      'contenteditable',
      () => {
        const div = document.createElement('div');
        div.setAttribute('contenteditable', 'true');
        div.appendChild(document.createElement('span'));
        return div;
      },
    ],
  ])('ignores keys and paste typed into a foreign %s', (_name, create) => {
    const element = create();
    document.body.appendChild(element);
    const target = element.firstElementChild ?? element;
    const { result } = renderHook(() => useCalculator(OPTIONS));
    act(() => {
      fireEvent.keyDown(target, { key: '7' });
      fireEvent.paste(target, { clipboardData: { getData: () => '42' } });
    });
    expect(result.current.display).toBe('0');
  });

  it('reacts to keys inside a non-editable contenteditable="false" element', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'false');
    document.body.appendChild(div);
    const { result } = renderHook(() => useCalculator(OPTIONS));
    act(() => {
      fireEvent.keyDown(div, { key: '8' });
    });
    expect(result.current.display).toBe('8');
  });

  it('pastes text and treats a missing clipboard as empty', () => {
    const { result } = renderHook(() => useCalculator(OPTIONS));
    act(() => {
      fireEvent.paste(window, { clipboardData: { getData: () => '42' } });
    });
    expect(result.current.display).toBe('42');
    act(() => {
      window.dispatchEvent(new Event('paste', { cancelable: true }));
    });
    expect(result.current.display).toBe('42');
    expect(result.current.state.error).toBe('Invalid number');
  });

  it('removes its listeners on unmount', () => {
    const { result, unmount } = renderHook(() => useCalculator(OPTIONS));
    unmount();
    fireEvent.keyDown(window, { key: '7' });
    expect(result.current.display).toBe('0');
  });
});
