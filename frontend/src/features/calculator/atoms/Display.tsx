import styles from './Display.module.css';

export interface DisplayProps {
  text: string;
  size: 'small' | 'large';
}

const COMPACT_FROM = 13;
const TINY_FROM = 19;

/** One line of text that shrinks when long and then scrolls horizontally inside itself. */
export function Display({ text, size }: DisplayProps) {
  const fit =
    text.length >= TINY_FROM ? styles.tiny : text.length >= COMPACT_FROM && styles.compact;
  const className = [styles.display, styles[size], fit].filter(Boolean).join(' ');
  return (
    <div className={className} data-size={size}>
      {text}
    </div>
  );
}
