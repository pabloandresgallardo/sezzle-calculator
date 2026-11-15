import type { MouseEvent } from 'react';
import styles from './CalcButton.module.css';

export interface CalcButtonProps {
  label: string;
  ariaLabel: string;
  onPress: () => void;
  variant: 'digit' | 'operator' | 'action' | 'equals';
  wide?: boolean;
  disabled?: boolean;
}

/** Keeps focus where it was, so a later Enter is not taken as a press of this button. */
function keepFocus(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

export function CalcButton({
  label,
  ariaLabel,
  onPress,
  variant,
  wide = false,
  disabled = false,
}: CalcButtonProps) {
  const className = [styles.button, styles[variant], wide && styles.wide].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel}
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={onPress}
    >
      {label}
    </button>
  );
}
