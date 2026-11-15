// Package decimal implements the subset of java.math.BigDecimal semantics
// the calculator needs, on top of math/big, for exact parity with the Java
// backend.
//
// A Decimal is unscaled × 10^-scale, with an arbitrary-precision unscaled
// integer and an int32 scale, exactly like BigDecimal. Values are immutable:
// every method returns a new Decimal and never mutates its receiver or its
// arguments. The zero value is a usable zero (unscaled 0, scale 0).
//
// Rounding, wherever it happens, is HALF_EVEN. Operations whose Java
// counterpart throws ArithmeticException (scale overflow, division by zero,
// square root of a negative number, negative power) panic: callers enforce
// the domain limits before calling them.
//
// Some operations materialize 10^n to align scales (Add, Sub, Cmp of
// near-equal magnitudes, SetScale upwards, QuoScale, Sqrt, PlainString with a
// negative scale). Their cost grows with n, so callers must only use them on
// values within the domain limits (|x| < 1e15, scale ≤ 10 after
// normalization). Parse, Precision, Scale, Signum, Cmp of different
// magnitudes, StripTrailingZeros, IsInteger, Int and Log10Abs never do.
package decimal

import (
	"math"
	"math/big"
	"strings"
)

// Decimal is an immutable arbitrary-precision decimal: unscaled × 10^-scale.
type Decimal struct {
	unscaled *big.Int // nil means 0; never mutated after construction
	scale    int32
}

var (
	bigZero = big.NewInt(0)
	bigOne  = big.NewInt(1)
	bigTen  = big.NewInt(10)
)

// FromInt64 returns v with scale 0.
func FromInt64(v int64) Decimal {
	return Decimal{unscaled: big.NewInt(v)}
}

// int returns the unscaled value; the result must not be mutated.
func (d Decimal) int() *big.Int {
	if d.unscaled == nil {
		return bigZero
	}
	return d.unscaled
}

// Scale returns the BigDecimal scale.
func (d Decimal) Scale() int32 { return d.scale }

// Signum returns -1, 0 or 1. There is no negative zero.
func (d Decimal) Signum() int { return d.int().Sign() }

// Precision returns the number of decimal digits of the unscaled value;
// zero has precision 1, like BigDecimal.
func (d Decimal) Precision() int {
	return digitCount(d.int())
}

// digitCount returns the number of decimal digits of |x| (1 for 0).
func digitCount(x *big.Int) int {
	if x.Sign() == 0 {
		return 1
	}
	if x.IsInt64() {
		v := x.Int64()
		if v < 0 {
			if v == math.MinInt64 {
				return 19
			}
			v = -v
		}
		n := 1
		for v >= 10 {
			v /= 10
			n++
		}
		return n
	}
	return len(new(big.Int).Abs(x).String())
}

// Abs returns |d| with the same scale.
func (d Decimal) Abs() Decimal {
	if d.Signum() >= 0 {
		return d
	}
	return Decimal{unscaled: new(big.Int).Neg(d.int()), scale: d.scale}
}

// Neg returns -d with the same scale; negating zero yields zero.
func (d Decimal) Neg() Decimal {
	if d.Signum() == 0 {
		return d
	}
	return Decimal{unscaled: new(big.Int).Neg(d.int()), scale: d.scale}
}

// Cmp compares numerically (scale is ignored: 1 and 1.000 are equal) and
// returns -1, 0 or 1. Values whose magnitudes differ are decided without
// aligning scales, so huge exponents are never materialized.
func (d Decimal) Cmp(o Decimal) int {
	ds, os := d.Signum(), o.Signum()
	if ds != os {
		if ds < os {
			return -1
		}
		return 1
	}
	if ds == 0 {
		return 0
	}
	// Same non-zero sign: compare adjusted exponents (precision - scale)
	// first; |x| lies in [10^(adj-1), 10^adj).
	da := int64(d.Precision()) - int64(d.scale)
	oa := int64(o.Precision()) - int64(o.scale)
	if da != oa {
		if (da < oa) == (ds > 0) {
			return -1
		}
		return 1
	}
	// Same magnitude: the scale difference equals the precision difference,
	// so alignment is bounded by the operands' digit counts.
	a, b := align(d, o)
	return a.Cmp(b)
}

// align returns both unscaled values brought to the larger of the two scales.
func align(d, o Decimal) (*big.Int, *big.Int) {
	switch {
	case d.scale == o.scale:
		return d.int(), o.int()
	case d.scale < o.scale:
		return mulPow10(d.int(), int64(o.scale)-int64(d.scale)), o.int()
	default:
		return d.int(), mulPow10(o.int(), int64(d.scale)-int64(o.scale))
	}
}

// Add returns d + o exactly, with scale max(d.scale, o.scale).
func (d Decimal) Add(o Decimal) Decimal {
	a, b := align(d, o)
	return Decimal{unscaled: new(big.Int).Add(a, b), scale: max(d.scale, o.scale)}
}

// Sub returns d - o exactly, with scale max(d.scale, o.scale).
func (d Decimal) Sub(o Decimal) Decimal {
	a, b := align(d, o)
	return Decimal{unscaled: new(big.Int).Sub(a, b), scale: max(d.scale, o.scale)}
}

// Mul returns d × o exactly, with scale d.scale + o.scale.
// It panics if that scale overflows int32.
func (d Decimal) Mul(o Decimal) Decimal {
	return Decimal{
		unscaled: new(big.Int).Mul(d.int(), o.int()),
		scale:    checkScale(int64(d.scale) + int64(o.scale)),
	}
}

// MovePointLeft returns d × 10^-n like BigDecimal.movePointLeft: the result
// has scale max(d.scale + n, 0); n == 0 returns d unchanged. It panics if
// the new scale overflows int32.
func (d Decimal) MovePointLeft(n int32) Decimal {
	if n == 0 {
		return d
	}
	r := Decimal{unscaled: d.int(), scale: checkScale(int64(d.scale) + int64(n))}
	if r.scale < 0 {
		return r.SetScale(0)
	}
	return r
}

// StripTrailingZeros removes trailing zeros from the unscaled value,
// decreasing the scale accordingly. Any zero becomes 0 with scale 0, like
// BigDecimal since Java 8. It panics if the scale would drop below
// math.MinInt32 (Java throws ArithmeticException there).
func (d Decimal) StripTrailingZeros() Decimal {
	u := d.int()
	if u.Sign() == 0 {
		return Decimal{}
	}
	if u.Bit(0) == 1 { // odd: no trailing decimal zero
		return d
	}
	digits := u.String()
	end := len(digits)
	for digits[end-1] == '0' {
		end--
	}
	zeros := len(digits) - end
	if zeros == 0 {
		return d
	}
	stripped, _ := new(big.Int).SetString(digits[:end], 10)
	return Decimal{unscaled: stripped, scale: checkScale(int64(d.scale) - int64(zeros))}
}

// SetScale returns d with the given scale, rounding HALF_EVEN when digits
// are dropped. When more digits are dropped than d has, the result is zero
// without materializing 10^n.
func (d Decimal) SetScale(scale int32) Decimal {
	if scale == d.scale {
		return d
	}
	if scale > d.scale {
		return Decimal{unscaled: mulPow10(d.int(), int64(scale)-int64(d.scale)), scale: scale}
	}
	drop := int64(d.scale) - int64(scale)
	// |unscaled| < 10^precision ≤ 10^(drop-1) < 0.5 × 10^drop → rounds to 0.
	if int64(d.Precision()) < drop {
		return Decimal{unscaled: new(big.Int), scale: scale}
	}
	return Decimal{unscaled: quoHalfEven(d.int(), pow10(drop)), scale: scale}
}

// QuoScale returns d / o rounded HALF_EVEN to the given scale, like
// BigDecimal.divide(o, scale, RoundingMode.HALF_EVEN). It panics if o is 0.
func (d Decimal) QuoScale(o Decimal, scale int32) Decimal {
	if o.Signum() == 0 {
		panic("decimal: division by zero")
	}
	// d/o × 10^scale = ua × 10^k / ub with k = scale - d.scale + o.scale.
	k := int64(scale) - int64(d.scale) + int64(o.scale)
	num, den := d.int(), o.int()
	if k >= 0 {
		num = mulPow10(num, k)
	} else {
		// |ua| / (|ub| × 10^-k) < 10^(precision+k) ≤ 0.1 → rounds to 0.
		if int64(d.Precision()) < -k {
			return Decimal{unscaled: new(big.Int), scale: scale}
		}
		den = mulPow10(den, -k)
	}
	return Decimal{unscaled: quoHalfEven(num, den), scale: scale}
}

// Sqrt returns √d correctly rounded HALF_EVEN at the given scale. It
// computes the exact integer square root r of unscaled × 10^k (k = 2·scale -
// d.scale) and uses the remainder to decide the rounding (ties, possible only
// when 10^k is fractional, go to the even neighbour). For operands within the
// domain limits this equals Java's sqrt(DECIMAL128).setScale(scale,
// HALF_EVEN). It panics if d is negative.
func (d Decimal) Sqrt(scale int32) Decimal {
	if d.Signum() < 0 {
		panic("decimal: square root of a negative number")
	}
	if d.Signum() == 0 {
		return Decimal{unscaled: new(big.Int), scale: scale}
	}
	// √(u × 10^-s) × 10^scale = √(u × 10^k).
	k := 2*int64(scale) - int64(d.scale)
	num, den := d.int(), bigOne
	if k >= 0 {
		num = mulPow10(num, k)
	} else {
		// 4u < 10^(precision+1) ≤ 10^-k → u × 10^k < 1/4 → √ < 1/2 → 0.
		if int64(d.Precision())+1 < -k {
			return Decimal{unscaled: new(big.Int), scale: scale}
		}
		den = pow10(-k)
	}
	// x = num/den; r = floor(√x) = isqrt(floor(x)).
	r := new(big.Int).Sqrt(new(big.Int).Quo(num, den))
	// Round up iff √x > r + 1/2 ⇔ 4·num > (2r+1)²·den; tie when equal.
	lhs := new(big.Int).Lsh(num, 2)
	twoRPlus1 := new(big.Int).Lsh(r, 1)
	twoRPlus1.Add(twoRPlus1, bigOne)
	rhs := new(big.Int).Mul(twoRPlus1, twoRPlus1)
	rhs.Mul(rhs, den)
	if c := lhs.Cmp(rhs); c > 0 || (c == 0 && r.Bit(0) == 1) {
		r.Add(r, bigOne)
	}
	return Decimal{unscaled: r, scale: scale}
}

// PowInt returns d^e exactly, with scale d.scale × e (0^0 = 1, like
// BigDecimal.pow). It panics if e < 0 or the scale overflows int32.
func (d Decimal) PowInt(e int) Decimal {
	if e < 0 {
		panic("decimal: negative exponent")
	}
	scale := checkScale(int64(d.scale) * int64(e))
	return Decimal{unscaled: new(big.Int).Exp(d.int(), big.NewInt(int64(e)), nil), scale: scale}
}

// IsInteger reports whether the normalized value (StripTrailingZeros) has
// scale ≤ 0, i.e. whether d is a whole number.
func (d Decimal) IsInteger() bool {
	return d.StripTrailingZeros().scale <= 0
}

// Int returns d as an int when it is a whole number that fits in int.
func (d Decimal) Int() (int, bool) {
	n := d.StripTrailingZeros()
	if n.scale > 0 {
		return 0, false
	}
	v := n.int()
	if n.scale < 0 {
		// Non-zero (zero normalizes to scale 0) with ≥ 20 digits never fits.
		if int64(n.Precision())-int64(n.scale) > 19 {
			return 0, false
		}
		v = mulPow10(v, -int64(n.scale))
	}
	if !v.IsInt64() || v.Int64() < math.MinInt || v.Int64() > math.MaxInt {
		return 0, false
	}
	return int(v.Int64()), true
}

// Log10Abs returns log10(|unscaled| as float64) - scale, mirroring Java's
// Math.log10(unscaled.doubleValue()) - scale. It is meant for estimates on
// values whose unscaled part has at most 15 digits (exactly representable as
// a float64). Zero yields -Inf.
func (d Decimal) Log10Abs() float64 {
	u := d.int()
	if u.Sign() == 0 {
		return math.Inf(-1)
	}
	f, _ := new(big.Float).SetInt(new(big.Int).Abs(u)).Float64()
	return math.Log10(f) - float64(d.scale)
}

// PlainString formats like BigDecimal.toPlainString (no exponent, the
// scale's fraction digits kept), except that every zero is "0": a minus sign
// only appears on non-zero values.
func (d Decimal) PlainString() string {
	u := d.int()
	if u.Sign() == 0 {
		return "0"
	}
	digits := new(big.Int).Abs(u).String()
	var b strings.Builder
	if u.Sign() < 0 {
		b.WriteByte('-')
	}
	switch {
	case d.scale == 0:
		b.WriteString(digits)
	case d.scale < 0:
		b.WriteString(digits)
		b.WriteString(strings.Repeat("0", -int(d.scale)))
	case int(d.scale) >= len(digits):
		b.WriteString("0.")
		b.WriteString(strings.Repeat("0", int(d.scale)-len(digits)))
		b.WriteString(digits)
	default:
		point := len(digits) - int(d.scale)
		b.WriteString(digits[:point])
		b.WriteByte('.')
		b.WriteString(digits[point:])
	}
	return b.String()
}

// checkScale narrows a computed scale to int32, panicking on overflow like
// BigDecimal's ArithmeticException.
func checkScale(s int64) int32 {
	if s < math.MinInt32 || s > math.MaxInt32 {
		panic("decimal: scale overflow")
	}
	return int32(s)
}

// pow10 returns 10^n for n ≥ 0.
func pow10(n int64) *big.Int {
	return new(big.Int).Exp(bigTen, big.NewInt(n), nil)
}

// mulPow10 returns x × 10^n (n ≥ 0) as a new value.
func mulPow10(x *big.Int, n int64) *big.Int {
	if n == 0 || x.Sign() == 0 {
		return new(big.Int).Set(x)
	}
	return new(big.Int).Mul(x, pow10(n))
}

// quoHalfEven returns num/den rounded HALF_EVEN (den ≠ 0). The result is a
// plain big.Int, so a rounded-to-zero negative quotient is 0, never -0.
func quoHalfEven(num, den *big.Int) *big.Int {
	q, r := new(big.Int).QuoRem(num, den, new(big.Int))
	if r.Sign() == 0 {
		return q
	}
	twiceR := r.Abs(r)
	twiceR.Lsh(twiceR, 1)
	c := twiceR.Cmp(new(big.Int).Abs(den))
	if c > 0 || (c == 0 && q.Bit(0) == 1) {
		if (num.Sign() < 0) != (den.Sign() < 0) {
			q.Sub(q, bigOne)
		} else {
			q.Add(q, bigOne)
		}
	}
	return q
}
