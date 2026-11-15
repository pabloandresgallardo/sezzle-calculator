import { act, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { calculate } from '../api/calculatorApi';
import { useCalculator } from './useCalculator';

vi.mock('../api/calculatorApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/calculatorApi')>();
  return { ...actual, calculate: vi.fn(actual.calculate) };
});

const URL_PATH = '/api/v1/calculate';

function lastSignal(): AbortSignal | undefined {
  return vi.mocked(calculate).mock.lastCall?.[2];
}

function hangingHandler() {
  return http.post(URL_PATH, async () => {
    await delay('infinite');
    return HttpResponse.json({ result: 'never' });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('useCalculator', () => {
  it('derives expression and display from state', () => {
    const { result } = renderHook(() => useCalculator());
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
    const { result } = renderHook(() => useCalculator());
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
    const { result } = renderHook(() => useCalculator());
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
    const { result } = renderHook(() => useCalculator());
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

  it('aborts the in-flight request on clear', async () => {
    server.use(hangingHandler());
    const { result } = renderHook(() => useCalculator());
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
    const { result, unmount } = renderHook(() => useCalculator());
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
    renderHook(() => useCalculator());
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
    const { result } = renderHook(() => useCalculator());
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
    const { result } = renderHook(() => useCalculator());
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
    const { result } = renderHook(() => useCalculator());
    act(() => {
      fireEvent.keyDown(window, { key: '3' });
      fireEvent.keyDown(window, { key: 'y' });
    });
    expect(result.current.expression).toBe('3 ^');
  });

  it('maps uppercase Y to power but ignores Ctrl+Y and Cmd+Y', () => {
    const { result } = renderHook(() => useCalculator());
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
    const { result } = renderHook(() => useCalculator());
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
      const { result } = renderHook(() => useCalculator());
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
      const { result } = renderHook(() => useCalculator());
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
      const { result } = renderHook(() => useCalculator());
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
      const { result } = renderHook(() => useCalculator());
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
        const { result } = renderHook(() => useCalculator());
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
    const { result } = renderHook(() => useCalculator());
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
    const { result } = renderHook(() => useCalculator());
    act(() => {
      fireEvent.keyDown(div, { key: '8' });
    });
    expect(result.current.display).toBe('8');
  });

  it('pastes text and treats a missing clipboard as empty', () => {
    const { result } = renderHook(() => useCalculator());
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
    const { result, unmount } = renderHook(() => useCalculator());
    unmount();
    fireEvent.keyDown(window, { key: '7' });
    expect(result.current.display).toBe('0');
  });
});
