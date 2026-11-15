import { CalculatorPanel } from '../features/calculator/organisms/CalculatorPanel';
import { ThemeToggle } from '../shared/theme/ThemeToggle';
import styles from './App.module.css';

export function App() {
  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <ThemeToggle />
      </header>
      <main className={styles.main}>
        <CalculatorPanel />
      </main>
    </div>
  );
}
