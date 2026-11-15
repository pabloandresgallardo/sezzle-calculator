package domain

import "github.com/pabloandresgallardo/sezzle-calculator/backend/go/internal/decimal"

// resultScale is the scale divide, sqrt and power round to (HALF_EVEN).
const resultScale = 10

var (
	one         = decimal.FromInt64(1)
	minExponent = decimal.FromInt64(-1000)
	maxExponent = decimal.FromInt64(1000)
)

// Operation is one calculator operation, a strategy over its operands.
// Callers check Arity, then call Validate and finally Apply. Operands must
// come from NewOperand (normalized, within limits).
type Operation struct {
	Code  string
	Arity int

	validate func([]Operand) error                    // nil: any in-range operand is fine
	apply    func([]Operand) (decimal.Decimal, error) // runs after validate
}

// Validate runs the operation-specific checks that follow the generic
// Operand bounds (sqrt: not negative; power: integer exponent, exponent
// range, cost estimate). A wrong operand count is an
// *InvalidOperandCountError.
func (op Operation) Validate(operands []Operand) error {
	if len(operands) != op.Arity {
		return &InvalidOperandCountError{Code: op.Code, Expected: op.Arity, Actual: len(operands)}
	}
	if op.validate == nil {
		return nil
	}
	return op.validate(operands)
}

// Apply computes the result. It re-runs Validate first, so it is safe on its
// own: the power cost bound can never be skipped.
func (op Operation) Apply(operands []Operand) (decimal.Decimal, error) {
	if err := op.Validate(operands); err != nil {
		return decimal.Decimal{}, err
	}
	return op.apply(operands)
}

var operations = map[string]Operation{
	"add": {Code: "add", Arity: 2, apply: func(o []Operand) (decimal.Decimal, error) {
		return left(o).Add(right(o)), nil
	}},
	"subtract": {Code: "subtract", Arity: 2, apply: func(o []Operand) (decimal.Decimal, error) {
		return left(o).Sub(right(o)), nil
	}},
	"multiply": {Code: "multiply", Arity: 2, apply: func(o []Operand) (decimal.Decimal, error) {
		return left(o).Mul(right(o)), nil
	}},
	"divide":     {Code: "divide", Arity: 2, apply: applyDivide},
	"power":      {Code: "power", Arity: 2, validate: validatePower, apply: applyPower},
	"sqrt":       {Code: "sqrt", Arity: 1, validate: validateSqrt, apply: applySqrt},
	"percentage": {Code: "percentage", Arity: 2, apply: applyPercentage},
}

// Lookup returns the operation with exactly this code (case-sensitive), or
// an *UnsupportedOperationError carrying the raw code.
func Lookup(code string) (Operation, error) {
	op, ok := operations[code]
	if !ok {
		return Operation{}, &UnsupportedOperationError{Code: code}
	}
	return op, nil
}

func left(o []Operand) decimal.Decimal  { return o[0].value }
func right(o []Operand) decimal.Decimal { return o[1].value }

func applyDivide(o []Operand) (decimal.Decimal, error) {
	divisor := right(o)
	if divisor.Signum() == 0 {
		return decimal.Decimal{}, &DivisionByZeroError{}
	}
	return left(o).QuoScale(divisor, resultScale), nil
}

func validateSqrt(o []Operand) error {
	if left(o).Signum() < 0 {
		return &InvalidOperandError{Index: 0, Reason: reasonNegative}
	}
	return nil
}

func applySqrt(o []Operand) (decimal.Decimal, error) {
	// Single exact HALF_EVEN rounding; equals Java's
	// sqrt(DECIMAL128).setScale(10, HALF_EVEN) for in-limit operands.
	return left(o).Sqrt(resultScale), nil
}

func validatePower(o []Operand) error {
	exponent := right(o)
	// Operands are normalized, so an integer has a non-positive scale.
	if exponent.Scale() > 0 {
		return &InvalidOperandError{Index: 1, Reason: reasonNotInteger}
	}
	if exponent.Cmp(minExponent) < 0 || exponent.Cmp(maxExponent) > 0 {
		return &OperandOutOfRangeError{Index: 1, Reason: reasonExponentRange}
	}
	if estimatePower(left(o), exponentInt(o)) == estimateTooLarge {
		return &ResultOutOfRangeError{}
	}
	return nil
}

func applyPower(o []Operand) (decimal.Decimal, error) {
	base, exponent := left(o), exponentInt(o)
	if estimatePower(base, exponent) == estimateRoundsToZero {
		return decimal.Decimal{}, nil
	}
	var result decimal.Decimal
	if exponent >= 0 {
		result = base.PowInt(exponent).SetScale(resultScale)
	} else {
		if base.Signum() == 0 {
			return decimal.Decimal{}, &DivisionByZeroError{}
		}
		result = one.QuoScale(base.PowInt(-exponent), resultScale)
	}
	if err := requireWithinIntegerDigits(result); err != nil {
		return decimal.Decimal{}, err
	}
	return result, nil
}

// exponentInt returns the power exponent; validatePower guarantees it is an
// integer in [-1000, 1000].
func exponentInt(o []Operand) int {
	e, _ := right(o).Int()
	return e
}

func applyPercentage(o []Operand) (decimal.Decimal, error) {
	return left(o).Mul(right(o)).MovePointLeft(2), nil
}
