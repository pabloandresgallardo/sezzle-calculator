import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders calculator', () => {
    render(<App />);
    expect(screen.getByRole('region', { name: 'Calculator' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0');
    expect(screen.getAllByRole('button')).toHaveLength(19);
  });
});
