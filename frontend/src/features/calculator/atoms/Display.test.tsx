import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Display } from './Display';

describe('Display', () => {
  it('renders text at the requested size', () => {
    render(<Display text="123" size="large" />);
    const display = screen.getByText('123');
    expect(display).toHaveAttribute('data-size', 'large');
    expect(display).not.toHaveClass('compact');
    expect(display).not.toHaveClass('tiny');
  });

  it('shrinks long text', () => {
    render(<Display text="1234567890123" size="large" />);
    expect(screen.getByText('1234567890123')).toHaveClass('compact');
  });

  it('shrinks very long text further', () => {
    const text = '999999999999998000000000000001';
    render(<Display text={text} size="small" />);
    expect(screen.getByText(text)).toHaveClass('tiny');
  });
});
