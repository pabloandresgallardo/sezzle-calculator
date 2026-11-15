package decimal

import (
	"errors"
	"fmt"
	"math"
	"math/big"
)

// Errors returned by Parse. They are sentinel values: test them with errors.Is.
var (
	// ErrSyntax reports a literal that is not a strict JSON number.
	ErrSyntax = errors.New("decimal: invalid number syntax")
	// ErrTooManyDigits reports a literal over Jackson's maxNumberLength (1000).
	ErrTooManyDigits = errors.New("decimal: number literal has too many digits")
	// ErrScaleOverflow reports a literal whose BigDecimal scale is outside
	// [-2147483647, 2147483647].
	ErrScaleOverflow = errors.New("decimal: number scale out of range")
)

// maxNumberLength is Jackson's StreamReadConstraints.maxNumberLength default.
const maxNumberLength = 1000

// maxParseScale bounds |fracDigits - exponent| like Jackson does
// (math.MinInt32 itself is rejected).
const maxParseScale = math.MaxInt32

// Parse converts a JSON number literal into a Decimal with the exact
// unscaled value and scale that Jackson's BigDecimal reading produces:
//   - grammar: -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?
//   - an integer literal (no fraction, no exponent) may have at most 1000
//     digits; any other literal at most 1000 digits counting integer,
//     fraction and exponent digits together (signs, '.', 'e' not counted);
//   - scale = fracDigits - exponent, computed without overflow, must lie in
//     [-2147483647, 2147483647].
//
// 10^exponent is never materialized: "1e999999999" yields unscaled 1 and
// scale -999999999.
func Parse(literal string) (Decimal, error) {
	s := literal
	i := 0
	negative := false
	if i < len(s) && s[i] == '-' {
		negative = true
		i++
	}

	intStart := i
	switch {
	case i < len(s) && s[i] == '0':
		i++
	case i < len(s) && s[i] >= '1' && s[i] <= '9':
		for i < len(s) && isDigit(s[i]) {
			i++
		}
	default:
		return Decimal{}, syntaxError(literal)
	}
	intDigits := s[intStart:i]

	fracDigits := ""
	if i < len(s) && s[i] == '.' {
		i++
		start := i
		for i < len(s) && isDigit(s[i]) {
			i++
		}
		if i == start {
			return Decimal{}, syntaxError(literal)
		}
		fracDigits = s[start:i]
	}

	hasExp := false
	expNegative := false
	expDigits := ""
	if i < len(s) && (s[i] == 'e' || s[i] == 'E') {
		hasExp = true
		i++
		if i < len(s) && (s[i] == '+' || s[i] == '-') {
			expNegative = s[i] == '-'
			i++
		}
		start := i
		for i < len(s) && isDigit(s[i]) {
			i++
		}
		if i == start {
			return Decimal{}, syntaxError(literal)
		}
		expDigits = s[start:i]
	}

	if i != len(s) {
		// Includes a leading zero followed by digits ("00", "01").
		return Decimal{}, syntaxError(literal)
	}

	isInteger := fracDigits == "" && !hasExp
	if isInteger {
		if len(intDigits) > maxNumberLength {
			return Decimal{}, tooManyDigitsError(len(intDigits))
		}
	} else if total := len(intDigits) + len(fracDigits) + len(expDigits); total > maxNumberLength {
		return Decimal{}, tooManyDigitsError(total)
	}

	scale, err := literalScale(len(fracDigits), expNegative, expDigits)
	if err != nil {
		return Decimal{}, err
	}

	u, ok := new(big.Int).SetString(intDigits+fracDigits, 10)
	if !ok { // unreachable: the grammar guarantees ASCII digits
		return Decimal{}, syntaxError(literal)
	}
	if negative {
		u.Neg(u) // big.Int has no negative zero, so "-0" stays 0
	}
	return Decimal{unscaled: u, scale: scale}, nil
}

// literalScale computes fracDigits - exponent with arbitrary precision and
// checks it against [-maxParseScale, maxParseScale].
func literalScale(fracDigits int, expNegative bool, expDigits string) (int32, error) {
	scale := big.NewInt(int64(fracDigits))
	if expDigits != "" {
		exp, _ := new(big.Int).SetString(expDigits, 10)
		if expNegative {
			scale.Add(scale, exp)
		} else {
			scale.Sub(scale, exp)
		}
	}
	if !scale.IsInt64() || scale.Int64() > maxParseScale || scale.Int64() < -maxParseScale {
		return 0, fmt.Errorf("%w: scale %s", ErrScaleOverflow, abbreviate(scale.String()))
	}
	return int32(scale.Int64()), nil
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

func syntaxError(literal string) error {
	return fmt.Errorf("%w: %q", ErrSyntax, abbreviate(literal))
}

func tooManyDigitsError(n int) error {
	return fmt.Errorf("%w: %d digits (max %d)", ErrTooManyDigits, n, maxNumberLength)
}

// abbreviate keeps error messages bounded for very long inputs.
func abbreviate(s string) string {
	const limit = 40
	if len(s) <= limit {
		return s
	}
	return s[:limit] + "..."
}
