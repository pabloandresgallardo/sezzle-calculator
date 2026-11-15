export type Operation =
  'add' | 'subtract' | 'multiply' | 'divide' | 'power' | 'sqrt' | 'percentage';

/** Operations typed between two operands (`a op b`). */
export type BinaryOperation = Exclude<Operation, 'sqrt'>;

/** Operations applied immediately to the number on the display. */
export type UnaryOperation = 'sqrt';
