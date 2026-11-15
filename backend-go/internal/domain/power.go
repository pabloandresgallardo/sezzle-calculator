package domain

import "github.com/pabloandresgallardo/sezzle-calculator/backend-go/internal/decimal"

// powerEstimate is the outcome of the cheap log estimate for base^e
// (Java's PowerBounds.Estimate).
type powerEstimate int

const (
	estimateCompute powerEstimate = iota
	estimateTooLarge
	estimateRoundsToZero
)

const (
	maxResultIntegerDigits = 100
	// One digit of margin over the limit covers the error of the float64
	// estimate.
	tooLargeLog10 = maxResultIntegerDigits + 1
	// Below 10^-11 the result rounds to 0 at the 10-decimal result scale.
	roundsToZeroLog10 = -11
)

// estimatePower decides from L = e × log10|base| whether base^e is worth
// computing. |base| of 0 or 1 is trivial to compute and has no useful log.
// base is a normalized operand, so its unscaled value (≤ 15 digits) is
// exact as a float64.
func estimatePower(base decimal.Decimal, exponent int) powerEstimate {
	magnitude := base.Abs()
	if magnitude.Signum() == 0 || magnitude.Cmp(one) == 0 {
		return estimateCompute
	}
	resultLog10 := float64(exponent) * magnitude.Log10Abs()
	switch {
	case resultLog10 > tooLargeLog10:
		return estimateTooLarge
	case resultLog10 < roundsToZeroLog10:
		return estimateRoundsToZero
	default:
		return estimateCompute
	}
}

// requireWithinIntegerDigits is the exact check on a computed power result.
func requireWithinIntegerDigits(result decimal.Decimal) error {
	if int64(result.Precision())-int64(result.Scale()) > maxResultIntegerDigits {
		return &ResultOutOfRangeError{}
	}
	return nil
}
