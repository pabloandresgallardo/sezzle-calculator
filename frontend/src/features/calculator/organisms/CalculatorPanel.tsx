import { useCalculator } from '../hooks/useCalculator';
import { DisplayPanel } from '../molecules/DisplayPanel';
import { Keypad } from '../molecules/Keypad';
import styles from './CalculatorPanel.module.css';

export function CalculatorPanel() {
  const { state, dispatch, expression, display } = useCalculator();
  const pending = state.phase === 'pending';
  return (
    <section className={styles.panel} aria-label="Calculator">
      <DisplayPanel expression={expression} value={display} error={state.error} pending={pending} />
      <Keypad onAction={dispatch} disabled={pending} />
    </section>
  );
}
