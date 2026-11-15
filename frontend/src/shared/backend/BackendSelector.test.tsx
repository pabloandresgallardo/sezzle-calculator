import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from './backend';
import { BackendSelector } from './BackendSelector';

function radio(name: 'Java' | 'Go'): HTMLElement {
  return screen.getByRole('radio', { name });
}

/** Controlled like `App` does it. */
function Harness({
  disabled = false,
  initial = 'java',
}: {
  disabled?: boolean;
  initial?: Backend;
}) {
  const [value, setValue] = useState<Backend>(initial);
  return <BackendSelector value={value} onChange={setValue} disabled={disabled} />;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BackendSelector', () => {
  it('renders Java and Go with Java checked', () => {
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Backend' });
    expect(group).toContainElement(radio('Java'));
    expect(group).toContainElement(radio('Go'));
    expect(radio('Java')).toBeChecked();
    expect(radio('Go')).not.toBeChecked();
    // Roving tabindex: one tab stop for the whole group.
    expect(radio('Java')).toHaveAttribute('tabindex', '0');
    expect(radio('Go')).toHaveAttribute('tabindex', '-1');
  });

  it('click selects without moving focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(radio('Go'));
    expect(radio('Go')).toBeChecked();
    expect(radio('Java')).not.toBeChecked();
    expect(radio('Go')).not.toHaveFocus();
  });

  it('arrow keys change selection', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    radio('Java').focus();

    await user.keyboard('{ArrowRight}');
    expect(radio('Go')).toBeChecked();
    expect(radio('Go')).toHaveFocus();

    // Wraps around.
    await user.keyboard('{ArrowRight}');
    expect(radio('Java')).toBeChecked();
    expect(radio('Java')).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(radio('Go')).toBeChecked();
    await user.keyboard('{ArrowUp}');
    expect(radio('Java')).toBeChecked();
    await user.keyboard('{ArrowDown}');
    expect(radio('Go')).toBeChecked();
    expect(radio('Go')).toHaveAttribute('tabindex', '0');
    expect(radio('Java')).toHaveAttribute('tabindex', '-1');
  });

  it('ignores other keys', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BackendSelector value="java" onChange={onChange} disabled={false} />);
    radio('Java').focus();
    await user.keyboard('a');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps Enter and Space away from the calculator listener on window', () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    render(<Harness />);
    fireEvent.keyDown(radio('Java'), { key: 'Enter' });
    fireEvent.keyDown(radio('Java'), { key: ' ' });
    fireEvent.keyDown(radio('Java'), { key: '7' });
    window.removeEventListener('keydown', onWindowKey);
    expect(onWindowKey.mock.calls.map(([event]) => (event as KeyboardEvent).key)).toEqual(['7']);
  });

  it('disabled blocks changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BackendSelector value="java" onChange={onChange} disabled />);
    expect(radio('Java')).toBeDisabled();
    expect(radio('Go')).toBeDisabled();
    await user.click(radio('Go'));
    fireEvent.keyDown(radio('Java'), { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
    expect(radio('Java')).toBeChecked();
  });
});
