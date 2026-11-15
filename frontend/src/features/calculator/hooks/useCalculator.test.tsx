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
