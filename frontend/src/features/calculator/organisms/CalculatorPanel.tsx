import { useEffect } from 'react';
import type { Backend } from '../../../shared/backend/backend';
import { useCalculator } from '../hooks/useCalculator';
import { DisplayPanel } from '../molecules/DisplayPanel';
import { Keypad } from '../molecules/Keypad';
import styles from './CalculatorPanel.module.css';

export interface CalculatorPanelProps {
  backend: Backend;
  /** Receives the backend that failed; see `useCalculator`. */
  failover: (failed: Backend) => Promise<Backend | null>;
  /** Reports whether a calculation is in flight (the backend selector is disabled meanwhile). */
  onBusyChange?: (busy: boolean) => void;
}

export function CalculatorPanel({ backend, failover, onBusyChange }: CalculatorPanelProps) {
  const { state, dispatch, expression, display } = useCalculator({ backend, failover });
  const pending = state.phase === 'pending';

  useEffect(() => {
    onBusyChange?.(pending);
  }, [pending, onBusyChange]);

  return (
    <section className={styles.panel} aria-label="Calculator">
      <DisplayPanel expression={expression} value={display} error={state.error} pending={pending} />
      <Keypad onAction={dispatch} disabled={pending} />
    </section>
  );
}
