import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CalcButton } from './CalcButton';

describe('CalcButton', () => {
  it('calls onPress', async () => {
    const onPress = vi.fn();
    render(<CalcButton label="7" ariaLabel="7" variant="digit" onPress={onPress} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '7' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('exposes aria-label', () => {
    render(<CalcButton label="÷" ariaLabel="divide" variant="operator" onPress={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'divide' });
    expect(button).toHaveTextContent('÷');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('does not call onPress when disabled', async () => {
    const onPress = vi.fn();
    render(<CalcButton label="=" ariaLabel="equals" variant="equals" onPress={onPress} disabled />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'equals' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not take focus on mouse press', async () => {
    render(<CalcButton label="0" ariaLabel="0" variant="digit" wide onPress={vi.fn()} />);
    const button = screen.getByRole('button', { name: '0' });
    await userEvent.setup().click(button);
    expect(button).not.toHaveFocus();
    expect(button).toHaveClass('wide');
    expect(button).not.toHaveClass('tall');
  });

  it('tall spans two grid rows', () => {
    render(<CalcButton label="=" ariaLabel="equals" variant="equals" tall onPress={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'equals' });
    expect(button).toHaveClass('tall');
    expect(button).not.toHaveClass('wide');
  });
});
