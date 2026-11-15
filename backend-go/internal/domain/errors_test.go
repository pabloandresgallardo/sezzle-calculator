package domain

import (
	"errors"
	"strings"
	"testing"
)

func TestErrorMessages(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want string
	}{
		{"range without index", &OperandOutOfRangeError{Index: -1, Reason: reasonMagnitude}, "absolute value must be less than 10^15"},
		{"range magnitude", &OperandOutOfRangeError{Index: 0, Reason: reasonMagnitude}, "operands[0] absolute value must be less than 10^15"},
		{"range digits", &OperandOutOfRangeError{Index: 1, Reason: reasonSignificantDigits}, "operands[1] has more than 15 significant digits"},
		{"range decimals", &OperandOutOfRangeError{Index: 2, Reason: reasonDecimalPlaces}, "operands[2] has more than 10 decimal places"},
		{"range exponent", &OperandOutOfRangeError{Index: 1, Reason: reasonExponentRange}, "operands[1] must be between -1000 and 1000"},
		{"invalid negative", &InvalidOperandError{Index: 0, Reason: reasonNegative}, "operands[0] must not be negative"},
		{"invalid integer", &InvalidOperandError{Index: 1, Reason: reasonNotInteger}, "operands[1] must be an integer"},
		{"result range", &ResultOutOfRangeError{}, "result would exceed 100 integer digits"},
		{"division by zero", &DivisionByZeroError{}, "division by zero"},
		{"count sqrt 0", &InvalidOperandCountError{Code: "sqrt", Expected: 1, Actual: 0}, "sqrt requires 1 operand, got 0"},
		{"count sqrt 2", &InvalidOperandCountError{Code: "sqrt", Expected: 1, Actual: 2}, "sqrt requires 1 operand, got 2"},
		{"count add 1", &InvalidOperandCountError{Code: "add", Expected: 2, Actual: 1}, "add requires 2 operands, got 1"},
		{"count divide 11", &InvalidOperandCountError{Code: "divide", Expected: 2, Actual: 11}, "divide requires 2 operands, got 11"},
		{"count percentage 0", &InvalidOperandCountError{Code: "percentage", Expected: 2, Actual: 0}, "percentage requires 2 operands, got 0"},
		{"count actual 1 not pluralized", &InvalidOperandCountError{Code: "add", Expected: 2, Actual: 1}, "add requires 2 operands, got 1"},
		{"unsupported", &UnsupportedOperationError{Code: "xxx"}, "unsupported operation: xxx"},
		{"unsupported empty", &UnsupportedOperationError{Code: ""}, "unsupported operation: "},
		{"unsupported uppercase", &UnsupportedOperationError{Code: "PERCENTAGE"}, "unsupported operation: PERCENTAGE"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.err.Error(); got != tt.want {
				t.Errorf("Error() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestUnsupportedOperationTruncation(t *testing.T) {
	a := func(n int) string { return strings.Repeat("a", n) }
	const prefix = "unsupported operation: "
	tests := []struct {
		name string
		code string
		want string
	}{
		{"32 units intact", a(32), a(32)},
		{"33 units cut", a(33), a(32) + "…"},
		{"code units not bytes", strings.Repeat("á", 40), strings.Repeat("á", 32) + "…"},
		{"32 bytes of 2-byte runes intact", strings.Repeat("á", 16), strings.Repeat("á", 16)},
		{"emoji ending at unit 32 intact", a(30) + "😀", a(30) + "😀"},
		{"emoji before cut kept", a(30) + "😀b", a(30) + "😀…"},
		// Java splits the surrogate pair and echoes a lone \uD83D. A Go string
		// cannot hold a lone surrogate, so the dangling half becomes U+FFFD
		// (what encoding/json would emit anyway); documented Level-B deviation.
		{"emoji crossing the limit", a(31) + "😀", a(31) + "�…"},
		{"emoji crossing the limit with tail", a(31) + "😀xyz", a(31) + "�…"},
		{"long input", a(100000), a(32) + "…"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := &UnsupportedOperationError{Code: tt.code}
			if got, want := err.Error(), prefix+tt.want; got != want {
				t.Errorf("Error() = %q, want %q", got, want)
			}
		})
	}
}

func TestWithIndexReturnsCopy(t *testing.T) {
	base := &OperandOutOfRangeError{Index: -1, Reason: reasonDecimalPlaces}
	indexed := base.WithIndex(3)
	if indexed == base {
		t.Fatal("WithIndex returned the receiver")
	}
	if base.Index != -1 {
		t.Errorf("receiver mutated: Index = %d", base.Index)
	}
	if indexed.Index != 3 || indexed.Reason != reasonDecimalPlaces {
		t.Errorf("WithIndex(3) = %+v", indexed)
	}
	if got, want := indexed.Error(), "operands[3] has more than 10 decimal places"; got != want {
		t.Errorf("Error() = %q, want %q", got, want)
	}
	// Re-indexing replaces the index; it never stacks prefixes.
	if got, want := indexed.WithIndex(0).Error(), "operands[0] has more than 10 decimal places"; got != want {
		t.Errorf("re-indexed Error() = %q, want %q", got, want)
	}
}

func TestErrorsAreDistinguishableWithAs(t *testing.T) {
	var err error = &DivisionByZeroError{}
	var dz *DivisionByZeroError
	if !errors.As(err, &dz) {
		t.Fatal("errors.As failed for DivisionByZeroError")
	}
	var rr *ResultOutOfRangeError
	if errors.As(err, &rr) {
		t.Fatal("DivisionByZeroError matched ResultOutOfRangeError")
	}
}
