import { useState } from 'react';
import { CalculatorPanel } from '../features/calculator/organisms/CalculatorPanel';
import { BackendSelector } from '../shared/backend/BackendSelector';
import { useBackends } from '../shared/backend/useBackends';
import { ThemeToggle } from '../shared/theme/ThemeToggle';
import styles from './App.module.css';

export function App() {
  const { active, selectable, select, failover } = useBackends();
  const [busy, setBusy] = useState(false);
  return (
    <div className={styles.app}>
      <header className={styles.header}>
        {selectable && <BackendSelector value={active} onChange={select} disabled={busy} />}
        <ThemeToggle />
      </header>
      <main className={styles.main}>
        <CalculatorPanel backend={active} failover={failover} onBusyChange={setBusy} />
      </main>
    </div>
  );
}
