import { useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { BACKEND_LABELS, BACKENDS, type Backend } from './backend';
import styles from './BackendSelector.module.css';

export interface BackendSelectorProps {
  value: Backend;
  onChange: (backend: Backend) => void;
  /** While a calculation is pending. */
  disabled: boolean;
}

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown']);
const PREVIOUS_KEYS = new Set(['ArrowLeft', 'ArrowUp']);

/** A mouse click leaves focus where it was, so a later Enter still means `=`. */
function keepFocus(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

/**
 * Segmented switch with the ARIA radio-group pattern: one tab stop (roving tabindex) and arrow keys
 * that move and select. `App` renders it only while both backends are healthy.
 */
export function BackendSelector({ value, onChange, disabled }: BackendSelectorProps) {
  const radios = useRef(new Map<Backend, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // The calculator treats Enter as `=` on `window` (see ThemeToggle); keys aimed here stop here.
    if (event.key === 'Enter' || event.key === ' ') {
      event.stopPropagation();
      return;
    }
    const step = NEXT_KEYS.has(event.key) ? 1 : PREVIOUS_KEYS.has(event.key) ? -1 : 0;
    if (step === 0 || disabled) {
      return;
    }
    event.preventDefault();
    const index = BACKENDS.indexOf(value);
    const next = BACKENDS[(index + step + BACKENDS.length) % BACKENDS.length] ?? value;
    onChange(next);
    radios.current.get(next)?.focus();
  }

  return (
    <div className={styles.selector}>
      <span className={styles.label} aria-hidden="true">
        Backend
      </span>
      <div
        role="radiogroup"
        aria-label="Backend"
        aria-disabled={disabled || undefined}
        className={styles.group}
        onKeyDown={onKeyDown}
      >
        {BACKENDS.map((backend) => {
          const checked = backend === value;
          return (
            <button
              key={backend}
              ref={(element) => {
                if (element === null) {
                  radios.current.delete(backend);
                } else {
                  radios.current.set(backend, element);
                }
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              disabled={disabled}
              className={styles.option}
              onMouseDown={keepFocus}
              onClick={() => {
                onChange(backend);
              }}
            >
              {BACKEND_LABELS[backend]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
