import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CalculatorAction } from '../model/calculatorReducer';
import { Keypad } from './Keypad';

const EXPECTED: [string, string, CalculatorAction][] = [
  ['clear', 'C', { type: 'clear' }],
  ['backspace', '⌫', { type: 'backspace' }],
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
  it('renders the 19 buttons with their exact labels', () => {
    render(<Keypad onAction={vi.fn()} disabled={false} />);
    expect(screen.getAllByRole('button')).toHaveLength(19);
    for (const [name, symbol] of EXPECTED) {
      expect(screen.getByRole('button', { name })).toHaveTextContent(symbol);
    }
  });

  it('lays out the 4×5 grid in spec order with a double-width 0', () => {
    render(<Keypad onAction={vi.fn()} disabled={false} />);
    const order = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(order).toEqual([
      'clear',
      'backspace',
      'plus/minus',
      'divide',
      '7',
      '8',
      '9',
      'multiply',
      '4',
      '5',
      '6',
      'subtract',
      '1',
      '2',
      '3',
      'add',
      '0',
      'decimal point',
      'equals',
    ]);
    expect(screen.getByRole('button', { name: '0' })).toHaveClass('wide');
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
