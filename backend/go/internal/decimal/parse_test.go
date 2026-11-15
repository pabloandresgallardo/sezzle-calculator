package decimal_test

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/pabloandresgallardo/sezzle-calculator/backend/go/internal/decimal"
)

func TestParseAccepted(t *testing.T) {
	cases := []struct {
		literal   string
		plain     string
		scale     int32
		precision int
		signum    int
	}{
		{"0.1", "0.1", 1, 1, 1},
		{"1E+3", "1000", -3, 1, 1},
		{"1e3", "1000", -3, 1, 1},
		{"1e-3", "0.001", 3, 1, 1},
		{"1E1", "10", -1, 1, 1},
		{"1e+0", "1", 0, 1, 1},
		{"1e-0", "1", 0, 1, 1},
		{"1e00000000002", "100", -2, 1, 1},
		{"-0", "0", 0, 1, 0},
		{"0", "0", 0, 1, 0},
		{"0.0", "0", 1, 1, 0},
		{"-0.0", "0", 1, 1, 0},
		{"-0e5", "0", -5, 1, 0},
		{"0e-999999999", "0", 999999999, 1, 0},
		{"1.0e0", "1.0", 1, 2, 1},
		{"2.000", "2.000", 3, 4, 1},
		{"100e-2", "1.00", 2, 3, 1},
		{"-0.125", "-0.125", 3, 3, -1},
		{"999999999999999", "999999999999999", 0, 15, 1},
		{"-12.5", "-12.5", 1, 3, -1},
		{"1e-2147483647", "", 2147483647, 1, 1},
		{"1e2147483647", "", -2147483647, 1, 1},
		{"0.1e2147483648", "", -2147483647, 1, 1},
		{"0.12e2147483649", "", -2147483647, 2, 1},
		{"0.01e2147483649", "", -2147483647, 1, 1},
	}
	for _, tc := range cases {
		t.Run(tc.literal, func(t *testing.T) {
			d, err := decimal.Parse(tc.literal)
			if err != nil {
				t.Fatalf("Parse(%q) unexpected error: %v", tc.literal, err)
			}
			if d.Scale() != tc.scale {
				t.Errorf("Scale() = %d, want %d", d.Scale(), tc.scale)
			}
			if d.Precision() != tc.precision {
				t.Errorf("Precision() = %d, want %d", d.Precision(), tc.precision)
			}
			if d.Signum() != tc.signum {
				t.Errorf("Signum() = %d, want %d", d.Signum(), tc.signum)
			}
			if tc.plain != "" && d.PlainString() != tc.plain {
				t.Errorf("PlainString() = %q, want %q", d.PlainString(), tc.plain)
			}
		})
	}
}

func TestParseHugeExponentIsFastAndNotMaterialized(t *testing.T) {
	start := time.Now()
	d, err := decimal.Parse("1e999999999")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("Parse took %v; 10^exponent must not be materialized", elapsed)
	}
	if d.Precision() != 1 || d.Scale() != -999999999 {
		t.Fatalf("got precision %d scale %d, want 1 and -999999999", d.Precision(), d.Scale())
	}
	// Comparison must not materialize either.
	if d.Cmp(decimal.FromInt64(1)) != 1 {
		t.Fatalf("1e999999999 must compare greater than 1")
	}
	// Domain-style magnitude check: precision - scale.
	if int64(d.Precision())-int64(d.Scale()) != 1000000000 {
		t.Fatalf("unexpected adjusted magnitude")
	}
}

func TestParseScaleOverflow(t *testing.T) {
	for _, lit := range []string{
		"1e-2147483648",
		"0.1e-2147483647",
		"1.5e-2147483647",
		"10e-2147483648",
		"0e-2147483648",
		"1e2147483648",
		"10e2147483648",
		"12e2147483648",
		"0e2147483648",
		"1e9999999999",
		"0e9999999999",
		"1e-9999999999",
		"-1e" + strings.Repeat("9", 999),
	} {
		t.Run(lit[:min(len(lit), 30)], func(t *testing.T) {
			_, err := decimal.Parse(lit)
			if !errors.Is(err, decimal.ErrScaleOverflow) {
				t.Fatalf("Parse(%q) error = %v, want ErrScaleOverflow", lit, err)
			}
		})
	}
}

func TestParseDigitLimits(t *testing.T) {
	ones := func(n int) string { return strings.Repeat("1", n) }
	zeros := func(n int) string { return strings.Repeat("0", n) }
	cases := []struct {
		name    string
		literal string
		ok      bool
	}{
		{"int 1000", ones(1000), true},
		{"int 1001", ones(1001), false},
		{"neg int 1000", "-" + ones(1000), true},
		{"neg int 1001", "-" + ones(1001), false},
		{"0. + 999 zeros", "0." + zeros(999), true},
		{"0. + 1000 zeros", "0." + zeros(1000), false},
		{"1. + 999 zeros", "1." + zeros(999), true},
		{"1. + 1000 zeros", "1." + zeros(1000), false},
		{"999 int + .0", ones(999) + ".0", true},
		{"1000 int + .0", ones(1000) + ".0", false},
		{"500+500", ones(500) + "." + ones(500), true},
		{"501+501", ones(501) + "." + ones(501), false},
		{"500+501", ones(500) + "." + ones(501), false},
		{"1e + 999 exp digits", "1e" + zeros(999), true},
		{"1e + 1000 exp digits", "1e" + zeros(1000), false},
		{"1e- + 999 exp digits", "1e-" + zeros(999), true},
		{"1e+ + 1000 exp digits", "1e+" + zeros(1000), false},
		{"999 int e0", ones(999) + "e0", true},
		{"1000 int e0", ones(1000) + "e0", false},
		{"0. + 998 zeros e0", "0." + zeros(998) + "e0", true},
		{"0. + 999 zeros e0", "0." + zeros(999) + "e0", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := decimal.Parse(tc.literal)
			if tc.ok && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !tc.ok && !errors.Is(err, decimal.ErrTooManyDigits) {
				t.Fatalf("error = %v, want ErrTooManyDigits", err)
			}
		})
	}
}

func TestParseTooManyDigitsWinsOverScaleOverflow(t *testing.T) {
	_, err := decimal.Parse("1e-" + strings.Repeat("9", 1000))
	if !errors.Is(err, decimal.ErrTooManyDigits) {
		t.Fatalf("error = %v, want ErrTooManyDigits", err)
	}
}

func TestParseSyntaxErrors(t *testing.T) {
	for _, lit := range []string{
		"", "-", "00", "01", "-01", "+1", ".5", "5.", "1.", "1.e5", "NaN", "Infinity",
		"-Infinity", "0x10", "1e", "1e+", "1E-", "1.5.5", "--1", " 1", "1 ", "1,5",
		"1e5.0", "1ee5", "e5", "-.5", "١", "1_000", "0.-1",
	} {
		t.Run(lit, func(t *testing.T) {
			_, err := decimal.Parse(lit)
			if !errors.Is(err, decimal.ErrSyntax) {
				t.Fatalf("Parse(%q) error = %v, want ErrSyntax", lit, err)
			}
		})
	}
}
