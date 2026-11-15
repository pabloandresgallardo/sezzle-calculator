import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from './backend';
import { BackendSelector } from './BackendSelector';

function radio(name: 'Go' | 'Java'): HTMLElement {
  return screen.getByRole('radio', { name });
}

/** Controlled like `App` does it. */
function Harness({ disabled = false, initial = 'go' }: { disabled?: boolean; initial?: Backend }) {
  const [value, setValue] = useState<Backend>(initial);
  return <BackendSelector value={value} onChange={setValue} disabled={disabled} />;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BackendSelector', () => {
  it('renders Go and Java with Go checked', () => {
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Backend' });
    expect(group).toContainElement(radio('Go'));
    expect(group).toContainElement(radio('Java'));
    // Go, the default backend, comes first.
    expect(screen.getAllByRole('radio').map((option) => option.textContent)).toEqual([
      'Go',
      'Java',
    ]);
    expect(radio('Go')).toBeChecked();
    expect(radio('Java')).not.toBeChecked();
    // Roving tabindex: one tab stop for the whole group.
    expect(radio('Go')).toHaveAttribute('tabindex', '0');
    expect(radio('Java')).toHaveAttribute('tabindex', '-1');
  });

  it('click selects without moving focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(radio('Java'));
    expect(radio('Java')).toBeChecked();
    expect(radio('Go')).not.toBeChecked();
    expect(radio('Java')).not.toHaveFocus();
  });

  it('arrow keys change selection', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    radio('Go').focus();

    await user.keyboard('{ArrowRight}');
    expect(radio('Java')).toBeChecked();
    expect(radio('Java')).toHaveFocus();

    // Wraps around.
    await user.keyboard('{ArrowRight}');
    expect(radio('Go')).toBeChecked();
    expect(radio('Go')).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(radio('Java')).toBeChecked();
    await user.keyboard('{ArrowUp}');
    expect(radio('Go')).toBeChecked();
    await user.keyboard('{ArrowDown}');
    expect(radio('Java')).toBeChecked();
    expect(radio('Java')).toHaveAttribute('tabindex', '0');
    expect(radio('Go')).toHaveAttribute('tabindex', '-1');
  });

  it('ignores other keys', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BackendSelector value="go" onChange={onChange} disabled={false} />);
    radio('Go').focus();
    await user.keyboard('a');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps Enter and Space away from the calculator listener on window', () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    render(<Harness />);
    fireEvent.keyDown(radio('Go'), { key: 'Enter' });
    fireEvent.keyDown(radio('Go'), { key: ' ' });
    fireEvent.keyDown(radio('Go'), { key: '7' });
    window.removeEventListener('keydown', onWindowKey);
    expect(onWindowKey.mock.calls.map(([event]) => (event as KeyboardEvent).key)).toEqual(['7']);
  });

  it('disabled blocks changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BackendSelector value="go" onChange={onChange} disabled />);
    expect(radio('Go')).toBeDisabled();
    expect(radio('Java')).toBeDisabled();
    await user.click(radio('Java'));
    fireEvent.keyDown(radio('Go'), { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
    expect(radio('Go')).toBeChecked();
  });
});
