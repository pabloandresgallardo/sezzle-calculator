package com.sezzle.calculator.domain.model;

import com.sezzle.calculator.domain.exception.ResultOutOfRangeException;
import java.math.BigDecimal;

/** Cost bound for {@link Operation#POWER}: decides from a cheap log estimate whether {@code base^e} is worth computing. */
final class PowerBounds {

    enum Estimate {
        TOO_LARGE,
        ROUNDS_TO_ZERO,
        COMPUTE
    }

    static final int MAX_INTEGER_DIGITS = 100;

    /** One digit of margin over the limit covers the error of the {@code double} estimate. */
    private static final double TOO_LARGE_LOG10 = MAX_INTEGER_DIGITS + 1;

    /** Below 10^-11 the result rounds to 0 at the 10-decimal result scale. */
    private static final double ROUNDS_TO_ZERO_LOG10 = -11;

    private PowerBounds() {}

    static Estimate estimate(BigDecimal base, int exponent) {
        BigDecimal magnitude = base.abs();
        // log10 is undefined for 0 and 0 for 1: both are trivial to compute directly.
        if (magnitude.signum() == 0 || magnitude.compareTo(BigDecimal.ONE) == 0) {
            return Estimate.COMPUTE;
        }
        // The unscaled value has at most 15 digits (Operand bound), so it is exact as a double.
        double log10 = Math.log10(magnitude.unscaledValue().doubleValue()) - magnitude.scale();
        double resultLog10 = exponent * log10;
        if (resultLog10 > TOO_LARGE_LOG10) {
            return Estimate.TOO_LARGE;
        }
        if (resultLog10 < ROUNDS_TO_ZERO_LOG10) {
            return Estimate.ROUNDS_TO_ZERO;
        }
        return Estimate.COMPUTE;
    }

    static void requireWithinIntegerDigits(BigDecimal result) {
        if (result.precision() - result.scale() > MAX_INTEGER_DIGITS) {
            throw new ResultOutOfRangeException();
        }
    }
}
