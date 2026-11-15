import { CalcButton, type CalcButtonProps } from '../atoms/CalcButton';
import type { CalculatorAction } from '../model/calculatorReducer';
import styles from './Keypad.module.css';

interface KeyDef {
  label: string;
  ariaLabel: string;
  variant: CalcButtonProps['variant'];
  action: CalculatorAction;
  wide?: boolean;
}

function digitKey(digit: string): KeyDef {
  return { label: digit, ariaLabel: digit, variant: 'digit', action: { type: 'digit', digit } };
}

/** Spec grid, row by row: 4 columns × 5 rows, 19 buttons, `0` spans two cells. */
const KEYS: readonly KeyDef[] = [
  { label: 'C', ariaLabel: 'clear', variant: 'action', action: { type: 'clear' } },
  { label: '⌫', ariaLabel: 'backspace', variant: 'action', action: { type: 'backspace' } },
  { label: '±', ariaLabel: 'plus/minus', variant: 'action', action: { type: 'toggleSign' } },
  {
    label: '÷',
    ariaLabel: 'divide',
    variant: 'operator',
    action: { type: 'operator', operator: 'divide' },
  },
  digitKey('7'),
  digitKey('8'),
  digitKey('9'),
  {
    label: '×',
    ariaLabel: 'multiply',
    variant: 'operator',
    action: { type: 'operator', operator: 'multiply' },
  },
  digitKey('4'),
  digitKey('5'),
  digitKey('6'),
  {
    label: '−',
    ariaLabel: 'subtract',
    variant: 'operator',
    action: { type: 'operator', operator: 'subtract' },
  },
  digitKey('1'),
  digitKey('2'),
  digitKey('3'),
  {
    label: '+',
    ariaLabel: 'add',
    variant: 'operator',
    action: { type: 'operator', operator: 'add' },
  },
  { ...digitKey('0'), wide: true },
  { label: '.', ariaLabel: 'decimal point', variant: 'digit', action: { type: 'decimal' } },
  { label: '=', ariaLabel: 'equals', variant: 'equals', action: { type: 'equals' } },
];

export interface KeypadProps {
  onAction: (action: CalculatorAction) => void;
  /** Disables every key except `clear` (used while a calculation is pending). */
  disabled: boolean;
}

export function Keypad({ onAction, disabled }: KeypadProps) {
  return (
    <div className={styles.keypad}>
      {KEYS.map((key) => (
        <CalcButton
          key={key.ariaLabel}
          label={key.label}
          ariaLabel={key.ariaLabel}
          variant={key.variant}
          wide={key.wide}
          disabled={disabled && key.action.type !== 'clear'}
          onPress={() => {
            onAction(key.action);
          }}
        />
      ))}
    </div>
  );
}
