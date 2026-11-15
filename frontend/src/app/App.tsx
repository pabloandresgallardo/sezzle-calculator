import { CalculatorPanel } from '../features/calculator/organisms/CalculatorPanel';
import styles from './App.module.css';

export function App() {
  return (
    <main className={styles.app}>
      <CalculatorPanel />
    </main>
  );
}
