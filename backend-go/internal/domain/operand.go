// Package domain holds the calculator's business rules: operand limits, the
// seven operations, the power cost bound and the typed errors whose messages
// are part of the HTTP contract. It mirrors the Java backend's
// domain.model and domain.exception packages.
package domain

import "github.com/pabloandresgallardo/sezzle-calculator/backend-go/internal/decimal"

const (
	maxIntegerDigits     = 15
	maxSignificantDigits = 15
	maxDecimalPlaces     = 10
)

// Operand is a value within the domain limits, stored normalized
// (StripTrailingZeros). The zero value is the operand 0.
type Operand struct {
	value decimal.Decimal
}

// NewOperand checks v against the limits in Java's order: magnitude first
// (cheap on the raw value: precision − scale, no expansion), then
// significant digits and decimal places on the normalized value. Errors are
// *OperandOutOfRangeError with Index -1.
//
// Only Signum, Precision, Scale and StripTrailingZeros touch the raw value:
// arithmetic on a raw extreme like 0e-999999999 would materialize 10^n.
func NewOperand(v decimal.Decimal) (Operand, error) {
	if v.Signum() != 0 && int64(v.Precision())-int64(v.Scale()) > maxIntegerDigits {
		return Operand{}, outOfRange(reasonMagnitude)
	}
	// Cannot panic: with the magnitude bound, the stripped scale stays > -15.
	n := v.StripTrailingZeros()
	if n.Precision() > maxSignificantDigits {
		return Operand{}, outOfRange(reasonSignificantDigits)
	}
	if n.Scale() > maxDecimalPlaces {
		return Operand{}, outOfRange(reasonDecimalPlaces)
	}
	return Operand{value: n}, nil
}

// Value returns the normalized value.
func (o Operand) Value() decimal.Decimal { return o.value }

func outOfRange(reason string) *OperandOutOfRangeError {
	return &OperandOutOfRangeError{Index: -1, Reason: reason}
}
