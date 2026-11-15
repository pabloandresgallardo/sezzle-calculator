import { useEffect, useEffectEvent, useReducer, type Dispatch } from 'react';
import type { Backend } from '../../../shared/backend/backend';
import { calculate, CalculatorApiError } from '../api/calculatorApi';
import {
  calculatorReducer,
  initialState,
  type CalculatorAction,
  type CalculatorState,
} from '../model/calculatorReducer';
import { messageForApiTitle } from '../model/errorMessages';
import type { BinaryOperation, Operation } from '../model/types';

const SYMBOLS: Record<BinaryOperation, string> = {
  add: '+',
  subtract: '−',
  multiply: '×',
  divide: '÷',
  power: '^',
  percentage: '%',
};

const KEY_ACTIONS = new Map<string, CalculatorAction>([
  ['+', { type: 'operator', operator: 'add' }],
  ['-', { type: 'operator', operator: 'subtract' }],
  ['*', { type: 'operator', operator: 'multiply' }],
  ['/', { type: 'operator', operator: 'divide' }],
  ['^', { type: 'operator', operator: 'power' }],
  ['y', { type: 'operator', operator: 'power' }],
  ['Y', { type: 'operator', operator: 'power' }],
  ['%', { type: 'operator', operator: 'percentage' }],
  ['@', { type: 'unaryOperator', operator: 'sqrt' }],
  ['Enter', { type: 'equals' }],
  ['=', { type: 'equals' }],
  ['Escape', { type: 'clear' }],
  ['Backspace', { type: 'backspace' }],
  ['F9', { type: 'toggleSign' }],
  ['.', { type: 'decimal' }],
  [',', { type: 'decimal' }],
  ...Array.from({ length: 10 }, (_, d): [string, CalculatorAction] => [
    String(d),
    { type: 'digit', digit: String(d) },
  ]),
]);

/** Symbols that international layouts produce with AltGr (Windows/Linux) or Option (macOS), e.g. `@` on Spanish. */
const ALT_COMPOSED_SYMBOLS = new Set(['@', '^', '%']);

/**
 * Shortcuts (Ctrl/Meta/Alt chords) belong to the browser or OS. The exception is a symbol composed
 * with AltGr (reported via `getModifierState('AltGraph')`, not the ctrl+alt heuristic) or with Option.
 */
function isShortcut(event: KeyboardEvent): boolean {
  if (event.metaKey) {
    return true;
  }
  if (!event.ctrlKey && !event.altKey) {
    return false;
  }
  if (!ALT_COMPOSED_SYMBOLS.has(event.key)) {
    return true;
  }
  const viaAltGraph = event.getModifierState('AltGraph');
  const viaOption = event.altKey && !event.ctrlKey;
  return !(viaAltGraph || viaOption);
}

/** Keys typed into a foreign editable element (another input on the page) belong to it. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return (
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !==
    null
  );
}

export interface UseCalculatorOptions {
  /** Backend for the next request; changing it never re-sends the one in flight. */
  backend: Backend;
  /**
   * Asked once when `failed` (the backend the request went to) is unavailable; resolves to the
   * backend to retry on, or `null`.
   */
  failover: (failed: Backend) => Promise<Backend | null>;
}

/** Network error, client timeout or 5xx: worth trying the other backend. A 4xx never is. */
function isUnavailable(error: unknown): boolean {
  return error instanceof CalculatorApiError && error.retryable;
}

export interface UseCalculator {
  state: CalculatorState;
  dispatch: Dispatch<CalculatorAction>;
  /** Top line: the pending operation, e.g. `5 ×`. */
  expression: string;
  /** Main line: the operand being typed, the left operand, or the result. */
  display: string;
}

export function useCalculator({ backend, failover }: UseCalculatorOptions): UseCalculator {
  const [state, dispatch] = useReducer(calculatorReducer, initialState);
  const { request } = state;

  // An effect event reads the latest backend/failover without making them effect dependencies.
  const send = useEffectEvent(
    async (operation: Operation, operands: readonly string[], signal: AbortSignal) => {
      try {
        return await calculate(operation, operands, { backend, signal });
      } catch (error) {
        if (signal.aborted || !isUnavailable(error)) {
          throw error;
        }
        const next = await failover(backend);
        // Cleared or superseded while failing over: no retry.
        signal.throwIfAborted();
        if (next === null) {
          throw error;
        }
        // At most one retry: a second failure is reported as is.
        return await calculate(operation, operands, { backend: next, signal });
      }
    },
  );

  useEffect(() => {
    if (request === null) {
      return;
    }
    const controller = new AbortController();
    send(request.operation, request.operands, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) {
          dispatch({ type: 'resolved', result });
        }
      },
      (error: unknown) => {
        // Aborted (clear, unmount or superseded): the AbortError is expected and ignored.
        if (controller.signal.aborted) {
          return;
        }
        const title = error instanceof CalculatorApiError ? error.title : null;
        dispatch({ type: 'rejected', message: messageForApiTitle(title) });
      },
    );
    return () => {
      controller.abort();
    };
  }, [request]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Shift is allowed on purpose: `^`, `%` and `@` need it on many layouts.
      if (isShortcut(event) || isEditableTarget(event.target)) {
        return;
      }
      const action = KEY_ACTIONS.get(event.key);
      if (action === undefined) {
        return;
      }
      // Also stops Enter from activating a focused button (double action) and `/` quick-find.
      event.preventDefault();
      dispatch(action);
    }

    function onPaste(event: ClipboardEvent) {
      if (isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      dispatch({ type: 'paste', text: event.clipboardData?.getData('text') ?? '' });
    }

    // ThemeToggle relies on this listener being on `window` (bubble phase): it stops Enter/Space propagation so `=` isn't triggered.
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  const expression =
    state.previous !== null && state.operator !== null
      ? `${state.previous} ${SYMBOLS[state.operator]}`
      : '';
  const display = state.current !== '' ? state.current : (state.previous ?? '0');

  return { state, dispatch, expression, display };
}
