import { Display } from '../atoms/Display';
import styles from './DisplayPanel.module.css';

export interface DisplayPanelProps {
  expression: string;
  value: string;
  error: string | null;
  pending: boolean;
}

export function DisplayPanel({ expression, value, error, pending }: DisplayPanelProps) {
  const className = [styles.panel, pending && styles.pending].filter(Boolean).join(' ');
  return (
    <div className={className} role="status" aria-live="polite" aria-busy={pending}>
      <Display text={expression} size="small" />
      <Display text={value} size="large" />
      <p className={styles.error}>{error}</p>
    </div>
  );
}
