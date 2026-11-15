import { describe, expect, it } from 'vitest';
import {
  calculatorReducer,
  initialState,
  type CalculatorAction,
  type CalculatorState,
} from './calculatorReducer';

function run(actions: CalculatorAction[], from: CalculatorState = initialState): CalculatorState {
  return actions.reduce(calculatorReducer, from);
}

function digits(text: string): CalculatorAction[] {
  return text.split('').map((digit) => ({ type: 'digit', digit }));
}

const OVERSIZED = '17636684.1428571429';

const resultState: CalculatorState = { ...initialState, current: '5', phase: 'result' };
const errorState: CalculatorState = { ...initialState, current: '12', error: 'Invalid number' };

function pendingAfter(actions: CalculatorAction[]): CalculatorState {
  const state = run(actions);
  expect(state.phase).toBe('pending');
  return state;
}

describe('calculatorReducer', () => {
  it('starts with zero in input phase', () => {
    expect(initialState).toEqual({
      previous: null,
      operator: null,
      current: '0',
      phase: 'input',
      error: null,
      pendingOperator: null,
      request: null,
      replaceNext: false,
      requestedFrom: null,
    });
  });

  describe('digit', () => {
    it('replaces a leading zero', () => {
      expect(run(digits('7')).current).toBe('7');
    });

    it('appends to the current number', () => {
      expect(run(digits('123')).current).toBe('123');
    });

    it('digit after result starts new calculation', () => {
      const from: CalculatorState = {
        ...resultState,
        error: 'Result too long to continue',
      };
      expect(run(digits('8'), from)).toEqual({ ...initialState, current: '8' });
    });

    it('is ignored beyond 15 significant digits', () => {
      const state = run(digits('9999999999999999'));
      expect(state.current).toBe('999999999999999');
    });

    it('is ignored beyond 10 decimals', () => {
      const from: CalculatorState = { ...initialState, current: '1.0000000000' };
      expect(run(digits('1'), from)).toEqual(from);
    });

    it('starts the second operand after an operator', () => {
      const state = run([...digits('2'), { type: 'operator', operator: 'add' }, ...digits('3')]);
      expect(state).toMatchObject({ previous: '2', operator: 'add', current: '3', phase: 'input' });
    });
  });

  describe('decimal', () => {
    it('appends a point', () => {
      expect(run([...digits('5'), { type: 'decimal' }]).current).toBe('5.');
    });

    it('is ignored when a point already exists', () => {
      expect(run([...digits('5'), { type: 'decimal' }, { type: 'decimal' }]).current).toBe('5.');
    });

    it('produces "0." on empty input', () => {
      const state = run([{ type: 'operator', operator: 'add' }, { type: 'decimal' }]);
      expect(state).toMatchObject({ current: '0.', phase: 'input' });
    });

    it('produces "0." from the initial zero', () => {
      expect(run([{ type: 'decimal' }]).current).toBe('0.');
    });

    it('starts a new calculation on a result', () => {
      expect(run([{ type: 'decimal' }], resultState)).toEqual({ ...initialState, current: '0.' });
    });
  });

  describe('toggleSign', () => {
    it('negates current', () => {
      expect(run([...digits('5'), { type: 'toggleSign' }]).current).toBe('-5');
      expect(run([...digits('5'), { type: 'toggleSign' }, { type: 'toggleSign' }]).current).toBe(
        '5',
      );
    });

    it('does nothing on "0"', () => {
      expect(run([{ type: 'toggleSign' }])).toEqual(initialState);
    });

    it('toggleSign on numeric zero is a no-op', () => {
      const from: CalculatorState = { ...initialState, current: '0.' };
      expect(run([{ type: 'toggleSign' }], from)).toEqual(from);
    });

    it('negates a result and allows continuing with it', () => {
      const state = run([{ type: 'toggleSign' }], resultState);
      expect(state).toEqual({ ...resultState, current: '-5' });
      expect(run([{ type: 'operator', operator: 'add' }], state)).toMatchObject({
        previous: '-5',
        operator: 'add',
        phase: 'awaitingOperand',
      });
    });
  });

  describe('backspace', () => {
    it('removes the last character', () => {
      expect(run([...digits('123'), { type: 'backspace' }]).current).toBe('12');
    });

    it('leaves "0" when input becomes empty', () => {
      expect(run([...digits('7'), { type: 'backspace' }]).current).toBe('0');
    });

    it("backspace on '-5' yields '0'", () => {
      const from: CalculatorState = { ...initialState, current: '-5' };
      expect(run([{ type: 'backspace' }], from).current).toBe('0');
    });

    it('does nothing on a result', () => {
      expect(run([{ type: 'backspace' }], resultState)).toEqual(resultState);
    });
  });

  describe('clear', () => {
    it('resets everything', () => {
      const from: CalculatorState = {
        previous: '2',
        operator: 'add',
        current: '3',
        phase: 'input',
        error: 'Cannot divide by zero',
        pendingOperator: null,
        request: null,
        replaceNext: false,
        requestedFrom: null,
      };
      expect(run([{ type: 'clear' }], from)).toEqual(initialState);
    });

    it('resets a pending request', () => {
      const pending = pendingAfter([
        ...digits('2'),
        { type: 'operator', operator: 'add' },
        ...digits('3'),
        { type: 'equals' },
      ]);
      expect(run([{ type: 'clear' }], pending)).toEqual(initialState);
    });
  });

  describe('operator', () => {
    it('stores current as previous and awaits the second operand', () => {
      expect(run([...digits('5'), { type: 'operator', operator: 'multiply' }])).toEqual({
        ...initialState,
        previous: '5',
        operator: 'multiply',
        current: '',
        phase: 'awaitingOperand',
      });
    });

    it('operator on fresh state uses zero', () => {
      expect(run([{ type: 'operator', operator: 'add' }])).toMatchObject({
        previous: '0',
        operator: 'add',
        current: '',
        phase: 'awaitingOperand',
      });
    });

    it('chains on second operator', () => {
      const pending = pendingAfter([
        ...digits('2'),
        { type: 'operator', operator: 'add' },
        ...digits('3'),
        { type: 'operator', operator: 'multiply' },
      ]);
      expect(pending).toMatchObject({
        request: { operation: 'add', operands: ['2', '3'] },
        pendingOperator: 'multiply',
      });

      expect(run([{ type: 'resolved', result: '5' }], pending)).toEqual({
        ...initialState,
        previous: '5',
        operator: 'multiply',
        current: '',
        phase: 'awaitingOperand',
      });
    });

    it('operator replaces operator when no second operand', () => {
      const state = run([
        ...digits('2'),
        { type: 'operator', operator: 'add' },
        { type: 'operator', operator: 'divide' },
      ]);
      expect(state).toEqual({
        ...initialState,
        previous: '2',
        operator: 'divide',
        current: '',
        phase: 'awaitingOperand',
      });
    });

    it('operator after result continues with result', () => {
      expect(run([{ type: 'operator', operator: 'subtract' }], resultState)).toEqual({
        ...initialState,
        previous: '5',
        operator: 'subtract',
        current: '',
        phase: 'awaitingOperand',
      });
    });

    it('operator after oversized result sets resultTooLong', () => {
      const from: CalculatorState = { ...resultState, current: OVERSIZED };
      expect(run([{ type: 'operator', operator: 'add' }], from)).toEqual({
        ...from,
        error: 'Result too long to continue',
      });
    });

    it('sends operands exactly as typed', () => {
      const pending = pendingAfter([
        ...digits('5'),
        { type: 'decimal' },
        { type: 'operator', operator: 'add' },
        ...digits('1'),
        { type: 'equals' },
      ]);
      expect(pending.request).toEqual({ operation: 'add', operands: ['5.', '1'] });
    });
  });

  describe('equals', () => {
    it('requests the calculation and shows the result when resolved', () => {
      const pending = pendingAfter([
        ...digits('6'),
        { type: 'operator', operator: 'divide' },
        ...digits('3'),
        { type: 'equals' },
      ]);
      expect(pending).toMatchObject({
        request: { operation: 'divide', operands: ['6', '3'] },
        pendingOperator: null,
      });

      expect(run([{ type: 'resolved', result: '2' }], pending)).toEqual({
        ...initialState,
        current: '2',
        phase: 'result',
      });
    });

    it('equals without second operand is a no-op', () => {
      const awaiting = run([...digits('2'), { type: 'operator', operator: 'add' }]);
      expect(run([{ type: 'equals' }], awaiting)).toEqual(awaiting);
      expect(run([{ type: 'equals' }])).toEqual(initialState);
      expect(run([{ type: 'equals' }], resultState)).toEqual(resultState);
    });
  });

  describe('paste', () => {
    it('replaces current with a valid number', () => {
      const state = run([...digits('12'), { type: 'paste', text: ' 3,5 ' }]);
      expect(state).toMatchObject({ current: '3.5', phase: 'input', error: null });
    });

    it('stores the normalized pasted value', () => {
      expect(run([{ type: 'paste', text: '-007.' }])).toMatchObject({ current: '-7', error: null });
      expect(run([{ type: 'paste', text: '-0' }])).toMatchObject({ current: '0', error: null });
    });

    it('fills the second operand', () => {
      const state = run([
        ...digits('2'),
        { type: 'operator', operator: 'add' },
        { type: 'paste', text: '-7' },
      ]);
      expect(state).toMatchObject({ previous: '2', current: '-7', phase: 'input' });
    });

    it('paste on result starts new calculation', () => {
      expect(run([{ type: 'paste', text: '42' }], resultState)).toEqual({
        ...initialState,
        current: '42',
      });
    });

    it('paste invalid keeps state and sets invalidNumber', () => {
      const from = run(digits('12'));
      expect(run([{ type: 'paste', text: '1e5' }], from)).toEqual({
        ...from,
        error: 'Invalid number',
      });
    });

    it('paste too long keeps state and sets tooManyDigits', () => {
      const from = run(digits('12'));
      expect(run([{ type: 'paste', text: '1234567890123456' }], from)).toEqual({
        ...from,
        error: 'Too many digits',
      });
    });
  });

  describe('resolved / rejected', () => {
    it('rejected keeps operands for retry', () => {
      const pending = pendingAfter([
        ...digits('5'),
        { type: 'operator', operator: 'divide' },
        ...digits('0'),
        { type: 'equals' },
      ]);
      const rejected = run([{ type: 'rejected', message: 'Cannot divide by zero' }], pending);
      expect(rejected).toEqual({
        ...initialState,
        previous: '5',
        operator: 'divide',
        current: '0',
        phase: 'input',
        error: 'Cannot divide by zero',
      });

      expect(run([{ type: 'equals' }], rejected)).toMatchObject({
        phase: 'pending',
        error: null,
        request: { operation: 'divide', operands: ['5', '0'] },
      });
    });

    it('rejected after a chained operator drops the pending operator', () => {
      const pending = pendingAfter([
        ...digits('2'),
        { type: 'operator', operator: 'add' },
        ...digits('3'),
        { type: 'operator', operator: 'multiply' },
      ]);
      expect(run([{ type: 'rejected', message: 'Service unavailable' }], pending)).toMatchObject({
        previous: '2',
        operator: 'add',
        current: '3',
        phase: 'input',
        pendingOperator: null,
        request: null,
      });
    });

    it('resolved with pendingOperator and oversized result drops operator', () => {
      const pending = pendingAfter([
        ...digits('2'),
        { type: 'operator', operator: 'add' },
        ...digits('3'),
        { type: 'operator', operator: 'multiply' },
      ]);
      expect(run([{ type: 'resolved', result: OVERSIZED }], pending)).toEqual({
        ...initialState,
        current: OVERSIZED,
        phase: 'result',
        error: 'Result too long to continue',
      });
    });

    it('are ignored when nothing is pending', () => {
      const from = run(digits('12'));
      expect(run([{ type: 'resolved', result: '9' }], from)).toBe(from);
      expect(run([{ type: 'rejected', message: 'Service unavailable' }], from)).toBe(from);
    });
  });

  describe('power / percentage', () => {
    it('chains power then multiply', () => {
      const pending = pendingAfter([
        ...digits('2'),
        { type: 'operator', operator: 'power' },
        ...digits('3'),
        { type: 'operator', operator: 'multiply' },
      ]);
      expect(pending).toMatchObject({
        request: { operation: 'power', operands: ['2', '3'] },
        pendingOperator: 'multiply',
      });
    });

    it('percentage behaves as binary', () => {
      const pending = pendingAfter([
        ...digits('20'),
        { type: 'operator', operator: 'percentage' },
        ...digits('150'),
        { type: 'equals' },
      ]);
      expect(pending).toMatchObject({
        request: { operation: 'percentage', operands: ['20', '150'] },
        pendingOperator: null,
      });
    });

    it('replaces the operator when no second operand', () => {
      const state = run([
        ...digits('2'),
        { type: 'operator', operator: 'add' },
        { type: 'operator', operator: 'power' },
      ]);
      expect(state).toEqual({
        ...initialState,
        previous: '2',
        operator: 'power',
        current: '',
        phase: 'awaitingOperand',
      });
    });

    it('continues from a result', () => {
      expect(run([{ type: 'operator', operator: 'percentage' }], resultState)).toEqual({
        ...initialState,
        previous: '5',
        operator: 'percentage',
        current: '',
        phase: 'awaitingOperand',
      });
    });
  });

  describe('unaryOperator (sqrt)', () => {
    const SQRT: CalculatorAction = { type: 'unaryOperator', operator: 'sqrt' };

    /** `2 + 9 √` resolved to `3`: second operand set, next digit replaces it. */
    function afterSqrtWithPendingBinary(result = '3'): CalculatorState {
      const pending = pendingAfter([
        ...digits('2'),
        { type: 'operator', operator: 'add' },
        ...digits('9'),
        SQRT,
      ]);
      return run([{ type: 'resolved', result }], pending);
    }

    it('sqrt requests single operand', () => {
      const pending = pendingAfter([...digits('9'), SQRT]);
      expect(pending.request).toEqual({ operation: 'sqrt', operands: ['9'] });
      expect(pending.pendingOperator).toBeNull();
    });

    it('sqrt requests the result when within limits', () => {
      const pending = run([SQRT], resultState);
      expect(pending).toMatchObject({
        phase: 'pending',
        current: '5',
        request: { operation: 'sqrt', operands: ['5'] },
      });
    });

    it('sqrt keeps previous and operator while pending', () => {
      const pending = pendingAfter([
        ...digits('2'),
        { type: 'operator', operator: 'add' },
        ...digits('9'),
        SQRT,
      ]);
      expect(pending).toMatchObject({
        previous: '2',
        operator: 'add',
        current: '9',
        pendingOperator: null,
        request: { operation: 'sqrt', operands: ['9'] },
      });
    });

    it('sqrt with pending binary keeps previous', () => {
      const resolved = afterSqrtWithPendingBinary();
      expect(resolved).toMatchObject({
        previous: '2',
        operator: 'add',
        current: '3',
        phase: 'input',
        error: null,
        request: null,
      });

      const replaced = run(digits('4'), resolved);
      expect(replaced).toMatchObject({ previous: '2', operator: 'add', current: '4' });
      expect(run(digits('5'), replaced).current).toBe('45');

      const equals = run([{ type: 'equals' }], resolved);
      expect(equals).toMatchObject({
        phase: 'pending',
        request: { operation: 'add', operands: ['2', '3'] },
      });
    });

    it('decimal after sqrt with pending binary replaces current', () => {
      expect(run([{ type: 'decimal' }], afterSqrtWithPendingBinary()).current).toBe('0.');
    });

    it('backspace after sqrt with pending binary does nothing', () => {
      const resolved = afterSqrtWithPendingBinary('1.5');
      expect(run([{ type: 'backspace' }], resolved)).toEqual(resolved);
    });

    it('paste after sqrt with pending binary replaces and allows appending', () => {
      const state = run(
        [{ type: 'paste', text: '7' }, ...digits('1')],
        afterSqrtWithPendingBinary(),
      );
      expect(state).toMatchObject({ previous: '2', current: '71' });
    });

    it('toggleSign after unary keeps replace flag', () => {
      const negated = run([{ type: 'toggleSign' }], afterSqrtWithPendingBinary());
      expect(negated).toMatchObject({ previous: '2', operator: 'add', current: '-3' });
      expect(run(digits('4'), negated).current).toBe('4');
    });

    it('operator after sqrt with pending binary chains with the root', () => {
      expect(
        run([{ type: 'operator', operator: 'multiply' }], afterSqrtWithPendingBinary()),
      ).toMatchObject({
        phase: 'pending',
        pendingOperator: 'multiply',
        request: { operation: 'add', operands: ['2', '3'] },
      });
    });

    it('sqrt without pending goes to result', () => {
      const pending = pendingAfter([...digits('9'), SQRT]);
      const resolved = run([{ type: 'resolved', result: '3' }], pending);
      expect(resolved).toEqual({ ...initialState, current: '3', phase: 'result' });
      expect(run(digits('7'), resolved)).toEqual({ ...initialState, current: '7' });
      expect(run([{ type: 'operator', operator: 'add' }], resolved)).toMatchObject({
        previous: '3',
        operator: 'add',
        phase: 'awaitingOperand',
      });
    });

    it('oversized unary result is shown and cannot be used as operand', () => {
      const pending = pendingAfter([...digits('9'), SQRT]);
      const resolved = run([{ type: 'resolved', result: OVERSIZED }], pending);
      expect(resolved).toEqual({ ...initialState, current: OVERSIZED, phase: 'result' });
      expect(run([{ type: 'operator', operator: 'add' }], resolved)).toEqual({
        ...resolved,
        error: 'Result too long to continue',
      });
    });

    it('oversized unary result with pending binary cannot be used as operand', () => {
      const resolved = afterSqrtWithPendingBinary(OVERSIZED);
      expect(resolved).toMatchObject({ previous: '2', current: OVERSIZED, error: null });
      expect(run([{ type: 'equals' }], resolved)).toEqual({
        ...resolved,
        error: 'Result too long to continue',
      });
      expect(run([{ type: 'operator', operator: 'add' }], resolved)).toEqual({
        ...resolved,
        error: 'Result too long to continue',
      });
      expect(run([SQRT], resolved)).toEqual({
        ...resolved,
        error: 'Result too long to continue',
      });
    });

    it('unaryOperator in awaitingOperand is a no-op', () => {
      const awaiting = run([...digits('2'), { type: 'operator', operator: 'add' }]);
      expect(run([SQRT], awaiting)).toEqual(awaiting);
    });

    it('unaryOperator ignored while pending', () => {
      const pending = pendingAfter([
        ...digits('2'),
        { type: 'operator', operator: 'add' },
        ...digits('3'),
        { type: 'equals' },
      ]);
      expect(calculatorReducer(pending, SQRT)).toBe(pending);
      const unaryPending = pendingAfter([...digits('9'), SQRT]);
      expect(calculatorReducer(unaryPending, SQRT)).toBe(unaryPending);
    });

    it('sqrt on oversized result sets resultTooLong', () => {
      const from: CalculatorState = { ...resultState, current: OVERSIZED };
      expect(run([SQRT], from)).toEqual({ ...from, error: 'Result too long to continue' });
    });

    it('rejected unary restores result phase', () => {
      const pending = run([SQRT], resultState);
      expect(run([{ type: 'rejected', message: 'Invalid input' }], pending)).toEqual({
        ...resultState,
        error: 'Invalid input',
      });
    });

    it('rejected unary restores input phase', () => {
      const from = run([...digits('4'), { type: 'toggleSign' }]);
      const pending = run([SQRT], from);
      expect(run([{ type: 'rejected', message: 'Invalid input' }], pending)).toEqual({
        ...from,
        error: 'Invalid input',
      });

      const withBinary = run([
        ...digits('2'),
        { type: 'operator', operator: 'add' },
        ...digits('9'),
      ]);
      expect(run([SQRT, { type: 'rejected', message: 'Service unavailable' }], withBinary)).toEqual(
        { ...withBinary, error: 'Service unavailable' },
      );
    });

    it('rejected unary keeps the replace flag', () => {
      const resolved = afterSqrtWithPendingBinary();
      const rejected = run([SQRT, { type: 'rejected', message: 'Service unavailable' }], resolved);
      expect(rejected).toEqual({ ...resolved, error: 'Service unavailable' });
      expect(run(digits('4'), rejected).current).toBe('4');
    });

    it('clears a previous error', () => {
      expect(run([SQRT], errorState)).toMatchObject({
        phase: 'pending',
        error: null,
        request: { operation: 'sqrt', operands: ['12'] },
      });
      const awaiting: CalculatorState = {
        ...run([...digits('2'), { type: 'operator', operator: 'add' }]),
        error: 'Invalid input',
      };
      expect(run([SQRT], awaiting).error).toBeNull();
    });
  });

  it('ignores input while pending except clear', () => {
    const pending = pendingAfter([
      ...digits('2'),
      { type: 'operator', operator: 'add' },
      ...digits('3'),
      { type: 'equals' },
    ]);
    const ignored: CalculatorAction[] = [
      { type: 'digit', digit: '1' },
      { type: 'decimal' },
      { type: 'toggleSign' },
      { type: 'backspace' },
      { type: 'operator', operator: 'subtract' },
      { type: 'equals' },
      { type: 'paste', text: '9' },
      { type: 'unaryOperator', operator: 'sqrt' },
    ];
    for (const action of ignored) {
      expect(calculatorReducer(pending, action)).toBe(pending);
    }
    expect(calculatorReducer(pending, { type: 'clear' })).toEqual(initialState);
  });

  it('any key clears error before applying', () => {
    expect(run(digits('3'), errorState)).toEqual({ ...initialState, current: '123' });
    expect(run([{ type: 'decimal' }], errorState).error).toBeNull();
    expect(run([{ type: 'toggleSign' }], errorState)).toEqual({ ...initialState, current: '-12' });
    expect(run([{ type: 'backspace' }], errorState)).toEqual({ ...initialState, current: '1' });
    expect(run([{ type: 'equals' }], errorState)).toEqual({ ...initialState, current: '12' });
    expect(run([{ type: 'operator', operator: 'add' }], errorState).error).toBeNull();
    expect(run([{ type: 'paste', text: '4' }], errorState)).toEqual({
      ...initialState,
      current: '4',
    });
    const oversized: CalculatorState = {
      ...resultState,
      current: OVERSIZED,
      error: 'Result too long to continue',
    };
    expect(run([{ type: 'toggleSign' }], oversized)).toEqual({
      ...oversized,
      current: `-${OVERSIZED}`,
      error: null,
    });
  });
});
