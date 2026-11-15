package domain

import (
	"strings"
	"testing"
)

func TestPowerEstimate(t *testing.T) {
	tests := []struct {
		base     string
		exponent int
		want     powerEstimate
	}{
		{"0", 1000, estimateCompute},
		{"0", -1000, estimateCompute},
		{"1", 1000, estimateCompute},
		{"-1", -1000, estimateCompute},
		{"10", 99, estimateCompute},
		{"10", 100, estimateCompute},  // L = 100: computed, rejected by the exact check
		{"-10", 101, estimateCompute}, // L = 101 is not > 101
		{"10", 102, estimateTooLarge},
		{"2", 333, estimateCompute}, // L ≈ 100.24
		{"999999999999999", 1000, estimateTooLarge},
		{"0.5", -1000, estimateTooLarge},
		{"0.0000000001", -11, estimateTooLarge},
		{"3", -1000, estimateRoundsToZero},
		{"2", -1000, estimateRoundsToZero},
		{"-3", -999, estimateRoundsToZero},
		{"10", -11, estimateCompute}, // L = -11 is not < -11
		{"10", -12, estimateRoundsToZero},
		{"0.1", 11, estimateCompute},
		{"0.1", 12, estimateRoundsToZero},
		{"2", 0, estimateCompute},
		{"0.9999999999", 1000, estimateCompute},
	}
	for _, tt := range tests {
		t.Run(tt.base, func(t *testing.T) {
			base := operands(t, tt.base)[0].Value()
			if got := estimatePower(base, tt.exponent); got != tt.want {
				t.Errorf("estimatePower(%s, %d) = %v, want %v", tt.base, tt.exponent, got, tt.want)
			}
		})
	}
}

func TestRequireWithinIntegerDigits(t *testing.T) {
	ok := dec(t, "1"+strings.Repeat("0", 99)+".0000000000") // 100 integer digits
	if err := requireWithinIntegerDigits(ok); err != nil {
		t.Errorf("100 integer digits: %v", err)
	}
	tooMany := dec(t, "1"+strings.Repeat("0", 100)+".0000000000") // 101 integer digits
	wantErr[*ResultOutOfRangeError](t, requireWithinIntegerDigits(tooMany), "result would exceed 100 integer digits")
	if err := requireWithinIntegerDigits(dec(t, "0.0000000000")); err != nil {
		t.Errorf("zero: %v", err)
	}
}
