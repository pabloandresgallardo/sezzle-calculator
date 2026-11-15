import { useEffect, useReducer, type Dispatch } from 'react';
import { calculate, CalculatorApiError } from '../api/calculatorApi';
import {
  calculatorReducer,
  initialState,
  type CalculatorAction,
  type CalculatorState,
} from '../model/calculatorReducer';
import { messageForApiTitle } from '../model/errorMessages';
import type { Operation } from '../model/types';

const SYMBOLS: Record<Operation, string> = {
  add: '+',
  subtract: '−',
  multiply: '×',
  divide: '÷',
};

const KEY_ACTIONS = new Map<string, CalculatorAction>([
  ['+', { type: 'operator', operator: 'add' }],
  ['-', { type: 'operator', operator: 'subtract' }],
  ['*', { type: 'operator', operator: 'multiply' }],
  ['/', { type: 'operator', operator: 'divide' }],
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

export interface UseCalculator {
  state: CalculatorState;
  dispatch: Dispatch<CalculatorAction>;
  /** Top line: the pending operation, e.g. `5 ×`. */
  expression: string;
  /** Main line: the operand being typed, the left operand, or the result. */
  display: string;
}

export function useCalculator(): UseCalculator {
  const [state, dispatch] = useReducer(calculatorReducer, initialState);
  const { request } = state;

  useEffect(() => {
    if (request === null) {
      return;
    }
    const controller = new AbortController();
    calculate(request.operation, request.operands, controller.signal).then(
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
      if (event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) {
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
