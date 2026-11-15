// Package app is the calculate use case: it runs the validation pipeline of
// the Java CalculatorService over the domain package.
package app

import (
	"errors"

	"github.com/pabloandresgallardo/sezzle-calculator/backend-go/internal/decimal"
	"github.com/pabloandresgallardo/sezzle-calculator/backend-go/internal/domain"
)

// Command is a parsed calculate request. Operands are raw parsed values
// (not yet checked against the domain limits).
type Command struct {
	Operation string
	Operands  []decimal.Decimal
}

// Result is a successful calculation.
type Result struct {
	Operation string // canonical operation code
	Value     decimal.Decimal
}

// Formatted renders Value like Java's stripTrailingZeros().toPlainString():
// no exponent, no trailing fraction zeros, and every zero is "0".
func (r Result) Formatted() string {
	return r.Value.StripTrailingZeros().PlainString()
}

// Calculate runs the pipeline in Java's order; the first error wins:
// Lookup → arity → NewOperand per index (range errors get the index) →
// Validate → Apply. Every error is one of the domain error types.
func Calculate(cmd Command) (Result, error) {
	op, err := domain.Lookup(cmd.Operation)
	if err != nil {
		return Result{}, err
	}
	if len(cmd.Operands) != op.Arity {
		return Result{}, &domain.InvalidOperandCountError{Code: op.Code, Expected: op.Arity, Actual: len(cmd.Operands)}
	}
	operands := make([]domain.Operand, len(cmd.Operands))
	for i, v := range cmd.Operands {
		o, err := domain.NewOperand(v)
		if err != nil {
			if oor, ok := errors.AsType[*domain.OperandOutOfRangeError](err); ok {
				err = oor.WithIndex(i)
			}
			return Result{}, err
		}
		operands[i] = o
	}
	if err := op.Validate(operands); err != nil {
		return Result{}, err
	}
	value, err := op.Apply(operands)
	if err != nil {
		return Result{}, err
	}
	return Result{Operation: op.Code, Value: value}, nil
}
