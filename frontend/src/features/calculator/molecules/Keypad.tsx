import { CalcButton, type CalcButtonProps } from '../atoms/CalcButton';
import type { CalculatorAction } from '../model/calculatorReducer';
import styles from './Keypad.module.css';

interface KeyDef {
  label: string;
  ariaLabel: string;
  variant: CalcButtonProps['variant'];
  action: CalculatorAction;
  wide?: boolean;
  tall?: boolean;
}

function digitKey(digit: string): KeyDef {
  return { label: digit, ariaLabel: digit, variant: 'digit', action: { type: 'digit', digit } };
}

/** Spec grid, row by row: 4 columns × 6 rows, 22 buttons; `0` spans two columns, `=` two rows. */
const KEYS: readonly KeyDef[] = [
  { label: 'C', ariaLabel: 'clear', variant: 'action', action: { type: 'clear' } },
  { label: '⌫', ariaLabel: 'backspace', variant: 'action', action: { type: 'backspace' } },
  {
    label: '%',
    ariaLabel: 'percent',
    variant: 'operator',
    action: { type: 'operator', operator: 'percentage' },
  },
  {
    label: '÷',
    ariaLabel: 'divide',
    variant: 'operator',
    action: { type: 'operator', operator: 'divide' },
  },
  {
    label: 'xʸ',
    ariaLabel: 'power',
    variant: 'operator',
    action: { type: 'operator', operator: 'power' },
  },
  {
    label: '√',
    ariaLabel: 'square root',
    variant: 'operator',
    action: { type: 'unaryOperator', operator: 'sqrt' },
  },
  { label: '±', ariaLabel: 'plus/minus', variant: 'action', action: { type: 'toggleSign' } },
  {
    label: '×',
    ariaLabel: 'multiply',
    variant: 'operator',
    action: { type: 'operator', operator: 'multiply' },
  },
  digitKey('7'),
  digitKey('8'),
  digitKey('9'),
  {
    label: '−',
    ariaLabel: 'subtract',
    variant: 'operator',
    action: { type: 'operator', operator: 'subtract' },
  },
  digitKey('4'),
  digitKey('5'),
  digitKey('6'),
  {
    label: '+',
    ariaLabel: 'add',
    variant: 'operator',
    action: { type: 'operator', operator: 'add' },
  },
  digitKey('1'),
  digitKey('2'),
  digitKey('3'),
  { label: '=', ariaLabel: 'equals', variant: 'equals', action: { type: 'equals' }, tall: true },
  { ...digitKey('0'), wide: true },
  { label: '.', ariaLabel: 'decimal point', variant: 'digit', action: { type: 'decimal' } },
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
          tall={key.tall}
          disabled={disabled && key.action.type !== 'clear'}
          onPress={() => {
            onAction(key.action);
          }}
        />
      ))}
    </div>
  );
}
