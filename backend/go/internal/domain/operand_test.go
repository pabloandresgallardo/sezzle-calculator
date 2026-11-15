package domain

import (
	"testing"
)

func TestNewOperandAccepts(t *testing.T) {
	// Boundaries from the Java reference §5.1, with the normalized value.
	tests := []struct {
		literal   string
		wantPlain string
		wantScale int32
	}{
		{"999999999999999", "999999999999999", 0},
		{"-999999999999999", "-999999999999999", 0},
		{"999999999999999.0", "999999999999999", 0},
		{"9.99999999999999e14", "999999999999999", 0},
		{"9.9999999999999e14", "999999999999990", -1},
		{"1000000000000000e-1", "100000000000000", -14},
		{"12345678901.2345", "12345678901.2345", 4},
		{"0.00000000010", "0.0000000001", 10},
		{"1e-10", "0.0000000001", 10},
		{"10e-11", "0.0000000001", 10},
		{"1.00000000000000000000", "1", 0},
		{"123456789012345.0000000000", "123456789012345", 0},
		{"1E+14", "100000000000000", -14},
		{"0", "0", 0},
		{"-0", "0", 0},
		{"-0.000", "0", 0},
		// Zero is exempt from the magnitude check and normalizes to scale 0,
		// so a huge raw scale never reaches the arithmetic.
		{"0e-999999999", "0", 0},
		{"0e999999999", "0", 0},
		{"0.1234567891", "0.1234567891", 10},
	}
	for _, tt := range tests {
		t.Run(tt.literal, func(t *testing.T) {
			o, err := NewOperand(dec(t, tt.literal))
			if err != nil {
				t.Fatalf("NewOperand: %v", err)
			}
			if got := o.Value().PlainString(); got != tt.wantPlain {
				t.Errorf("value = %s, want %s", got, tt.wantPlain)
			}
			if got := o.Value().Scale(); got != tt.wantScale {
				t.Errorf("scale = %d, want %d (normalized)", got, tt.wantScale)
			}
		})
	}
}

func TestNewOperandRejects(t *testing.T) {
	tests := []struct {
		literal string
		reason  string
	}{
		{"1e15", reasonMagnitude},
		{"-1000000000000000", reasonMagnitude},
		{"1000000000000000.0", reasonMagnitude},
		{"1234567890123456", reasonMagnitude}, // magnitude wins over digits
		{"1e999999999", reasonMagnitude},
		{"-1e999999999", reasonMagnitude},
		{"999999999999999.9", reasonSignificantDigits},
		{"1234567890123456e-5", reasonSignificantDigits},
		{"0.1234567890123456", reasonSignificantDigits}, // digits before decimals
		{"0.00000000001", reasonDecimalPlaces},
		{"1e-11", reasonDecimalPlaces},
		{"0.12345678901", reasonDecimalPlaces},
		{"1e-999999999", reasonDecimalPlaces},
	}
	for _, tt := range tests {
		t.Run(tt.literal, func(t *testing.T) {
			_, err := NewOperand(dec(t, tt.literal))
			wantErr[*OperandOutOfRangeError](t, err, tt.reason)
			if got := err.(*OperandOutOfRangeError).Index; got != -1 {
				t.Errorf("Index = %d, want -1", got)
			}
		})
	}
}

func TestOperandZeroValueIsZero(t *testing.T) {
	var o Operand
	if o.Value().Signum() != 0 {
		t.Fatalf("zero Operand value = %s", o.Value().PlainString())
	}
}
