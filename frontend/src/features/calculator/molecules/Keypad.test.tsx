import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CalculatorAction } from '../model/calculatorReducer';
import { Keypad } from './Keypad';

const EXPECTED: [string, string, CalculatorAction][] = [
  ['clear', 'C', { type: 'clear' }],
  ['backspace', '⌫', { type: 'backspace' }],
  ['percent', '%', { type: 'operator', operator: 'percentage' }],
  ['power', 'xʸ', { type: 'operator', operator: 'power' }],
  ['square root', '√', { type: 'unaryOperator', operator: 'sqrt' }],
  ['plus/minus', '±', { type: 'toggleSign' }],
  ['divide', '÷', { type: 'operator', operator: 'divide' }],
  ['multiply', '×', { type: 'operator', operator: 'multiply' }],
  ['subtract', '−', { type: 'operator', operator: 'subtract' }],
  ['add', '+', { type: 'operator', operator: 'add' }],
  ['equals', '=', { type: 'equals' }],
  ['decimal point', '.', { type: 'decimal' }],
  ...Array.from({ length: 10 }, (_, d): [string, string, CalculatorAction] => [
    String(d),
    String(d),
    { type: 'digit', digit: String(d) },
  ]),
];

describe('Keypad', () => {
  it('renders the 22 buttons with their exact labels', () => {
    render(<Keypad onAction={vi.fn()} disabled={false} />);
    expect(screen.getAllByRole('button')).toHaveLength(22);
    for (const [name, symbol] of EXPECTED) {
      expect(screen.getByRole('button', { name })).toHaveTextContent(symbol);
    }
  });

  it('lays out the 4×6 grid in spec order with a double-width 0 and a tall =', () => {
    render(<Keypad onAction={vi.fn()} disabled={false} />);
    const order = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(order).toEqual([
      'clear',
      'backspace',
      'percent',
      'divide',
      'power',
      'square root',
      'plus/minus',
      'multiply',
      '7',
      '8',
      '9',
      'subtract',
      '4',
      '5',
      '6',
      'add',
      '1',
      '2',
      '3',
      'equals',
      '0',
      'decimal point',
    ]);
    expect(screen.getByRole('button', { name: '0' })).toHaveClass('wide');
    expect(screen.getByRole('button', { name: 'equals' })).toHaveClass('tall');
  });

  it('styles the 7 operation keys as operators and C, ⌫, ± as actions', () => {
    render(<Keypad onAction={vi.fn()} disabled={false} />);
    const operations = ['divide', 'multiply', 'subtract', 'add', 'power', 'percent', 'square root'];
    for (const name of operations) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveClass('operator');
      expect(button).not.toHaveClass('action');
    }
    for (const name of ['clear', 'backspace', 'plus/minus']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveClass('action');
      expect(button).not.toHaveClass('operator');
    }
    expect(document.querySelectorAll('.operator')).toHaveLength(7);
    expect(document.querySelectorAll('.action')).toHaveLength(3);
  });

  it('square root emits the sqrt unary operator', async () => {
    const onAction = vi.fn();
    render(<Keypad onAction={onAction} disabled={false} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'square root' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'unaryOperator', operator: 'sqrt' });
  });

  it('divide emits the divide operator', async () => {
    const onAction = vi.fn();
    render(<Keypad onAction={onAction} disabled={false} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'divide' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'operator', operator: 'divide' });
  });

  it.each(EXPECTED)('%s emits its action', async (name, _symbol, action) => {
    const onAction = vi.fn();
    render(<Keypad onAction={onAction} disabled={false} />);
    await userEvent.setup().click(screen.getByRole('button', { name }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith(action);
  });

  it('disabled disables every button except clear', () => {
    render(<Keypad onAction={vi.fn()} disabled />);
    for (const [name] of EXPECTED) {
      const button = screen.getByRole('button', { name });
      if (name === 'clear') {
        expect(button).toBeEnabled();
      } else {
        expect(button).toBeDisabled();
      }
    }
  });
});
