package domain

import (
	"strconv"
	"unicode/utf16"
	"unicode/utf8"
)

// Reasons of OperandOutOfRangeError and InvalidOperandError; the Error()
// texts are contract (Java reference §3.3).
const (
	reasonMagnitude         = "absolute value must be less than 10^15"
	reasonSignificantDigits = "has more than 15 significant digits"
	reasonDecimalPlaces     = "has more than 10 decimal places"
	reasonExponentRange     = "must be between -1000 and 1000"
	reasonNegative          = "must not be negative"
	reasonNotInteger        = "must be an integer"
)

// maxEchoedCodeUnits is how many UTF-16 code units of an unknown operation
// code are echoed back, like Java's String.length().
const maxEchoedCodeUnits = 32

// OperandOutOfRangeError reports an operand outside the domain limits.
// Index is -1 while the operand position is unknown (NewOperand); the
// pipeline attaches it with WithIndex.
type OperandOutOfRangeError struct {
	Index  int
	Reason string
}

func (e *OperandOutOfRangeError) Error() string {
	return indexed(e.Index, e.Reason)
}

// WithIndex returns a copy of e that reports operand i. The receiver is not
// modified, and re-indexing replaces the index instead of stacking prefixes.
func (e *OperandOutOfRangeError) WithIndex(i int) *OperandOutOfRangeError {
	return &OperandOutOfRangeError{Index: i, Reason: e.Reason}
}

// InvalidOperandError reports an in-range operand an operation cannot take
// (negative sqrt argument, non-integer exponent).
type InvalidOperandError struct {
	Index  int
	Reason string
}

func (e *InvalidOperandError) Error() string {
	return indexed(e.Index, e.Reason)
}

// InvalidOperandCountError reports an operand count that does not match the
// operation's arity. Code is the canonical (lowercase) operation code.
type InvalidOperandCountError struct {
	Code     string
	Expected int
	Actual   int
}

func (e *InvalidOperandCountError) Error() string {
	noun := " operands"
	if e.Expected == 1 {
		noun = " operand"
	}
	return e.Code + " requires " + strconv.Itoa(e.Expected) + noun + ", got " + strconv.Itoa(e.Actual)
}

// UnsupportedOperationError reports an unknown operation code. Code is the
// raw received string; Error() echoes at most its first 32 UTF-16 code units.
type UnsupportedOperationError struct {
	Code string
}

func (e *UnsupportedOperationError) Error() string {
	return "unsupported operation: " + truncateCode(e.Code)
}

// DivisionByZeroError reports a zero divisor (divide, or power with base 0
// and a negative exponent).
type DivisionByZeroError struct{}

func (e *DivisionByZeroError) Error() string { return "division by zero" }

// ResultOutOfRangeError reports a power result over 100 integer digits.
type ResultOutOfRangeError struct{}

func (e *ResultOutOfRangeError) Error() string { return "result would exceed 100 integer digits" }

func indexed(index int, reason string) string {
	if index < 0 {
		return reason
	}
	return "operands[" + strconv.Itoa(index) + "] " + reason
}

// truncateCode mirrors Java's code.substring(0, 32) + "…" when the code is
// longer than 32 UTF-16 code units. When the cut splits a surrogate pair,
// Java keeps a lone high surrogate; a Go string cannot hold one, so that
// half becomes U+FFFD (a documented deviation). An invalid UTF-8 byte
// ranges as RuneError and counts as one unit (it cannot come from the JSON
// decoder, which yields valid UTF-8).
func truncateCode(code string) string {
	// UTF-16 units never exceed UTF-8 bytes, so short strings are intact.
	if len(code) <= maxEchoedCodeUnits {
		return code
	}
	units := 0
	for i, r := range code {
		// 1 or 2: ranging a string never yields a surrogate or an invalid rune.
		n := utf16.RuneLen(r)
		if units+n > maxEchoedCodeUnits {
			if units == maxEchoedCodeUnits {
				return code[:i] + "…"
			}
			// Only a surrogate pair (2 units) can overshoot by one.
			return code[:i] + string(utf8.RuneError) + "…"
		}
		units += n
	}
	return code
}
