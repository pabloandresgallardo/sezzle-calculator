package domain

import (
	"strings"
	"testing"
)

func TestLookupKnownCodes(t *testing.T) {
	tests := []struct {
		code  string
		arity int
	}{
		{"add", 2}, {"subtract", 2}, {"multiply", 2}, {"divide", 2},
		{"power", 2}, {"sqrt", 1}, {"percentage", 2},
	}
	for _, tt := range tests {
		t.Run(tt.code, func(t *testing.T) {
			op := lookup(t, tt.code)
			if op.Code != tt.code {
				t.Errorf("Code = %q, want %q", op.Code, tt.code)
			}
			if op.Arity != tt.arity {
				t.Errorf("Arity = %d, want %d", op.Arity, tt.arity)
			}
		})
	}
}

func TestLookupUnknownCodes(t *testing.T) {
	for _, code := range []string{"ADD", "PERCENTAGE", "Sqrt", "", "add ", " add", "xxx", "mod", "nope"} {
		t.Run(code, func(t *testing.T) {
			_, err := Lookup(code)
			wantErr[*UnsupportedOperationError](t, err, "unsupported operation: "+code)
			if got := err.(*UnsupportedOperationError).Code; got != code {
				t.Errorf("Code = %q, want raw %q", got, code)
			}
		})
	}
}

func TestApplyResults(t *testing.T) {
	tests := []struct {
		op       string
		operands []string
		want     string
	}{
		{"add", []string{"0.1", "0.2"}, "0.3"},
		{"add", []string{"1E+3", "1e-3"}, "1000.001"},
		{"add", []string{"999999999999999", "999999999999999"}, "1999999999999998"},
		{"add", []string{"0e-999999999", "1"}, "1"},
		{"subtract", []string{"5", "8"}, "-3"},
		{"subtract", []string{"-999999999999999", "999999999999999"}, "-1999999999999998"},
		{"subtract", []string{"0", "0"}, "0"},
		{"multiply", []string{"999999999999999", "999999999999999"}, "999999999999998000000000000001"},
		{"multiply", []string{"-2.5", "0"}, "0"},
		{"multiply", []string{"-0.0", "5"}, "0"},
		{"multiply", []string{"0.0000000001", "0.0000000001"}, "0.00000000000000000001"},
		{"divide", []string{"6", "3"}, "2"},
		{"divide", []string{"1", "3"}, "0.3333333333"},
		{"divide", []string{"2", "3"}, "0.6666666667"},
		{"divide", []string{"1", "8"}, "0.125"},
		{"divide", []string{"0.0000000001", "3"}, "0"},
		{"divide", []string{"-1", "3"}, "-0.3333333333"},
		{"divide", []string{"1", "20000000000"}, "0"},
		{"divide", []string{"3", "20000000000"}, "0.0000000002"},
		{"divide", []string{"5", "20000000000"}, "0.0000000002"},
		{"divide", []string{"-1", "20000000000"}, "0"},
		{"divide", []string{"0", "-5"}, "0"},
		{"divide", []string{"999999999999999", "0.0000000001"}, "9999999999999990000000000"},
		{"sqrt", []string{"2"}, "1.4142135624"},
		{"sqrt", []string{"16"}, "4"},
		{"sqrt", []string{"0.25"}, "0.5"},
		{"sqrt", []string{"3"}, "1.7320508076"},
		{"sqrt", []string{"0.0000000001"}, "0.00001"},
		{"sqrt", []string{"0.0000000002"}, "0.0000141421"},
		{"sqrt", []string{"999999999999999"}, "31622776.6016837775"},
		{"sqrt", []string{"0"}, "0"},
		{"sqrt", []string{"-0"}, "0"},
		{"power", []string{"2", "64"}, "18446744073709551616"},
		{"power", []string{"2", "-3"}, "0.125"},
		{"power", []string{"3", "-5"}, "0.0041152263"},
		{"power", []string{"-2", "-3"}, "-0.125"},
		{"power", []string{"-2", "-1"}, "-0.5"},
		{"power", []string{"1.5", "3"}, "3.375"},
		{"power", []string{"0.5", "10"}, "0.0009765625"},
		{"power", []string{"0.1234567891", "3"}, "0.0018816764"},
		{"power", []string{"-2", "3"}, "-8"},
		{"power", []string{"0.5", "11"}, "0.0004882812"},
		{"power", []string{"-0.5", "11"}, "-0.0004882812"},
		{"power", []string{"0", "0"}, "1"},
		{"power", []string{"0", "0.0"}, "1"},
		{"power", []string{"2", "-0"}, "1"},
		{"power", []string{"2", "2.0"}, "4"},
		{"power", []string{"1", "1000"}, "1"},
		{"power", []string{"1", "-1000"}, "1"},
		{"power", []string{"-1", "999"}, "-1"},
		{"power", []string{"-1", "-1000"}, "1"},
		{"power", []string{"0", "1000"}, "0"},
		{"power", []string{"10", "99"}, "1" + strings.Repeat("0", 99)},
		{"power", []string{"2", "332"}, "8749002899132047697490008908470485461412677723572849745703082425639811996797503692894052708092215296"},
		{"power", []string{"9.9999999999", "100"}, "9999999990000000004949999998383000000392122499924712480011920523998399243920186087894280977681917731.0309455024"},
		{"power", []string{"3", "-1000"}, "0"},
		{"power", []string{"2", "-1000"}, "0"},
		{"power", []string{"-3", "-999"}, "0"},
		{"power", []string{"10", "-11"}, "0"},
		{"power", []string{"-10", "-11"}, "0"},
		{"power", []string{"0.1", "11"}, "0"},
		{"power", []string{"10", "-10"}, "0.0000000001"},
		{"power", []string{"2", "-34"}, "0.0000000001"},
		{"power", []string{"1.0000000001", "1000"}, "1.0000001"},
		{"power", []string{"0.9999999999", "1000"}, "0.9999999"},
		{"power", []string{"999999999999999", "6"}, "999999999999994000000000000014999999999999980000000000000014999999999999994000000000000001"},
		{"percentage", []string{"20", "150"}, "30"},
		{"percentage", []string{"12.5", "80"}, "10"},
		{"percentage", []string{"0.1", "0.1"}, "0.0001"},
		{"percentage", []string{"-15", "200"}, "-30"},
		{"percentage", []string{"0", "-5"}, "0"},
		{"percentage", []string{"-0.0000000001", "0.0000000001"}, "-0.0000000000000000000001"},
		{"percentage", []string{"999999999999999", "999999999999999"}, "9999999999999980000000000000.01"},
	}
	for _, tt := range tests {
		t.Run(tt.op+"/"+strings.Join(tt.operands, ","), func(t *testing.T) {
			op := lookup(t, tt.op)
			ops := operands(t, tt.operands...)
			if err := op.Validate(ops); err != nil {
				t.Fatalf("Validate: %v", err)
			}
			got, err := op.Apply(ops)
			if err != nil {
				t.Fatalf("Apply: %v", err)
			}
			if f := formatted(got); f != tt.want {
				t.Errorf("result = %s, want %s", f, tt.want)
			}
		})
	}
}

func TestDivideByZero(t *testing.T) {
	for _, divisor := range []string{"0", "-0", "-0.000", "0e-999999999"} {
		t.Run(divisor, func(t *testing.T) {
			_, err := lookup(t, "divide").Apply(operands(t, "5", divisor))
			wantErr[*DivisionByZeroError](t, err, "division by zero")
		})
	}
}

func TestSqrtValidate(t *testing.T) {
	sqrt := lookup(t, "sqrt")
	err := sqrt.Validate(operands(t, "-4"))
	wantErr[*InvalidOperandError](t, err, "operands[0] must not be negative")

	// Apply re-validates on its own.
	_, err = sqrt.Apply(operands(t, "-0.0000000001"))
	wantErr[*InvalidOperandError](t, err, "operands[0] must not be negative")
}

func TestPowerValidate(t *testing.T) {
	tests := []struct {
		name     string
		operands []string
		check    func(*testing.T, error)
	}{
		{"fractional exponent", []string{"2", "0.5"}, func(t *testing.T, err error) {
			wantErr[*InvalidOperandError](t, err, "operands[1] must be an integer")
		}},
		{"integer check before range", []string{"2", "1000.5"}, func(t *testing.T, err error) {
			wantErr[*InvalidOperandError](t, err, "operands[1] must be an integer")
		}},
		{"exponent above range", []string{"2", "1001"}, func(t *testing.T, err error) {
			wantErr[*OperandOutOfRangeError](t, err, "operands[1] must be between -1000 and 1000")
		}},
		{"exponent below range", []string{"2", "-1001"}, func(t *testing.T, err error) {
			wantErr[*OperandOutOfRangeError](t, err, "operands[1] must be between -1000 and 1000")
		}},
		{"exponent with negative scale above range", []string{"2", "1E+14"}, func(t *testing.T, err error) {
			wantErr[*OperandOutOfRangeError](t, err, "operands[1] must be between -1000 and 1000")
		}},
		// The cost bound is decided by Validate alone, without computing.
		{"huge base", []string{"999999999999999", "1000"}, func(t *testing.T, err error) {
			wantErr[*ResultOutOfRangeError](t, err, "result would exceed 100 integer digits")
		}},
		{"tiny base negative exponent", []string{"0.5", "-1000"}, func(t *testing.T, err error) {
			wantErr[*ResultOutOfRangeError](t, err, "result would exceed 100 integer digits")
		}},
		{"rounds to zero is valid", []string{"3", "-1000"}, func(t *testing.T, err error) {
			if err != nil {
				t.Fatalf("Validate: %v", err)
			}
		}},
		{"edge exponents valid", []string{"2", "-1000"}, func(t *testing.T, err error) {
			if err != nil {
				t.Fatalf("Validate: %v", err)
			}
		}},
		{"zero base negative exponent passes validate", []string{"0", "-1"}, func(t *testing.T, err error) {
			if err != nil {
				t.Fatalf("Validate: %v", err)
			}
		}},
	}
	power := lookup(t, "power")
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.check(t, power.Validate(operands(t, tt.operands...)))
		})
	}
}

func TestPowerApplyErrors(t *testing.T) {
	power := lookup(t, "power")
	tests := []struct {
		name     string
		operands []string
		check    func(*testing.T, error)
	}{
		{"zero base negative exponent", []string{"0", "-1"}, func(t *testing.T, err error) {
			wantErr[*DivisionByZeroError](t, err, "division by zero")
		}},
		{"zero base min exponent", []string{"0", "-1000"}, func(t *testing.T, err error) {
			wantErr[*DivisionByZeroError](t, err, "division by zero")
		}},
		{"exact check 10^100", []string{"10", "100"}, func(t *testing.T, err error) {
			wantErr[*ResultOutOfRangeError](t, err, "result would exceed 100 integer digits")
		}},
		{"exact check -10^101", []string{"-10", "101"}, func(t *testing.T, err error) {
			wantErr[*ResultOutOfRangeError](t, err, "result would exceed 100 integer digits")
		}},
		{"exact check 2^333", []string{"2", "333"}, func(t *testing.T, err error) {
			wantErr[*ResultOutOfRangeError](t, err, "result would exceed 100 integer digits")
		}},
		// Apply re-validates: the cost bound is never skipped.
		{"revalidates estimate", []string{"999999999999999", "1000"}, func(t *testing.T, err error) {
			wantErr[*ResultOutOfRangeError](t, err, "result would exceed 100 integer digits")
		}},
		{"revalidates integer", []string{"2", "0.5"}, func(t *testing.T, err error) {
			wantErr[*InvalidOperandError](t, err, "operands[1] must be an integer")
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := power.Apply(operands(t, tt.operands...))
			tt.check(t, err)
		})
	}
}

func TestValidateAndApplyCheckArity(t *testing.T) {
	tests := []struct {
		op       string
		operands []string
		want     string
	}{
		{"add", []string{"1"}, "add requires 2 operands, got 1"},
		{"divide", nil, "divide requires 2 operands, got 0"},
		{"power", []string{"1", "2", "3"}, "power requires 2 operands, got 3"},
		{"sqrt", []string{"1", "2"}, "sqrt requires 1 operand, got 2"},
		{"sqrt", nil, "sqrt requires 1 operand, got 0"},
	}
	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			op := lookup(t, tt.op)
			ops := operands(t, tt.operands...)
			wantErr[*InvalidOperandCountError](t, op.Validate(ops), tt.want)
			_, err := op.Apply(ops)
			wantErr[*InvalidOperandCountError](t, err, tt.want)
		})
	}
}

func TestLookupReturnsIndependentCopies(t *testing.T) {
	op := lookup(t, "add")
	op.Code = "mutated"
	op.Arity = 9
	again := lookup(t, "add")
	if again.Code != "add" || again.Arity != 2 {
		t.Fatalf("registry mutated through a returned value: %+v", again)
	}
}
