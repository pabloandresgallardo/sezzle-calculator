package decimal_test

import (
	"math"
	"strconv"
	"strings"
	"testing"

	"github.com/pabloandresgallardo/sezzle-calculator/backend/go/internal/decimal"
)

// mustParse parses a literal or fails the test.
func mustParse(t *testing.T, literal string) decimal.Decimal {
	t.Helper()
	d, err := decimal.Parse(literal)
	if err != nil {
		t.Fatalf("Parse(%q): %v", literal, err)
	}
	return d
}

// operand mimics Java's Operand: parse, then stripTrailingZeros.
func operand(t *testing.T, literal string) decimal.Decimal {
	t.Helper()
	return mustParse(t, literal).StripTrailingZeros()
}

// result mimics CalculationResult: stripTrailingZeros().toPlainString().
func result(d decimal.Decimal) string {
	return d.StripTrailingZeros().PlainString()
}

func expectPanic(t *testing.T, name string, f func()) {
	t.Helper()
	defer func() {
		if recover() == nil {
			t.Fatalf("%s: expected panic", name)
		}
	}()
	f()
}

func TestPlainString(t *testing.T) {
	cases := []struct {
		literal string
		want    string
	}{
		{"1E+30", "1000000000000000000000000000000"},
		{"0.000", "0"},
		{"-0", "0"},
		{"-0.000", "0"},
		{"0e+5", "0"},
		{"-0.125", "-0.125"},
		{"1E-22", "0.0000000000000000000001"},
		{"-1E-3", "-0.001"},
		{"123.45", "123.45"},
		{"-12E+2", "-1200"},
		{"1.50", "1.50"},
	}
	for _, tc := range cases {
		t.Run(tc.literal, func(t *testing.T) {
			if got := mustParse(t, tc.literal).PlainString(); got != tc.want {
				t.Fatalf("PlainString() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestZeroValueIsUsableZero(t *testing.T) {
	var z decimal.Decimal
	if z.Signum() != 0 || z.PlainString() != "0" || z.Precision() != 1 || z.Scale() != 0 {
		t.Fatalf("zero value is not a usable zero")
	}
	if got := z.Add(decimal.FromInt64(2)).PlainString(); got != "2" {
		t.Fatalf("0 + 2 = %q", got)
	}
}

func TestFromInt64(t *testing.T) {
	for _, v := range []int64{0, 1, -1, 42, math.MaxInt64, math.MinInt64} {
		d := decimal.FromInt64(v)
		if d.PlainString() != strconv.FormatInt(v, 10) || d.Scale() != 0 {
			t.Fatalf("FromInt64(%d) = %q scale %d", v, d.PlainString(), d.Scale())
		}
	}
}

func TestStripTrailingZeros(t *testing.T) {
	cases := []struct {
		literal   string
		plain     string
		scale     int32
		precision int
	}{
		{"0.000", "0", 0, 1},
		{"-0e5", "0", 0, 1},
		{"1.0e0", "1", 0, 1},
		{"2.000", "2", 0, 1},
		{"100e-2", "1", 0, 1},
		{"1000", "1000", -3, 1},
		{"0.00000000010", "0.0000000001", 10, 1},
		{"1000000000000000e-1", "100000000000000", -14, 1},
		{"-12.500", "-12.5", 1, 3},
		{"123", "123", 0, 3},
	}
	for _, tc := range cases {
		t.Run(tc.literal, func(t *testing.T) {
			d := mustParse(t, tc.literal).StripTrailingZeros()
			if d.PlainString() != tc.plain || d.Scale() != tc.scale || d.Precision() != tc.precision {
				t.Fatalf("got %q scale %d precision %d, want %q scale %d precision %d",
					d.PlainString(), d.Scale(), d.Precision(), tc.plain, tc.scale, tc.precision)
			}
		})
	}
}

func TestStripTrailingZerosScaleUnderflowPanics(t *testing.T) {
	d := mustParse(t, "100e2147483647") // scale -2147483647; stripping needs -2147483649
	expectPanic(t, "StripTrailingZeros", func() { d.StripTrailingZeros() })
}

func TestSignumAbsNeg(t *testing.T) {
	n := mustParse(t, "-2.5")
	if n.Signum() != -1 || n.Abs().PlainString() != "2.5" || n.Neg().PlainString() != "2.5" {
		t.Fatalf("negative handling wrong")
	}
	p := mustParse(t, "2.5")
	if p.Signum() != 1 || p.Abs().PlainString() != "2.5" || p.Neg().PlainString() != "-2.5" {
		t.Fatalf("positive handling wrong")
	}
	z := mustParse(t, "0.0")
	if z.Neg().PlainString() != "0" || z.Neg().Signum() != 0 || z.Neg().Scale() != 1 {
		t.Fatalf("negating zero must keep scale and never yield -0")
	}
	// Immutability: Neg must not alter the receiver.
	if n.PlainString() != "-2.5" {
		t.Fatalf("receiver mutated")
	}
}

func TestCmp(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"1", "1.000", 0},
		{"0", "-0.0", 0},
		{"0.1", "0.2", -1},
		{"-0.1", "-0.2", 1},
		{"1e999999999", "1", 1},
		{"1", "1e999999999", -1},
		{"-1e999999999", "1", -1},
		{"1e-999999999", "0", 1},
		{"0", "1e-999999999", -1},
		{"1e-999999999", "1e-999999998", -1},
		{"999999999999999", "1e15", -1},
		{"10", "9.99", 1},
		{"-10", "-9.99", -1},
		{"12.5", "12.50", 0},
		{"12.5", "12.51", -1},
	}
	for _, tc := range cases {
		t.Run(tc.a+" vs "+tc.b, func(t *testing.T) {
			if got := mustParse(t, tc.a).Cmp(mustParse(t, tc.b)); got != tc.want {
				t.Fatalf("Cmp = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestAddSubMulExact(t *testing.T) {
	cases := []struct {
		a, b          string
		add, sub, mul string
	}{
		{"0.1", "0.2", "0.3", "-0.1", "0.02"},
		{"1E+3", "1e-3", "1000.001", "999.999", "1"},
		{"999999999999999", "999999999999999", "1999999999999998", "0", "999999999999998000000000000001"},
		{"-999999999999999", "999999999999999", "0", "-1999999999999998", "-999999999999998000000000000001"},
		{"5", "8", "13", "-3", "40"},
		{"-2.5", "0", "-2.5", "-2.5", "0"},
		{"-0.0", "5", "5", "-5", "0"},
		{"0.0000000001", "0.0000000001", "0.0000000002", "0", "0.00000000000000000001"},
	}
	for _, tc := range cases {
		t.Run(tc.a+" "+tc.b, func(t *testing.T) {
			a, b := operand(t, tc.a), operand(t, tc.b)
			if got := result(a.Add(b)); got != tc.add {
				t.Errorf("add = %q, want %q", got, tc.add)
			}
			if got := result(a.Sub(b)); got != tc.sub {
				t.Errorf("sub = %q, want %q", got, tc.sub)
			}
			if got := result(a.Mul(b)); got != tc.mul {
				t.Errorf("mul = %q, want %q", got, tc.mul)
			}
		})
	}
}

func TestAddScaleIsMax(t *testing.T) {
	got := mustParse(t, "1.5").Add(mustParse(t, "2.25"))
	if got.Scale() != 2 || got.PlainString() != "3.75" {
		t.Fatalf("got %q scale %d", got.PlainString(), got.Scale())
	}
	got = mustParse(t, "1.50").Add(mustParse(t, "2.5"))
	if got.Scale() != 2 || got.PlainString() != "4.00" {
		t.Fatalf("got %q scale %d", got.PlainString(), got.Scale())
	}
}

func TestMulScaleOverflowPanics(t *testing.T) {
	a := mustParse(t, "1e-2147483647")
	expectPanic(t, "Mul", func() { a.Mul(a) })
}

func TestMovePointLeft(t *testing.T) {
	// percentage: a.multiply(b).movePointLeft(2)
	p := decimal.FromInt64(20).Mul(decimal.FromInt64(150)).MovePointLeft(2)
	if result(p) != "30" || p.Scale() != 2 || p.PlainString() != "30.00" {
		t.Fatalf("20*150 moved 2 = %q (scale %d)", p.PlainString(), p.Scale())
	}
	cases := []struct {
		a, b, want string
	}{
		{"12.5", "80", "10"},
		{"0.1", "0.1", "0.0001"},
		{"-15", "200", "-30"},
		{"0", "-5", "0"},
		{"-0.0000000001", "0.0000000001", "-0.0000000000000000000001"},
		{"999999999999999", "999999999999999", "9999999999999980000000000000.01"},
	}
	for _, tc := range cases {
		got := result(operand(t, tc.a).Mul(operand(t, tc.b)).MovePointLeft(2))
		if got != tc.want {
			t.Errorf("percentage %s %s = %q, want %q", tc.a, tc.b, got, tc.want)
		}
	}
	// Java: resulting scale is max(scale+n, 0).
	m := mustParse(t, "1E+5").MovePointLeft(2)
	if m.Scale() != 0 || m.PlainString() != "1000" {
		t.Fatalf("1E+5 moved 2 = %q scale %d", m.PlainString(), m.Scale())
	}
	// n == 0 returns the receiver unchanged (scale kept, even negative).
	same := mustParse(t, "1E+5").MovePointLeft(0)
	if same.Scale() != -5 {
		t.Fatalf("MovePointLeft(0) changed scale to %d", same.Scale())
	}
	// Negative n moves the point right.
	r := mustParse(t, "1.25").MovePointLeft(-1)
	if r.PlainString() != "12.5" || r.Scale() != 1 {
		t.Fatalf("1.25 moved -1 = %q scale %d", r.PlainString(), r.Scale())
	}
	expectPanic(t, "MovePointLeft", func() { mustParse(t, "1e-2147483647").MovePointLeft(1) })
}

func TestSetScaleHalfEven(t *testing.T) {
	cases := []struct {
		literal string
		scale   int32
		want    string
	}{
		{"0.125", 2, "0.12"},
		{"0.135", 2, "0.14"},
		{"-0.125", 2, "-0.12"},
		{"-0.135", 2, "-0.14"},
		{"0.1251", 2, "0.13"},
		{"2.5", 0, "2"},
		{"3.5", 0, "4"},
		{"-2.5", 0, "-2"},
		{"-0.4", 0, "0"},
		{"-0.0004", 3, "0"},
		{"1.5", 3, "1.500"},
		{"1E+3", 2, "1000.00"},
		{"1E+3", -2, "1000"},
		{"1250", -2, "1200"},
		{"1350", -2, "1400"},
		{"0.00000000005", 10, "0"},
		{"0.00000000015", 10, "0.0000000002"},
		{"0.00000000025", 10, "0.0000000002"},
		{"0.00000000026", 10, "0.0000000003"},
		{"5", -1, "0"},
		{"6", -1, "10"},
		{"7", 0, "7"},
	}
	for _, tc := range cases {
		t.Run(tc.literal, func(t *testing.T) {
			got := mustParse(t, tc.literal).SetScale(tc.scale)
			if got.PlainString() != tc.want || got.Scale() != tc.scale {
				t.Fatalf("SetScale(%d) = %q scale %d, want %q", tc.scale, got.PlainString(), got.Scale(), tc.want)
			}
		})
	}
}

func TestSetScaleTinyValueDoesNotMaterialize(t *testing.T) {
	got := mustParse(t, "-1e-2147483647").SetScale(10)
	if got.Signum() != 0 || got.Scale() != 10 || got.PlainString() != "0" {
		t.Fatalf("got %q scale %d", got.PlainString(), got.Scale())
	}
	// Exactly at the boundary (precision == digits dropped) still rounds correctly.
	if got := mustParse(t, "6").SetScale(-1).PlainString(); got != "10" {
		t.Fatalf("6 setScale(-1) = %q", got)
	}
}

func TestQuoScale(t *testing.T) {
	cases := []struct {
		a, b, want string
	}{
		{"1", "3", "0.3333333333"},
		{"2", "3", "0.6666666667"},
		{"6", "3", "2"},
		{"1", "8", "0.125"},
		{"1", "2048", "0.0004882812"},
		{"3", "2e10", "0.0000000002"},
		{"5", "2e10", "0.0000000002"},
		{"1", "2e10", "0"},
		{"-1", "2e10", "0"},
		{"-1", "3", "-0.3333333333"},
		{"1", "-3", "-0.3333333333"},
		{"-2", "-3", "0.6666666667"},
		{"0", "-5", "0"},
		{"0.0000000001", "3", "0"},
		{"999999999999999", "0.0000000001", "9999999999999990000000000"},
		{"1E+14", "1E-10", "1000000000000000000000000"},
	}
	for _, tc := range cases {
		t.Run(tc.a+"/"+tc.b, func(t *testing.T) {
			q := operand(t, tc.a).QuoScale(operand(t, tc.b), 10)
			if q.Scale() != 10 {
				t.Errorf("scale = %d, want 10", q.Scale())
			}
			if got := result(q); got != tc.want {
				t.Fatalf("QuoScale = %q, want %q", got, tc.want)
			}
			if q.PlainString() == "-0" || strings.HasPrefix(q.PlainString(), "-0.0000000000") {
				t.Fatalf("negative zero produced: %q", q.PlainString())
			}
		})
	}
}

func TestQuoScaleTinyQuotientDoesNotMaterialize(t *testing.T) {
	q := mustParse(t, "1e-2147483647").QuoScale(decimal.FromInt64(3), 10)
	if q.Signum() != 0 || q.Scale() != 10 {
		t.Fatalf("got %q scale %d", q.PlainString(), q.Scale())
	}
}

func TestQuoScaleBelowOperandScale(t *testing.T) {
	cases := []struct {
		a, b  string
		scale int32
		want  string
	}{
		{"1.25", "1", 0, "1"},
		{"1.5", "1", 0, "2"},
		{"-2.5", "1", 0, "-2"},
		{"0.125", "0.5", 1, "0.2"},
		{"1250", "1", -2, "1200"},
	}
	for _, tc := range cases {
		q := mustParse(t, tc.a).QuoScale(mustParse(t, tc.b), tc.scale)
		if q.Scale() != tc.scale || result(q) != tc.want {
			t.Errorf("%s/%s at scale %d = %q (scale %d), want %q", tc.a, tc.b, tc.scale, result(q), q.Scale(), tc.want)
		}
	}
}

func TestPrecisionLargeAndMinInt64(t *testing.T) {
	if p := decimal.FromInt64(math.MinInt64).Precision(); p != 19 {
		t.Fatalf("Precision(MinInt64) = %d, want 19", p)
	}
	if p := mustParse(t, "-"+strings.Repeat("9", 40)).Precision(); p != 40 {
		t.Fatalf("Precision(40 nines) = %d, want 40", p)
	}
}

func TestQuoScaleByZeroPanics(t *testing.T) {
	expectPanic(t, "QuoScale", func() { decimal.FromInt64(1).QuoScale(mustParse(t, "-0.000"), 10) })
}

func TestSqrt(t *testing.T) {
	cases := []struct {
		literal string
		scale   int32
		want    string
	}{
		{"2", 10, "1.4142135624"},
		{"3", 10, "1.7320508076"},
		{"16", 10, "4"},
		{"0.25", 10, "0.5"},
		{"999999999999999", 10, "31622776.6016837775"},
		{"0.0000000001", 10, "0.00001"},
		{"0.0000000002", 10, "0.0000141421"},
		{"0", 10, "0"},
		{"-0", 10, "0"},
		{"1E+14", 10, "10000000"},
		{"1E+3", 10, "31.6227766017"},
		// HALF_EVEN with exact ties (sqrt is exactly x.5 at the target scale).
		{"2.25", 0, "2"},
		{"6.25", 0, "2"},
		{"12.25", 0, "4"},
		{"0.25", 0, "0"},
		{"0.0225", 1, "0.2"},
		{"0.1225", 1, "0.4"},
		// Remainder decides when there is no tie.
		{"2", 0, "1"},
		{"3", 0, "2"},
		{"8", 0, "3"},
		// Negative target scale.
		{"2500", -1, "50"},
		{"3025", -1, "60"},
		{"2025", -1, "40"},
	}
	for _, tc := range cases {
		t.Run(tc.literal, func(t *testing.T) {
			s := operand(t, tc.literal).Sqrt(tc.scale)
			if s.Scale() != tc.scale {
				t.Errorf("scale = %d, want %d", s.Scale(), tc.scale)
			}
			if got := result(s); got != tc.want {
				t.Fatalf("Sqrt(%d) = %q, want %q", tc.scale, got, tc.want)
			}
		})
	}
}

func TestSqrtRawScale(t *testing.T) {
	// Unnormalized input with odd scale.
	if got := result(mustParse(t, "2.000").Sqrt(10)); got != "1.4142135624" {
		t.Fatalf("got %q", got)
	}
	if got := result(mustParse(t, "1e-2147483647").Sqrt(10)); got != "0" {
		t.Fatalf("tiny sqrt = %q", got)
	}
}

func TestSqrtNegativePanics(t *testing.T) {
	expectPanic(t, "Sqrt", func() { decimal.FromInt64(-1).Sqrt(10) })
}

func TestPowInt(t *testing.T) {
	cases := []struct {
		base string
		e    int
		want string
	}{
		{"2", 64, "18446744073709551616"},
		{"0", 0, "1"},
		{"2", 0, "1"},
		{"0", 1000, "0"},
		{"-2", 3, "-8"},
		{"1.5", 3, "3.375"},
		{"-1", 999, "-1"},
		{"999999999999999", 6, "999999999999994000000000000014999999999999980000000000000014999999999999994000000000000001"},
		{"2", 332, "8749002899132047697490008908470485461412677723572849745703082425639811996797503692894052708092215296"},
	}
	for _, tc := range cases {
		t.Run(tc.base, func(t *testing.T) {
			if got := result(operand(t, tc.base).PowInt(tc.e)); got != tc.want {
				t.Fatalf("PowInt = %q, want %q", got, tc.want)
			}
		})
	}
	p := mustParse(t, "1.5").PowInt(3)
	if p.Scale() != 3 {
		t.Fatalf("exact power scale = %d, want 3", p.Scale())
	}
}

func TestPowIntThenSetScale(t *testing.T) {
	cases := []struct {
		base string
		e    int
		want string
	}{
		{"0.1234567891", 3, "0.0018816764"},
		{"0.5", 10, "0.0009765625"},
		{"0.5", 11, "0.0004882812"},
		{"-0.5", 11, "-0.0004882812"},
		{"0.1", 11, "0"},
		{"1.0000000001", 1000, "1.0000001"},
		{"0.9999999999", 1000, "0.9999999"},
		{"9.9999999999", 100, "9999999990000000004949999998383000000392122499924712480011920523998399243920186087894280977681917731.0309455024"},
	}
	for _, tc := range cases {
		t.Run(tc.base, func(t *testing.T) {
			if got := result(operand(t, tc.base).PowInt(tc.e).SetScale(10)); got != tc.want {
				t.Fatalf("PowInt.SetScale(10) = %q, want %q", got, tc.want)
			}
		})
	}
	// Negative exponent path in the domain: ONE.divide(base.pow(-e), 10, HALF_EVEN).
	if got := result(decimal.FromInt64(1).QuoScale(operand(t, "3").PowInt(5), 10)); got != "0.0041152263" {
		t.Fatalf("3^-5 = %q", got)
	}
	if got := result(decimal.FromInt64(1).QuoScale(operand(t, "2").PowInt(34), 10)); got != "0.0000000001" {
		t.Fatalf("2^-34 = %q", got)
	}
}

func TestPowIntPanics(t *testing.T) {
	expectPanic(t, "negative exponent", func() { decimal.FromInt64(2).PowInt(-1) })
	expectPanic(t, "scale overflow", func() { mustParse(t, "1e-2147483647").PowInt(2) })
}

func TestIsIntegerAndInt(t *testing.T) {
	cases := []struct {
		literal string
		isInt   bool
		val     int
		ok      bool
	}{
		{"2", true, 2, true},
		{"2.0", true, 2, true},
		{"-0", true, 0, true},
		{"0.000", true, 0, true},
		{"1E+3", true, 1000, true},
		{"-1000", true, -1000, true},
		{"2.5", false, 0, false},
		{"1e-10", false, 0, false},
		{"1e999999999", true, 0, false},
		{"99999999999999999999", true, 0, false},
		{"9223372036854775807", true, math.MaxInt64, true},
		{"-9223372036854775808", true, math.MinInt64, true},
		{"9223372036854775808", true, 0, false},
		{"1E+18", true, 1000000000000000000, true},
		{"1E+19", true, 0, false},
		{"1E+20", true, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.literal, func(t *testing.T) {
			d := mustParse(t, tc.literal)
			if d.IsInteger() != tc.isInt {
				t.Errorf("IsInteger() = %v, want %v", d.IsInteger(), tc.isInt)
			}
			v, ok := d.Int()
			if ok != tc.ok || (ok && v != tc.val) {
				t.Errorf("Int() = (%d, %v), want (%d, %v)", v, ok, tc.val, tc.ok)
			}
		})
	}
}

func TestLog10Abs(t *testing.T) {
	cases := []struct {
		literal string
		want    float64
	}{
		{"10", 1},
		{"1E+2", 2},
		{"-1000", 3},
		{"0.001", -3},
		{"2", math.Log10(2)},
		{"0.1234567891", math.Log10(1234567891) - 10},
		{"999999999999999", math.Log10(999999999999999)},
	}
	for _, tc := range cases {
		t.Run(tc.literal, func(t *testing.T) {
			got := operand(t, tc.literal).Log10Abs()
			if math.Abs(got-tc.want) > 1e-12 {
				t.Fatalf("Log10Abs() = %v, want %v", got, tc.want)
			}
		})
	}
	if !math.IsInf(decimal.FromInt64(0).Log10Abs(), -1) {
		t.Fatalf("Log10Abs(0) must be -Inf")
	}
}
