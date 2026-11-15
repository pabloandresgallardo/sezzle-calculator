package domain

import (
	"errors"
	"testing"

	"github.com/pabloandresgallardo/sezzle-calculator/backend-go/internal/decimal"
)

// dec parses a JSON number literal or fails the test.
func dec(t *testing.T, literal string) decimal.Decimal {
	t.Helper()
	d, err := decimal.Parse(literal)
	if err != nil {
		t.Fatalf("decimal.Parse(%q): %v", literal, err)
	}
	return d
}

// operands builds normalized operands from literals or fails the test.
func operands(t *testing.T, literals ...string) []Operand {
	t.Helper()
	ops := make([]Operand, len(literals))
	for i, l := range literals {
		o, err := NewOperand(dec(t, l))
		if err != nil {
			t.Fatalf("NewOperand(%q): %v", l, err)
		}
		ops[i] = o
	}
	return ops
}

// lookup returns the operation for code or fails the test.
func lookup(t *testing.T, code string) Operation {
	t.Helper()
	op, err := Lookup(code)
	if err != nil {
		t.Fatalf("Lookup(%q): %v", code, err)
	}
	return op
}

// formatted mirrors CalculationResult.formatted().
func formatted(d decimal.Decimal) string {
	return d.StripTrailingZeros().PlainString()
}

// wantErr checks that err has the dynamic type of target and the exact message.
func wantErr[T error](t *testing.T, err error, msg string) {
	t.Helper()
	var target T
	if !errors.As(err, &target) {
		t.Fatalf("error = %v (%T), want type %T", err, err, target)
	}
	if err.Error() != msg {
		t.Fatalf("error message = %q, want %q", err.Error(), msg)
	}
}
