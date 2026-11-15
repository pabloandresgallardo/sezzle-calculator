import { CLIENT_ERRORS } from './errorMessages';
import { canAppendDigit, isWithinLimits, parsePastedNumber } from './limits';
import type { Operation } from './types';

export interface CalculatorState {
  previous: string | null;
  operator: Operation | null;
  current: string;
  phase: 'input' | 'awaitingOperand' | 'result' | 'pending';
  error: string | null;
  pendingOperator: Operation | null;
  request: { operation: Operation; operands: [string, string] } | null;
}

export type CalculatorAction =
  | { type: 'digit'; digit: string }
  | { type: 'decimal' }
  | { type: 'toggleSign' }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'operator'; operator: Operation }
  | { type: 'equals' }
  | { type: 'paste'; text: string }
  | { type: 'resolved'; result: string }
  | { type: 'rejected'; message: string };

export const initialState: CalculatorState = {
  previous: null,
  operator: null,
  current: '0',
  phase: 'input',
  error: null,
  pendingOperator: null,
  request: null,
};

/** Fresh calculation whose only content is `current`. */
function startWith(current: string): CalculatorState {
  return { ...initialState, current };
}

/** `previous op _`: the operator is set and the second operand is still empty. */
function awaitOperand(previous: string, op: Operation): CalculatorState {
  return { ...initialState, previous, operator: op, current: '', phase: 'awaitingOperand' };
}

/** Writes `current` while typing an operand, leaving `awaitingOperand` if needed. */
function withInput(state: CalculatorState, current: string): CalculatorState {
  return { ...state, current, phase: 'input' };
}

function requestCalculation(
  state: CalculatorState,
  pendingOperator: Operation | null,
): CalculatorState {
  if (state.phase !== 'input' || state.previous === null || state.operator === null) {
    return state;
  }
  return {
    ...state,
    phase: 'pending',
    pendingOperator,
    request: { operation: state.operator, operands: [state.previous, state.current] },
  };
}

function digit(state: CalculatorState, d: string): CalculatorState {
  if (state.phase === 'result') {
    return startWith(d);
  }
  if (state.current === '0' || state.current === '-0') {
    return withInput(state, state.current.replace('0', d));
  }
  if (!canAppendDigit(state.current)) {
    return state;
  }
  return withInput(state, state.current + d);
}

function decimal(state: CalculatorState): CalculatorState {
  if (state.phase === 'result') {
    return startWith('0.');
  }
  if (state.current.includes('.')) {
    return state;
  }
  return withInput(state, state.current === '' ? '0.' : `${state.current}.`);
}

function toggleSign(state: CalculatorState): CalculatorState {
  if (Number(state.current) === 0) {
    return state;
  }
  const current = state.current.startsWith('-') ? state.current.slice(1) : `-${state.current}`;
  return { ...state, current };
}

function backspace(state: CalculatorState): CalculatorState {
  if (state.phase !== 'input') {
    return state;
  }
  const current = state.current.slice(0, -1);
  return { ...state, current: current === '' || current === '-' ? '0' : current };
}

function operator(state: CalculatorState, op: Operation): CalculatorState {
  switch (state.phase) {
    case 'result':
      if (!isWithinLimits(state.current)) {
        return { ...state, error: CLIENT_ERRORS.resultTooLong };
      }
      return awaitOperand(state.current, op);
    case 'awaitingOperand':
      return { ...state, operator: op };
    default:
      if (state.previous !== null && state.operator !== null) {
        return requestCalculation(state, op);
      }
      return awaitOperand(state.current, op);
  }
}

function paste(state: CalculatorState, text: string): CalculatorState {
  const parsed = parsePastedNumber(text);
  if (!parsed.ok) {
    const error =
      parsed.reason === 'invalid' ? CLIENT_ERRORS.invalidNumber : CLIENT_ERRORS.tooManyDigits;
    return { ...state, error };
  }
  return state.phase === 'result' ? startWith(parsed.value) : withInput(state, parsed.value);
}

function resolved(state: CalculatorState, result: string): CalculatorState {
  const { pendingOperator } = state;
  if (pendingOperator !== null && isWithinLimits(result)) {
    return awaitOperand(result, pendingOperator);
  }
  return {
    ...startWith(result),
    phase: 'result',
    error: pendingOperator === null ? null : CLIENT_ERRORS.resultTooLong,
  };
}

function rejected(state: CalculatorState, message: string): CalculatorState {
  return { ...state, phase: 'input', error: message, pendingOperator: null, request: null };
}

/** Pure state machine for the calculator; requesting a calculation only sets `request`. */
export function calculatorReducer(
  state: CalculatorState,
  action: CalculatorAction,
): CalculatorState {
  if (action.type === 'clear') {
    return initialState;
  }
  if (action.type === 'resolved' || action.type === 'rejected') {
    if (state.phase !== 'pending') {
      return state;
    }
    return action.type === 'resolved'
      ? resolved(state, action.result)
      : rejected(state, action.message);
  }
  if (state.phase === 'pending') {
    return state;
  }

  const cleared: CalculatorState = state.error === null ? state : { ...state, error: null };
  switch (action.type) {
    case 'digit':
      return digit(cleared, action.digit);
    case 'decimal':
      return decimal(cleared);
    case 'toggleSign':
      return toggleSign(cleared);
    case 'backspace':
      return backspace(cleared);
    case 'operator':
      return operator(cleared, action.operator);
    case 'equals':
      return requestCalculation(cleared, null);
    case 'paste':
      return paste(cleared, action.text);
  }
}
