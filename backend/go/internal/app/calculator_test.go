package app

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/pabloandresgallardo/sezzle-calculator/backend/go/internal/decimal"
	"github.com/pabloandresgallardo/sezzle-calculator/backend/go/internal/domain"
)

func command(t *testing.T, op string, literals ...string) Command {
	t.Helper()
	values := make([]decimal.Decimal, len(literals))
	for i, l := range literals {
		d, err := decimal.Parse(l)
		if err != nil {
			t.Fatalf("decimal.Parse(%q): %v", l, err)
		}
		values[i] = d
	}
	return Command{Operation: op, Operands: values}
}

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

// Success rows of "Ejemplos" in the basic-operations and optional-operations specs.
func TestCalculateExamples(t *testing.T) {
	tests := []struct {
		op       string
		operands []string
		want     string
	}{
		// basic-operations
		{"add", []string{"0.1", "0.2"}, "0.3"},
		{"subtract", []string{"5", "8"}, "-3"},
		{"multiply", []string{"999999999999999", "999999999999999"}, "999999999999998000000000000001"},
		{"multiply", []string{"-2.5", "0"}, "0"},
		{"divide", []string{"6", "3"}, "2"},
		{"divide", []string{"1", "3"}, "0.3333333333"},
		{"divide", []string{"2", "3"}, "0.6666666667"},
		{"divide", []string{"1", "8"}, "0.125"},
		{"divide", []string{"0.0000000001", "3"}, "0"},
		// optional-operations
		{"sqrt", []string{"2"}, "1.4142135624"},
		{"sqrt", []string{"16"}, "4"},
		{"sqrt", []string{"0.25"}, "0.5"},
		{"sqrt", []string{"3"}, "1.7320508076"},
		{"sqrt", []string{"0.0000000001"}, "0.00001"},
		{"sqrt", []string{"999999999999999"}, "31622776.6016837775"},
		{"sqrt", []string{"0"}, "0"},
		{"power", []string{"2", "64"}, "18446744073709551616"},
		{"power", []string{"2", "-3"}, "0.125"},
		{"power", []string{"3", "-5"}, "0.0041152263"},
		{"power", []string{"1.5", "3"}, "3.375"},
		{"power", []string{"0.5", "10"}, "0.0009765625"},
		{"power", []string{"0.1234567891", "3"}, "0.0018816764"},
		{"power", []string{"-2", "3"}, "-8"},
		{"power", []string{"0", "0"}, "1"},
		{"power", []string{"10", "99"}, "1" + strings.Repeat("0", 99)},
		{"power", []string{"3", "-1000"}, "0"},
		{"percentage", []string{"20", "150"}, "30"},
		{"percentage", []string{"12.5", "80"}, "10"},
		{"percentage", []string{"0.1", "0.1"}, "0.0001"},
		{"percentage", []string{"-15", "200"}, "-30"},
		// normalized storage: a zero with a huge raw scale costs nothing
		{"add", []string{"0e-999999999", "1"}, "1"},
		{"sqrt", []string{"0e-999999999"}, "0"},
	}
	for _, tt := range tests {
		t.Run(tt.op+"/"+strings.Join(tt.operands, ","), func(t *testing.T) {
			res, err := Calculate(command(t, tt.op, tt.operands...))
			if err != nil {
				t.Fatalf("Calculate: %v", err)
			}
			if res.Operation != tt.op {
				t.Errorf("Operation = %q, want %q", res.Operation, tt.op)
			}
			if got := res.Formatted(); got != tt.want {
				t.Errorf("Formatted() = %s, want %s", got, tt.want)
			}
		})
	}
}

// Error rows of "Ejemplos" plus the validation-order cases of the Java reference §3.1.
func TestCalculateErrors(t *testing.T) {
	type check func(*testing.T, error)
	unsupported := func(msg string) check {
		return func(t *testing.T, err error) { wantErr[*domain.UnsupportedOperationError](t, err, msg) }
	}
	count := func(msg string) check {
		return func(t *testing.T, err error) { wantErr[*domain.InvalidOperandCountError](t, err, msg) }
	}
	outOfRange := func(msg string) check {
		return func(t *testing.T, err error) { wantErr[*domain.OperandOutOfRangeError](t, err, msg) }
	}
	invalid := func(msg string) check {
		return func(t *testing.T, err error) { wantErr[*domain.InvalidOperandError](t, err, msg) }
	}
	divByZero := func(t *testing.T, err error) {
		wantErr[*domain.DivisionByZeroError](t, err, "division by zero")
	}
	resultRange := func(t *testing.T, err error) {
		wantErr[*domain.ResultOutOfRangeError](t, err, "result would exceed 100 integer digits")
	}

	tests := []struct {
		name     string
		op       string
		operands []string
		check    check
	}{
		// basic-operations
		{"divide by zero", "divide", []string{"5", "0"}, divByZero},
		{"huge operand", "add", []string{"1e999999999", "0.1"}, outOfRange("operands[0] absolute value must be less than 10^15")},
		{"16 digits", "add", []string{"1234567890123456", "1"}, outOfRange("operands[0] absolute value must be less than 10^15")},
		{"11 decimals", "add", []string{"0.12345678901", "1"}, outOfRange("operands[0] has more than 10 decimal places")},
		{"index from 0", "add", []string{"1", "999999999999999.9"}, outOfRange("operands[1] has more than 15 significant digits")},
		{"three operands", "add", []string{"1", "2", "3"}, count("add requires 2 operands, got 3")},
		{"uppercase ADD", "ADD", []string{"1", "2"}, unsupported("unsupported operation: ADD")},
		{"range before division by zero", "divide", []string{"1e999999999", "0"}, outOfRange("operands[0] absolute value must be less than 10^15")},
		// basic-operations listed "power [1,2,3]" as Unsupported (iteration 1);
		// since power exists it is an arity error, as in Java today.
		{"power three operands", "power", []string{"1", "2", "3"}, count("power requires 2 operands, got 3")},
		// optional-operations
		{"sqrt negative", "sqrt", []string{"-4"}, invalid("operands[0] must not be negative")},
		{"sqrt two operands", "sqrt", []string{"1", "2"}, count("sqrt requires 1 operand, got 2")},
		{"sqrt no operands", "sqrt", nil, count("sqrt requires 1 operand, got 0")},
		{"sqrt huge", "sqrt", []string{"1e999999999"}, outOfRange("operands[0] absolute value must be less than 10^15")},
		{"power 10^100", "power", []string{"10", "100"}, resultRange},
		{"power huge base", "power", []string{"999999999999999", "1000"}, resultRange},
		{"power 0.5^-1000", "power", []string{"0.5", "-1000"}, resultRange},
		{"power fractional exponent", "power", []string{"2", "0.5"}, invalid("operands[1] must be an integer")},
		{"power integer check before range", "power", []string{"2", "1000.5"}, invalid("operands[1] must be an integer")},
		{"power exponent range", "power", []string{"2", "1001"}, outOfRange("operands[1] must be between -1000 and 1000")},
		{"power zero base negative exponent", "power", []string{"0", "-1"}, divByZero},
		{"uppercase PERCENTAGE", "PERCENTAGE", []string{"20", "150"}, unsupported("unsupported operation: PERCENTAGE")},
		// reference §3.1 order examples
		{"lookup before arity", "xxx", []string{"1e999999999"}, unsupported("unsupported operation: xxx")},
		{"arity before range", "add", []string{"1e999999999"}, count("add requires 2 operands, got 1")},
		{"sqrt range before negative", "sqrt", []string{"-1e999999999"}, outOfRange("operands[0] absolute value must be less than 10^15")},
		{"power base range first", "power", []string{"1e999999999", "0.5"}, outOfRange("operands[0] absolute value must be less than 10^15")},
		{"power exponent generic range", "power", []string{"2", "1e999999999"}, outOfRange("operands[1] absolute value must be less than 10^15")},
		{"first bad operand wins", "add", []string{"0.12345678901", "1e999999999"}, outOfRange("operands[0] has more than 10 decimal places")},
		{"digits before decimals", "add", []string{"0.1234567890123456", "1"}, outOfRange("operands[0] has more than 15 significant digits")},
		{"divide by raw zero with huge scale", "divide", []string{"1", "0e-999999999"}, divByZero},
		{"empty operation code", "", []string{"1", "2"}, unsupported("unsupported operation: ")},
		{"truncated code", strings.Repeat("a", 33), []string{"1", "2"}, unsupported("unsupported operation: " + strings.Repeat("a", 32) + "…")},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, err := Calculate(command(t, tt.op, tt.operands...))
			if err == nil {
				t.Fatalf("Calculate = %q, want error", res.Formatted())
			}
			tt.check(t, err)
		})
	}
}

func TestCalculateIndexesOperandErrors(t *testing.T) {
	_, err := Calculate(command(t, "multiply", "1", "1e-11"))
	var oor *domain.OperandOutOfRangeError
	if !errors.As(err, &oor) {
		t.Fatalf("error = %v, want *OperandOutOfRangeError", err)
	}
	if oor.Index != 1 || oor.Reason != "has more than 10 decimal places" {
		t.Errorf("error = %+v", oor)
	}
}

// The extreme cases must be decided without expanding 10^n or computing huge powers.
func TestCalculateExtremesAreCheap(t *testing.T) {
	cases := []Command{
		command(t, "divide", "1e999999999", "0"),
		command(t, "add", "1", "1e-999999999"),
		command(t, "add", "0e-999999999", "0e999999999"),
		command(t, "power", "999999999999999", "1000"),
		command(t, "power", "0.5", "-1000"),
		command(t, "power", "3", "-1000"),
		command(t, "power", "0.9999999999", "1000"),
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for _, c := range cases {
			_, _ = Calculate(c)
		}
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("extreme cases took longer than 10s")
	}
}

func TestResultFormatted(t *testing.T) {
	d, err := decimal.Parse("1.2300000000")
	if err != nil {
		t.Fatal(err)
	}
	if got := (Result{Operation: "add", Value: d}).Formatted(); got != "1.23" {
		t.Errorf("Formatted() = %q, want 1.23", got)
	}
	var zero Result
	if got := zero.Formatted(); got != "0" {
		t.Errorf("zero Formatted() = %q, want 0", got)
	}
}
